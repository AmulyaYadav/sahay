/**
 * Aggregate dashboard: k-anonymity gating, correct §49-shaped figures, redis
 * caching, and visibility rules.
 */
import '../env.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { closeDb } from '../../src/db/index.js';
import { closeRedis, getRedis } from '../../src/lib/redis.js';
import { closeQueues } from '../../src/queues.js';
import {
  addInventoryDirect,
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
import { idemKey } from './fixtures.js';

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

async function searchingRequest(eventId: string, requesterId: string, categoryId: string, qty: number) {
  await getDb().insert(schema.requests).values({
    eventId,
    requesterId,
    categoryId,
    qty: String(qty),
    unit: 'bottle',
    status: 'searching',
    expiresAt: new Date(Date.now() + 900_000),
    idempotencyKey: idemKey('dash'),
  });
}

function needFor(body: { needs: { categorySlug: string }[] }, slug: string) {
  return body.needs.find((n) => n.categorySlug === slug) as unknown as {
    level: string;
    requestedQty: number | null;
    offeredQty: number | null;
    reservedQty: number | null;
    fulfilledRecentQty: number | null;
    unit: string;
  };
}

describe('GET /events/:id/dashboard', () => {
  it('hides figures below the k-anonymity threshold (nulls + unknown)', async () => {
    const creator = await makeUser();
    const event = await makeEvent(creator.id, { visibility: 'public', publicApproved: true });
    const water = await categoryBySlug('water-bottle');

    // 1 requester + 2 offerers: both below k=3.
    const r1 = await makeUser();
    await joinEventDirect(r1.id, event.id);
    await searchingRequest(event.id, r1.id, water.id, 4);
    for (let i = 0; i < 2; i++) {
      const h = await makeUser();
      await joinEventDirect(h.id, event.id);
      await addInventoryDirect(h.id, event.id, water.id, 5, 'bottle');
    }

    const res = await app.inject({ url: `/api/v1/events/${event.id}/dashboard` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.approximate).toBe(true);
    const water0 = needFor(body, 'water-bottle');
    expect(water0.requestedQty).toBeNull();
    expect(water0.offeredQty).toBeNull();
    expect(water0.reservedQty).toBeNull();
    expect(water0.fulfilledRecentQty).toBeNull();
    expect(water0.level).toBe('unknown');
    expect(body.recentFulfilments).toBe(0);
    // Categories without any activity are present too, all unknown.
    expect(needFor(body, 'blanket').level).toBe('unknown');
  });

  it('exposes correct figures at the threshold and computes the level', async () => {
    const creator = await makeUser();
    const event = await makeEvent(creator.id, { visibility: 'public', publicApproved: true });
    const water = await categoryBySlug('water-bottle');

    // 3 distinct requesters wanting 4+3+3 = 10, 3 distinct offerers holding 2+2+1 = 5.
    for (const qty of [4, 3, 3]) {
      const r = await makeUser();
      await joinEventDirect(r.id, event.id);
      await searchingRequest(event.id, r.id, water.id, qty);
    }
    for (const qty of [2, 2, 1]) {
      const h = await makeUser();
      await joinEventDirect(h.id, event.id);
      await addInventoryDirect(h.id, event.id, water.id, qty, 'bottle');
    }

    const res = await app.inject({ url: `/api/v1/events/${event.id}/dashboard` });
    const need = needFor(res.json(), 'water-bottle');
    expect(need.requestedQty).toBe(10);
    expect(need.offeredQty).toBe(5);
    expect(need.reservedQty).toBeNull(); // no active matches → 0 helpers behind it
    expect(need.level).toBe('high_need'); // 5/10 = 0.5 → high_need
    expect(need.unit).toBe('bottle');
  });

  it('caches the whole response in redis for ~30s', async () => {
    const creator = await makeUser();
    const event = await makeEvent(creator.id, { visibility: 'public', publicApproved: true });

    const first = await app.inject({ url: `/api/v1/events/${event.id}/dashboard` });
    expect(first.statusCode).toBe(200);
    const cached = await getRedis().get(`dash:${event.id}`);
    expect(cached).not.toBeNull();
    const ttl = await getRedis().ttl(`dash:${event.id}`);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(30);

    // New data does NOT show up within the cache window.
    const water = await categoryBySlug('water-bottle');
    for (let i = 0; i < 3; i++) {
      const h = await makeUser();
      await joinEventDirect(h.id, event.id);
      await addInventoryDirect(h.id, event.id, water.id, 5, 'bottle');
    }
    const second = await app.inject({ url: `/api/v1/events/${event.id}/dashboard` });
    expect(second.json()).toEqual(first.json());
  });

  it('is public only for approved public events; members-only otherwise (404 outsiders)', async () => {
    const creator = await makeUser();
    const unlisted = await makeEvent(creator.id, { visibility: 'unlisted' });
    const pendingPublic = await makeEvent(creator.id, { visibility: 'public', publicApproved: false });

    expect((await app.inject({ url: `/api/v1/events/${unlisted.id}/dashboard` })).statusCode).toBe(404);
    expect((await app.inject({ url: `/api/v1/events/${pendingPublic.id}/dashboard` })).statusCode).toBe(404);

    const outsider = await makeAuthedUser();
    expect(
      (await app.inject({ url: `/api/v1/events/${unlisted.id}/dashboard`, headers: outsider.headers }))
        .statusCode,
    ).toBe(404);

    const member = await makeAuthedUser();
    await joinEventDirect(member.user.id, unlisted.id);
    expect(
      (await app.inject({ url: `/api/v1/events/${unlisted.id}/dashboard`, headers: member.headers }))
        .statusCode,
    ).toBe(200);
  });
});
