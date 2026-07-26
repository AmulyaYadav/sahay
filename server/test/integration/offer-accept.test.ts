/**
 * Atomic reservation on accept: concurrent double-accepts, competing offers on
 * one request (unique active-match index), and stock evaporating before accept.
 */
import '../env.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { buildApp } from '../../src/app.js';
import { closeDb } from '../../src/db/index.js';
import { closeRedis } from '../../src/lib/redis.js';
import { closeQueues } from '../../src/queues.js';
import { runMatchPass } from '../../src/workers/matching.js';
import { getDb, schema, setupTestDb, truncateAll } from '../helpers.js';
import {
  addHelper,
  createRequestVia,
  itemRow,
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

describe('concurrent accepts of the SAME offer', () => {
  it('creates exactly one match and reserves exactly once', async () => {
    const s = await matchScenario({ helperQty: 4 });
    const request = await createRequestVia(app, s.requester.headers, {
      eventId: s.event.id,
      categoryId: s.water.id,
      qty: 1,
    });
    await runMatchPass(request.id);
    const offer = await latestOffer(request.id);

    const [a, b] = await Promise.all([
      respond(app, s.helper.headers, offer!.id, true),
      respond(app, s.helper.headers, offer!.id, true),
    ]);
    const codes = [a.statusCode, b.statusCode].sort();
    expect(codes[0]).toBe(200);
    expect([409, 410]).toContain(codes[1]); // loser: conflict or offer_expired

    const matches = await getDb()
      .select()
      .from(schema.matches)
      .where(eq(schema.matches.requestId, request.id));
    expect(matches).toHaveLength(1); // exactly one match row

    const item = await itemRow(s.item.id);
    expect(Number(item.qtyReserved)).toBe(1); // reserved exactly once
    expect((await requestRow(request.id)).status).toBe('matched');
  });
});

describe('two open offers for one request', () => {
  it('the unique active-match index rejects the loser; reservation counted once', async () => {
    const s = await matchScenario({ helperQty: 4 });
    const second = await addHelper(s.event.id, s.water.id, { latOffset: 0.002 });
    const request = await createRequestVia(app, s.requester.headers, {
      eventId: s.event.id,
      categoryId: s.water.id,
      qty: 1,
    });
    await runMatchPass(request.id);
    const offer1 = await latestOffer(request.id);
    expect(offer1!.helperId).toBe(s.helper.user.id);

    // Force-create a second open offer (the engine would never allow this).
    const [offer2] = await getDb()
      .insert(schema.matchOffers)
      .values({
        requestId: request.id,
        helperId: second.helper.user.id,
        inventoryItemId: second.item.id,
        qty: '1',
        status: 'offered',
        respondBy: new Date(Date.now() + 45_000),
      })
      .returning();

    const [a, b] = await Promise.all([
      respond(app, s.helper.headers, offer1!.id, true),
      respond(app, second.helper.headers, offer2!.id, true),
    ]);
    const results = [a, b];
    const winners = results.filter((r) => r.statusCode === 200);
    const losers = results.filter((r) => r.statusCode !== 200);
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);
    expect([409, 410]).toContain(losers[0]!.statusCode);

    const matches = await getDb()
      .select()
      .from(schema.matches)
      .where(eq(schema.matches.requestId, request.id));
    expect(matches).toHaveLength(1);

    // Only the winner's item carries a reservation.
    const reserved1 = Number((await itemRow(s.item.id)).qtyReserved);
    const reserved2 = Number((await itemRow(second.item.id)).qtyReserved);
    expect(reserved1 + reserved2).toBe(1);
  });
});

describe('inventory drops before accept', () => {
  it('fails with insufficient_inventory and puts the request back to searching', async () => {
    const s = await matchScenario({ helperQty: 2 });
    const request = await createRequestVia(app, s.requester.headers, {
      eventId: s.event.id,
      categoryId: s.water.id,
      qty: 1,
    });
    await runMatchPass(request.id);
    const offer = await latestOffer(request.id);

    // Everything the helper has gets reserved elsewhere before they accept.
    await getDb()
      .update(schema.inventoryItems)
      .set({ qtyReserved: '2' })
      .where(eq(schema.inventoryItems.id, s.item.id));

    const res = await respond(app, s.helper.headers, offer!.id, true);
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('insufficient_inventory');

    expect((await latestOffer(request.id))!.status).toBe('expired');
    expect((await requestRow(request.id)).status).toBe('searching');
    const matches = await getDb()
      .select()
      .from(schema.matches)
      .where(eq(schema.matches.requestId, request.id));
    expect(matches).toHaveLength(0);
    // No over-reservation happened.
    expect(Number((await itemRow(s.item.id)).qtyReserved)).toBe(2);
  });

  it('deactivated items also fail the accept', async () => {
    const s = await matchScenario({ helperQty: 2 });
    const request = await createRequestVia(app, s.requester.headers, {
      eventId: s.event.id,
      categoryId: s.water.id,
      qty: 1,
    });
    await runMatchPass(request.id);
    const offer = await latestOffer(request.id);
    await getDb()
      .update(schema.inventoryItems)
      .set({ active: false })
      .where(eq(schema.inventoryItems.id, s.item.id));
    const res = await respond(app, s.helper.headers, offer!.id, true);
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('insufficient_inventory');
  });
});

describe('offer response guards', () => {
  it('rejects responses from non-owners and past respond_by', async () => {
    const s = await matchScenario();
    const request = await createRequestVia(app, s.requester.headers, {
      eventId: s.event.id,
      categoryId: s.water.id,
    });
    await runMatchPass(request.id);
    const offer = await latestOffer(request.id);

    // The requester (not the offer's helper) cannot respond.
    const wrongUser = await respond(app, s.requester.headers, offer!.id, true);
    expect(wrongUser.statusCode).toBe(404);

    await getDb()
      .update(schema.matchOffers)
      .set({ respondBy: new Date(Date.now() - 1000) })
      .where(eq(schema.matchOffers.id, offer!.id));
    const late = await respond(app, s.helper.headers, offer!.id, true);
    expect(late.statusCode).toBe(410);
    expect(late.json().error.code).toBe('offer_expired');

    const lateDecline = await respond(app, s.helper.headers, offer!.id, false);
    expect(lateDecline.statusCode).toBe(410);
  });
});
