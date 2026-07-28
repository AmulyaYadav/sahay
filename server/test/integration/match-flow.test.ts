/**
 * The §49 happy path end-to-end (HTTP + direct engine calls), plus chat
 * behavior and authorization. Workers are not started; the engine runs via
 * runMatchPass and friends for determinism.
 */
import '../env.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { asc, eq } from 'drizzle-orm';
import { buildApp } from '../../src/app.js';
import { closeDb } from '../../src/db/index.js';
import { closeRedis } from '../../src/lib/redis.js';
import { closeQueues } from '../../src/queues.js';
import { runMatchPass } from '../../src/workers/matching.js';
import { getDb, makeAuthedUser, schema, setupTestDb, truncateAll } from '../helpers.js';
import {
  conversationForMatch,
  createRequestVia,
  idemKey,
  itemRow,
  latestOffer,
  matchScenario,
  requestRow,
  respond,
  statsFor,
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

describe('happy path: request → offer → accept → chat → meet → confirm', () => {
  it('runs the full exchange with correct inventory, aliases, reliability, and transitions', async () => {
    const s = await matchScenario({ helperQty: 4 });

    // 1. Requester asks for 1 bottle.
    const request = await createRequestVia(app, s.requester.headers, {
      eventId: s.event.id,
      categoryId: s.water.id,
      qty: 1,
    });
    expect(request.status).toBe('searching');
    expect(request.qty).toBe(1);

    // 2. Matching pass extends an offer to the helper.
    await runMatchPass(request.id);
    const offer = await latestOffer(request.id);
    expect(offer).not.toBeNull();
    expect(offer!.helperId).toBe(s.helper.user.id);
    expect(Number(offer!.qty)).toBe(1);
    expect(offer!.proximity).toBe('very_nearby');
    expect((await requestRow(request.id)).status).toBe('offering');
    expect((await requestRow(request.id)).attemptCount).toBe(1);

    // Helper sees it in the pending list with live availability.
    const pending = await app.inject({ url: '/api/v1/offers/pending', headers: s.helper.headers });
    expect(pending.statusCode).toBe(200);
    expect(pending.json().items).toHaveLength(1);
    expect(pending.json().items[0].qtyYouHave).toBe(4);
    expect(pending.json().items[0].qtyRequested).toBe(1);

    // 3. Accept: atomic reservation + match + conversation.
    const acceptRes = await respond(app, s.helper.headers, offer!.id, true);
    expect(acceptRes.statusCode).toBe(200);
    const { offer: acceptedOffer, match } = acceptRes.json();
    expect(acceptedOffer.status).toBe('accepted');
    expect(match.role).toBe('helper');
    expect(match.qtyReserved).toBe(1);
    expect(match.status).toBe('active');

    const item = await itemRow(s.item.id);
    expect(Number(item.qtyReserved)).toBe(1); // reservation asserted in DB
    expect(Number(item.qtyOnHand)).toBe(4);
    expect((await requestRow(request.id)).status).toBe('matched');

    // Distinct one-time aliases, different from account pseudonyms.
    expect(match.myAlias).not.toBe(match.peer.alias);
    expect(match.myAlias).not.toBe(s.helper.user.pseudonym);
    expect(match.peer.alias).not.toBe(s.requester.user.pseudonym);
    expect(match.peer.emailVerifiedLabel).toBe(true);
    expect(match.peer.memberSince).toMatch(/^[A-Z][a-z]+ \d{4}$/); // "March 2026"

    // Requester sees the same match from their side.
    const reqView = await app.inject({
      url: `/api/v1/matches/${match.id}`,
      headers: s.requester.headers,
    });
    expect(reqView.statusCode).toBe(200);
    expect(reqView.json().role).toBe('requester');
    expect(reqView.json().myAlias).toBe(match.peer.alias);
    expect(reqView.json().conversationId).toBe(match.conversationId);

    // 4. Chat both ways: text (redacted), quick reply, clientMsgId replay.
    const convId = match.conversationId;
    const msg1 = await app.inject({
      method: 'POST',
      url: `/api/v1/conversations/${convId}/messages`,
      headers: s.helper.headers,
      payload: { kind: 'text', body: 'near the gate, call 9876543210', clientMsgId: idemKey('msg') },
    });
    expect(msg1.statusCode).toBe(200);
    expect(msg1.json().body).toBe('near the gate, call ‹…›'); // phone never stored
    expect(msg1.json().senderAlias).toBe(match.myAlias);
    expect(msg1.json().mine).toBe(true);

    const quickId = idemKey('quick');
    const quick = await app.inject({
      method: 'POST',
      url: `/api/v1/conversations/${convId}/messages`,
      headers: s.requester.headers,
      payload: { kind: 'quick', body: 'where_meet', clientMsgId: quickId },
    });
    expect(quick.statusCode).toBe(200);
    const quickReplay = await app.inject({
      method: 'POST',
      url: `/api/v1/conversations/${convId}/messages`,
      headers: s.requester.headers,
      payload: { kind: 'quick', body: 'where_meet', clientMsgId: quickId },
    });
    expect(quickReplay.statusCode).toBe(200);
    expect(quickReplay.json().id).toBe(quick.json().id); // idempotent replay

    const invalidQuick = await app.inject({
      method: 'POST',
      url: `/api/v1/conversations/${convId}/messages`,
      headers: s.requester.headers,
      payload: { kind: 'quick', body: 'not_a_quick_key', clientMsgId: idemKey('bad') },
    });
    expect(invalidQuick.statusCode).toBe(400);

    // Message list: ascending, aliases resolved for the viewer, delivery marked.
    const list = await app.inject({
      url: `/api/v1/conversations/${convId}/messages`,
      headers: s.requester.headers,
    });
    const items = list.json().items;
    expect(items.length).toBe(3); // system 'match.matched' + text + quick
    expect(items[0].kind).toBe('system');
    expect(items[0].body).toBe('match.matched');
    const textMsg = items.find((m: { kind: string }) => m.kind === 'text');
    expect(textMsg.mine).toBe(false);
    expect(textMsg.deliveredAt).not.toBeNull(); // fetching delivered it

    const read = await app.inject({
      method: 'POST',
      url: `/api/v1/conversations/${convId}/read`,
      headers: s.requester.headers,
    });
    expect(read.statusCode).toBe(200);

    const convView = await app.inject({ url: `/api/v1/conversations/${convId}`, headers: s.helper.headers });
    expect(convView.json().status).toBe('open');
    expect(convView.json().quickReplies).toContain('where_meet');

    // 5. Meeting states.
    for (const who of [s.requester, s.helper]) {
      const meeting = await app.inject({
        method: 'POST',
        url: `/api/v1/matches/${match.id}/meeting`,
        headers: who.headers,
        payload: { state: 'arrived' },
      });
      expect(meeting.statusCode).toBe(200);
      expect(meeting.json().myMeetingState).toBe('arrived');
    }

    // 6. Both confirm 1 → settled.
    const helperConfirm = await app.inject({
      method: 'POST',
      url: `/api/v1/matches/${match.id}/confirm`,
      headers: s.helper.headers,
      payload: { qty: 1, idempotencyKey: idemKey('c1') },
    });
    expect(helperConfirm.statusCode).toBe(200);
    expect(helperConfirm.json().myConfirmedQty).toBe(1);
    expect(helperConfirm.json().status).toBe('active'); // waiting for the peer

    const requesterConfirm = await app.inject({
      method: 'POST',
      url: `/api/v1/matches/${match.id}/confirm`,
      headers: s.requester.headers,
      payload: { qty: 1, idempotencyKey: idemKey('c2') },
    });
    expect(requesterConfirm.statusCode).toBe(200);
    expect(requesterConfirm.json().status).toBe('completed');
    expect(requesterConfirm.json().peerConfirmed).toBe(true);

    // Idempotent re-confirm (same qty) replays; different qty conflicts.
    const reconfirm = await app.inject({
      method: 'POST',
      url: `/api/v1/matches/${match.id}/confirm`,
      headers: s.requester.headers,
      payload: { qty: 1, idempotencyKey: idemKey('c3') },
    });
    expect(reconfirm.statusCode).toBe(200);
    const changed = await app.inject({
      method: 'POST',
      url: `/api/v1/matches/${match.id}/confirm`,
      headers: s.requester.headers,
      payload: { qty: 0.5, idempotencyKey: idemKey('c4') },
    });
    expect(changed.statusCode).toBe(409);

    // Inventory: 1 handed over, reservation fully released.
    const settledItem = await itemRow(s.item.id);
    expect(Number(settledItem.qtyOnHand)).toBe(3);
    expect(Number(settledItem.qtyReserved)).toBe(0);

    const settledRequest = await requestRow(request.id);
    expect(settledRequest.status).toBe('fulfilled');
    expect(Number(settledRequest.qtyFulfilled)).toBe(1);
    expect(settledRequest.closedAt).not.toBeNull();

    // Reliability: accepted=1, completed=1, requester_confirmed=1, no penalties.
    const stats = await statsFor(s.helper.user.id);
    expect(stats!.accepted).toBe(1);
    expect(stats!.completed).toBe(1);
    expect(stats!.requesterConfirmed).toBe(1);
    expect(stats!.cancelledPreMeeting).toBe(0);
    expect(stats!.cancelledPostMeeting).toBe(0);
    expect(stats!.disputes).toBe(0);
    expect(stats!.offersReceived30d).toBe(1);
    expect(stats!.offersResponded30d).toBe(1);

    // Transition audit trail is ordered and complete.
    const transitions = await getDb()
      .select()
      .from(schema.requestTransitions)
      .where(eq(schema.requestTransitions.requestId, request.id))
      .orderBy(asc(schema.requestTransitions.id));
    expect(transitions.map((t) => `${t.fromStatus}>${t.toStatus}`)).toEqual([
      'none>searching',
      'searching>offering',
      'offering>matched',
      'matched>fulfilled',
    ]);

    // Conversation got its grace expiry.
    const conv = await conversationForMatch(match.id);
    expect(conv.status).toBe('open');
    expect(conv.expiresAt).not.toBeNull();
  });
});

describe('request endpoints', () => {
  it('replays idempotent creates and enforces the 3-active-request limit', async () => {
    const s = await matchScenario();
    const key = idemKey('same');
    const payload = {
      eventId: s.event.id,
      categoryId: s.water.id,
      qty: 1,
      unit: 'bottle',
      expiresInMinutes: 15,
      safetyAcknowledged: true,
      idempotencyKey: key,
    };
    const first = await app.inject({ method: 'POST', url: '/api/v1/requests', headers: s.requester.headers, payload });
    const second = await app.inject({ method: 'POST', url: '/api/v1/requests', headers: s.requester.headers, payload });
    expect(second.statusCode).toBe(200);
    expect(second.json().id).toBe(first.json().id);

    // Two more active requests → limit reached.
    await createRequestVia(app, s.requester.headers, { eventId: s.event.id, categoryId: s.water.id });
    await createRequestVia(app, s.requester.headers, { eventId: s.event.id, categoryId: s.water.id });
    const fourth = await app.inject({
      method: 'POST',
      url: '/api/v1/requests',
      headers: s.requester.headers,
      payload: { ...payload, idempotencyKey: idemKey('limit') },
    });
    expect(fourth.statusCode).toBe(429);

    const mine = await app.inject({
      url: `/api/v1/requests/mine?eventId=${s.event.id}`,
      headers: s.requester.headers,
    });
    expect(mine.json().items).toHaveLength(3);

    // Notes are redacted before storage.
    await app.inject({ method: 'POST', url: `/api/v1/requests/${first.json().id}/cancel`, headers: s.requester.headers });
    const noted = await app.inject({
      method: 'POST',
      url: '/api/v1/requests',
      headers: s.requester.headers,
      payload: { ...payload, idempotencyKey: idemKey('note'), note: 'ping me on 99887 76655 pls' },
    });
    expect(noted.statusCode).toBe(200);
    expect(noted.json().note).toBe('ping me on ‹…› pls');
  });

  it('is owner-only and validates event/category/limits', async () => {
    const s = await matchScenario();
    const request = await createRequestVia(app, s.requester.headers, {
      eventId: s.event.id,
      categoryId: s.water.id,
    });

    const stranger = await makeAuthedUser();
    const forbidden = await app.inject({
      url: `/api/v1/requests/${request.id}`,
      headers: stranger.headers,
    });
    expect(forbidden.statusCode).toBe(404);

    // qty above the category maxRequestQty (water = 6).
    const tooMany = await app.inject({
      method: 'POST',
      url: '/api/v1/requests',
      headers: s.requester.headers,
      payload: {
        eventId: s.event.id,
        categoryId: s.water.id,
        qty: 7,
        unit: 'bottle',
        expiresInMinutes: 15,
        safetyAcknowledged: true,
        idempotencyKey: idemKey('over'),
      },
    });
    expect(tooMany.statusCode).toBe(400);

    // Non-member cannot request.
    const outsider = await makeAuthedUser();
    const notMember = await app.inject({
      method: 'POST',
      url: '/api/v1/requests',
      headers: outsider.headers,
      payload: {
        eventId: s.event.id,
        categoryId: s.water.id,
        qty: 1,
        unit: 'bottle',
        expiresInMinutes: 15,
        safetyAcknowledged: true,
        idempotencyKey: idemKey('nm'),
      },
    });
    expect(notMember.statusCode).toBe(403);
  });

  it('cancel from searching supersedes any open offer; renew restarts the search', async () => {
    const s = await matchScenario();
    const request = await createRequestVia(app, s.requester.headers, {
      eventId: s.event.id,
      categoryId: s.water.id,
    });
    await runMatchPass(request.id);
    const offer = await latestOffer(request.id);
    expect(offer!.status).toBe('offered');

    const cancel = await app.inject({
      method: 'POST',
      url: `/api/v1/requests/${request.id}/cancel`,
      headers: s.requester.headers,
    });
    expect(cancel.statusCode).toBe(200);
    expect(cancel.json().status).toBe('cancelled');
    expect((await latestOffer(request.id))!.status).toBe('superseded');

    const renew = await app.inject({
      method: 'POST',
      url: `/api/v1/requests/${request.id}/renew`,
      headers: s.requester.headers,
      payload: { expiresInMinutes: 10 },
    });
    expect(renew.statusCode).toBe(200);
    expect(renew.json().status).toBe('searching');
    const row = await requestRow(request.id);
    expect(row.currentRadiusM).toBe(400); // radius reset
    expect(row.closedAt).toBeNull();
  });
});

describe('chat authorization and readonly', () => {
  it('rejects third parties and readonly sends', async () => {
    const s = await matchScenario();
    const request = await createRequestVia(app, s.requester.headers, {
      eventId: s.event.id,
      categoryId: s.water.id,
    });
    await runMatchPass(request.id);
    const offer = await latestOffer(request.id);
    const match = (await respond(app, s.helper.headers, offer!.id, true)).json().match;
    const convId = match.conversationId;

    // A third user gets 404 (existence not leaked) on every chat surface.
    const third = await makeAuthedUser();
    expect((await app.inject({ url: `/api/v1/conversations/${convId}`, headers: third.headers })).statusCode).toBe(404);
    expect(
      (await app.inject({ url: `/api/v1/conversations/${convId}/messages`, headers: third.headers })).statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/api/v1/conversations/${convId}/messages`,
          headers: third.headers,
          payload: { kind: 'text', body: 'hi', clientMsgId: idemKey('x') },
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (await app.inject({ url: `/api/v1/matches/${match.id}`, headers: third.headers })).statusCode,
    ).toBe(404);

    // Readonly (and lazily-expired) conversations reject sends.
    await getDb()
      .update(schema.conversations)
      .set({ status: 'readonly' })
      .where(eq(schema.conversations.id, convId));
    const send = await app.inject({
      method: 'POST',
      url: `/api/v1/conversations/${convId}/messages`,
      headers: s.helper.headers,
      payload: { kind: 'text', body: 'still there?', clientMsgId: idemKey('ro') },
    });
    expect(send.statusCode).toBe(409);

    await getDb()
      .update(schema.conversations)
      .set({ status: 'open', expiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.conversations.id, convId));
    const lazyExpired = await app.inject({
      method: 'POST',
      url: `/api/v1/conversations/${convId}/messages`,
      headers: s.helper.headers,
      payload: { kind: 'text', body: 'hello?', clientMsgId: idemKey('exp') },
    });
    expect(lazyExpired.statusCode).toBe(409);
    const view = await app.inject({ url: `/api/v1/conversations/${convId}`, headers: s.helper.headers });
    expect(view.json().status).toBe('readonly'); // lazy status in responses
  });
});
