/**
 * Admin/moderation slice: RBAC, moderation actions and their effects, report
 * resolution, notices, catalogue denylist, feature flags, appeals, audit, and
 * emergency shutdown. Notify jobs are drained inline through the real worker.
 */
import '../env.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { and, desc, eq } from 'drizzle-orm';
import { buildApp } from '../../src/app.js';
import { closeDb } from '../../src/db/index.js';
import { closeRedis } from '../../src/lib/redis.js';
import { closeQueues, notifyQueue } from '../../src/queues.js';
import { deliverNotification } from '../../src/workers/notify.js';
import { runMatchPass } from '../../src/workers/matching.js';
import {
  categoryBySlug,
  getDb,
  makeAuthedUser,
  makeEvent,
  schema,
  setAvailabilityOn,
  setupTestDb,
  truncateAll,
} from '../helpers.js';
import { createRequestVia, idemKey, itemRow, latestOffer, matchScenario, requestRow, respond } from './fixtures.js';

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

const moderate = (headers: Record<string, string>, payload: Record<string, unknown>) =>
  app.inject({ method: 'POST', url: '/api/v1/admin/moderate', headers, payload });

/** Run every queued notify job through the real worker, then clear the queue. */
async function drainNotify() {
  const jobs = await notifyQueue().getJobs(['waiting', 'delayed', 'prioritized']);
  const datas = jobs.map((j) => j.data);
  for (const j of jobs) {
    await deliverNotification(j.data);
    await j.remove();
  }
  return datas;
}

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

async function otpLogin(email: string) {
  const otp = captureOtp();
  await app.inject({ method: 'POST', url: '/api/v1/auth/otp/start', payload: { email, locale: 'en' } });
  return app.inject({
    method: 'POST',
    url: '/api/v1/auth/otp/verify',
    payload: { email, code: otp.code(), device: { platform: 'web' } },
  });
}

async function auditRows(action?: string) {
  const db = getDb();
  const rows = await db.select().from(schema.auditLog).orderBy(desc(schema.auditLog.id));
  return action ? rows.filter((r) => r.action === action) : rows;
}

describe('RBAC', () => {
  it('403s ordinary users on moderator surfaces and moderators on admin surfaces', async () => {
    const user = await makeAuthedUser();
    const moderator = await makeAuthedUser({ role: 'moderator' });

    expect((await app.inject({ url: '/api/v1/admin/reports', headers: user.headers })).statusCode).toBe(403);
    expect((await moderate(user.headers, { action: 'warn', targetUserId: user.user.id, reason: 'nope please' })).statusCode).toBe(403);
    expect((await app.inject({ url: '/api/v1/admin/flags', headers: moderator.headers })).statusCode).toBe(403);
    expect((await app.inject({ url: '/api/v1/admin/audit', headers: moderator.headers })).statusCode).toBe(403);
    expect((await app.inject({ url: '/api/v1/admin/reports', headers: moderator.headers })).statusCode).toBe(200);
  });
});

describe('moderation actions', () => {
  it('moderator suspend: sessions revoked, matches cancelled, reservation released, availability off, audited', async () => {
    const s = await matchScenario();
    const moderator = await makeAuthedUser({ role: 'moderator' });
    const request = await createRequestVia(app, s.requester.headers, {
      eventId: s.event.id, categoryId: s.water.id, qty: 1,
    });
    await runMatchPass(request.id);
    const offer = await latestOffer(request.id);
    expect((await respond(app, s.helper.headers, offer!.id, true)).statusCode).toBe(200);
    expect(Number((await itemRow(s.item.id)).qtyReserved)).toBe(1);
    await drainNotify();

    // Bounds: no duration or >168h is not a moderator's call.
    expect((await moderate(moderator.headers, { action: 'suspend', targetUserId: s.helper.user.id, reason: 'indefinite ban' })).statusCode).toBe(403);
    expect((await moderate(moderator.headers, { action: 'suspend', targetUserId: s.helper.user.id, reason: 'too long', durationHours: 200 })).statusCode).toBe(403);

    const res = await moderate(moderator.headers, {
      action: 'suspend', targetUserId: s.helper.user.id, reason: 'harassment confirmed', durationHours: 24,
    });
    expect(res.statusCode).toBe(200);

    // Sessions revoked → helper's next request is a 401.
    expect((await app.inject({ url: '/api/v1/me', headers: s.helper.headers })).statusCode).toBe(401);

    const [helperRow] = await getDb().select().from(schema.users).where(eq(schema.users.id, s.helper.user.id));
    expect(helperRow!.status).toBe('suspended');
    expect(helperRow!.suspendedUntil).not.toBeNull();

    // Active match cancelled and reservation released.
    expect(Number((await itemRow(s.item.id)).qtyReserved)).toBe(0);
    expect((await requestRow(request.id)).status).toBe('moderated');

    const [avail] = await getDb()
      .select()
      .from(schema.availability)
      .where(and(eq(schema.availability.userId, s.helper.user.id), eq(schema.availability.eventId, s.event.id)));
    expect(avail!.isOn).toBe(false);

    const actions = await getDb().select().from(schema.moderationActions);
    expect(actions.some((a) => a.action === 'suspend' && a.targetUserId === s.helper.user.id)).toBe(true);
    expect((await auditRows('suspend'))).toHaveLength(1);

    // The suspension notice still reaches the (suspended) target's feed.
    await drainNotify();
    const feed = await getDb()
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.userId, s.helper.user.id));
    expect(feed.some((n) => n.type === 'moderation_outcome')).toBe(true);

    // Admin unsuspend restores the account.
    const admin = await makeAuthedUser({ role: 'admin' });
    expect((await moderate(moderator.headers, { action: 'unsuspend', targetUserId: s.helper.user.id, reason: 'not allowed' })).statusCode).toBe(403);
    expect((await moderate(admin.headers, { action: 'unsuspend', targetUserId: s.helper.user.id, reason: 'appeal accepted' })).statusCode).toBe(200);
    const [restored] = await getDb().select().from(schema.users).where(eq(schema.users.id, s.helper.user.id));
    expect(restored!.status).toBe('active');
    expect(restored!.canHelp).toBe(true);
  });

  it('restrict_requests blocks POST /requests with account_restricted', async () => {
    const s = await matchScenario();
    const moderator = await makeAuthedUser({ role: 'moderator' });
    expect(
      (await moderate(moderator.headers, {
        action: 'restrict_requests', targetUserId: s.requester.user.id, reason: 'repeated false requests', durationHours: 48,
      })).statusCode,
    ).toBe(200);

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/requests',
      headers: s.requester.headers,
      payload: {
        eventId: s.event.id, categoryId: s.water.id, qty: 1, unit: 'bottle',
        expiresInMinutes: 15, safetyAcknowledged: true, idempotencyKey: idemKey('restricted'),
      },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('account_restricted');
  });

  it('event approve → shows in public search; pause → request create rejected; disable is admin-only', async () => {
    const creator = await makeAuthedUser();
    const moderator = await makeAuthedUser({ role: 'moderator' });
    const event = await makeEvent(creator.user.id, { visibility: 'public', publicApproved: false, title: 'Pending Fair' });
    const water = await categoryBySlug('water-bottle');

    expect((await app.inject({ url: '/api/v1/events?q=Pending+Fair' })).json().items).toHaveLength(0);
    const pending = await app.inject({ url: '/api/v1/admin/events?pendingApproval=true', headers: moderator.headers });
    expect(pending.json().items.map((e: { id: string }) => e.id)).toContain(event.id);

    expect((await moderate(moderator.headers, { action: 'event_approve_public', targetEventId: event.id, reason: 'looks legitimate' })).statusCode).toBe(200);
    expect((await app.inject({ url: '/api/v1/events?q=Pending+Fair' })).json().items).toHaveLength(1);

    // Pause stops request creation with event_paused.
    expect((await moderate(moderator.headers, { action: 'event_pause', targetEventId: event.id, reason: 'crowd control' })).statusCode).toBe(200);
    const paused = await app.inject({
      method: 'POST',
      url: '/api/v1/requests',
      headers: creator.headers,
      payload: {
        eventId: event.id, categoryId: water.id, qty: 1, unit: 'bottle',
        expiresInMinutes: 15, safetyAcknowledged: true, idempotencyKey: idemKey('paused'),
      },
    });
    expect(paused.statusCode).toBe(409);
    expect(paused.json().error.code).toBe('event_paused');

    expect((await moderate(moderator.headers, { action: 'event_unpause', targetEventId: event.id, reason: 'crowd cleared' })).statusCode).toBe(200);
    expect((await moderate(moderator.headers, { action: 'event_disable', targetEventId: event.id, reason: 'not yours' })).statusCode).toBe(403);

    const admin = await makeAuthedUser({ role: 'admin' });
    expect((await moderate(admin.headers, { action: 'event_disable', targetEventId: event.id, reason: 'fraudulent event' })).statusCode).toBe(200);
    const [row] = await getDb().select().from(schema.events).where(eq(schema.events.id, event.id));
    expect(row!.status).toBe('disabled');
  });

  it('reports queue → resolve notifies the reporter and sets the resolution key', async () => {
    const s = await matchScenario();
    const moderator = await makeAuthedUser({ role: 'moderator' });
    const report = await app.inject({
      method: 'POST',
      url: '/api/v1/reports',
      headers: s.requester.headers,
      payload: { category: 'suspicious_event', eventId: s.event.id, note: 'odd behavior' },
    });
    expect(report.statusCode).toBe(200);

    const queue = await app.inject({ url: '/api/v1/admin/reports', headers: moderator.headers });
    expect(queue.json().items).toHaveLength(1);
    const item = queue.json().items[0];
    expect(item.reporterPseudonym).toBe(s.requester.user.pseudonym);
    expect(item.eventTitle).toBe(s.event.title);

    expect(
      (await moderate(moderator.headers, { action: 'report_resolve', reportId: item.id, reason: 'event checked, warned organizer' })).statusCode,
    ).toBe(200);

    const mine = await app.inject({ url: '/api/v1/reports/mine', headers: s.requester.headers });
    expect(mine.json().items[0].status).toBe('resolved');
    expect(mine.json().items[0].resolutionKey).toBe('reports.resolved.action_taken');

    await drainNotify();
    const feed = await getDb()
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.userId, s.requester.user.id));
    expect(feed.some((n) => n.type === 'moderation_outcome')).toBe(true);
    expect((await auditRows('report_resolve'))).toHaveLength(1);
  });
});

describe('notices', () => {
  it('creates notifications for current members and dedupes re-delivery', async () => {
    const s = await matchScenario();
    const moderator = await makeAuthedUser({ role: 'moderator' });
    await drainNotify();

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/events/${s.event.id}/notice`,
      headers: moderator.headers,
      payload: { body: 'Water refill point moved to the north gate.', urgent: true },
    });
    expect(res.statusCode).toBe(200);

    const jobs = await drainNotify();
    const noticeJobs = jobs.filter((j) => j.type === 'event_notice');
    // requester + helper + event creator are members.
    expect(noticeJobs.length).toBeGreaterThanOrEqual(3);

    const countRows = async () =>
      (await getDb().select().from(schema.notifications)).filter((n) => n.type === 'event_notice').length;
    const first = await countRows();
    expect(first).toBe(noticeJobs.length);

    // Worker retry with the same dedupe keys must not duplicate rows.
    for (const j of noticeJobs) await deliverNotification(j);
    expect(await countRows()).toBe(first);

    // The notice itself is on the event and audited.
    const detail = await app.inject({ url: `/api/v1/events/${s.event.id}`, headers: s.requester.headers });
    expect(detail.json().notices[0].body).toContain('north gate');
    expect((await auditRows('event_notice'))).toHaveLength(1);
  });
});

describe('catalogue & flags administration', () => {
  it('PATCH /admin/categories enforces the denylist when enabling', async () => {
    const admin = await makeAuthedUser({ role: 'admin' });
    const water = await categoryBySlug('water-bottle');

    const off = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/categories/${water.id}`,
      headers: admin.headers,
      payload: { active: false, maxRequestQty: 4 },
    });
    expect(off.statusCode).toBe(200);
    expect(off.json().active).toBe(false);
    expect(off.json().maxRequestQty).toBe(4);

    // Inactive categories still appear on the admin list.
    const list = await app.inject({ url: '/api/v1/admin/categories', headers: admin.headers });
    expect(list.json().categories.some((c: { slug: string; active: boolean }) => c.slug === 'water-bottle' && !c.active)).toBe(true);

    // Restore for other tests' sanity, then try to enable a prohibited one.
    await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/categories/${water.id}`,
      headers: admin.headers,
      payload: { active: true, maxRequestQty: 6 },
    });

    const [banned] = await getDb()
      .insert(schema.categories)
      .values({ slug: 'test-liquor-crate', group: 'misc', name: { en: 'Liquor crate' }, unit: 'box', active: false })
      .returning();
    const enable = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/categories/${banned!.id}`,
      headers: admin.headers,
      payload: { active: true },
    });
    expect(enable.statusCode).toBe(422);
    expect(enable.json().error.code).toBe('prohibited_category');
    await getDb().delete(schema.categories).where(eq(schema.categories.id, banned!.id));
  });

  it('feature flags can be listed and toggled with an audit trail', async () => {
    const admin = await makeAuthedUser({ role: 'admin' });
    const list = await app.inject({ url: '/api/v1/admin/flags', headers: admin.headers });
    expect(list.json().flags.map((f: { key: string }) => f.key)).toContain('signup_open');

    const patch = await app.inject({
      method: 'PATCH',
      url: '/api/v1/admin/flags/voice_calls',
      headers: admin.headers,
      payload: { enabled: true },
    });
    expect(patch.statusCode).toBe(200);
    expect(patch.json().enabled).toBe(true);
    expect((await auditRows('flag_update'))).toHaveLength(1);
    // restore
    await app.inject({
      method: 'PATCH', url: '/api/v1/admin/flags/voice_calls', headers: admin.headers, payload: { enabled: false },
    });
  });
});

describe('emergency shutdown', () => {
  it('pauses all active events, closes signup for new phones, keeps existing users working', async () => {
    const admin = await makeAuthedUser({ role: 'admin' });
    const creator = await makeAuthedUser();
    const active1 = await makeEvent(creator.user.id);
    const active2 = await makeEvent(creator.user.id);
    const scheduled = await makeEvent(creator.user.id, { status: 'scheduled', startsAt: new Date(Date.now() + 3600_000), endsAt: new Date(Date.now() + 7200_000) });

    // An existing email-verified account to prove existing login still works.
    const existingEmail = 'e2e-shutdown-existing@example.com';
    const first = await otpLogin(existingEmail);
    expect(first.statusCode).toBe(200);

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/emergency-shutdown',
      headers: admin.headers,
      payload: { reason: 'credible safety threat at venue' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
    expect(res.json().pausedEvents).toBe(2);

    const events = await getDb().select().from(schema.events);
    const paused = new Map(events.map((e) => [e.id, e.matchingPaused]));
    expect(paused.get(active1.id)).toBe(true);
    expect(paused.get(active2.id)).toBe(true);
    expect(paused.get(scheduled.id)).toBe(false);

    const [flag] = await getDb()
      .select()
      .from(schema.featureFlags)
      .where(eq(schema.featureFlags.key, 'signup_open'));
    expect(flag!.enabled).toBe(false);

    // New email → signup refused; existing email → still logs in.
    expect((await otpLogin('e2e-shutdown-new@example.com')).statusCode).toBe(403);
    const again = await otpLogin(existingEmail);
    expect(again.statusCode).toBe(200);
    expect(again.json().isNewAccount).toBe(false);

    expect((await auditRows('emergency_shutdown'))).toHaveLength(1);

    // restore the flag for subsequent tests (truncate keeps feature_flags)
    await getDb().update(schema.featureFlags).set({ enabled: true }).where(eq(schema.featureFlags.key, 'signup_open'));
  });
});

describe('appeals', () => {
  it('suspended user appeals; admin overturn reverses the suspension', async () => {
    const admin = await makeAuthedUser({ role: 'admin' });
    const moderator = await makeAuthedUser({ role: 'moderator' });

    const email = 'e2e-appeals@example.com';
    const login = await otpLogin(email);
    const target = login.json().user as { id: string };

    expect(
      (await moderate(moderator.headers, { action: 'suspend', targetUserId: target.id, reason: 'mistaken identity case', durationHours: 72 })).statusCode,
    ).toBe(200);

    // Old session is dead, but OTP login still works while suspended…
    expect((await app.inject({ url: '/api/v1/me', headers: { authorization: `Bearer ${login.json().token}` } })).statusCode).toBe(401);
    const relogin = await otpLogin(email);
    expect(relogin.statusCode).toBe(200);
    const suspendedHeaders = { authorization: `Bearer ${relogin.json().token}` };
    // …ordinary endpoints stay closed:
    expect((await app.inject({ url: '/api/v1/me', headers: suspendedHeaders })).statusCode).toBe(403);

    const [action] = await getDb()
      .select()
      .from(schema.moderationActions)
      .where(eq(schema.moderationActions.targetUserId, target.id));

    // Only the appellant may appeal, once per action.
    const outsider = await makeAuthedUser();
    expect(
      (await app.inject({ method: 'POST', url: '/api/v1/appeals', headers: outsider.headers, payload: { moderationActionId: action!.id, body: 'not even my action' } })).statusCode,
    ).toBe(404);
    const appeal = await app.inject({
      method: 'POST',
      url: '/api/v1/appeals',
      headers: suspendedHeaders,
      payload: { moderationActionId: action!.id, body: 'I was reported by mistake; the excerpt shows someone else.' },
    });
    expect(appeal.statusCode).toBe(200);
    expect(
      (await app.inject({ method: 'POST', url: '/api/v1/appeals', headers: suspendedHeaders, payload: { moderationActionId: action!.id, body: 'duplicate appeal attempt' } })).statusCode,
    ).toBe(409);

    const mine = await app.inject({ url: '/api/v1/appeals/mine', headers: suspendedHeaders });
    expect(mine.json().items).toHaveLength(1);
    expect(mine.json().items[0].status).toBe('open');

    const open = await app.inject({ url: '/api/v1/admin/appeals?status=open', headers: admin.headers });
    expect(open.json().items).toHaveLength(1);

    const resolve = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/appeals/${appeal.json().id}/resolve`,
      headers: admin.headers,
      payload: { outcome: 'overturned', reason: 'evidence does not support the suspension' },
    });
    expect(resolve.statusCode).toBe(200);

    const [restored] = await getDb().select().from(schema.users).where(eq(schema.users.id, target.id));
    expect(restored!.status).toBe('active');
    expect(restored!.suspendedUntil).toBeNull();
    // The surviving session works again now that the account is active.
    expect((await app.inject({ url: '/api/v1/me', headers: suspendedHeaders })).statusCode).toBe(200);
    expect((await auditRows('appeal_resolve'))).toHaveLength(1);
  });
});

describe('read surfaces', () => {
  it('user search, audit keyset, and stats aggregates never expose email data', async () => {
    const moderator = await makeAuthedUser({ role: 'moderator' });
    const admin = await makeAuthedUser({ role: 'admin' });
    const target = await makeAuthedUser({ pseudonym: 'Amber Falcon', avatarSeed: 'Amber Falcon' });

    // A couple of audited actions to page through.
    for (const reason of ['first written warning', 'second written warning'] as const) {
      expect((await moderate(moderator.headers, { action: 'warn', targetUserId: target.user.id, reason })).statusCode).toBe(200);
    }

    const users = await app.inject({ url: '/api/v1/admin/users?q=amber', headers: moderator.headers });
    expect(users.json().items).toHaveLength(1);
    expect(users.json().items[0]).toMatchObject({ pseudonym: 'Amber Falcon', reportCount: 0, riskFlags: [] });
    expect(JSON.stringify(users.json())).not.toMatch(/email(?!Verified)/i);

    const page1 = await app.inject({ url: '/api/v1/admin/audit', headers: admin.headers });
    expect(page1.statusCode).toBe(200);
    expect(page1.json().items.length).toBe(2);
    expect(page1.json().items[0].actorPseudonym).toBe(moderator.user.pseudonym);
    expect(page1.json().items[0].id).toBeGreaterThan(page1.json().items[1].id); // id desc

    const stats = await app.inject({ url: '/api/v1/admin/stats', headers: moderator.headers });
    expect(stats.statusCode).toBe(200);
    const body = stats.json();
    expect(body.users.total).toBeGreaterThanOrEqual(3);
    expect(body).toHaveProperty('eventsByStatus');
    expect(body).toHaveProperty('requests24hByStatus');
    expect(body).toHaveProperty('matches24h.completed');
    expect(body).toHaveProperty('offers24h.acceptanceRate');
    expect(body).toHaveProperty('notifications24h');
    expect(body).toHaveProperty('reportsOpen');
    expect(JSON.stringify(body)).not.toMatch(UUIDish);
  });

  it('PATCH /admin/events edits fields and audits', async () => {
    const admin = await makeAuthedUser({ role: 'admin' });
    const creator = await makeAuthedUser();
    const event = await makeEvent(creator.user.id);
    await setAvailabilityOn(creator.user.id, event.id);

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/events/${event.id}`,
      headers: admin.headers,
      payload: { title: 'Renamed Relief Point', matchingPaused: true, retentionDays: 3 },
    });
    expect(res.statusCode).toBe(200);
    const [row] = await getDb().select().from(schema.events).where(eq(schema.events.id, event.id));
    expect(row!.title).toBe('Renamed Relief Point');
    expect(row!.matchingPaused).toBe(true);
    expect(row!.retentionDays).toBe(3);
    expect((await auditRows('event_update'))).toHaveLength(1);
  });

  it('PATCH /admin/events/:id/wants sets admin-declared wants', async () => {
    const admin = await makeAuthedUser({ role: 'admin' });
    const event = await makeEvent(admin.user.id);
    const water = await categoryBySlug('water-bottle');

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/events/${event.id}/wants`,
      headers: admin.headers,
      payload: { categorySlugs: [water.slug] },
    });
    expect(res.statusCode).toBe(200);

    const detail = await app.inject({ url: `/api/v1/events/${event.code}` });
    expect(detail.json().wants).toEqual([
      expect.objectContaining({ categorySlug: water.slug, source: 'admin' }),
    ]);
  });

  it('PATCH /admin/events/:id/wants is rejected for a moderator (admin-tier only)', async () => {
    const moderator = await makeAuthedUser({ role: 'moderator' });
    const admin = await makeAuthedUser({ role: 'admin' });
    const event = await makeEvent(admin.user.id);
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/events/${event.id}/wants`,
      headers: moderator.headers,
      payload: { categorySlugs: [] },
    });
    expect(res.statusCode).toBe(403);
  });
});

const UUIDish = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
