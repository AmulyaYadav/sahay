/**
 * Notification fan-out: persist (with dedupe), publish the WS hint, then push.
 * The DB row is the source of truth for the in-app feed; push is best-effort.
 *
 * Privacy: lock-screen payloads for content-bearing types (match_offer,
 * new_message) stay vague unless the user opted into detailed previews.
 * Per-type preference OFF suppresses PUSH ONLY — the feed row (and WS hint)
 * still lands so in-app history stays complete.
 */
import type { Job } from 'bullmq';
import { and, eq, inArray } from 'drizzle-orm';
import { t, type Locale, type Notification } from '@sahay/shared';
import { getDb, schema } from '../db/index.js';
import { getPushProviders, type PushPayload, type PushProvider } from '../lib/push.js';
import { publishToUser } from '../realtime/hub.js';
import type { NotifyJob } from '../queues.js';

/** Types whose real content could reveal what someone asked for or carries. */
export const VAGUE_PREVIEW_TYPES: ReadonlySet<string> = new Set(['match_offer', 'new_message']);

/**
 * The vague body to use per type.
 *
 * One string used to serve both, and it was written for the offer case:
 * "Someone at your event may need an item you are carrying." Sent to a helper
 * that is true. Sent to a requester — who gets new_message pushes throughout
 * their own exchange — it says the opposite of their situation, and reads as an
 * unexplained request to go and help someone.
 */
const VAGUE_BODY: Record<string, string> = {
  match_offer: 'notifications.vaguePreview',
  new_message: 'notifications.vagueMessage',
};

/**
 * Push payload policy (pure, unit-tested): content-bearing types are vague
 * unless detailed previews are on; every other type (event notices, moderation,
 * security) carries its real localized text — it holds no peer/request details.
 */
export function buildPushPayload(
  job: Pick<NotifyJob, 'type' | 'titleKey' | 'bodyKey' | 'params' | 'deepLink'>,
  detailedPreviews: boolean,
  locale: Locale,
): PushPayload {
  const vague = VAGUE_PREVIEW_TYPES.has(job.type) && !detailedPreviews;
  const payload: PushPayload = vague
    ? {
        title: t(locale, 'common.appName'),
        body: t(locale, VAGUE_BODY[job.type] ?? 'notifications.vagueGeneric'),
      }
    : { title: t(locale, job.titleKey, job.params), body: t(locale, job.bodyKey, job.params) };
  if (job.deepLink) payload.deepLink = job.deepLink;
  return payload;
}

/**
 * Full delivery pipeline. `providers` is injectable for tests; production uses
 * the configured providers.
 */
export async function deliverNotification(
  data: NotifyJob,
  providers: PushProvider[] = getPushProviders(),
): Promise<void> {
  const db = getDb();
  const [user] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, data.userId))
    .limit(1);
  if (!user || user.deletedAt || user.status === 'deleted') return;
  // Suspended accounts still receive security + moderation notices (they must
  // learn about — and be able to appeal — the action); everything else is muted.
  if (user.status === 'suspended' && data.type !== 'account_security' && data.type !== 'moderation_outcome') {
    return;
  }
  const locale: Locale = user.locale === 'hi' ? 'hi' : 'en';

  // (b) Persist exactly once per (user, dedupeKey). A conflict means an earlier
  // job already delivered this notification — stop, no push, no WS.
  const inserted = await db
    .insert(schema.notifications)
    .values({
      userId: data.userId,
      type: data.type,
      titleKey: data.titleKey,
      bodyKey: data.bodyKey,
      params: data.params ?? {},
      deepLink: data.deepLink ?? null,
      dedupeKey: data.dedupeKey ?? null,
    })
    .onConflictDoNothing()
    .returning();
  const row = inserted[0];
  if (!row) return; // deduped

  // (c) WS hint with the feed view model.
  const view: Notification = {
    id: row.id,
    type: row.type as Notification['type'],
    titleKey: row.titleKey,
    bodyKey: row.bodyKey,
    params: row.params,
    createdAt: row.createdAt.toISOString(),
    readAt: null,
    deepLink: row.deepLink,
  };
  await publishToUser(data.userId, 'notification.new', view);

  // (d) Push, honoring prefs. Missing prefs row = defaults (vague, all types on).
  const [prefs] = await db
    .select()
    .from(schema.notificationPrefs)
    .where(eq(schema.notificationPrefs.userId, data.userId))
    .limit(1);
  if (prefs?.perType?.[data.type] === false) return; // push muted; feed row stays

  const tokens = await db
    .select({ provider: schema.pushTokens.provider, token: schema.pushTokens.token })
    .from(schema.pushTokens)
    .where(and(eq(schema.pushTokens.userId, data.userId), eq(schema.pushTokens.disabled, false)));
  if (tokens.length === 0) return;

  const payload = buildPushPayload(data, prefs?.detailedPreviews ?? false, locale);
  const failed = new Set<string>();
  for (const provider of providers) {
    const result = await provider.send(tokens, payload);
    for (const token of result.failed) failed.add(token);
  }
  if (failed.size > 0) {
    await db
      .update(schema.pushTokens)
      .set({ disabled: true })
      .where(
        and(eq(schema.pushTokens.userId, data.userId), inArray(schema.pushTokens.token, [...failed])),
      );
  }
}

export async function processNotify(job: Job<NotifyJob>): Promise<void> {
  await deliverNotification(job.data);
}
