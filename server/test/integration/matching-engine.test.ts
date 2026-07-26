/**
 * Matching engine behavior: sequential offers, decline/timeout progression,
 * radius expansion, pause deferral, expiry outcomes, and eligibility filters.
 * The engine is driven directly (runMatchPass/expireOffer) — no live workers.
 */
import '../env.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { buildApp } from '../../src/app.js';
import { closeDb } from '../../src/db/index.js';
import { closeRedis } from '../../src/lib/redis.js';
import { closeQueues } from '../../src/queues.js';
import { expireOffer, runMatchPass } from '../../src/workers/matching.js';
import { getDb, schema, setupTestDb, truncateAll } from '../helpers.js';
import {
  addHelper,
  createRequestVia,
  fabricateActiveMatch,
  latestOffer,
  matchScenario,
  requestRow,
  respond,
} from './fixtures.js';

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

async function offersFor(requestId: string) {
  return getDb().select().from(schema.matchOffers).where(eq(schema.matchOffers.requestId, requestId));
}

describe('decline → next helper', () => {
  it('moves to the farther helper and honors alsoStopReceiving', async () => {
    // helper1 very_nearby (~111 m), helper2 nearby (~333 m): buckets differ, so
    // ranking is deterministic regardless of jitter.
    const s = await matchScenario({ helperLatOffset: 0.001 });
    const second = await addHelper(s.event.id, s.water.id, { latOffset: 0.003 });

    const request = await createRequestVia(app, s.requester.headers, {
      eventId: s.event.id,
      categoryId: s.water.id,
    });
    await runMatchPass(request.id);
    const first = await latestOffer(request.id);
    expect(first!.helperId).toBe(s.helper.user.id); // nearest first

    const decline = await respond(app, s.helper.headers, first!.id, false, true);
    expect(decline.statusCode).toBe(200);
    expect(decline.json().offer.status).toBe('declined');
    expect((await requestRow(request.id)).status).toBe('searching');

    // alsoStopReceiving switched availability off for this event.
    const [avail] = await getDb()
      .select()
      .from(schema.availability)
      .where(eq(schema.availability.userId, s.helper.user.id));
    expect(avail!.isOn).toBe(false);

    await runMatchPass(request.id);
    const nextOffer = await latestOffer(request.id);
    expect(nextOffer!.helperId).toBe(second.helper.user.id);
    expect(nextOffer!.status).toBe('offered');
    expect((await requestRow(request.id)).attemptCount).toBe(2);

    // Declining never dents reliability (only responsiveness credit).
    const [stats] = await getDb()
      .select()
      .from(schema.reliabilityStats)
      .where(eq(schema.reliabilityStats.userId, s.helper.user.id));
    expect(stats!.offersResponded30d).toBe(1);
    expect(stats!.cancelledPreMeeting).toBe(0);
  });
});

describe('offer timeout → next helper', () => {
  it('expires an unanswered offer and asks the next candidate', async () => {
    const s = await matchScenario({ helperLatOffset: 0.001 });
    const second = await addHelper(s.event.id, s.water.id, { latOffset: 0.003 });
    const request = await createRequestVia(app, s.requester.headers, {
      eventId: s.event.id,
      categoryId: s.water.id,
    });
    await runMatchPass(request.id);
    const first = await latestOffer(request.id);
    expect(first!.helperId).toBe(s.helper.user.id);

    // Not yet due: the timeout job is a no-op.
    await expireOffer(first!.id);
    expect((await latestOffer(request.id))!.status).toBe('offered');

    await getDb()
      .update(schema.matchOffers)
      .set({ respondBy: new Date(Date.now() - 1000) })
      .where(eq(schema.matchOffers.id, first!.id));
    await expireOffer(first!.id);
    await expireOffer(first!.id); // idempotent

    const [expired] = await offersFor(request.id);
    expect(expired!.status).toBe('expired');
    expect((await requestRow(request.id)).status).toBe('searching');

    await runMatchPass(request.id);
    const nextOffer = await latestOffer(request.id);
    expect(nextOffer!.helperId).toBe(second.helper.user.id);

    // The timed-out helper is never asked again for this request.
    expect((await offersFor(request.id)).filter((o) => o.helperId === s.helper.user.id)).toHaveLength(1);
  });
});

describe('radius expansion', () => {
  it('finds nobody at 400 m, expands, then offers to the ~660 m helper', async () => {
    const s = await matchScenario({ helperLatOffset: 0.006 }); // ~665 m away
    const request = await createRequestVia(app, s.requester.headers, {
      eventId: s.event.id,
      categoryId: s.water.id,
    });
    expect((await requestRow(request.id)).currentRadiusM).toBe(400);

    await runMatchPass(request.id);
    expect(await latestOffer(request.id)).toBeNull(); // out of the first ring
    expect((await requestRow(request.id)).currentRadiusM).toBe(800); // doubled
    expect((await requestRow(request.id)).status).toBe('searching');

    await runMatchPass(request.id);
    const offer = await latestOffer(request.id);
    expect(offer).not.toBeNull();
    expect(offer!.helperId).toBe(s.helper.user.id);
    expect(offer!.proximity).toBe('short_walk');
  });

  it('caps at the event max radius and only then reaches location-less helpers', async () => {
    const s = await matchScenario({ helperLatOffset: null }); // helper without a live location
    const request = await createRequestVia(app, s.requester.headers, {
      eventId: s.event.id,
      categoryId: s.water.id,
    });
    // 400 → 800 → 1600 → 3200 → 5000 (max): no offer until the cap is reached.
    for (const expected of [800, 1600, 3200, 5000]) {
      await runMatchPass(request.id);
      expect((await requestRow(request.id)).currentRadiusM).toBe(expected);
      expect(await latestOffer(request.id)).toBeNull();
    }
    await runMatchPass(request.id);
    const offer = await latestOffer(request.id);
    expect(offer).not.toBeNull();
    expect(offer!.proximity).toBe('unknown');
  });

  it('reaches everyone immediately when the requester has no live location', async () => {
    const s = await matchScenario({ helperLatOffset: 0.006 });
    await getDb()
      .delete(schema.memberLocations)
      .where(eq(schema.memberLocations.userId, s.requester.user.id));
    const request = await createRequestVia(app, s.requester.headers, {
      eventId: s.event.id,
      categoryId: s.water.id,
      coords: null, // areaHint-style request
    });
    await runMatchPass(request.id);
    const offer = await latestOffer(request.id);
    expect(offer).not.toBeNull();
    expect(offer!.proximity).toBe('unknown'); // distances unknown, never exposed
  });
});

describe('paused matching', () => {
  it('defers without consuming the request when the event pauses', async () => {
    const s = await matchScenario();
    const request = await createRequestVia(app, s.requester.headers, {
      eventId: s.event.id,
      categoryId: s.water.id,
    });
    await getDb().update(schema.events).set({ matchingPaused: true }).where(eq(schema.events.id, s.event.id));

    await runMatchPass(request.id);
    expect(await latestOffer(request.id)).toBeNull();
    const row = await requestRow(request.id);
    expect(row.status).toBe('searching');
    expect(row.currentRadiusM).toBe(400); // no expansion while paused

    // Unpause: the next pass proceeds normally.
    await getDb().update(schema.events).set({ matchingPaused: false }).where(eq(schema.events.id, s.event.id));
    await runMatchPass(request.id);
    expect(await latestOffer(request.id)).not.toBeNull();

    // And creating a NEW request while paused is rejected up front.
    await getDb().update(schema.events).set({ matchingPaused: true }).where(eq(schema.events.id, s.event.id));
    const rejected = await app.inject({
      method: 'POST',
      url: '/api/v1/requests',
      headers: s.requester.headers,
      payload: {
        eventId: s.event.id,
        categoryId: s.water.id,
        qty: 1,
        unit: 'bottle',
        expiresInMinutes: 15,
        safetyAcknowledged: true,
        idempotencyKey: 'paused-key-0001',
      },
    });
    expect(rejected.statusCode).toBe(409);
    expect(rejected.json().error.code).toBe('event_paused');
  });
});

describe('expiry', () => {
  it('closes as no_match when nobody was ever asked', async () => {
    const creatorScenario = await matchScenario();
    const s = creatorScenario;
    // Remove the helper's availability so no offer can ever be made.
    await getDb().update(schema.availability).set({ isOn: false });
    const request = await createRequestVia(app, s.requester.headers, {
      eventId: s.event.id,
      categoryId: s.water.id,
    });
    await getDb()
      .update(schema.requests)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.requests.id, request.id));
    await runMatchPass(request.id);
    const row = await requestRow(request.id);
    expect(row.status).toBe('no_match');
    expect(row.closedAt).not.toBeNull();
    await runMatchPass(request.id); // idempotent on terminal states
    expect((await requestRow(request.id)).status).toBe('no_match');
  });

  it('closes as expired when at least one offer was made (declined earlier)', async () => {
    const s = await matchScenario();
    const request = await createRequestVia(app, s.requester.headers, {
      eventId: s.event.id,
      categoryId: s.water.id,
    });
    await runMatchPass(request.id);
    const offer = await latestOffer(request.id);
    await respond(app, s.helper.headers, offer!.id, false);
    await getDb()
      .update(schema.requests)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.requests.id, request.id));
    await runMatchPass(request.id);
    expect((await requestRow(request.id)).status).toBe('expired');
  });

  it('supersedes a still-open offer when the request expires', async () => {
    const s = await matchScenario();
    const request = await createRequestVia(app, s.requester.headers, {
      eventId: s.event.id,
      categoryId: s.water.id,
    });
    await runMatchPass(request.id);
    await getDb()
      .update(schema.requests)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.requests.id, request.id));
    await runMatchPass(request.id);
    expect((await requestRow(request.id)).status).toBe('expired');
    expect((await latestOffer(request.id))!.status).toBe('superseded');
  });
});

describe('eligibility filters', () => {
  it('never offers to blocked pairs (either direction)', async () => {
    const s = await matchScenario();
    const request = await createRequestVia(app, s.requester.headers, {
      eventId: s.event.id,
      categoryId: s.water.id,
    });

    await getDb()
      .insert(schema.blocks)
      .values({ blockerId: s.requester.user.id, blockedId: s.helper.user.id });
    await runMatchPass(request.id);
    expect(await latestOffer(request.id)).toBeNull();

    // Reverse direction blocks too.
    await getDb().delete(schema.blocks);
    await getDb()
      .insert(schema.blocks)
      .values({ blockerId: s.helper.user.id, blockedId: s.requester.user.id });
    await runMatchPass(request.id);
    expect(await latestOffer(request.id)).toBeNull();

    await getDb().delete(schema.blocks);
    await runMatchPass(request.id);
    expect(await latestOffer(request.id)).not.toBeNull();
  });

  it('skips helpers at the active-match cap and never offers a request to its own requester', async () => {
    const s = await matchScenario();
    // Requester also carries stock and is available — must never be picked.
    await getDb()
      .insert(schema.availability)
      .values({ userId: s.requester.user.id, eventId: s.event.id, isOn: true });
    await getDb().insert(schema.inventoryItems).values({
      userId: s.requester.user.id,
      eventId: s.event.id,
      categoryId: s.water.id,
      qtyOnHand: '10',
      unit: 'bottle',
    });

    // Helper is saturated with 2 active matches (LIMITS.maxActiveMatchesPerHelper).
    await fabricateActiveMatch(s.helper.user.id, s.event.id, s.water.id);
    await fabricateActiveMatch(s.helper.user.id, s.event.id, s.water.id);

    const request = await createRequestVia(app, s.requester.headers, {
      eventId: s.event.id,
      categoryId: s.water.id,
    });
    await runMatchPass(request.id);
    expect(await latestOffer(request.id)).toBeNull();
  });
});
