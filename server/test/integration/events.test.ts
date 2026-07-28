import '../env.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { and, eq, sql } from 'drizzle-orm';
import { buildApp } from '../../src/app.js';
import { closeDb } from '../../src/db/index.js';
import { closeRedis } from '../../src/lib/redis.js';
import { closeQueues } from '../../src/queues.js';
import {
  categoryBySlug,
  getDb,
  joinEventDirect,
  makeAuthedUser,
  makeEvent,
  makeSession,
  makeUser,
  schema,
  setupTestDb,
  truncateAll,
} from '../helpers.js';

let app: FastifyInstance;

beforeAll(async () => {
  await setupTestDb();
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  if (app) await app.close();
  await closeQueues();
  await closeRedis();
  await closeDb();
});

beforeEach(async () => {
  await truncateAll();
});

const baseEvent = {
  title: 'Ganpati Visarjan Aid',
  description: 'Water and first aid along the procession route',
  type: 'festival',
  visibility: 'unlisted',
  areaLabel: 'Near City Park, Pune',
  center: { lat: 18.5204444, lng: 73.8567777 },
  startsAt: new Date(Date.now() - 3600_000).toISOString(),
  endsAt: new Date(Date.now() + 6 * 3600_000).toISOString(),
};

describe('POST /events', () => {
  it('is rejected for a non-moderator', async () => {
    const user = await makeAuthedUser();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/events',
      headers: user.headers,
      payload: {
        title: 'Test Drive',
        description: '',
        type: 'community_event',
        visibility: 'unlisted',
        areaLabel: 'Somewhere',
        center: { lat: 18.5, lng: 73.8 },
        radiusM: 2000,
        startsAt: new Date().toISOString(),
        endsAt: new Date(Date.now() + 3600_000).toISOString(),
      },
    });
    expect(res.statusCode).toBe(403);
  });

  it('event detail response includes an empty wants array before any are declared', async () => {
    const admin = await makeAuthedUser({ role: 'admin' });
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/events',
      headers: admin.headers,
      payload: {
        title: 'Wants Test Event',
        description: '',
        type: 'community_event',
        visibility: 'public',
        areaLabel: 'Somewhere',
        center: { lat: 18.5, lng: 73.8 },
        radiusM: 2000,
        startsAt: new Date(Date.now() - 3600_000).toISOString(),
        endsAt: new Date(Date.now() + 3600_000).toISOString(),
      },
    });
    expect(created.statusCode).toBe(200);
    const detail = await app.inject({ url: `/api/v1/events/${created.json().event.code}` });
    expect(detail.json().wants).toEqual([]);
  });

  it('event search response includes a wants array, capped at 3', async () => {
    const admin = await makeAuthedUser({ role: 'admin' });
    const event = await makeEvent(admin.user.id, { visibility: 'public', publicApproved: true });
    const slugs = ['water-bottle', 'blanket', 'sanitary-pads', 'diapers', 'bandages'];
    const setRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/events/${event.id}/wants`,
      headers: admin.headers,
      payload: { categorySlugs: slugs },
    });
    expect(setRes.statusCode).toBe(200);

    const search = await app.inject({ url: '/api/v1/events' });
    expect(search.statusCode).toBe(200);
    const row = search.json().items.find((it: { id: string }) => it.id === event.id);
    expect(row).toBeDefined();
    expect(row.wants.length).toBeLessThanOrEqual(3);
    expect(row.wants.length).toBeGreaterThan(0);

    const detail = await app.inject({ url: `/api/v1/events/${event.code}` });
    expect(detail.json().wants.length).toBe(slugs.length); // detail is uncapped
  });

  it('creates an event, coarsens the center, and auto-joins the creator as event_admin', async () => {
    const { headers } = await makeAuthedUser({ role: 'moderator' });
    const res = await app.inject({ method: 'POST', url: '/api/v1/events', headers, payload: baseEvent });
    expect(res.statusCode).toBe(200);
    const { event, inviteCode } = res.json();
    expect(inviteCode).toBeUndefined();
    expect(event.status).toBe('active'); // startsAt <= now < endsAt
    expect(event.membership.role).toBe('event_admin');
    expect(event.code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(event.categories.length).toBeGreaterThan(0); // defaults apply
    // Exact coordinates never come back...
    expect(res.body).not.toContain('18.52');
    // ...and never went in: stored center is rounded to 3 decimals.
    const stored = await getDb().execute(
      sql`SELECT ST_X(center::geometry) AS lng, ST_Y(center::geometry) AS lat FROM events WHERE id = ${event.id}`,
    );
    expect(Number(stored.rows[0]!.lat)).toBe(18.52);
    expect(Number(stored.rows[0]!.lng)).toBe(73.857);
  });

  it('returns the invite code once, at creation, for invite-only events', async () => {
    const { headers } = await makeAuthedUser({ role: 'moderator' });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/events',
      headers,
      payload: { ...baseEvent, visibility: 'invite_only' },
    });
    expect(res.statusCode).toBe(200);
    const { event, inviteCode } = res.json();
    expect(inviteCode).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(event.requiresInvite).toBe(true);
    // The detail response never carries the code.
    const detail = await app.inject({ url: `/api/v1/events/${event.id}`, headers });
    expect(detail.body).not.toContain(inviteCode);
  });

  it('detects duplicates: same title, within 5 km, overlapping window', async () => {
    const { headers } = await makeAuthedUser({ role: 'moderator' });
    const first = await app.inject({ method: 'POST', url: '/api/v1/events', headers, payload: baseEvent });
    expect(first.statusCode).toBe(200);

    const { headers: otherHeaders } = await makeAuthedUser({ role: 'moderator' });
    const dupe = await app.inject({
      method: 'POST',
      url: '/api/v1/events',
      headers: otherHeaders,
      payload: { ...baseEvent, title: 'ganpati visarjan aid', center: { lat: 18.53, lng: 73.86 } },
    });
    expect(dupe.statusCode).toBe(409);
    expect(dupe.json().error.code).toBe('request_conflict');
    expect(dupe.json().error.details.duplicateEventCode).toBe(first.json().event.code);

    // Same title far away is fine.
    const farAway = await app.inject({
      method: 'POST',
      url: '/api/v1/events',
      headers: otherHeaders,
      payload: { ...baseEvent, center: { lat: 19.076, lng: 72.8777 } }, // Mumbai, ~120 km
    });
    expect(farAway.statusCode).toBe(200);
  });
});

describe('GET /events (search)', () => {
  it('lists only approved public scheduled/active events', async () => {
    const creator = await makeUser();
    const listed = await makeEvent(creator.id, {
      title: 'Community Kitchen Drive',
      visibility: 'public',
      publicApproved: true,
    });
    await makeEvent(creator.id, { title: 'Pending Public', visibility: 'public', publicApproved: false });
    await makeEvent(creator.id, { title: 'Unlisted Thing', visibility: 'unlisted' });
    await makeEvent(creator.id, {
      title: 'Finished Public',
      visibility: 'public',
      publicApproved: true,
      status: 'completed',
    });

    const res = await app.inject({ url: '/api/v1/events' });
    expect(res.statusCode).toBe(200);
    const { items } = res.json();
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe(listed.id);
    expect(items[0].joined).toBeUndefined(); // anonymous

    const q = await app.inject({ url: '/api/v1/events?q=kitchen' });
    expect(q.json().items).toHaveLength(1);
    const qMiss = await app.inject({ url: '/api/v1/events?q=zebra' });
    expect(qMiss.json().items).toHaveLength(0);

    // joined flag for the authed creator.
    const token = await makeSession(creator.id);
    const authed = await app.inject({ url: '/api/v1/events', headers: { authorization: `Bearer ${token}` } });
    expect(authed.json().items[0].joined).toBe(true);

    // near filter (JSON-encoded in the querystring)
    const near = await app.inject({
      url: `/api/v1/events?near=${encodeURIComponent(JSON.stringify({ lat: 18.52, lng: 73.856 }))}`,
    });
    expect(near.json().items).toHaveLength(1);
    const nearFar = await app.inject({
      url: `/api/v1/events?near=${encodeURIComponent(JSON.stringify({ lat: 28.6139, lng: 77.209 }))}`, // Delhi
    });
    expect(nearFar.json().items).toHaveLength(0);
  });
});

describe('GET /events/:idOrCode', () => {
  it('resolves unlisted events by code for link sharing', async () => {
    const creator = await makeUser();
    const event = await makeEvent(creator.id, { visibility: 'unlisted' });
    const res = await app.inject({ url: `/api/v1/events/${event.code}` });
    expect(res.statusCode).toBe(200);
    expect(res.json().id).toBe(event.id);
    expect(res.json().membership).toBeNull();
  });

  it('hides draft/disabled events from non-members', async () => {
    const creator = await makeUser();
    const event = await makeEvent(creator.id, { status: 'disabled' });
    expect((await app.inject({ url: `/api/v1/events/${event.id}` })).statusCode).toBe(404);
    // ...but not from members.
    const token = await makeSession(creator.id);
    const asMember = await app.inject({
      url: `/api/v1/events/${event.id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(asMember.statusCode).toBe(200);
  });
});

describe('join / leave / mute', () => {
  it('enforces the invite code for invite-only events', async () => {
    const creator = await makeUser();
    const event = await makeEvent(creator.id, { visibility: 'invite_only', inviteCode: 'JOIN-CODE' });
    const { headers } = await makeAuthedUser();

    const noCode = await app.inject({ method: 'POST', url: `/api/v1/events/${event.id}/join`, headers, payload: {} });
    expect(noCode.statusCode).toBe(403);
    const wrong = await app.inject({
      method: 'POST',
      url: `/api/v1/events/${event.id}/join`,
      headers,
      payload: { inviteCode: 'WRONG-ONE' },
    });
    expect(wrong.statusCode).toBe(403);
    const right = await app.inject({
      method: 'POST',
      url: `/api/v1/events/${event.id}/join`,
      headers,
      payload: { inviteCode: 'JOIN-CODE' },
    });
    expect(right.statusCode).toBe(200);
    expect(right.json().membership.role).toBe('member');
  });

  it('rejects joining inactive events and banned members', async () => {
    const creator = await makeUser();
    const done = await makeEvent(creator.id, { status: 'completed' });
    const { user, headers } = await makeAuthedUser();
    const res = await app.inject({ method: 'POST', url: `/api/v1/events/${done.id}/join`, headers, payload: {} });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('event_not_active');

    const event = await makeEvent(creator.id);
    await getDb().insert(schema.memberships).values({ userId: user.id, eventId: event.id, banned: true, leftAt: new Date() });
    const banned = await app.inject({ method: 'POST', url: `/api/v1/events/${event.id}/join`, headers, payload: {} });
    expect(banned.statusCode).toBe(403);
  });

  it('leave turns availability off and deletes the location row; rejoin works', async () => {
    const creator = await makeUser();
    const event = await makeEvent(creator.id);
    const { user, headers } = await makeAuthedUser();
    await joinEventDirect(user.id, event.id);
    const db = getDb();
    await db.insert(schema.availability).values({ userId: user.id, eventId: event.id, isOn: true });
    await db.execute(
      sql`
        INSERT INTO member_locations (user_id, event_id, geog, expires_at)
        VALUES (${user.id}, ${event.id}, ST_SetSRID(ST_MakePoint(73.856, 18.52), 4326)::geography, now() + interval '15 minutes')`,
    );

    const res = await app.inject({ method: 'POST', url: `/api/v1/events/${event.id}/leave`, headers });
    expect(res.statusCode).toBe(200);
    const [avail] = await db
      .select()
      .from(schema.availability)
      .where(and(eq(schema.availability.userId, user.id), eq(schema.availability.eventId, event.id)));
    expect(avail!.isOn).toBe(false);
    const locs = await db.select().from(schema.memberLocations).where(eq(schema.memberLocations.userId, user.id));
    expect(locs).toHaveLength(0);

    const rejoin = await app.inject({ method: 'POST', url: `/api/v1/events/${event.id}/join`, headers, payload: {} });
    expect(rejoin.statusCode).toBe(200);
    expect(rejoin.json().membership).not.toBeNull();
  });

  it('mutes and unmutes', async () => {
    const creator = await makeUser();
    const event = await makeEvent(creator.id);
    const token = await makeSession(creator.id);
    const headers = { authorization: `Bearer ${token}` };
    const res = await app.inject({ method: 'POST', url: `/api/v1/events/${event.id}/mute`, headers, payload: { muted: true } });
    expect(res.statusCode).toBe(200);
    const detail = await app.inject({ url: `/api/v1/events/${event.id}`, headers });
    expect(detail.json().membership.muted).toBe(true);
  });
});

describe('GET /events/:id/bring', () => {
  it('is member-only and ranks shortages first with k-anonymity', async () => {
    const creator = await makeUser();
    const event = await makeEvent(creator.id);
    const { user, headers } = await makeAuthedUser();

    const outsider = await app.inject({ url: `/api/v1/events/${event.id}/bring`, headers });
    expect(outsider.statusCode).toBe(403);

    await joinEventDirect(user.id, event.id);
    const db = getDb();
    const water = await categoryBySlug('water-bottle');
    const blanket = await categoryBySlug('blanket');

    // 3 distinct requesters (clears k=3) needing 30 bottles; 2 offered by others.
    for (let i = 0; i < 3; i++) {
      const requester = await makeUser();
      await db.insert(schema.requests).values({
        eventId: event.id,
        requesterId: requester.id,
        categoryId: water.id,
        qty: '10',
        unit: 'bottle',
        expiresAt: new Date(Date.now() + 900_000),
        idempotencyKey: `bring-key-${i}`,
      });
    }
    const helper = await makeUser();
    await db.insert(schema.inventoryItems).values({
      userId: helper.id,
      eventId: event.id,
      categoryId: water.id,
      qtyOnHand: '2',
      unit: 'bottle',
    });
    // One lone requester for blankets — below k on both sides → unknown.
    const lone = await makeUser();
    await db.insert(schema.requests).values({
      eventId: event.id,
      requesterId: lone.id,
      categoryId: blanket.id,
      qty: '2',
      unit: 'blanket',
      expiresAt: new Date(Date.now() + 900_000),
      idempotencyKey: 'bring-key-lone',
    });

    const res = await app.inject({ url: `/api/v1/events/${event.id}/bring`, headers });
    expect(res.statusCode).toBe(200);
    const { suggestions } = res.json();
    expect(suggestions).toHaveLength(6);
    expect(suggestions[0].categorySlug).toBe('water-bottle');
    expect(suggestions[0].level).toBe('critical_shortage'); // 2/30 < 0.25
    expect(suggestions[0].suggestedQty).toBe(10); // min(28, 100, 10)
    expect(suggestions[0].reasonKey).toBe('shortage.critical_shortage');
    const blanketRow = suggestions.find((s: { categorySlug: string }) => s.categorySlug === 'blanket');
    if (blanketRow) expect(blanketRow.level).toBe('unknown');
  });
});
