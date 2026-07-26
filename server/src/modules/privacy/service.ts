/**
 * Privacy self-service: data export (async via the data-request worker),
 * account deletion, and the consent ledger. Deletion revokes every session
 * immediately and marks the account deleted; the destructive cleanup runs in
 * the worker so the API call stays fast and retry-safe.
 */
import { and, desc, eq, isNull } from 'drizzle-orm';
import type { z } from 'zod';
import type { zDataExport } from '@sahay/shared';
import { getDb, schema } from '../../db/index.js';
import { errors } from '../../lib/errors.js';
import { rateLimit } from '../../lib/redis.js';
import { dataRequestQueue } from '../../queues.js';
import { publishToUser } from '../../realtime/hub.js';

export type DataExportView = z.infer<typeof zDataExport>;

export const EXPORTS_PER_DAY = 2;
export const EXPORT_DOWNLOAD_PATH = '/api/v1/me/export/download';

function toExportView(row: typeof schema.dataRequests.$inferSelect): DataExportView {
  const ready = row.status === 'ready' || row.status === 'done';
  return {
    status: ready ? 'ready' : 'pending',
    requestedAt: row.createdAt.toISOString(),
    downloadUrl: ready ? EXPORT_DOWNLOAD_PATH : null,
  };
}

export async function requestExport(userId: string): Promise<DataExportView> {
  const allowed = await rateLimit('export:create', userId, EXPORTS_PER_DAY, 86_400).catch(() => false);
  if (!allowed) throw errors.rateLimited();
  const db = getDb();
  const [row] = await db
    .insert(schema.dataRequests)
    .values({ userId, kind: 'export', status: 'pending' })
    .returning();
  await dataRequestQueue().add('data-request', { dataRequestId: row!.id });
  return toExportView(row!);
}

export async function getLatestExport(userId: string): Promise<DataExportView> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.dataRequests)
    .where(and(eq(schema.dataRequests.userId, userId), eq(schema.dataRequests.kind, 'export')))
    .orderBy(desc(schema.dataRequests.createdAt))
    .limit(1);
  if (!row) throw errors.notFound();
  return toExportView(row);
}

export async function getExportPayload(userId: string): Promise<unknown> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.dataRequests)
    .where(
      and(
        eq(schema.dataRequests.userId, userId),
        eq(schema.dataRequests.kind, 'export'),
        eq(schema.dataRequests.status, 'ready'),
      ),
    )
    .orderBy(desc(schema.dataRequests.createdAt))
    .limit(1);
  if (!row || row.payload == null) throw errors.notFound();
  return row.payload;
}

/**
 * Confirm-and-queue deletion. The pseudonym retype is the confirmation factor
 * (trimmed, case-insensitive). All sessions die NOW; the worker performs the
 * data removal and final anonymization (including deleted_at).
 */
export async function requestAccountDeletion(userId: string, confirmPseudonym: string): Promise<void> {
  const db = getDb();
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1);
  if (!user) throw errors.unauthorized();
  if (confirmPseudonym.trim().toLowerCase() !== user.pseudonym.trim().toLowerCase()) {
    throw errors.validation({ field: 'confirmPseudonym' });
  }

  const { sessionIds, dataRequestId } = await db.transaction(async (tx) => {
    const revoked = await tx
      .update(schema.sessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(schema.sessions.userId, userId), isNull(schema.sessions.revokedAt)))
      .returning({ id: schema.sessions.id });
    // status flips immediately so nothing new can be started; deleted_at is set
    // by the worker once the actual data removal has happened.
    await tx.update(schema.users).set({ status: 'deleted' }).where(eq(schema.users.id, userId));
    const [dr] = await tx
      .insert(schema.dataRequests)
      .values({ userId, kind: 'delete', status: 'pending' })
      .returning({ id: schema.dataRequests.id });
    return { sessionIds: revoked.map((r) => r.id), dataRequestId: dr!.id };
  });

  for (const sessionId of sessionIds) {
    await publishToUser(userId, 'session.revoked', { sessionId }).catch(() => {});
  }
  await dataRequestQueue().add('data-request', { dataRequestId });
}

export async function listConsents(
  userId: string,
): Promise<{ kind: string; granted: boolean; createdAt: string }[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.consentRecords)
    .where(eq(schema.consentRecords.userId, userId))
    .orderBy(desc(schema.consentRecords.createdAt));
  return rows.map((r) => ({ kind: r.kind, granted: r.granted, createdAt: r.createdAt.toISOString() }));
}
