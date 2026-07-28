/**
 * Data export & account deletion processor.
 *
 * Export gathers the USER'S OWN data only. Hard rules: the phone number (even
 * encrypted/hashed) never appears; peers appear exclusively as match aliases;
 * no other account's uuid may occur anywhere in the bundle.
 *
 * Deletion is a sequence of idempotent steps (each its own transaction), so a
 * crashed/retried job resumes safely: active matches are cancelled through the
 * moderation cancel path (releases reservations), open requests are cancelled,
 * device/session/location data is removed, inventory is zeroed & deactivated,
 * and finally the users row is anonymized. Reports the user filed and
 * moderation history are kept (the anonymized user row de-identifies them);
 * blocks where the user is the BLOCKED side survive — they protect others.
 */
import { randomBytes } from 'node:crypto';
import type { Job } from 'bullmq';
import { and, asc, desc, eq, inArray, or, sql } from 'drizzle-orm';
import { getDb, schema } from '../db/index.js';
import { notifyQueue, type DataRequestJob } from '../queues.js';
import { cancelMatchForModeration } from '../modules/matches/service.js';
import { transitionRequest } from '../modules/requests/transitions.js';

/* ------------------------------------------------------------------ export */

export async function buildExportBundle(userId: string): Promise<Record<string, unknown>> {
  const db = getDb();
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1);
  if (!user) throw new Error('user not found for export');

  const sessions = await db
    .select()
    .from(schema.sessions)
    .where(eq(schema.sessions.userId, userId))
    .orderBy(desc(schema.sessions.createdAt));

  const memberships = await db
    .select({ m: schema.memberships, eventTitle: schema.events.title, eventCode: schema.events.code })
    .from(schema.memberships)
    .innerJoin(schema.events, eq(schema.memberships.eventId, schema.events.id))
    .where(eq(schema.memberships.userId, userId))
    .orderBy(desc(schema.memberships.joinedAt));

  const inventory = await db
    .select({ i: schema.inventoryItems, slug: schema.categories.slug, eventTitle: schema.events.title })
    .from(schema.inventoryItems)
    .innerJoin(schema.categories, eq(schema.inventoryItems.categoryId, schema.categories.id))
    .innerJoin(schema.events, eq(schema.inventoryItems.eventId, schema.events.id))
    .where(eq(schema.inventoryItems.userId, userId))
    .orderBy(desc(schema.inventoryItems.createdAt));

  const requests = await db
    .select({ r: schema.requests, slug: schema.categories.slug, eventTitle: schema.events.title })
    .from(schema.requests)
    .innerJoin(schema.categories, eq(schema.requests.categoryId, schema.categories.id))
    .innerJoin(schema.events, eq(schema.requests.eventId, schema.events.id))
    .where(eq(schema.requests.requesterId, userId))
    .orderBy(desc(schema.requests.createdAt));

  const matches = await db
    .select({ m: schema.matches, slug: schema.categories.slug })
    .from(schema.matches)
    .innerJoin(schema.requests, eq(schema.matches.requestId, schema.requests.id))
    .innerJoin(schema.categories, eq(schema.requests.categoryId, schema.categories.id))
    .where(or(eq(schema.matches.requesterId, userId), eq(schema.matches.helperId, userId)))
    .orderBy(desc(schema.matches.createdAt));

  const messages = await db
    .select()
    .from(schema.messages)
    .where(eq(schema.messages.senderId, userId))
    .orderBy(asc(schema.messages.createdAt));

  const reports = await db
    .select()
    .from(schema.reports)
    .where(eq(schema.reports.reporterId, userId))
    .orderBy(desc(schema.reports.createdAt));

  const blocks = await db
    .select()
    .from(schema.blocks)
    .where(eq(schema.blocks.blockerId, userId))
    .orderBy(desc(schema.blocks.createdAt));

  const consents = await db
    .select()
    .from(schema.consentRecords)
    .where(eq(schema.consentRecords.userId, userId))
    .orderBy(desc(schema.consentRecords.createdAt));

  const notifications = await db
    .select()
    .from(schema.notifications)
    .where(eq(schema.notifications.userId, userId))
    .orderBy(desc(schema.notifications.createdAt));

  return {
    generatedAt: new Date().toISOString(),
    profile: {
      pseudonym: user.pseudonym,
      locale: user.locale,
      createdAt: user.createdAt.toISOString(),
      emailVerified: user.emailVerifiedAt != null, // never the address itself
    },
    sessions: sessions.map((s) => ({
      platform: s.platform,
      deviceName: s.deviceName,
      createdAt: s.createdAt.toISOString(),
      lastSeenAt: s.lastSeenAt.toISOString(),
      revoked: s.revokedAt != null,
    })),
    events: memberships.map((row) => ({
      title: row.eventTitle,
      code: row.eventCode,
      joinedAt: row.m.joinedAt.toISOString(),
      leftAt: row.m.leftAt ? row.m.leftAt.toISOString() : null,
      role: row.m.role,
    })),
    inventory: inventory.map((row) => ({
      eventTitle: row.eventTitle,
      categorySlug: row.slug,
      qtyOnHand: Number(row.i.qtyOnHand),
      qtyReserved: Number(row.i.qtyReserved),
      unit: row.i.unit,
      details: row.i.details,
      active: row.i.active,
      createdAt: row.i.createdAt.toISOString(),
    })),
    requests: requests.map((row) => ({
      eventTitle: row.eventTitle,
      categorySlug: row.slug,
      qty: Number(row.r.qty),
      qtyFulfilled: Number(row.r.qtyFulfilled),
      unit: row.r.unit,
      urgency: row.r.urgency,
      note: row.r.note,
      status: row.r.status,
      createdAt: row.r.createdAt.toISOString(),
    })),
    matches: matches.map((row) => {
      const isRequester = row.m.requesterId === userId;
      return {
        role: isRequester ? 'requester' : 'helper',
        categorySlug: row.slug,
        myAlias: isRequester ? row.m.requesterAlias : row.m.helperAlias,
        peerAlias: isRequester ? row.m.helperAlias : row.m.requesterAlias, // alias only, never an id
        qtyReserved: Number(row.m.qtyReserved),
        myConfirmedQty:
          (isRequester ? row.m.requesterConfirmedQty : row.m.helperConfirmedQty) == null
            ? null
            : Number(isRequester ? row.m.requesterConfirmedQty : row.m.helperConfirmedQty),
        status: row.m.status,
        createdAt: row.m.createdAt.toISOString(),
        closedAt: row.m.closedAt ? row.m.closedAt.toISOString() : null,
      };
    }),
    messages: messages.map((m) => ({
      conversationId: m.conversationId,
      kind: m.kind,
      body: m.body,
      createdAt: m.createdAt.toISOString(),
    })),
    reports: reports.map((r) => ({
      category: r.category,
      status: r.status,
      createdAt: r.createdAt.toISOString(),
    })),
    blocks: blocks.map((b) => ({ createdAt: b.createdAt.toISOString() })),
    consents: consents.map((c) => ({
      kind: c.kind,
      granted: c.granted,
      createdAt: c.createdAt.toISOString(),
    })),
    notifications: notifications.map((n) => ({
      type: n.type,
      titleKey: n.titleKey,
      bodyKey: n.bodyKey,
      params: n.params,
      createdAt: n.createdAt.toISOString(),
      readAt: n.readAt ? n.readAt.toISOString() : null,
    })),
  };
}

async function processExport(row: typeof schema.dataRequests.$inferSelect): Promise<void> {
  if (row.status === 'ready' || row.status === 'done') return; // idempotent
  const db = getDb();
  const payload = await buildExportBundle(row.userId);
  await db
    .update(schema.dataRequests)
    .set({ payload, status: 'ready', completedAt: new Date() })
    .where(eq(schema.dataRequests.id, row.id));
  await notifyQueue().add('notify', {
    userId: row.userId,
    type: 'account_security',
    titleKey: 'settings.exportData',
    bodyKey: 'settings.exportReady',
    params: {},
    deepLink: '/settings',
    dedupeKey: `export:${row.id}`,
  });
}

/* ---------------------------------------------------------------- deletion */

export async function performAccountDeletion(userId: string): Promise<void> {
  const db = getDb();

  // 1. Cancel active matches via the moderation path (releases reservations,
  //    conversation readonly, request → 'moderated'). Each cancel is its own tx.
  const activeMatches = await db
    .select({ id: schema.matches.id })
    .from(schema.matches)
    .where(
      and(
        eq(schema.matches.status, 'active'),
        or(eq(schema.matches.requesterId, userId), eq(schema.matches.helperId, userId)),
      ),
    );
  for (const m of activeMatches) {
    await cancelMatchForModeration(m.id, 'account_deleted');
  }

  // 2. Cancel any still-open requests through the transition table.
  await db.transaction(async (tx) => {
    const open = await tx
      .select()
      .from(schema.requests)
      .where(
        and(
          eq(schema.requests.requesterId, userId),
          inArray(schema.requests.status, ['searching', 'offering']),
        ),
      )
      .for('update');
    for (const request of open) {
      await tx
        .update(schema.matchOffers)
        .set({ status: 'superseded', respondedAt: new Date() })
        .where(
          and(eq(schema.matchOffers.requestId, request.id), eq(schema.matchOffers.status, 'offered')),
        );
      await transitionRequest(tx, request, 'cancelled', 'system', 'account_deleted', {
        closedAt: new Date(),
      });
    }
  });

  // 3. Device/session/location data goes outright.
  await db.delete(schema.sessions).where(eq(schema.sessions.userId, userId));
  await db.delete(schema.pushTokens).where(eq(schema.pushTokens.userId, userId));
  await db.delete(schema.availability).where(eq(schema.availability.userId, userId));
  await db.delete(schema.memberLocations).where(eq(schema.memberLocations.userId, userId));

  // 4. Inventory: reservations were released in step 1, so on_hand collapses to
  //    qty_reserved (0) without ever violating the reserved<=on_hand CHECK.
  await db
    .update(schema.inventoryItems)
    .set({
      qtyOnHand: sql`${schema.inventoryItems.qtyReserved}`,
      active: false,
      updatedAt: new Date(),
    })
    .where(eq(schema.inventoryItems.userId, userId));

  // 5. Notifications and prefs are personal — delete.
  await db.delete(schema.notifications).where(eq(schema.notifications.userId, userId));
  await db.delete(schema.notificationPrefs).where(eq(schema.notificationPrefs.userId, userId));

  // 6. Blocks the user placed go; blocks AGAINST the user stay (they protect others).
  await db.delete(schema.blocks).where(eq(schema.blocks.blockerId, userId));

  // 7. Anonymize the users row. The phone and email are fully detached so
  //    either can register a FRESH account later. deleted_at marks completion.
  await db
    .update(schema.users)
    .set({
      pseudonym: 'Deleted User',
      avatarSeed: randomBytes(8).toString('hex'),
      phoneEnc: null,
      phoneHmac: null,
      phoneVerifiedAt: null,
      emailEnc: null,
      emailHmac: null,
      emailVerifiedAt: null,
      status: 'deleted',
      deletedAt: new Date(),
    })
    .where(eq(schema.users.id, userId));
}

async function processDelete(row: typeof schema.dataRequests.$inferSelect): Promise<void> {
  if (row.status === 'done') return; // idempotent
  await performAccountDeletion(row.userId);
  await getDb()
    .update(schema.dataRequests)
    .set({ status: 'done', completedAt: new Date() })
    .where(eq(schema.dataRequests.id, row.id));
}

/* ------------------------------------------------------------- job wiring */

export async function processDataRequest(job: Job<DataRequestJob>): Promise<void> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.dataRequests)
    .where(eq(schema.dataRequests.id, job.data.dataRequestId))
    .limit(1);
  if (!row) return;
  if (row.kind === 'export') await processExport(row);
  else if (row.kind === 'delete') await processDelete(row);
}
