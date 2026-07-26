import '../env.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';
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

async function memberSetup(eventOpts = {}) {
  const creator = await makeUser();
  const event = await makeEvent(creator.id, eventOpts);
  const { user, headers } = await makeAuthedUser();
  await joinEventDirect(user.id, event.id);
  return { event, user, headers };
}

describe('availability', () => {
  it('defaults to off', async () => {
    const { event, headers } = await memberSetup();
    const res = await app.inject({ url: `/api/v1/events/${event.id}/availability`, headers });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ on: false, until: null });
  });

  it('turns on with a duration or until event end', async () => {
    const { event, headers } = await memberSetup();
    const on = await app.inject({
      method: 'PUT',
      url: `/api/v1/events/${event.id}/availability`,
      headers,
      payload: { on: true, durationMinutes: 30 },
    });
    expect(on.statusCode).toBe(200);
    expect(on.json().on).toBe(true);
    const until = new Date(on.json().until).getTime();
    expect(Math.abs(until - (Date.now() + 30 * 60_000))).toBeLessThan(5000);

    const untilEnd = await app.inject({
      method: 'PUT',
      url: `/api/v1/events/${event.id}/availability`,
      headers,
      payload: { on: true, untilEventEnd: true },
    });
    expect(new Date(untilEnd.json().until).getTime()).toBe(event.endsAt.getTime());

    const off = await app.inject({
      method: 'PUT',
      url: `/api/v1/events/${event.id}/availability`,
      headers,
      payload: { on: false },
    });
    expect(off.json()).toEqual({ on: false, until: null });
  });

  it('rejects turning on for scheduled or paused events (off is always allowed)', async () => {
    const { event: scheduled, headers } = await memberSetup({
      status: 'scheduled',
      startsAt: new Date(Date.now() + 3600_000),
    });
    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/events/${scheduled.id}/availability`,
      headers,
      payload: { on: true, durationMinutes: 30 },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('event_not_active');

    const { event: paused, headers: h2 } = await memberSetup({ status: 'paused' });
    const res2 = await app.inject({
      method: 'PUT',
      url: `/api/v1/events/${paused.id}/availability`,
      headers: h2,
      payload: { on: true, durationMinutes: 30 },
    });
    expect(res2.statusCode).toBe(409);
    expect(res2.json().error.code).toBe('event_paused');

    const off = await app.inject({
      method: 'PUT',
      url: `/api/v1/events/${scheduled.id}/availability`,
      headers,
      payload: { on: false },
    });
    expect(off.statusCode).toBe(200);
  });

  it('rejects users who cannot help and non-members', async () => {
    const creator = await makeUser();
    const event = await makeEvent(creator.id);
    const { user, headers } = await makeAuthedUser({ canHelp: false });
    await joinEventDirect(user.id, event.id);
    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/events/${event.id}/availability`,
      headers,
      payload: { on: true, durationMinutes: 30 },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('account_restricted');

    const { headers: outsider } = await makeAuthedUser();
    const res2 = await app.inject({
      method: 'PUT',
      url: `/api/v1/events/${event.id}/availability`,
      headers: outsider,
      payload: { on: true, durationMinutes: 30 },
    });
    expect(res2.statusCode).toBe(403);
  });
});

describe('location pings', () => {
  it('are forbidden unless helping or actively requesting', async () => {
    const { event, headers } = await memberSetup();
    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/events/${event.id}/location`,
      headers,
      payload: { coords: { lat: 18.5204444, lng: 73.8567777 } },
    });
    expect(res.statusCode).toBe(403);
  });

  it('stores a coarsened point with a TTL while helping, and records consent once', async () => {
    const { event, user, headers } = await memberSetup();
    await app.inject({
      method: 'PUT',
      url: `/api/v1/events/${event.id}/availability`,
      headers,
      payload: { on: true, durationMinutes: 30 },
    });

    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/events/${event.id}/location`,
      headers,
      payload: { coords: { lat: 18.5204444, lng: 73.8567777 } },
    });
    expect(res.statusCode).toBe(200);
    const expiresAt = new Date(res.json().expiresAt).getTime();
    expect(Math.abs(expiresAt - (Date.now() + 15 * 60_000))).toBeLessThan(5000);

    // Raw check: coordinates must be rounded to exactly 3 decimals (~110 m).
    const stored = await getDb().execute(
      sql`SELECT ST_X(geog::geometry) AS lng, ST_Y(geog::geometry) AS lat
          FROM member_locations WHERE user_id = ${user.id} AND event_id = ${event.id}`,
    );
    expect(Number(stored.rows[0]!.lat)).toBe(18.52);
    expect(Number(stored.rows[0]!.lng)).toBe(73.857);

    // Consent recorded exactly once even after a second ping.
    await app.inject({
      method: 'PUT',
      url: `/api/v1/events/${event.id}/location`,
      headers,
      payload: { coords: { lat: 18.53, lng: 73.86 } },
    });
    const consents = await getDb().select().from(schema.consentRecords);
    expect(consents.filter((c) => c.userId === user.id && c.kind === 'location')).toHaveLength(1);

    // Upsert: still exactly one location row.
    const rows = await getDb().select().from(schema.memberLocations);
    expect(rows.filter((r) => r.userId === user.id)).toHaveLength(1);

    // DELETE removes it.
    const del = await app.inject({ method: 'DELETE', url: `/api/v1/events/${event.id}/location`, headers });
    expect(del.statusCode).toBe(200);
    const after = await getDb().select().from(schema.memberLocations);
    expect(after.filter((r) => r.userId === user.id)).toHaveLength(0);
  });

  it('are allowed while a request is actively searching', async () => {
    const { event, user, headers } = await memberSetup();
    const water = await categoryBySlug('water-bottle');
    await getDb().insert(schema.requests).values({
      eventId: event.id,
      requesterId: user.id,
      categoryId: water.id,
      qty: '2',
      unit: 'bottle',
      status: 'searching',
      expiresAt: new Date(Date.now() + 900_000),
      idempotencyKey: 'loc-key-1',
    });
    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/events/${event.id}/location`,
      headers,
      payload: { coords: { lat: 18.52, lng: 73.856 } },
    });
    expect(res.statusCode).toBe(200);
  });
});
