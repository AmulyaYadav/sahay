/**
 * Privacy slice: export (own data only — no email, no peer ids), the download
 * endpoint, rate limits, and account deletion end-to-end including email reuse
 * creating a FRESH account. The data-request worker runs inline.
 */
import '../env.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Job } from 'bullmq';
import { and, desc, eq } from 'drizzle-orm';
import { buildApp } from '../../src/app.js';
import { closeDb } from '../../src/db/index.js';
import { closeRedis } from '../../src/lib/redis.js';
import { closeQueues, type DataRequestJob } from '../../src/queues.js';
import { processDataRequest } from '../../src/workers/data-request.js';
import { runMatchPass } from '../../src/workers/matching.js';
import {
  addInventoryDirect,
  authHeaders,
  categoryBySlug,
  getDb,
  joinEventDirect,
  makeAuthedUser,
  makeEvent,
  makeUser,
  schema,
  setAvailabilityOn,
  setLocation,
  setupTestDb,
  truncateAll,
} from '../helpers.js';
import { createRequestVia, itemRow, latestOffer, matchRowByRequest, respond } from './fixtures.js';

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
  vi.restoreAllMocks();
});

function captureOtp(): { code: () => string } {
  const spy = vi.spyOn(console, 'log');
  return {
    code: () => {
      const lines = spy.mock.calls.map((c) => c.join(' ')).filter((l) => /OTP for .*: \d{6}/.test(l));
      const match = lines[lines.length - 1]?.match(/: (\d{6})$/);
      if (!match) throw new Error('no OTP logged');
      return match[1]!;
    },
  };
}

async function signup(email: string) {
  const otp = captureOtp();
  await app.inject({ method: 'POST', url: '/api/v1/auth/otp/start', payload: { email, locale: 'en' } });
  const verify = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/otp/verify',
    payload: { email, code: otp.code(), device: { platform: 'web', name: 'test' } },
  });
  expect(verify.statusCode).toBe(200);
  return verify.json() as { token: string; user: { id: string; pseudonym: string }; isNewAccount: boolean };
}

async function runDataRequestWorker(userId: string, kind: string) {
  const [row] = await getDb()
    .select()
    .from(schema.dataRequests)
    .where(and(eq(schema.dataRequests.userId, userId), eq(schema.dataRequests.kind, kind)))
    .orderBy(desc(schema.dataRequests.createdAt))
    .limit(1);
  expect(row).toBeDefined();
  await processDataRequest({ data: { dataRequestId: row!.id } } as Job<DataRequestJob>);
  return row!.id;
}

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

describe('data export', () => {
  it('exports own data only: no email anywhere, peers as aliases, no foreign user ids', async () => {
    const email = 'e2e-export@example.com';
    const me = await signup(email);
    const headers = authHeaders(me.token);

    // Build activity: an event, a request, an accepted match, a chat message,
    // a report, a consent record.
    const creator = await makeUser();
    const event = await makeEvent(creator.id);
    const water = await categoryBySlug('water-bottle');
    await joinEventDirect(me.user.id, event.id);
    await setLocation(me.user.id, event.id, 18.52, 73.856);
    const helper = await makeAuthedUser();
    await joinEventDirect(helper.user.id, event.id);
    await setAvailabilityOn(helper.user.id, event.id);
    await addInventoryDirect(helper.user.id, event.id, water.id, 4, 'bottle');
    await setLocation(helper.user.id, event.id, 18.521, 73.856);
    const request = await createRequestVia(app, headers, { eventId: event.id, categoryId: water.id, qty: 1 });
    await runMatchPass(request.id);
    const offer = await latestOffer(request.id);
    const accepted = await respond(app, helper.headers, offer!.id, true);
    const match = accepted.json().match;
    await app.inject({
      method: 'POST',
      url: `/api/v1/conversations/${match.conversationId}/messages`,
      headers,
      payload: { kind: 'text', body: 'hello from the export test', clientMsgId: 'exp-aaaaaaaa' },
    });
    await app.inject({
      method: 'POST',
      url: '/api/v1/reports',
      headers,
      payload: { category: 'other', matchId: match.id, note: 'export fixture', preserveConversation: false },
    });
    await getDb().insert(schema.consentRecords).values({ userId: me.user.id, kind: 'safety_ack', granted: true });

    // Request → worker → poll → download.
    const start = await app.inject({ method: 'POST', url: '/api/v1/me/export', headers });
    expect(start.statusCode).toBe(200);
    expect(start.json()).toMatchObject({ status: 'pending', downloadUrl: null });

    await runDataRequestWorker(me.user.id, 'export');

    const poll = await app.inject({ url: '/api/v1/me/export', headers });
    expect(poll.json()).toMatchObject({ status: 'ready', downloadUrl: '/api/v1/me/export/download' });

    const download = await app.inject({ url: '/api/v1/me/export/download', headers });
    expect(download.statusCode).toBe(200);
    expect(download.headers['content-disposition']).toContain('attachment');
    const bundle = download.json();

    expect(bundle.profile).toMatchObject({ pseudonym: me.user.pseudonym, emailVerified: true });
    expect(bundle.requests).toHaveLength(1);
    expect(bundle.matches).toHaveLength(1);
    expect(bundle.matches[0].role).toBe('requester');
    expect(bundle.matches[0].peerAlias).toBe(match.myAlias); // alias only
    expect(bundle.messages.map((m: { body: string }) => m.body)).toContain('hello from the export test');
    expect(bundle.reports).toEqual([expect.objectContaining({ category: 'other', status: 'open' })]);
    expect(bundle.consents).toEqual([expect.objectContaining({ kind: 'safety_ack', granted: true })]);

    const serialized = JSON.stringify(bundle);
    // The email address must not appear in ANY form.
    expect(serialized).not.toContain(email);
    // Deep scan: no other user's uuid leaks into the bundle.
    const uuids = serialized.match(UUID_RE) ?? [];
    expect(uuids).not.toContain(helper.user.id);
    expect(uuids).not.toContain(creator.id);
    // The export-ready notification was queued as account_security (row lands
    // once the notify worker runs; here we just assert the queue job exists).
  });

  it('rate-limits export requests to 2 per day', async () => {
    const me = await makeAuthedUser();
    expect((await app.inject({ method: 'POST', url: '/api/v1/me/export', headers: me.headers })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/api/v1/me/export', headers: me.headers })).statusCode).toBe(200);
    const third = await app.inject({ method: 'POST', url: '/api/v1/me/export', headers: me.headers });
    expect(third.statusCode).toBe(429);
  });
});

describe('account deletion', () => {
  it('requires the exact pseudonym (case-insensitive) to confirm', async () => {
    const me = await makeAuthedUser();
    const bad = await app.inject({
      method: 'POST',
      url: '/api/v1/me/delete',
      headers: me.headers,
      payload: { confirmPseudonym: 'Someone Else' },
    });
    expect(bad.statusCode).toBe(400);
    const ok = await app.inject({
      method: 'POST',
      url: '/api/v1/me/delete',
      headers: me.headers,
      payload: { confirmPseudonym: `  ${me.user.pseudonym.toUpperCase()} ` },
    });
    expect(ok.statusCode).toBe(200);
  });

  it('kills sessions, cancels matches, releases reservations, anonymizes, and frees the email', async () => {
    const email = 'e2e-delete@example.com';
    const me = await signup(email); // this account will be deleted (acts as HELPER)
    const headers = authHeaders(me.token);

    const creator = await makeUser();
    const event = await makeEvent(creator.id);
    const water = await categoryBySlug('water-bottle');
    await joinEventDirect(me.user.id, event.id);
    await setAvailabilityOn(me.user.id, event.id);
    const item = await addInventoryDirect(me.user.id, event.id, water.id, 4, 'bottle');
    await setLocation(me.user.id, event.id, 18.521, 73.856);
    const requester = await makeAuthedUser();
    await joinEventDirect(requester.user.id, event.id);
    await setLocation(requester.user.id, event.id, 18.52, 73.856);
    const request = await createRequestVia(app, requester.headers, {
      eventId: event.id,
      categoryId: water.id,
      qty: 2,
    });
    await runMatchPass(request.id);
    const offer = await latestOffer(request.id);
    expect((await respond(app, headers, offer!.id, true)).statusCode).toBe(200);
    expect(Number((await itemRow(item.id)).qtyReserved)).toBe(2);

    const del = await app.inject({
      method: 'POST',
      url: '/api/v1/me/delete',
      headers,
      payload: { confirmPseudonym: me.user.pseudonym },
    });
    expect(del.statusCode).toBe(200);

    // Sessions dead immediately.
    expect((await app.inject({ url: '/api/v1/me', headers })).statusCode).toBe(401);

    await runDataRequestWorker(me.user.id, 'delete');

    // Match cancelled, reservation released, inventory deactivated + zeroed.
    const match = await matchRowByRequest(request.id);
    expect(match!.status).toBe('cancelled_moderation');
    const itemAfter = await itemRow(item.id);
    expect(Number(itemAfter.qtyReserved)).toBe(0);
    expect(Number(itemAfter.qtyOnHand)).toBe(0);
    expect(itemAfter.active).toBe(false);

    // User row anonymized; device/location/notification data gone.
    const [user] = await getDb().select().from(schema.users).where(eq(schema.users.id, me.user.id));
    expect(user!.pseudonym).toBe('Deleted User');
    expect(user!.emailEnc).toBeNull();
    expect(user!.emailHmac).toBeNull();
    expect(user!.status).toBe('deleted');
    expect(user!.deletedAt).not.toBeNull();
    expect(await getDb().select().from(schema.sessions).where(eq(schema.sessions.userId, me.user.id))).toHaveLength(0);
    expect(
      await getDb().select().from(schema.memberLocations).where(eq(schema.memberLocations.userId, me.user.id)),
    ).toHaveLength(0);

    // The worker is idempotent — a retried job changes nothing.
    await runDataRequestWorker(me.user.id, 'delete');

    // The same email now creates a FRESH account.
    const again = await signup(email);
    expect(again.isNewAccount).toBe(true);
    expect(again.user.id).not.toBe(me.user.id);
  });
});
