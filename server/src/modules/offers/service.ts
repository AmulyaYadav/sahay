/**
 * Helper-side offers: the pending list and the accept/decline response.
 * Accepting is the atomic heart of the system — ONE transaction that locks
 * offer → request → inventory (global lock order), reserves stock, creates the
 * match + conversation under fresh aliases, and moves the request to 'matched'.
 * The DB backstops every invariant (CHECK qty_reserved <= qty_on_hand, unique
 * active match per request), so even a racing double-accept cannot over-reserve.
 */
import { and, eq, gt, sql } from 'drizzle-orm';
import type { MatchView, OfferView } from '@sahay/shared';
import { getDb, schema } from '../../db/index.js';
import { errors } from '../../lib/errors.js';
import { matchQueue, notifyQueue } from '../../queues.js';
import { publishToUser } from '../../realtime/hub.js';
import {
  emitMatchUpdate,
  generateMatchAliases,
  getMatchView,
  insertSystemMessage,
} from '../matches/service.js';
import { applyAccepted, applyOfferResponded } from '../matches/reliability.js';
import { transitionRequest } from '../requests/transitions.js';
import { loadRequestView } from '../requests/views.js';
import { loadOfferView, toOfferView } from './views.js';

/**
 * Pure reservation clamp: how much of the offer can actually be reserved given
 * the remaining need, live availability, and whether the category allows
 * fractional quantities (whole units only otherwise). ≤ 0 means the accept
 * must fail with insufficient_inventory.
 */
export function computeReserveQty(input: {
  offerQty: number;
  remainingNeed: number;
  available: number;
  fractional: boolean;
}): number {
  let qty = Math.min(input.offerQty, input.remainingNeed, input.available);
  if (!input.fractional) qty = Math.floor(qty);
  return qty > 0 ? qty : 0;
}

export async function listPendingOffers(helperId: string): Promise<OfferView[]> {
  const db = getDb();
  const rows = await db
    .select({
      offer: schema.matchOffers,
      request: schema.requests,
      categorySlug: schema.categories.slug,
      qtyOnHand: schema.inventoryItems.qtyOnHand,
      qtyReserved: schema.inventoryItems.qtyReserved,
    })
    .from(schema.matchOffers)
    .innerJoin(schema.requests, eq(schema.matchOffers.requestId, schema.requests.id))
    .innerJoin(schema.categories, eq(schema.requests.categoryId, schema.categories.id))
    .innerJoin(schema.inventoryItems, eq(schema.matchOffers.inventoryItemId, schema.inventoryItems.id))
    .where(
      and(
        eq(schema.matchOffers.helperId, helperId),
        eq(schema.matchOffers.status, 'offered'),
        gt(schema.matchOffers.respondBy, sql`now()`),
      ),
    )
    .orderBy(schema.matchOffers.respondBy);
  return rows.map(toOfferView);
}

export async function respondToOffer(
  helper: { userId: string },
  offerId: string,
  input: { accept: boolean; alsoStopReceiving: boolean },
): Promise<{ offer: OfferView; match?: MatchView }> {
  return input.accept
    ? acceptOffer(helper.userId, offerId)
    : declineOffer(helper.userId, offerId, input.alsoStopReceiving);
}

async function declineOffer(
  helperId: string,
  offerId: string,
  alsoStopReceiving: boolean,
): Promise<{ offer: OfferView }> {
  const db = getDb();
  const requestInfo = await db.transaction(async (tx) => {
    const [offer] = await tx
      .select()
      .from(schema.matchOffers)
      .where(and(eq(schema.matchOffers.id, offerId), eq(schema.matchOffers.helperId, helperId)))
      .limit(1)
      .for('update');
    if (!offer) throw errors.notFound();
    if (offer.status !== 'offered') throw errors.conflict();
    if (offer.respondBy <= new Date()) throw errors.offerExpired();

    const [request] = await tx
      .select()
      .from(schema.requests)
      .where(eq(schema.requests.id, offer.requestId))
      .limit(1)
      .for('update');
    if (!request) throw errors.notFound();

    await tx
      .update(schema.matchOffers)
      .set({ status: 'declined', respondedAt: new Date() })
      .where(eq(schema.matchOffers.id, offerId));
    // Declining is free — it only counts as being responsive.
    await applyOfferResponded(tx, helperId);

    if (request.status === 'offering') {
      await transitionRequest(tx, request, 'searching', 'helper', 'offer-declined');
    }

    if (alsoStopReceiving) {
      await tx
        .insert(schema.availability)
        .values({ userId: helperId, eventId: request.eventId, isOn: false, until: null, updatedAt: new Date() })
        .onConflictDoUpdate({
          target: [schema.availability.userId, schema.availability.eventId],
          set: { isOn: false, until: null, updatedAt: new Date() },
        });
    }
    return { requestId: request.id, requesterId: request.requesterId };
  });

  await matchQueue().add('match', { requestId: requestInfo.requestId });
  const requestView = await loadRequestView(requestInfo.requestId);
  if (requestView) await publishToUser(requestInfo.requesterId, 'request.update', requestView);
  const offer = await loadOfferView(offerId);
  if (!offer) throw errors.notFound();
  return { offer };
}

type AcceptOutcome =
  | { ok: true; matchId: string; requesterId: string; requestId: string }
  | { ok: false; requestId: string; requesterId: string };

async function acceptOffer(helperId: string, offerId: string): Promise<{ offer: OfferView; match?: MatchView }> {
  const db = getDb();
  const outcome: AcceptOutcome = await db.transaction(async (tx) => {
    // Lock order: offer → request → inventory (global convention).
    const [offer] = await tx
      .select()
      .from(schema.matchOffers)
      .where(and(eq(schema.matchOffers.id, offerId), eq(schema.matchOffers.helperId, helperId)))
      .limit(1)
      .for('update');
    if (!offer) throw errors.notFound();
    if (offer.status !== 'offered') throw errors.conflict();
    if (offer.respondBy <= new Date()) throw errors.offerExpired();

    const [request] = await tx
      .select()
      .from(schema.requests)
      .where(eq(schema.requests.id, offer.requestId))
      .limit(1)
      .for('update');
    if (!request) throw errors.notFound();
    if (request.status !== 'offering') throw errors.conflict();

    const [item] = await tx
      .select()
      .from(schema.inventoryItems)
      .where(eq(schema.inventoryItems.id, offer.inventoryItemId))
      .limit(1)
      .for('update');
    if (!item) throw errors.notFound();

    const [category] = await tx
      .select({ fractional: schema.categories.fractional })
      .from(schema.categories)
      .where(eq(schema.categories.id, request.categoryId))
      .limit(1);

    const available = item.active ? Number(item.qtyOnHand) - Number(item.qtyReserved) : 0;
    const reserveQty = computeReserveQty({
      offerQty: Number(offer.qty),
      remainingNeed: Number(request.qty) - Number(request.qtyFulfilled),
      available,
      fractional: category?.fractional ?? false,
    });

    if (reserveQty <= 0) {
      // Stock evaporated between offer and accept: void the offer, resume the
      // search, and report insufficient_inventory AFTER these writes commit.
      await tx
        .update(schema.matchOffers)
        .set({ status: 'expired', respondedAt: new Date() })
        .where(eq(schema.matchOffers.id, offerId));
      await transitionRequest(tx, request, 'searching', 'system', 'insufficient-inventory');
      return { ok: false, requestId: request.id, requesterId: request.requesterId };
    }

    await tx
      .update(schema.inventoryItems)
      .set({ qtyReserved: String(Number(item.qtyReserved) + reserveQty), updatedAt: new Date() })
      .where(eq(schema.inventoryItems.id, item.id));

    await tx
      .update(schema.matchOffers)
      .set({ status: 'accepted', respondedAt: new Date() })
      .where(eq(schema.matchOffers.id, offerId));

    // Fresh, per-match aliases distinct from each other AND from both account
    // pseudonyms, so exchanges cannot be correlated.
    const participants = await tx
      .select({ id: schema.users.id, pseudonym: schema.users.pseudonym })
      .from(schema.users)
      .where(sql`${schema.users.id} IN (${request.requesterId}, ${helperId})`);
    const aliases = generateMatchAliases(participants.map((p) => p.pseudonym));

    let matchId: string;
    try {
      const [match] = await tx
        .insert(schema.matches)
        .values({
          requestId: request.id,
          offerId: offer.id,
          eventId: request.eventId,
          requesterId: request.requesterId,
          helperId,
          inventoryItemId: item.id,
          qtyReserved: String(reserveQty),
          proximity: offer.proximity,
          status: 'active',
          requesterAlias: aliases.requesterAlias,
          helperAlias: aliases.helperAlias,
        })
        .returning();
      matchId = match!.id;
    } catch (err) {
      // matches_one_active_per_request: a concurrent accept won the race.
      if ((err as { code?: string }).code === '23505') throw errors.conflict();
      throw err;
    }

    await transitionRequest(tx, request, 'matched', 'helper', 'offer-accepted');

    const [conversation] = await tx
      .insert(schema.conversations)
      .values({ matchId, status: 'open' })
      .returning();
    await insertSystemMessage(tx, conversation!.id, helperId, 'match.matched');

    await applyAccepted(tx, helperId);

    return { ok: true, matchId, requesterId: request.requesterId, requestId: request.id };
  });

  if (!outcome.ok) {
    await matchQueue().add('match', { requestId: outcome.requestId });
    const requestView = await loadRequestView(outcome.requestId);
    if (requestView) await publishToUser(outcome.requesterId, 'request.update', requestView);
    throw errors.insufficientInventory();
  }

  // Post-commit hints. The offer is no longer pending for the helper — reuse
  // offer.expired so clients drop it from their pending list (see docs note).
  await emitMatchUpdate(outcome.matchId);
  const offerView = await loadOfferView(offerId);
  if (offerView) await publishToUser(helperId, 'offer.expired', offerView);
  const requestView = await loadRequestView(outcome.requestId);
  if (requestView) await publishToUser(outcome.requesterId, 'request.update', requestView);
  await notifyQueue().add('notify', {
    userId: outcome.requesterId,
    type: 'match_accepted',
    titleKey: 'notifications.match_accepted',
    bodyKey: 'match.matched',
    params: {},
    deepLink: `/match/${outcome.matchId}`,
    dedupeKey: `matchaccept:${outcome.matchId}`,
  });

  const match = await getMatchView(outcome.matchId, helperId);
  if (!offerView) throw errors.notFound();
  return { offer: offerView, match };
}
