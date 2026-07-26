/**
 * Retention worker: every task exercised against real data with manipulated
 * timestamps. Tasks are run directly via runRetentionTask (no BullMQ workers);
 * queue hand-offs (expire_requests/expire_offers) are asserted by draining the
 * queues and, where meaningful, running the target processor inline.
 */
import '../env.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { closeDb } from '../../src/db/index.js';
import { closeRedis } from '../../src/lib/redis.js';
import { closeQueues, matchQueue, offerTimeoutQueue } from '../../src/queues.js';
import { runRetentionTask } from '../../src/workers/retention.js';
import { runMatchPass } from '../../src/workers/matching.js';
import {
  addInventoryDirect,
  categoryBySlug,
  getDb,
  joinEventDirect,
  makeEvent,
  makeUser,
  schema,
  setAvailabilityOn,
  setLocation,
  setupTestDb,
  truncateAll,
} from '../helpers.js';
import { idemKey } from './fixtures.js';

beforeAll(async () => {
  await setupTestDb();
});

afterAll(async () => {
  await closeQueues();
  await closeRedis();
  await closeDb();
});

beforeEach(async () => {
  await truncateAll();
});

const HOUR = 3600_000;
const DAY = 24 * HOUR;

/** A closed match + conversation + messages, for the chat retention tasks. */
async function chatFixture(eventEndedAgoDays: number, retentionDays = 7) {
  const db = getDb();
  const requester = await makeUser();
  const helper = await makeUser();
  const event = await makeEvent(requester.id, {
    startsAt: new Date(Date.now() - (eventEndedAgoDays + 1) * DAY),
    endsAt: new Date(Date.now() - eventEndedAgoDays * DAY),
    status: 'completed',
  });
  await db.update(schema.events).set({ retentionDays }).where(eq(schema.events.id, event.id));
  await joinEventDirect(helper.id, event.id);
  const water = await categoryBySlug('water-bottle');
  const item = await addInventoryDirect(helper.id, event.id, water.id, 2, 'bottle');
  const [request] = await db
    .insert(schema.requests)
    .values({
      eventId: event.id, requesterId: requester.id, categoryId: water.id, qty: '1', unit: 'bottle',
      status: 'fulfilled', qtyFulfilled: '1', expiresAt: new Date(Date.now() - eventEndedAgoDays * DAY),
      closedAt: new Date(Date.now() - eventEndedAgoDays * DAY), note: 'private note', areaHint: 'north gate',
      idempotencyKey: idemKey('ret'),
    })
    .returning();
  const [offer] = await db
    .insert(schema.matchOffers)
    .values({
      requestId: request!.id, helperId: helper.id, inventoryItemId: item.id, qty: '1',
      status: 'accepted', respondBy: new Date(), respondedAt: new Date(),
    })
    .returning();
  const [match] = await db
    .insert(schema.matches)
    .values({
      requestId: request!.id, offerId: offer!.id, eventId: event.id,
      requesterId: requester.id, helperId: helper.id, inventoryItemId: item.id,
      qtyReserved: '1', status: 'completed', requesterAlias: 'Blue Kite', helperAlias: 'Jade Reed',
      inventoryApplied: true, reliabilityApplied: true, closedAt: new Date(Date.now() - eventEndedAgoDays * DAY),
    })
    .returning();
  const [conversation] = await db
    .insert(schema.conversations)
    .values({ matchId: match!.id, status: 'readonly', expiresAt: new Date(Date.now() - HOUR) })
    .returning();
  await db.insert(schema.messages).values({
    conversationId: conversation!.id, senderId: requester.id, body: 'see you at the gate',
  });
  return { event, request: request!, offer: offer!, match: match!, conversation: conversation! };
}

describe('retention tasks', () => {
  it('purge_locations removes only expired coarse locations', async () => {
    const db = getDb();
    const user = await makeUser();
    const fresh = await makeUser();
    const event = await makeEvent(user.id);
    await joinEventDirect(fresh.id, event.id);
    await setLocation(user.id, event.id, 18.52, 73.856, -1); // already expired
    await setLocation(fresh.id, event.id, 18.52, 73.856, 15);

    await runRetentionTask('purge_locations');

    const rows = await db.select().from(schema.memberLocations);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.userId).toBe(fresh.id);
  });

  it('expire_requests enqueues a pass that settles overdue requests', async () => {
    const db = getDb();
    const user = await makeUser();
    const event = await makeEvent(user.id);
    const water = await categoryBySlug('water-bottle');
    const [request] = await db
      .insert(schema.requests)
      .values({
        eventId: event.id, requesterId: user.id, categoryId: water.id, qty: '1', unit: 'bottle',
        status: 'searching', expiresAt: new Date(Date.now() - 60_000), idempotencyKey: idemKey('exp'),
      })
      .returning();

    await matchQueue().drain();
    await runRetentionTask('expire_requests');
    const jobs = await matchQueue().getJobs(['waiting']);
    expect(jobs.map((j) => (j.data as { requestId?: string }).requestId)).toContain(request!.id);

    await runMatchPass(request!.id); // the enqueued pass settles it
    const [after] = await db.select().from(schema.requests).where(eq(schema.requests.id, request!.id));
    expect(after!.status).toBe('no_match'); // nobody was ever asked
  });

  it('expire_offers enqueues timeouts for offers past respond_by', async () => {
    const db = getDb();
    const user = await makeUser();
    const helper = await makeUser();
    const event = await makeEvent(user.id);
    const water = await categoryBySlug('water-bottle');
    const item = await addInventoryDirect(helper.id, event.id, water.id, 2, 'bottle');
    const [request] = await db
      .insert(schema.requests)
      .values({
        eventId: event.id, requesterId: user.id, categoryId: water.id, qty: '1', unit: 'bottle',
        status: 'offering', expiresAt: new Date(Date.now() + 600_000), idempotencyKey: idemKey('exp'),
      })
      .returning();
    const [offer] = await db
      .insert(schema.matchOffers)
      .values({
        requestId: request!.id, helperId: helper.id, inventoryItemId: item.id, qty: '1',
        status: 'offered', respondBy: new Date(Date.now() - 10_000),
      })
      .returning();

    await offerTimeoutQueue().drain();
    await runRetentionTask('expire_offers');
    const jobs = await offerTimeoutQueue().getJobs(['waiting']);
    expect(jobs.map((j) => (j.data as { offerId?: string }).offerId)).toContain(offer!.id);
  });

  it('expire_availability turns helping-now off after `until` and after event end', async () => {
    const db = getDb();
    const u1 = await makeUser();
    const u2 = await makeUser();
    const u3 = await makeUser();
    const live = await makeEvent(u1.id);
    const ended = await makeEvent(u2.id, {
      startsAt: new Date(Date.now() - 5 * HOUR),
      endsAt: new Date(Date.now() - HOUR),
    });
    await joinEventDirect(u3.id, live.id);
    await setAvailabilityOn(u1.id, live.id); // until NULL, live event → stays on
    await db.insert(schema.availability).values({
      userId: u3.id, eventId: live.id, isOn: true, until: new Date(Date.now() - 60_000),
    });
    await setAvailabilityOn(u2.id, ended.id); // event over → off

    await runRetentionTask('expire_availability');

    const rows = await db.select().from(schema.availability);
    const byUser = new Map(rows.map((r) => [r.userId, r.isOn]));
    expect(byUser.get(u1.id)).toBe(true);
    expect(byUser.get(u3.id)).toBe(false);
    expect(byUser.get(u2.id)).toBe(false);
  });

  it('expire_conversations flips open conversations readonly at expires_at', async () => {
    const db = getDb();
    const { conversation } = await chatFixture(0);
    await db
      .update(schema.conversations)
      .set({ status: 'open', expiresAt: new Date(Date.now() - 60_000) })
      .where(eq(schema.conversations.id, conversation.id));

    await runRetentionTask('expire_conversations');

    const [after] = await db.select().from(schema.conversations).where(eq(schema.conversations.id, conversation.id));
    expect(after!.status).toBe('readonly');
  });

  it('purge_messages deletes transcripts once the event retention window closes', async () => {
    const db = getDb();
    const old = await chatFixture(8, 7); // ended 8 days ago, 7-day retention → purge
    const recent = await chatFixture(2, 7); // still inside the window → keep

    await runRetentionTask('purge_messages');

    expect(
      await db.select().from(schema.messages).where(eq(schema.messages.conversationId, old.conversation.id)),
    ).toHaveLength(0);
    const [oldConv] = await db
      .select()
      .from(schema.conversations)
      .where(eq(schema.conversations.id, old.conversation.id));
    expect(oldConv!.status).toBe('expired');
    expect(
      await db.select().from(schema.messages).where(eq(schema.messages.conversationId, recent.conversation.id)),
    ).toHaveLength(1);
  });

  it('purge_otps_sessions removes stale otps and long-dead sessions only', async () => {
    const db = getDb();
    const user = await makeUser();
    await db.insert(schema.otpCodes).values([
      { phoneHmac: 'h1', codeHash: 'x', expiresAt: new Date(Date.now() - 2 * HOUR) }, // stale
      { phoneHmac: 'h2', codeHash: 'x', expiresAt: new Date(Date.now() + 600_000) }, // live
    ]);
    await db.insert(schema.sessions).values([
      { userId: user.id, tokenHash: 't1', platform: 'web', expiresAt: new Date(Date.now() - 31 * DAY) },
      { userId: user.id, tokenHash: 't2', platform: 'web', expiresAt: new Date(Date.now() + DAY), revokedAt: new Date(Date.now() - 31 * DAY) },
      { userId: user.id, tokenHash: 't3', platform: 'web', expiresAt: new Date(Date.now() + DAY) },
    ]);

    await runRetentionTask('purge_otps_sessions');

    expect((await db.select().from(schema.otpCodes)).map((o) => o.phoneHmac)).toEqual(['h2']);
    expect((await db.select().from(schema.sessions)).map((s) => s.tokenHash)).toEqual(['t3']);
  });

  it('anonymize_closed nulls free text and deletes unreferenced offers after retention', async () => {
    const db = getDb();
    const old = await chatFixture(8, 7);
    // An extra offer on the old request that no match references → deletable.
    const extraHelper = await makeUser();
    const water = await categoryBySlug('water-bottle');
    const extraItem = await addInventoryDirect(extraHelper.id, old.event.id, water.id, 1, 'bottle');
    await db.insert(schema.matchOffers).values({
      requestId: old.request.id, helperId: extraHelper.id, inventoryItemId: extraItem.id,
      qty: '1', status: 'declined', respondBy: new Date(), respondedAt: new Date(),
    });

    await runRetentionTask('anonymize_closed');

    const [request] = await db.select().from(schema.requests).where(eq(schema.requests.id, old.request.id));
    expect(request!.note).toBeNull();
    expect(request!.areaHint).toBeNull();
    const offers = await db
      .select()
      .from(schema.matchOffers)
      .where(eq(schema.matchOffers.requestId, old.request.id));
    // Only the match-referenced offer survives (FK); linkage stays pseudonym-only.
    expect(offers.map((o) => o.id)).toEqual([old.offer.id]);
    // Matches/requests rows themselves remain for aggregate stats.
    expect(await db.select().from(schema.matches).where(eq(schema.matches.id, old.match.id))).toHaveLength(1);
  });

  it('purge_notifications trims the feed to 30 days', async () => {
    const db = getDb();
    const user = await makeUser();
    await db.insert(schema.notifications).values([
      { userId: user.id, type: 'event_notice', titleKey: 't', bodyKey: 'b', params: {}, createdAt: new Date(Date.now() - 31 * DAY) },
      { userId: user.id, type: 'event_notice', titleKey: 't', bodyKey: 'b', params: {}, createdAt: new Date(Date.now() - DAY) },
    ]);

    await runRetentionTask('purge_notifications');

    const rows = await db.select().from(schema.notifications);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.createdAt.getTime()).toBeGreaterThan(Date.now() - 2 * DAY);
  });

  it('event_lifecycle advances scheduled→active→completed→archived and turns availability off', async () => {
    const db = getDb();
    const creator = await makeUser();
    const shouldActivate = await makeEvent(creator.id, {
      status: 'scheduled',
      startsAt: new Date(Date.now() - HOUR),
      endsAt: new Date(Date.now() + 5 * HOUR),
    });
    const shouldComplete = await makeEvent(creator.id, {
      status: 'active',
      startsAt: new Date(Date.now() - 5 * HOUR),
      endsAt: new Date(Date.now() - HOUR),
    });
    const shouldArchive = await makeEvent(creator.id, {
      status: 'active', // completed + past retention in one sweep-two-steps check
      startsAt: new Date(Date.now() - 20 * DAY),
      endsAt: new Date(Date.now() - 10 * DAY),
    });
    await db.update(schema.events).set({ retentionDays: 7 }).where(eq(schema.events.id, shouldArchive.id));
    await setAvailabilityOn(creator.id, shouldComplete.id);

    await runRetentionTask('event_lifecycle');
    let statuses = new Map((await db.select().from(schema.events)).map((e) => [e.id, e.status]));
    expect(statuses.get(shouldActivate.id)).toBe('active');
    expect(statuses.get(shouldComplete.id)).toBe('completed');
    // Ended 10 days ago with 7-day retention: completes and archives in one sweep.
    expect(statuses.get(shouldArchive.id)).toBe('archived');

    const [avail] = await db
      .select()
      .from(schema.availability)
      .where(and(eq(schema.availability.userId, creator.id), eq(schema.availability.eventId, shouldComplete.id)));
    expect(avail!.isOn).toBe(false);

    await runRetentionTask('event_lifecycle'); // idempotent second sweep
    statuses = new Map((await db.select().from(schema.events)).map((e) => [e.id, e.status]));
    expect(statuses.get(shouldArchive.id)).toBe('archived');
    expect(statuses.get(shouldComplete.id)).toBe('completed'); // within retention → stays
  });

  it('event_lifecycle lifts expired suspensions (audited) and expired restrictions', async () => {
    const db = getDb();
    const moderator = await makeUser({ role: 'moderator' });
    const suspended = await makeUser({ status: 'suspended', suspendedUntil: new Date(Date.now() - HOUR) });
    const stillSuspended = await makeUser({ status: 'suspended', suspendedUntil: new Date(Date.now() + HOUR) });
    const indefinite = await makeUser({ status: 'suspended', suspendedUntil: null });
    const restricted = await makeUser({ canRequest: false });
    await db.insert(schema.moderationActions).values({
      actorId: moderator.id, action: 'restrict_requests', targetUserId: restricted.id,
      reason: 'test', expiresAt: new Date(Date.now() - HOUR),
    });
    const stillRestricted = await makeUser({ canHelp: false });
    await db.insert(schema.moderationActions).values({
      actorId: moderator.id, action: 'restrict_helping', targetUserId: stillRestricted.id,
      reason: 'test', expiresAt: new Date(Date.now() + HOUR),
    });

    await runRetentionTask('event_lifecycle');

    const users = new Map((await db.select().from(schema.users)).map((u) => [u.id, u]));
    expect(users.get(suspended.id)!.status).toBe('active');
    expect(users.get(stillSuspended.id)!.status).toBe('suspended');
    expect(users.get(indefinite.id)!.status).toBe('suspended');
    expect(users.get(restricted.id)!.canRequest).toBe(true);
    expect(users.get(stillRestricted.id)!.canHelp).toBe(false);

    const audit = await db
      .select()
      .from(schema.auditLog)
      .where(sql`${schema.auditLog.action} = 'auto_unsuspend'`);
    expect(audit).toHaveLength(1);
    expect(audit[0]!.target).toBe(`user:${suspended.id}`);
  });
});
