/**
 * Profile, blocks, push tokens, notification prefs, and the notification feed.
 * Peer identities never appear here: blocked users are shown only as the match
 * alias they used with the caller.
 */
import { and, desc, eq, or, sql } from 'drizzle-orm';
import type { Me, Notification } from '@sahay/shared';
import { getDb, schema } from '../../db/index.js';
import { errors } from '../../lib/errors.js';
import { randomPseudonym, toMe } from '../auth/service.js';

export const PSEUDONYM_REGEN_DAYS = 30;

/** Pure so it's unit-testable: one regeneration per 30 days. */
export function canRegeneratePseudonym(changedAt: Date | null, now: Date): boolean {
  if (!changedAt) return true;
  return now.getTime() - changedAt.getTime() >= PSEUDONYM_REGEN_DAYS * 24 * 3600_000;
}

export async function getMe(userId: string): Promise<Me> {
  const db = getDb();
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1);
  if (!user) throw errors.unauthorized();
  return toMe(user);
}

export async function updateMe(
  userId: string,
  patch: { locale?: 'en' | 'hi'; regeneratePseudonym?: boolean },
): Promise<Me> {
  const db = getDb();
  return db.transaction(async (tx) => {
    const [user] = await tx
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1)
      .for('update');
    if (!user) throw errors.unauthorized();

    const set: Partial<typeof schema.users.$inferInsert> = {};
    if (patch.locale) set.locale = patch.locale;
    if (patch.regeneratePseudonym) {
      if (!canRegeneratePseudonym(user.pseudonymChangedAt, new Date())) throw errors.rateLimited();
      const pseudonym = randomPseudonym();
      set.pseudonym = pseudonym;
      set.avatarSeed = pseudonym;
      set.pseudonymChangedAt = new Date();
    }
    if (Object.keys(set).length === 0) return toMe(user);
    const [updated] = await tx
      .update(schema.users)
      .set(set)
      .where(eq(schema.users.id, userId))
      .returning();
    return toMe(updated!);
  });
}

export async function listBlocks(userId: string): Promise<{ createdAt: string; alias: string }[]> {
  const db = getDb();
  // The alias the blocked user had in their most recent shared match with the caller.
  const rows = await db
    .select({
      createdAt: schema.blocks.createdAt,
      alias: sql<string | null>`(
        SELECT CASE WHEN m.requester_id = ${userId} THEN m.helper_alias ELSE m.requester_alias END
        FROM matches m
        WHERE (m.requester_id = ${userId} AND m.helper_id = ${schema.blocks.blockedId})
           OR (m.helper_id = ${userId} AND m.requester_id = ${schema.blocks.blockedId})
        ORDER BY m.created_at DESC
        LIMIT 1
      )`,
    })
    .from(schema.blocks)
    .where(eq(schema.blocks.blockerId, userId))
    .orderBy(desc(schema.blocks.createdAt));
  return rows.map((r) => ({ createdAt: r.createdAt.toISOString(), alias: r.alias ?? '—' }));
}

export async function registerPushToken(
  userId: string,
  provider: 'expo' | 'webpush',
  token: string,
): Promise<void> {
  const db = getDb();
  await db
    .insert(schema.pushTokens)
    .values({ userId, provider, token, lastUsedAt: new Date() })
    .onConflictDoUpdate({
      target: [schema.pushTokens.userId, schema.pushTokens.token],
      set: { provider, disabled: false, lastUsedAt: new Date() },
    });
}

export async function getNotificationPrefs(userId: string) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.notificationPrefs)
    .where(eq(schema.notificationPrefs.userId, userId))
    .limit(1);
  return { detailedPreviews: row?.detailedPreviews ?? false, perType: row?.perType ?? {} };
}

export async function putNotificationPrefs(
  userId: string,
  prefs: { detailedPreviews: boolean; perType: Record<string, boolean> },
) {
  const db = getDb();
  await db
    .insert(schema.notificationPrefs)
    .values({ userId, detailedPreviews: prefs.detailedPreviews, perType: prefs.perType })
    .onConflictDoUpdate({
      target: schema.notificationPrefs.userId,
      set: { detailedPreviews: prefs.detailedPreviews, perType: prefs.perType },
    });
  return prefs;
}

export function encodeCursor(createdAt: Date, id: string): string {
  return `${createdAt.toISOString()}|${id}`;
}

export function decodeCursor(cursor: string): { createdAt: Date; id: string } | null {
  const idx = cursor.indexOf('|');
  if (idx < 0) return null;
  const createdAt = new Date(cursor.slice(0, idx));
  const id = cursor.slice(idx + 1);
  if (Number.isNaN(createdAt.getTime()) || !id) return null;
  return { createdAt, id };
}

export async function listNotifications(
  userId: string,
  limit: number,
  cursor?: string,
): Promise<{ items: Notification[]; nextCursor: string | null }> {
  const db = getDb();
  const decoded = cursor ? decodeCursor(cursor) : null;
  if (cursor && !decoded) throw errors.validation({ field: 'cursor' });

  const where = decoded
    ? and(
        eq(schema.notifications.userId, userId),
        or(
          sql`${schema.notifications.createdAt} < ${decoded.createdAt}`,
          and(
            eq(schema.notifications.createdAt, decoded.createdAt),
            sql`${schema.notifications.id} < ${decoded.id}`,
          ),
        ),
      )
    : eq(schema.notifications.userId, userId);

  const rows = await db
    .select()
    .from(schema.notifications)
    .where(where)
    .orderBy(desc(schema.notifications.createdAt), desc(schema.notifications.id))
    .limit(limit);

  const items: Notification[] = rows.map((n) => ({
    id: n.id,
    type: n.type as Notification['type'],
    titleKey: n.titleKey,
    bodyKey: n.bodyKey,
    params: n.params,
    createdAt: n.createdAt.toISOString(),
    readAt: n.readAt ? n.readAt.toISOString() : null,
    deepLink: n.deepLink,
  }));
  const last = rows[rows.length - 1];
  const nextCursor = rows.length === limit && last ? encodeCursor(last.createdAt, last.id) : null;
  return { items, nextCursor };
}

export async function markNotificationRead(userId: string, id: string): Promise<void> {
  const db = getDb();
  const rows = await db
    .update(schema.notifications)
    .set({ readAt: new Date() })
    .where(and(eq(schema.notifications.id, id), eq(schema.notifications.userId, userId)))
    .returning({ id: schema.notifications.id });
  if (rows.length === 0) throw errors.notFound();
}
