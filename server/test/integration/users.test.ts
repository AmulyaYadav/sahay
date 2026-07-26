import '../env.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { closeDb } from '../../src/db/index.js';
import { closeRedis } from '../../src/lib/redis.js';
import { closeQueues } from '../../src/queues.js';
import {
  categoryBySlug,
  getDb,
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

describe('PATCH /me', () => {
  it('updates locale and regenerates pseudonym at most once per 30 days', async () => {
    const { user, headers } = await makeAuthedUser();

    const locale = await app.inject({
      method: 'PATCH',
      url: '/api/v1/me',
      headers,
      payload: { locale: 'hi' },
    });
    expect(locale.statusCode).toBe(200);
    expect(locale.json().locale).toBe('hi');

    const regen = await app.inject({
      method: 'PATCH',
      url: '/api/v1/me',
      headers,
      payload: { regeneratePseudonym: true },
    });
    expect(regen.statusCode).toBe(200);
    expect(regen.json().pseudonym).not.toBe(user.pseudonym);
    expect(regen.json().avatarSeed).toBe(regen.json().pseudonym);

    const again = await app.inject({
      method: 'PATCH',
      url: '/api/v1/me',
      headers,
      payload: { regeneratePseudonym: true },
    });
    expect(again.statusCode).toBe(429);
  });
});

describe('blocks', () => {
  it('lists blocked users by match alias only — never ids or pseudonyms', async () => {
    const { user: me, headers } = await makeAuthedUser();
    const other = await makeUser({ pseudonym: 'Crimson Falcon' });
    const db = getDb();

    // Minimal match fixture so the alias resolves.
    const event = await makeEvent(me.id);
    const cat = await categoryBySlug('water-bottle');
    const [item] = await db
      .insert(schema.inventoryItems)
      .values({ userId: other.id, eventId: event.id, categoryId: cat.id, qtyOnHand: '5', unit: 'bottle' })
      .returning();
    const [request] = await db
      .insert(schema.requests)
      .values({
        eventId: event.id,
        requesterId: me.id,
        categoryId: cat.id,
        qty: '2',
        unit: 'bottle',
        expiresAt: new Date(Date.now() + 900_000),
        idempotencyKey: 'test-key-1',
      })
      .returning();
    const [offer] = await db
      .insert(schema.matchOffers)
      .values({
        requestId: request!.id,
        helperId: other.id,
        inventoryItemId: item!.id,
        qty: '2',
        respondBy: new Date(Date.now() + 45_000),
      })
      .returning();
    await db.insert(schema.matches).values({
      requestId: request!.id,
      offerId: offer!.id,
      eventId: event.id,
      requesterId: me.id,
      helperId: other.id,
      inventoryItemId: item!.id,
      qtyReserved: '2',
      requesterAlias: 'Amber Kite',
      helperAlias: 'Silver Heron',
    });
    await db.insert(schema.blocks).values({ blockerId: me.id, blockedId: other.id });
    // A block with no shared match shows the placeholder alias.
    const stranger = await makeUser();
    await db.insert(schema.blocks).values({ blockerId: me.id, blockedId: stranger.id });

    const res = await app.inject({ url: '/api/v1/me/blocks', headers });
    expect(res.statusCode).toBe(200);
    const { blocks } = res.json();
    expect(blocks).toHaveLength(2);
    const aliases = blocks.map((b: { alias: string }) => b.alias).sort();
    expect(aliases).toEqual(['Silver Heron', '—']);
    expect(res.body).not.toContain(other.id);
    expect(res.body).not.toContain('Crimson Falcon');
  });
});

describe('push tokens and notification prefs', () => {
  it('upserts push tokens by user+token', async () => {
    const { user, headers } = await makeAuthedUser();
    const payload = { provider: 'expo', token: 'ExponentPushToken[abc123]' };
    expect(
      (await app.inject({ method: 'POST', url: '/api/v1/me/push-tokens', headers, payload }))
        .statusCode,
    ).toBe(200);
    expect(
      (await app.inject({ method: 'POST', url: '/api/v1/me/push-tokens', headers, payload }))
        .statusCode,
    ).toBe(200);
    const rows = await getDb().select().from(schema.pushTokens);
    expect(rows.filter((r) => r.userId === user.id)).toHaveLength(1);
  });

  it('round-trips notification prefs', async () => {
    const { headers } = await makeAuthedUser();
    const initial = await app.inject({ url: '/api/v1/me/notification-prefs', headers });
    expect(initial.json()).toEqual({ detailedPreviews: false, perType: {} });

    const put = await app.inject({
      method: 'PUT',
      url: '/api/v1/me/notification-prefs',
      headers,
      payload: { detailedPreviews: true, perType: { new_message: false } },
    });
    expect(put.statusCode).toBe(200);
    const after = await app.inject({ url: '/api/v1/me/notification-prefs', headers });
    expect(after.json()).toEqual({ detailedPreviews: true, perType: { new_message: false } });
  });
});

describe('notifications feed', () => {
  it('paginates newest-first with a keyset cursor and marks read', async () => {
    const { user, headers } = await makeAuthedUser();
    const db = getDb();
    for (let i = 0; i < 3; i++) {
      await db.insert(schema.notifications).values({
        userId: user.id,
        type: 'event_notice',
        titleKey: 'notifications.event_notice',
        bodyKey: 'notifications.event_notice',
        params: { n: String(i) },
        createdAt: new Date(Date.now() - (3 - i) * 60_000),
      });
    }

    const page1 = await app.inject({ url: '/api/v1/me/notifications?limit=2', headers });
    expect(page1.statusCode).toBe(200);
    const body1 = page1.json();
    expect(body1.items).toHaveLength(2);
    expect(body1.items[0].params.n).toBe('2'); // newest first
    expect(body1.nextCursor).toBeTruthy();

    const page2 = await app.inject({
      url: `/api/v1/me/notifications?limit=2&cursor=${encodeURIComponent(body1.nextCursor)}`,
      headers,
    });
    const body2 = page2.json();
    expect(body2.items).toHaveLength(1);
    expect(body2.items[0].params.n).toBe('0');
    expect(body2.nextCursor).toBeNull();

    const read = await app.inject({
      method: 'POST',
      url: `/api/v1/me/notifications/${body1.items[0].id}/read`,
      headers,
    });
    expect(read.statusCode).toBe(200);
    const after = await app.inject({ url: '/api/v1/me/notifications', headers });
    expect(after.json().items.find((n: { id: string }) => n.id === body1.items[0].id).readAt).toBeTruthy();
  });
});
