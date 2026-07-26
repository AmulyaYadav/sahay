/**
 * Match settlement and cancellation: partial fulfilment + continue, quantity
 * disagreements (disputed, never punished), auto-finalize after a silent peer,
 * and the requester/helper/unsafe cancel paths with reservation release.
 */
import '../env.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { buildApp } from '../../src/app.js';
import { closeDb } from '../../src/db/index.js';
import { closeRedis } from '../../src/lib/redis.js';
import { closeQueues } from '../../src/queues.js';
import { finalizeMatch, runMatchPass } from '../../src/workers/matching.js';
import { getDb, schema, setupTestDb, truncateAll } from '../helpers.js';
import {
  conversationForMatch,
  createRequestVia,
  idemKey,
  itemRow,
  latestOffer,
  matchScenario,
  matchRowByRequest,
  requestRow,
  respond,
  statsFor,
  type Scenario,
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

/** Create request(qty) → offer → accept; returns the accepted match view. */
async function matchedFixture(s: Scenario, qty: number) {
  const request = await createRequestVia(app, s.requester.headers, {
    eventId: s.event.id,
    categoryId: s.water.id,
    qty,
  });
  await runMatchPass(request.id);
  const offer = await latestOffer(request.id);
  const res = await respond(app, s.helper.headers, offer!.id, true);
  expect(res.statusCode).toBe(200);
  return { request, match: res.json().match };
}

async function confirm(
  headers: Record<string, string>,
  matchId: string,
  qty: number,
) {
  return app.inject({
    method: 'POST',
    url: `/api/v1/matches/${matchId}/confirm`,
    headers,
    payload: { qty, idempotencyKey: idemKey('cf') },
  });
}

describe('partial fulfilment and /continue', () => {
  it('request 4, helper has 2 → reserve 2, confirm 2/2 → partially_fulfilled → continue', async () => {
    const s = await matchScenario({ helperQty: 2 });
    const { request, match } = await matchedFixture(s, 4);
    expect(match.qtyReserved).toBe(2); // clamped to the helper's stock

    await confirm(s.helper.headers, match.id, 2);
    const done = await confirm(s.requester.headers, match.id, 2);
    expect(done.json().status).toBe('partially_completed');

    let row = await requestRow(request.id);
    expect(row.status).toBe('partially_fulfilled');
    expect(Number(row.qtyFulfilled)).toBe(2);
    const item = await itemRow(s.item.id);
    expect(Number(item.qtyOnHand)).toBe(0);
    expect(Number(item.qtyReserved)).toBe(0);

    // Continue searching for the remaining 2.
    const cont = await app.inject({
      method: 'POST',
      url: `/api/v1/requests/${request.id}/continue`,
      headers: s.requester.headers,
      payload: { continueSearching: true },
    });
    expect(cont.statusCode).toBe(200);
    expect(cont.json().status).toBe('searching');
    expect(cont.json().qtyFulfilled).toBe(2);
    row = await requestRow(request.id);
    expect(Number(row.qty) - Number(row.qtyFulfilled)).toBe(2); // remaining
    expect(row.currentRadiusM).toBe(400); // fresh search ring
    expect(row.expiresAt.getTime()).toBeGreaterThan(Date.now() + 14 * 60_000); // ~15 min

    // Close instead: back into partially_fulfilled first (test shortcut), then
    // continueSearching=false settles it as fulfilled (qty_fulfilled > 0).
    await getDb()
      .update(schema.requests)
      .set({ status: 'partially_fulfilled' })
      .where(eq(schema.requests.id, request.id));
    const close = await app.inject({
      method: 'POST',
      url: `/api/v1/requests/${request.id}/continue`,
      headers: s.requester.headers,
      payload: { continueSearching: false },
    });
    expect(close.statusCode).toBe(200);
    expect(close.json().status).toBe('fulfilled');
    expect((await requestRow(request.id)).closedAt).not.toBeNull();

    // continue on a non-partial request conflicts.
    const again = await app.inject({
      method: 'POST',
      url: `/api/v1/requests/${request.id}/continue`,
      headers: s.requester.headers,
      payload: { continueSearching: true },
    });
    expect(again.statusCode).toBe(409);
  });
});

describe('quantity disagreements', () => {
  it('helper 1 vs requester 0 → disputed, nothing deducted, request searches again', async () => {
    const s = await matchScenario({ helperQty: 4 });
    const { request, match } = await matchedFixture(s, 1);

    await confirm(s.helper.headers, match.id, 1);
    const res = await confirm(s.requester.headers, match.id, 0); // "nothing was exchanged"
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('disputed');

    const item = await itemRow(s.item.id);
    expect(Number(item.qtyOnHand)).toBe(4); // final = min(1,0) = 0 → no deduction
    expect(Number(item.qtyReserved)).toBe(0); // reservation released

    const row = await requestRow(request.id);
    expect(row.status).toBe('searching');
    expect(Number(row.qtyFulfilled)).toBe(0);

    // Disputes are recorded for both, but NEVER punish: no completion credit,
    // no cancellation counters, and the label math ignores disputes entirely.
    const helperStats = await statsFor(s.helper.user.id);
    const requesterStats = await statsFor(s.requester.user.id);
    expect(helperStats!.disputes).toBe(1);
    expect(requesterStats!.disputes).toBe(1);
    expect(helperStats!.completed).toBe(0);
    expect(helperStats!.cancelledPreMeeting).toBe(0);
    expect(helperStats!.cancelledPostMeeting).toBe(0);
    expect(helperStats!.noShows).toBe(0);
  });

  it('helper 3 vs requester 2 → final 2 applied, match disputed', async () => {
    const s = await matchScenario({ helperQty: 5 });
    const { request, match } = await matchedFixture(s, 3);
    expect(match.qtyReserved).toBe(3);

    await confirm(s.helper.headers, match.id, 3);
    const res = await confirm(s.requester.headers, match.id, 2);
    expect(res.json().status).toBe('disputed');

    const item = await itemRow(s.item.id);
    expect(Number(item.qtyOnHand)).toBe(3); // 5 - agreed 2
    expect(Number(item.qtyReserved)).toBe(0);
    const row = await requestRow(request.id);
    expect(row.status).toBe('partially_fulfilled'); // 2 of 3
    expect(Number(row.qtyFulfilled)).toBe(2);

    // Requester positively confirmed → the helper still gets completion credit.
    const helperStats = await statsFor(s.helper.user.id);
    expect(helperStats!.completed).toBe(1);
    expect(helperStats!.requesterConfirmed).toBe(1);
    expect(helperStats!.disputes).toBe(1);
  });

  it('rejects confirmations above the reserved quantity and fractional units', async () => {
    const s = await matchScenario({ helperQty: 4 });
    const { match } = await matchedFixture(s, 2);
    expect((await confirm(s.helper.headers, match.id, 3)).statusCode).toBe(400); // > reserved
    expect((await confirm(s.helper.headers, match.id, 1.5)).statusCode).toBe(400); // bottles are whole
  });
});

describe('auto-finalize (silent peer)', () => {
  it('settles with the single confirmed quantity, never disputed', async () => {
    const s = await matchScenario({ helperQty: 4 });
    const { request, match } = await matchedFixture(s, 1);

    await confirm(s.helper.headers, match.id, 1);
    await finalizeMatch(match.id);
    await finalizeMatch(match.id); // idempotent

    const m = await matchRowByRequest(request.id);
    expect(m!.status).toBe('completed');
    expect(m!.closeReason).toBe('auto_finalized_unconfirmed_peer');
    const item = await itemRow(s.item.id);
    expect(Number(item.qtyOnHand)).toBe(3);
    expect(Number(item.qtyReserved)).toBe(0);
    expect((await requestRow(request.id)).status).toBe('fulfilled');

    const stats = await statsFor(s.helper.user.id);
    expect(stats!.completed).toBe(1);
    expect(stats!.requesterConfirmed).toBe(0); // requester never spoke
    expect(stats!.disputes).toBe(0);
  });

  it('does nothing while both are silent or after both confirmed', async () => {
    const s = await matchScenario({ helperQty: 4 });
    const { request, match } = await matchedFixture(s, 1);
    await finalizeMatch(match.id); // no confirmations yet → no-op
    expect((await matchRowByRequest(request.id))!.status).toBe('active');

    await confirm(s.helper.headers, match.id, 1);
    await confirm(s.requester.headers, match.id, 1);
    const settled = await matchRowByRequest(request.id);
    await finalizeMatch(match.id); // already settled → no-op
    expect((await matchRowByRequest(request.id))!.status).toBe(settled!.status);
  });
});

describe('cancellations', () => {
  it('requester cancels a matched request: reservation released, no helper penalty', async () => {
    const s = await matchScenario({ helperQty: 4 });
    const { request, match } = await matchedFixture(s, 1);
    expect(Number((await itemRow(s.item.id)).qtyReserved)).toBe(1);

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/requests/${request.id}/cancel`,
      headers: s.requester.headers,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('cancelled');

    const m = await matchRowByRequest(request.id);
    expect(m!.status).toBe('cancelled_by_requester');
    const item = await itemRow(s.item.id);
    expect(Number(item.qtyReserved)).toBe(0); // released
    expect(Number(item.qtyOnHand)).toBe(4); // nothing deducted

    // cancelled_by_requester carries NO helper penalty.
    const stats = await statsFor(s.helper.user.id);
    expect(stats!.cancelledPreMeeting).toBe(0);
    expect(stats!.cancelledPostMeeting).toBe(0);
    expect(stats!.completed).toBe(0);

    // A system message landed in the conversation, which stays open for grace.
    const conv = await conversationForMatch(match.id);
    expect(conv.status).toBe('open');
    expect(conv.expiresAt).not.toBeNull();
  });

  it('helper cancels post-meeting (peer arrived): penalty + request searches again', async () => {
    const s = await matchScenario({ helperQty: 4 });
    const { request, match } = await matchedFixture(s, 1);

    // The requester already arrived → this is a post-meeting abandonment.
    await app.inject({
      method: 'POST',
      url: `/api/v1/matches/${match.id}/meeting`,
      headers: s.requester.headers,
      payload: { state: 'arrived' },
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/matches/${match.id}/cancel`,
      headers: s.helper.headers,
      payload: { reason: 'changed_mind' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('cancelled_by_helper');

    expect(Number((await itemRow(s.item.id)).qtyReserved)).toBe(0);
    expect((await requestRow(request.id)).status).toBe('searching');

    const stats = await statsFor(s.helper.user.id);
    expect(stats!.cancelledPostMeeting).toBe(1);
    expect(stats!.cancelledPreMeeting).toBe(0);

    // Cancelling twice conflicts (idempotent by state).
    const again = await app.inject({
      method: 'POST',
      url: `/api/v1/matches/${match.id}/cancel`,
      headers: s.helper.headers,
      payload: { reason: 'changed_mind' },
    });
    expect(again.statusCode).toBe(409);
  });

  it('helper cancels pre-meeting: the lighter counter is used', async () => {
    const s = await matchScenario({ helperQty: 4 });
    const { match } = await matchedFixture(s, 1);
    await app.inject({
      method: 'POST',
      url: `/api/v1/matches/${match.id}/cancel`,
      headers: s.helper.headers,
      payload: { reason: 'cannot_find' },
    });
    const stats = await statsFor(s.helper.user.id);
    expect(stats!.cancelledPreMeeting).toBe(1);
    expect(stats!.cancelledPostMeeting).toBe(0);
  });

  it('unsafe cancel: conversation readonly immediately, location gone, sends rejected', async () => {
    const s = await matchScenario({ helperQty: 4 });
    const { request, match } = await matchedFixture(s, 1);

    // Requester has a live location before cancelling.
    const before = await getDb()
      .select()
      .from(schema.memberLocations)
      .where(eq(schema.memberLocations.userId, s.requester.user.id));
    expect(before).toHaveLength(1);

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/matches/${match.id}/cancel`,
      headers: s.requester.headers,
      payload: { reason: 'unsafe' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('cancelled_unsafe');

    // Conversation is readonly IMMEDIATELY — the peer cannot keep messaging.
    const conv = await conversationForMatch(match.id);
    expect(conv.status).toBe('readonly');
    const send = await app.inject({
      method: 'POST',
      url: `/api/v1/conversations/${conv.id}/messages`,
      headers: s.helper.headers,
      payload: { kind: 'text', body: 'wait', clientMsgId: idemKey('u') },
    });
    expect(send.statusCode).toBe(409);
    // ...but reading (for block/report evidence) still works.
    const read = await app.inject({
      url: `/api/v1/conversations/${conv.id}/messages`,
      headers: s.helper.headers,
    });
    expect(read.statusCode).toBe(200);

    // The canceller's location row is deleted at once.
    const after = await getDb()
      .select()
      .from(schema.memberLocations)
      .where(
        and(
          eq(schema.memberLocations.userId, s.requester.user.id),
          eq(schema.memberLocations.eventId, s.event.id),
        ),
      );
    expect(after).toHaveLength(0);

    // Unsafe by the requester closes the request; reservation is released.
    expect((await requestRow(request.id)).status).toBe('cancelled');
    expect(Number((await itemRow(s.item.id)).qtyReserved)).toBe(0);
  });
});
