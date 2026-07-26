/**
 * Retention/lifecycle sweeper. Every task is idempotent set-based SQL: running
 * it twice (or concurrently) converges to the same state. Tasks that hand work
 * to other queues (expire_requests/expire_offers) only ENQUEUE — the target
 * processors re-check state under locks, so duplicate jobs are no-ops.
 *
 * Data minimization lives here: coarse locations, chat transcripts, OTPs,
 * stale sessions and old notifications all have hard expiry dates enforced by
 * this worker, independent of any user action.
 */
import type { Job } from 'bullmq';
import { sql } from 'drizzle-orm';
import { QUICK_REPLIES } from '@sahay/shared';
import { getDb } from '../db/index.js';
import { matchQueue, offerTimeoutQueue, type RetentionJob } from '../queues.js';
import { publishToUser } from '../realtime/hub.js';

/** Coarse locations past their TTL are removed outright. */
async function purgeLocations(): Promise<void> {
  await getDb().execute(sql`DELETE FROM member_locations WHERE expires_at < now()`);
}

/**
 * Requests past expiry get one more matching pass; runMatchPass settles them
 * to expired/no_match under the request lock.
 */
async function expireRequests(): Promise<void> {
  const res = await getDb().execute(sql`
    SELECT id FROM requests WHERE status IN ('searching', 'offering') AND expires_at <= now()
  `);
  for (const row of res.rows) {
    await matchQueue().add('match', { requestId: String(row.id) });
  }
}

/** Sweep offers whose timeout job was lost (respond_by 2s+ in the past). */
async function expireOffers(): Promise<void> {
  const res = await getDb().execute(sql`
    SELECT id FROM match_offers
    WHERE status = 'offered' AND respond_by < now() - interval '2 seconds'
  `);
  for (const row of res.rows) {
    await offerTimeoutQueue().add('timeout', { offerId: String(row.id) });
  }
}

/** Helping-now switches off at their chosen end time and when the event ends. */
async function expireAvailability(): Promise<void> {
  const db = getDb();
  await db.execute(sql`
    UPDATE availability SET is_on = false, updated_at = now()
    WHERE is_on AND until IS NOT NULL AND until < now()
  `);
  await db.execute(sql`
    UPDATE availability a SET is_on = false, updated_at = now()
    FROM events e
    WHERE e.id = a.event_id AND a.is_on AND e.ends_at < now()
  `);
}

/** Open conversations past their grace window flip to readonly (+ WS hint). */
async function expireConversations(): Promise<void> {
  const res = await getDb().execute(sql`
    UPDATE conversations c SET status = 'readonly'
    FROM matches m
    WHERE m.id = c.match_id AND c.status = 'open' AND c.expires_at < now()
    RETURNING c.id, c.match_id, c.expires_at, m.requester_id, m.helper_id
  `);
  for (const row of res.rows) {
    const view = {
      id: String(row.id),
      matchId: String(row.match_id),
      status: 'readonly' as const,
      expiresAt: row.expires_at ? new Date(String(row.expires_at)).toISOString() : null,
      quickReplies: [...QUICK_REPLIES],
    };
    await publishToUser(String(row.requester_id), 'conversation.update', view);
    await publishToUser(String(row.helper_id), 'conversation.update', view);
  }
}

/**
 * Chat transcripts are deleted once the event's retention window closes; the
 * conversation shell stays (status 'expired') so match views keep resolving.
 */
async function purgeMessages(): Promise<void> {
  await getDb().execute(sql`
    WITH target AS (
      SELECT c.id FROM conversations c
      JOIN matches m ON m.id = c.match_id
      JOIN events e ON e.id = m.event_id
      WHERE c.status <> 'expired'
        AND e.ends_at + make_interval(days => e.retention_days) < now()
    ),
    del AS (
      DELETE FROM messages WHERE conversation_id IN (SELECT id FROM target)
    )
    UPDATE conversations SET status = 'expired' WHERE id IN (SELECT id FROM target)
  `);
}

/** Consumed/expired OTPs and long-dead sessions have no further use. */
async function purgeOtpsSessions(): Promise<void> {
  const db = getDb();
  await db.execute(sql`DELETE FROM otp_codes WHERE expires_at < now() - interval '1 hour'`);
  await db.execute(sql`
    DELETE FROM sessions
    WHERE expires_at < now() - interval '30 days'
       OR (revoked_at IS NOT NULL AND revoked_at < now() - interval '30 days')
  `);
}

/**
 * Post-retention anonymization for ended events: free-text request fields are
 * nulled and unmatched offers deleted. Matches/requests rows themselves stay
 * for aggregate stats — linkage is pseudonym-only. Offers referenced by a
 * match must stay (FK matches.offer_id); the match row already carries the
 * same linkage, so deleting only unreferenced offers loses nothing.
 */
async function anonymizeClosed(): Promise<void> {
  const db = getDb();
  await db.execute(sql`
    UPDATE requests r SET note = NULL, area_hint = NULL
    FROM events e
    WHERE e.id = r.event_id
      AND e.ends_at + make_interval(days => e.retention_days) < now()
      AND r.status NOT IN ('searching', 'offering', 'matched')
      AND (r.note IS NOT NULL OR r.area_hint IS NOT NULL)
  `);
  await db.execute(sql`
    DELETE FROM match_offers mo
    USING requests r, events e
    WHERE r.id = mo.request_id AND e.id = r.event_id
      AND e.ends_at + make_interval(days => e.retention_days) < now()
      AND NOT EXISTS (SELECT 1 FROM matches m WHERE m.offer_id = mo.id)
  `);
}

/** The in-app feed is capped at 30 days. */
async function purgeNotifications(): Promise<void> {
  await getDb().execute(sql`DELETE FROM notifications WHERE created_at < now() - interval '30 days'`);
}

/**
 * Event lifecycle advancement + expiry of time-boxed moderation:
 * scheduled → active → completed (availability off) → archived, and
 * suspensions/restrictions whose clock ran out are lifted (audited).
 */
async function eventLifecycle(): Promise<void> {
  const db = getDb();
  await db.execute(sql`
    UPDATE events SET status = 'active'
    WHERE status = 'scheduled' AND starts_at <= now() AND ends_at > now()
  `);
  const completed = await db.execute(sql`
    UPDATE events SET status = 'completed'
    WHERE status IN ('scheduled', 'active') AND ends_at <= now()
    RETURNING id
  `);
  if (completed.rows.length > 0) {
    await db.execute(sql`
      UPDATE availability SET is_on = false, updated_at = now()
      WHERE is_on AND event_id IN (SELECT id FROM events WHERE status = 'completed')
    `);
  }
  await db.execute(sql`
    UPDATE events SET status = 'archived'
    WHERE status = 'completed' AND ends_at + make_interval(days => retention_days) < now()
  `);

  // Lift expired suspensions (audited per user).
  const unsuspended = await db.execute(sql`
    UPDATE users SET status = 'active', suspended_until = NULL
    WHERE status = 'suspended' AND suspended_until IS NOT NULL AND suspended_until < now()
    RETURNING id
  `);
  for (const row of unsuspended.rows) {
    await db.execute(sql`
      INSERT INTO audit_log (actor_id, action, target, reason)
      VALUES (NULL, 'auto_unsuspend', ${'user:' + String(row.id)}, 'suspension expired')
    `);
  }

  // Restore request/help flags once no unexpired restrict_* action remains.
  await db.execute(sql`
    UPDATE users u SET can_request = true, can_help = true
    WHERE (u.can_request = false OR u.can_help = false)
      AND EXISTS (
        SELECT 1 FROM moderation_actions ma
        WHERE ma.target_user_id = u.id
          AND ma.action IN ('restrict_requests', 'restrict_helping')
          AND ma.expires_at IS NOT NULL AND ma.expires_at < now())
      AND NOT EXISTS (
        SELECT 1 FROM moderation_actions ma2
        WHERE ma2.target_user_id = u.id
          AND ma2.action IN ('restrict_requests', 'restrict_helping')
          AND (ma2.expires_at IS NULL OR ma2.expires_at >= now()))
  `);
}

const TASKS: Record<RetentionJob['task'], () => Promise<void>> = {
  purge_locations: purgeLocations,
  expire_requests: expireRequests,
  expire_offers: expireOffers,
  expire_availability: expireAvailability,
  expire_conversations: expireConversations,
  purge_messages: purgeMessages,
  purge_otps_sessions: purgeOtpsSessions,
  anonymize_closed: anonymizeClosed,
  purge_notifications: purgeNotifications,
  event_lifecycle: eventLifecycle,
};

/** Exported for tests: run a single retention task by name. */
export async function runRetentionTask(task: RetentionJob['task']): Promise<void> {
  const fn = TASKS[task];
  if (!fn) throw new Error(`unknown retention task: ${task}`);
  await fn();
}

export async function processRetention(job: Job<RetentionJob>): Promise<void> {
  await runRetentionTask(job.data.task);
}
