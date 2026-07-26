/**
 * Safety slice: reports (evidence snapshots, urgent risk flags, rate limits)
 * and blocks (match cancel + matcher exclusion). Workers are not started; the
 * engine runs deterministically via runMatchPass.
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
  createRequestVia,
  itemRow,
  latestOffer,
  matchRowByRequest,
  matchScenario,
  requestRow,
  respond,
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

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/** Full accepted match with a short chat, driven over HTTP. */
async function activeMatchWithChat(s: Scenario) {
  const request = await createRequestVia(app, s.requester.headers, {
    eventId: s.event.id,
    categoryId: s.water.id,
    qty: 1,
  });
  await runMatchPass(request.id);
  const offer = await latestOffer(request.id);
  const accept = await respond(app, s.helper.headers, offer!.id, true);
  expect(accept.statusCode).toBe(200);
  const match = accept.json().match;

  const send = (headers: Record<string, string>, body: string, clientMsgId: string) =>
    app.inject({
      method: 'POST',
      url: `/api/v1/conversations/${match.conversationId}/messages`,
      headers,
      payload: { kind: 'text', body, clientMsgId },
    });
  expect((await send(s.requester.headers, 'meet at the tea stall?', 'msg-aaaaaaaa')).statusCode).toBe(200);
  expect((await send(s.helper.headers, 'sure, five minutes', 'msg-bbbbbbbb')).statusCode).toBe(200);
  return { request, match };
}

describe('POST /reports', () => {
  it('snapshots conversation evidence with aliases only — no user ids anywhere', async () => {
    const s = await matchScenario();
    const { match } = await activeMatchWithChat(s);

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/reports',
      headers: s.requester.headers,
      payload: { category: 'harassment', matchId: match.id, note: 'made me uncomfortable', preserveConversation: true },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('open');
    expect(res.json().resolutionKey).toBeNull();

    const [report] = await getDb().select().from(schema.reports);
    expect(report!.subjectUserId).toBe(s.helper.user.id); // resolved server-side: the OTHER participant
    expect(report!.subjectEventId).toBe(s.event.id);
    const evidence = report!.evidence as { senderAlias: string; body: string; createdAt: string }[];
    expect(evidence.length).toBeGreaterThanOrEqual(2);
    expect(evidence.some((m) => m.body === 'meet at the tea stall?')).toBe(true);
    expect(evidence.map((m) => m.senderAlias)).toContain(match.myAlias);
    // Aliases only: the serialized evidence must not contain ANY uuid.
    expect(JSON.stringify(evidence)).not.toMatch(UUID_RE);
  });

  it('urgent categories add the urgent_report risk flag exactly once', async () => {
    const s = await matchScenario();
    const { match } = await activeMatchWithChat(s);

    for (let i = 0; i < 2; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/reports',
        headers: s.requester.headers,
        payload: { category: 'threat', matchId: match.id, preserveConversation: false },
      });
      expect(res.statusCode).toBe(200);
    }
    const [subject] = await getDb()
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, s.helper.user.id));
    expect(subject!.riskFlags).toEqual(['urgent_report']);
  });

  it('reports an event directly, requires a subject, and lists mine newest-first', async () => {
    const s = await matchScenario();
    const bad = await app.inject({
      method: 'POST',
      url: '/api/v1/reports',
      headers: s.requester.headers,
      payload: { category: 'other' },
    });
    expect(bad.statusCode).toBe(400);

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/reports',
      headers: s.requester.headers,
      payload: { category: 'suspicious_event', eventId: s.event.id, note: 'asks 12345678901 to call' },
    });
    expect(res.statusCode).toBe(200);
    const [report] = await getDb().select().from(schema.reports);
    expect(report!.note).not.toContain('12345678901'); // contact details redacted

    const mine = await app.inject({ url: '/api/v1/reports/mine', headers: s.requester.headers });
    expect(mine.statusCode).toBe(200);
    expect(mine.json().items).toHaveLength(1);
    expect(mine.json().items[0].resolutionKey).toBeNull();

    // A non-participant cannot report through someone else's match.
    const outsider = await matchScenario();
    const sneaky = await app.inject({
      method: 'POST',
      url: '/api/v1/reports',
      headers: outsider.requester.headers,
      payload: { category: 'harassment', matchId: (await matchRowByRequest((await activeMatchWithChat(s)).request.id))!.id },
    });
    expect(sneaky.statusCode).toBe(404);
  });
});

describe('POST /blocks', () => {
  it('blocks the peer, cancels the active match, releases the reservation, and excludes future matching', async () => {
    const s = await matchScenario();
    const { request, match } = await activeMatchWithChat(s);

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/blocks',
      headers: s.requester.headers,
      payload: { matchId: match.id },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });

    // Block row exists; peer identity was resolved server-side.
    const [block] = await getDb().select().from(schema.blocks);
    expect(block).toMatchObject({ blockerId: s.requester.user.id, blockedId: s.helper.user.id });

    // Match closed via moderation path: reservation released, request moderated.
    const matchRow = await matchRowByRequest(request.id);
    expect(matchRow!.status).toBe('cancelled_moderation');
    const item = await itemRow(s.item.id);
    expect(Number(item.qtyReserved)).toBe(0);
    expect((await requestRow(request.id)).status).toBe('moderated');

    // Blocking is idempotent.
    const again = await app.inject({
      method: 'POST',
      url: '/api/v1/blocks',
      headers: s.requester.headers,
      payload: { matchId: match.id },
    });
    expect(again.statusCode).toBe(200);

    // Future matching skips the blocked pair entirely.
    const fresh = await createRequestVia(app, s.requester.headers, {
      eventId: s.event.id,
      categoryId: s.water.id,
      qty: 1,
    });
    await runMatchPass(fresh.id);
    expect(await latestOffer(fresh.id)).toBeNull();

    // The blocks list shows the alias, never an id.
    const blocks = await app.inject({ url: '/api/v1/me/blocks', headers: s.requester.headers });
    expect(blocks.statusCode).toBe(200);
    expect(blocks.json().blocks).toHaveLength(1);
    // `match` is the HELPER's accept-response view, so the helper's own alias
    // (what the requester saw, and what the blocks list shows) is myAlias.
    expect(blocks.json().blocks[0].alias).toBe(match.myAlias);
    expect(JSON.stringify(blocks.json())).not.toContain(s.helper.user.id);
  });

  it('rejects blocks through matches the caller is not part of', async () => {
    const s = await matchScenario();
    const { match } = await activeMatchWithChat(s);
    const outsider = await matchScenario();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/blocks',
      headers: outsider.requester.headers,
      payload: { matchId: match.id },
    });
    expect(res.statusCode).toBe(404);
    expect(await getDb().select().from(schema.blocks).then((r) => r.length)).toBe(0);
  });
});
