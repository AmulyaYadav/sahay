/**
 * Request lifecycle (requester side). Creation validates event/membership/
 * category/limits, stores a redacted note, records the 'none'→'searching'
 * transition, and kicks the matching engine (immediate run + delayed expiry
 * sweep). cancel/renew/continue all go through the transition table.
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { coarsen, LIMITS, type RequestView, type zCreateRequest } from '@sahay/shared';
import { loadConfig } from '../../config.js';
import { getDb, schema, type Tx } from '../../db/index.js';
import { errors } from '../../lib/errors.js';
import { redactContactDetails } from '../../lib/redact.js';
import { matchQueue } from '../../queues.js';
import { publishToUser } from '../../realtime/hub.js';
import type { AuthContext } from '../../plugins/auth.js';
import { effectiveEventCategories, getMembership, resolveEvent } from '../events/service.js';
import { cancelMatchInTx, type AfterCommit } from '../matches/service.js';
import { recordCreationTransition, transitionRequest, type RequestRow } from './transitions.js';
import { activeMatchIdFor, loadRequestView, toRequestView } from './views.js';

export type CreateRequestInput = z.infer<typeof zCreateRequest>;

/** Statuses that count against the per-user concurrent request limit. */
const ACTIVE_REQUEST_STATUSES = ['searching', 'offering', 'matched'] as const;

async function emitRequestUpdate(requestId: string, requesterId: string): Promise<void> {
  const view = await loadRequestView(requestId);
  if (view) await publishToUser(requesterId, 'request.update', view);
}

/** Immediate matching run + a delayed sweep just past expiry (processor expires it). */
async function enqueueMatching(requestId: string, expiresAt: Date): Promise<void> {
  const q = matchQueue();
  await q.add('match', { requestId });
  await q.add('match', { requestId }, { delay: Math.max(0, expiresAt.getTime() - Date.now()) + 1000 });
}

/** Same coarsen+UPSERT as the availability module (not reusable there: its route
 * helper enforces "may share" preconditions that don't apply mid-create). */
async function upsertMemberLocation(
  tx: Tx,
  userId: string,
  eventId: string,
  coords: { lat: number; lng: number },
): Promise<void> {
  const { lat, lng } = coarsen(coords.lat, coords.lng);
  const expiresAt = new Date(Date.now() + loadConfig().LOCATION_TTL_MINUTES * 60_000);
  await tx.execute(sql`
    INSERT INTO member_locations (user_id, event_id, geog, updated_at, expires_at)
    VALUES (${userId}, ${eventId}, ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography, now(), ${expiresAt})
    ON CONFLICT (user_id, event_id)
    DO UPDATE SET geog = EXCLUDED.geog, updated_at = now(), expires_at = EXCLUDED.expires_at
  `);
}

async function findByIdempotencyKey(
  db: Tx | ReturnType<typeof getDb>,
  userId: string,
  key: string,
): Promise<RequestRow | null> {
  const [existing] = await db
    .select()
    .from(schema.requests)
    .where(and(eq(schema.requests.requesterId, userId), eq(schema.requests.idempotencyKey, key)))
    .limit(1);
  return existing ?? null;
}

async function slugFor(db: Tx | ReturnType<typeof getDb>, categoryId: string): Promise<string> {
  const [cat] = await db
    .select({ slug: schema.categories.slug })
    .from(schema.categories)
    .where(eq(schema.categories.id, categoryId))
    .limit(1);
  return cat?.slug ?? '';
}

export async function createRequest(auth: AuthContext, input: CreateRequestInput): Promise<RequestView> {
  const db = getDb();

  // Idempotency replay wins over everything else: return the original result.
  const replay = await findByIdempotencyKey(db, auth.userId, input.idempotencyKey);
  if (replay) {
    return toRequestView(replay, await slugFor(db, replay.categoryId), await activeMatchIdFor(db, replay.id));
  }

  const event = await resolveEvent(input.eventId);
  if (!event) throw errors.notFound();
  const membership = await getMembership(event.id, auth.userId);
  if (!membership || membership.banned) throw errors.forbidden();
  if (event.status === 'paused') throw errors.eventPaused();
  if (event.status !== 'active') throw errors.eventNotActive();
  if (event.matchingPaused) throw errors.eventPaused();
  if (!auth.canRequest || auth.status !== 'active') throw errors.accountRestricted();

  const cats = await effectiveEventCategories(event.id);
  const effective = cats.find((c) => c.category.id === input.categoryId);
  if (!effective) throw errors.prohibitedCategory();
  const { category, maxRequestQty } = effective;

  const allowedUnits: string[] = [category.unit, ...(category.altUnits ?? [])];
  if (!allowedUnits.includes(input.unit)) throw errors.validation({ field: 'unit', allowed: allowedUnits });
  if (input.qty > maxRequestQty) throw errors.validation({ field: 'qty', max: maxRequestQty });
  if (!category.fractional && !Number.isInteger(input.qty)) throw errors.validation({ field: 'qty' });

  const expiresAt = new Date(Date.now() + input.expiresInMinutes * 60_000);
  // Phone numbers must not flow through notes: redact before storing.
  const note = input.note ? redactContactDetails(input.note) : null;

  const created = await db.transaction(async (tx) => {
    const [{ activeCount }] = (await tx
      .select({ activeCount: sql<number>`count(*)::int` })
      .from(schema.requests)
      .where(
        and(
          eq(schema.requests.requesterId, auth.userId),
          inArray(schema.requests.status, [...ACTIVE_REQUEST_STATUSES]),
        ),
      )) as [{ activeCount: number }];
    if (activeCount >= LIMITS.maxActiveRequestsPerUser) throw errors.rateLimited();

    if (input.coords) await upsertMemberLocation(tx, auth.userId, event.id, input.coords);

    try {
      const [row] = await tx
        .insert(schema.requests)
        .values({
          eventId: event.id,
          requesterId: auth.userId,
          categoryId: input.categoryId,
          qty: String(input.qty),
          unit: input.unit,
          urgency: input.urgency,
          note,
          areaHint: input.areaHint ?? null,
          status: 'searching',
          currentRadiusM: LIMITS.initialSearchRadiusM,
          expiresAt,
          idempotencyKey: input.idempotencyKey,
        })
        .returning();
      await recordCreationTransition(tx, row!.id, 'requester', 'created');
      return row!;
    } catch (err) {
      // Idempotency-key unique race: a concurrent request with the same key won.
      if ((err as { code?: string }).code === '23505') {
        const existing = await findByIdempotencyKey(tx, auth.userId, input.idempotencyKey);
        if (existing) return existing;
      }
      throw err;
    }
  });

  await enqueueMatching(created.id, created.expiresAt);
  await emitRequestUpdate(created.id, auth.userId);
  return toRequestView(created, category.slug, null);
}

export async function listMyRequests(userId: string, eventId?: string): Promise<RequestView[]> {
  const db = getDb();
  const rows = await db
    .select({ request: schema.requests, slug: schema.categories.slug })
    .from(schema.requests)
    .innerJoin(schema.categories, eq(schema.requests.categoryId, schema.categories.id))
    .where(
      and(
        eq(schema.requests.requesterId, userId),
        ...(eventId ? [eq(schema.requests.eventId, eventId)] : []),
      ),
    )
    .orderBy(sql`${schema.requests.createdAt} DESC`)
    .limit(50);
  const views: RequestView[] = [];
  for (const r of rows) {
    views.push(toRequestView(r.request, r.slug, await activeMatchIdFor(db, r.request.id)));
  }
  return views;
}

export async function getMyRequest(userId: string, requestId: string): Promise<RequestView> {
  const view = await loadRequestView(requestId);
  if (!view) throw errors.notFound();
  const db = getDb();
  const [row] = await db
    .select({ requesterId: schema.requests.requesterId })
    .from(schema.requests)
    .where(eq(schema.requests.id, requestId))
    .limit(1);
  if (!row || row.requesterId !== userId) throw errors.notFound(); // owner only
  return view;
}

async function lockOwnRequest(tx: Tx, userId: string, requestId: string): Promise<RequestRow> {
  const [row] = await tx
    .select()
    .from(schema.requests)
    .where(eq(schema.requests.id, requestId))
    .limit(1)
    .for('update');
  if (!row || row.requesterId !== userId) throw errors.notFound();
  return row;
}

export async function cancelRequest(userId: string, requestId: string): Promise<RequestView> {
  const db = getDb();
  const after = await db.transaction(async (tx) => {
    const request = await lockOwnRequest(tx, userId, requestId);
    const effects: AfterCommit[] = [];

    if (request.status === 'matched') {
      // Cancelling a matched request cancels the active match, which releases
      // the reservation and moves the request to 'cancelled' itself.
      const activeMatchId = await activeMatchIdFor(tx, requestId);
      if (!activeMatchId) throw errors.conflict();
      return cancelMatchInTx(tx, activeMatchId, {
        actor: 'requester',
        cancellerUserId: userId,
        reason: 'requester-cancel',
        unsafe: false,
      });
    }

    if (request.status !== 'searching' && request.status !== 'offering') throw errors.conflict();

    // Any open offer is superseded; its helper is told the moment has passed.
    const superseded = await tx
      .update(schema.matchOffers)
      .set({ status: 'superseded', respondedAt: new Date() })
      .where(and(eq(schema.matchOffers.requestId, requestId), eq(schema.matchOffers.status, 'offered')))
      .returning({ id: schema.matchOffers.id, helperId: schema.matchOffers.helperId });

    await transitionRequest(tx, request, 'cancelled', 'requester', 'owner-cancel', { closedAt: new Date() });

    for (const offer of superseded) {
      effects.push(async () => {
        await publishToUser(offer.helperId, 'offer.expired', { id: offer.id, status: 'superseded' });
      });
    }
    return effects;
  });
  for (const fn of after) await fn();
  await emitRequestUpdate(requestId, userId);
  return getMyRequest(userId, requestId);
}

export async function renewRequest(
  userId: string,
  requestId: string,
  expiresInMinutes: number,
): Promise<RequestView> {
  const db = getDb();
  const renewed = await db.transaction(async (tx) => {
    const request = await lockOwnRequest(tx, userId, requestId);
    if (!['expired', 'no_match', 'cancelled'].includes(request.status)) throw errors.conflict();
    return transitionRequest(tx, request, 'searching', 'requester', 'renew', {
      expiresAt: new Date(Date.now() + expiresInMinutes * 60_000),
      currentRadiusM: LIMITS.initialSearchRadiusM,
      closedAt: null,
      // qty_fulfilled is intentionally kept.
    });
  });
  await enqueueMatching(requestId, renewed.expiresAt);
  await emitRequestUpdate(requestId, userId);
  return getMyRequest(userId, requestId);
}

export async function continueRequest(
  userId: string,
  requestId: string,
  continueSearching: boolean,
): Promise<RequestView> {
  const db = getDb();
  const result = await db.transaction(async (tx) => {
    const request = await lockOwnRequest(tx, userId, requestId);
    if (request.status !== 'partially_fulfilled') throw errors.conflict();

    if (continueSearching) {
      const remaining = Number(request.qty) - Number(request.qtyFulfilled);
      if (remaining <= 0) throw errors.conflict();
      const row = await transitionRequest(tx, request, 'searching', 'requester', 'continue', {
        expiresAt: new Date(Date.now() + 15 * 60_000),
        currentRadiusM: LIMITS.initialSearchRadiusM,
        closedAt: null,
      });
      return { row, enqueue: true };
    }

    const to = Number(request.qtyFulfilled) > 0 ? ('fulfilled' as const) : ('cancelled' as const);
    const row = await transitionRequest(tx, request, to, 'requester', 'close-after-partial', {
      closedAt: new Date(),
    });
    return { row, enqueue: false };
  });
  if (result.enqueue) await enqueueMatching(requestId, result.row.expiresAt);
  await emitRequestUpdate(requestId, userId);
  return getMyRequest(userId, requestId);
}
