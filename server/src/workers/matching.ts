/**
 * Sequential matching engine. One candidate holds an offer at a time; declines
 * and timeouts move the search on; the radius doubles when a pass finds nobody.
 *
 * Jobs on the 'match' queue carry two names: 'match' (default; {requestId} —
 * run a matching pass, also handles expiry) and 'finalize' ({matchId} —
 * auto-finalize 60 min after a single-sided completion confirmation). The
 * 'offer-timeout' queue expires unanswered offers.
 *
 * Every processor is idempotent: it locks rows FOR UPDATE (in the global order
 * offer → request → inventory → match) and re-checks state before acting, so
 * duplicate or stale jobs are no-ops.
 */
import type { Job } from 'bullmq';
import { eq, sql } from 'drizzle-orm';
import {
  bucketForDistanceM,
  LIMITS,
  rankingReliability,
  type ProximityBucket,
  type ReliabilityCounters,
} from '@sahay/shared';
import { getDb, schema } from '../db/index.js';
import {
  matchQueue,
  notifyQueue,
  offerTimeoutQueue,
  type MatchFinalizeJob,
  type MatchJob,
  type MatchRunJob,
  type OfferTimeoutJob,
} from '../queues.js';
import { publishToUser } from '../realtime/hub.js';
import { applyOfferReceived } from '../modules/matches/reliability.js';
import { autoFinalizeMatch, type AfterCommit } from '../modules/matches/service.js';
import { loadOfferView } from '../modules/offers/views.js';
import { transitionRequest } from '../modules/requests/transitions.js';
import { loadRequestView } from '../modules/requests/views.js';

/* ------------------------------------------------------------------ ranking */

/**
 * Ranking weights (lowest score wins):
 *  - DISTANCE_WEIGHT × bucket rank: proximity dominates — a whole bucket step
 *    (3.0) outweighs the maximum reliability spread (2.0) plus jitter (1.0).
 *  - FAIRNESS_WEIGHT × recent offers (capped): spreads asks across helpers so
 *    the nearest person isn't hammered repeatedly.
 *  - RELIABILITY_WEIGHT × rankingReliability: better helpers edge out peers in
 *    the same bucket, but can never leapfrog a bucket.
 *  - jitter U(0,1): breaks ties non-deterministically.
 */
export const DISTANCE_WEIGHT = 3;
export const FAIRNESS_WEIGHT = 0.8;
export const RELIABILITY_WEIGHT = 2;
export const FAIRNESS_RECENT_OFFERS_CAP = 5;

const BUCKET_RANK: Record<ProximityBucket, number> = {
  very_nearby: 0,
  nearby: 1,
  short_walk: 2,
  farther: 3,
  unknown: 4, // helpers without a live location always sort last
};

export interface Candidate {
  helperId: string;
  itemId: string;
  availableQty: number;
  distanceM: number | null;
  recentOffers: number;
  counters: ReliabilityCounters;
}

export function scoreCandidate(c: Candidate, jitter: number): number {
  return (
    DISTANCE_WEIGHT * BUCKET_RANK[bucketForDistanceM(c.distanceM)] +
    FAIRNESS_WEIGHT * Math.min(c.recentOffers, FAIRNESS_RECENT_OFFERS_CAP) -
    RELIABILITY_WEIGHT * rankingReliability(c.counters) +
    jitter
  );
}

/** Best candidate first. `rng` is injectable so tests can pin the jitter. */
export function rankCandidates(candidates: Candidate[], rng: () => number = Math.random): Candidate[] {
  return candidates
    .map((c) => ({ c, score: scoreCandidate(c, rng()) }))
    .sort((a, b) => a.score - b.score)
    .map((x) => x.c);
}

/* --------------------------------------------------------------- candidates */

interface CandidateRow {
  helper_id: string;
  item_id: string;
  available_qty: number;
  distance_m: number | null;
  recent_offers: number;
  accepted: number | null;
  completed: number | null;
  requester_confirmed: number | null;
  cancelled_pre_meeting: number | null;
  cancelled_post_meeting: number | null;
  timeouts: number | null;
  no_shows: number | null;
  disputes: number | null;
  offers_received_30d: number | null;
  offers_responded_30d: number | null;
}

function rowToCandidate(r: CandidateRow): Candidate {
  return {
    helperId: r.helper_id,
    itemId: r.item_id,
    availableQty: Number(r.available_qty),
    distanceM: r.distance_m == null ? null : Number(r.distance_m),
    recentOffers: Number(r.recent_offers),
    counters: {
      accepted: r.accepted ?? 0,
      completed: r.completed ?? 0,
      requesterConfirmed: r.requester_confirmed ?? 0,
      cancelledPreMeeting: r.cancelled_pre_meeting ?? 0,
      cancelledPostMeeting: r.cancelled_post_meeting ?? 0,
      timeouts: r.timeouts ?? 0,
      noShows: r.no_shows ?? 0,
      disputes: r.disputes ?? 0,
      offersReceived30d: r.offers_received_30d ?? 0,
      offersResponded30d: r.offers_responded_30d ?? 0,
    },
  };
}

/* ---------------------------------------------------------------- the pass */

const PAUSED_RETRY_DELAY_MS = 30_000;
const NO_CANDIDATE_RETRY_DELAY_MS = 20_000;
const OFFER_TIMEOUT_SLACK_MS = 500;

export async function runMatchPass(requestId: string, rng: () => number = Math.random): Promise<void> {
  const db = getDb();
  const after: AfterCommit[] = await db.transaction(async (tx) => {
    const effects: AfterCommit[] = [];

    // Lock any open offers FIRST (global lock order: offer before request), so
    // superseding/expiring them below cannot deadlock with accept/timeout.
    await tx.execute(
      sql`SELECT id FROM match_offers WHERE request_id = ${requestId} AND status = 'offered' FOR UPDATE`,
    );

    let [request] = await tx
      .select()
      .from(schema.requests)
      .where(eq(schema.requests.id, requestId))
      .limit(1)
      .for('update');
    if (!request) return effects;
    if (request.status !== 'searching' && request.status !== 'offering') return effects;

    // (a) Expiry terminates the loop: expired if anyone was ever asked, else no_match.
    if (request.expiresAt <= new Date()) {
      const superseded = await tx
        .update(schema.matchOffers)
        .set({ status: 'superseded', respondedAt: new Date() })
        .where(sql`${schema.matchOffers.requestId} = ${requestId} AND ${schema.matchOffers.status} = 'offered'`)
        .returning({ id: schema.matchOffers.id, helperId: schema.matchOffers.helperId });
      const [{ offerCount }] = (await tx
        .select({ offerCount: sql<number>`count(*)::int` })
        .from(schema.matchOffers)
        .where(eq(schema.matchOffers.requestId, requestId))) as [{ offerCount: number }];
      const requester = request.requesterId;
      await transitionRequest(tx, request, offerCount > 0 ? 'expired' : 'no_match', 'system', 'expiry', {
        closedAt: new Date(),
      });
      effects.push(async () => {
        for (const o of superseded) {
          await publishToUser(o.helperId, 'offer.expired', { id: o.id, status: 'superseded' });
        }
        const view = await loadRequestView(requestId);
        if (view) await publishToUser(requester, 'request.update', view);
        await notifyQueue().add('notify', {
          userId: requester,
          type: 'no_helper_found',
          titleKey: 'notifications.no_helper_found',
          bodyKey: 'request.noMatch',
          params: {},
          dedupeKey: `nomatch:${requestId}`,
        });
      });
      return effects;
    }

    // (b) Paused/inactive events defer matching without consuming the request.
    const [event] = await tx
      .select()
      .from(schema.events)
      .where(eq(schema.events.id, request.eventId))
      .limit(1);
    if (!event || event.status !== 'active' || event.matchingPaused) {
      effects.push(async () => {
        await matchQueue().add('match', { requestId }, { delay: PAUSED_RETRY_DELAY_MS });
      });
      return effects;
    }

    // (c) An unexpired open offer owns the request; an expired one is swept
    // here (idempotent with processOfferTimeout — both re-check state).
    if (request.status === 'offering') {
      const [open] = await tx
        .select()
        .from(schema.matchOffers)
        .where(
          sql`${schema.matchOffers.requestId} = ${requestId} AND ${schema.matchOffers.status} = 'offered'`,
        )
        .limit(1);
      if (open && open.respondBy > new Date()) return effects;
      if (open) {
        await tx
          .update(schema.matchOffers)
          .set({ status: 'expired', respondedAt: new Date() })
          .where(eq(schema.matchOffers.id, open.id));
        effects.push(async () => {
          await publishToUser(open.helperId, 'offer.expired', { id: open.id, status: 'expired' });
        });
      }
      request = await transitionRequest(tx, request, 'searching', 'system', 'offer-timeout');
    }

    // (d) One query finds every eligible helper. Radius rule: with a live
    // requester location, helpers beyond current_radius_m are excluded and
    // location-less helpers only become eligible once the radius has expanded
    // to the event maximum (they still sort last via the 'unknown' bucket).
    // Without a requester location (areaHint fallback) everyone is eligible.
    const res = await tx.execute(sql`
      SELECT * FROM (
        SELECT DISTINCT ON (u.id)
          u.id AS helper_id,
          ii.id AS item_id,
          (ii.qty_on_hand - ii.qty_reserved)::float8 AS available_qty,
          ST_Distance(hl.geog, rl.geog)::float8 AS distance_m,
          (SELECT count(*)::int FROM match_offers mo2
            WHERE mo2.helper_id = u.id AND mo2.offered_at > now() - interval '30 minutes') AS recent_offers,
          rs.accepted, rs.completed, rs.requester_confirmed,
          rs.cancelled_pre_meeting, rs.cancelled_post_meeting,
          rs.timeouts, rs.no_shows, rs.disputes,
          rs.offers_received_30d, rs.offers_responded_30d
        FROM users u
        JOIN memberships m ON m.user_id = u.id AND m.event_id = ${request.eventId}
          AND m.left_at IS NULL AND m.banned = false
        JOIN availability a ON a.user_id = u.id AND a.event_id = ${request.eventId}
          AND a.is_on AND (a.until IS NULL OR a.until > now())
        JOIN inventory_items ii ON ii.user_id = u.id AND ii.event_id = ${request.eventId}
          AND ii.category_id = ${request.categoryId} AND ii.active
          AND (ii.expires_at IS NULL OR ii.expires_at > now())
          AND (ii.qty_on_hand - ii.qty_reserved) > 0
        LEFT JOIN member_locations hl ON hl.user_id = u.id AND hl.event_id = ${request.eventId}
          AND hl.expires_at > now()
        LEFT JOIN member_locations rl ON rl.user_id = ${request.requesterId} AND rl.event_id = ${request.eventId}
          AND rl.expires_at > now()
        LEFT JOIN reliability_stats rs ON rs.user_id = u.id
        WHERE u.status = 'active' AND u.can_help AND u.deleted_at IS NULL
          AND u.id <> ${request.requesterId}
          AND NOT EXISTS (
            SELECT 1 FROM blocks b
            WHERE (b.blocker_id = u.id AND b.blocked_id = ${request.requesterId})
               OR (b.blocker_id = ${request.requesterId} AND b.blocked_id = u.id))
          AND NOT EXISTS (
            SELECT 1 FROM match_offers mo
            WHERE mo.request_id = ${request.id} AND mo.helper_id = u.id)
          AND (SELECT count(*) FROM matches mm
            WHERE mm.helper_id = u.id AND mm.status = 'active') < ${LIMITS.maxActiveMatchesPerHelper}
          AND (
            rl.geog IS NULL
            OR (hl.geog IS NOT NULL AND ST_Distance(hl.geog, rl.geog) <= ${request.currentRadiusM}::float8)
            OR (hl.geog IS NULL AND ${request.currentRadiusM}::int >= ${event.maxMatchRadiusM}::int)
          )
        ORDER BY u.id, (ii.qty_on_hand - ii.qty_reserved) DESC
      ) c
      ORDER BY c.distance_m ASC NULLS LAST
      LIMIT 8
    `);
    const candidates = (res.rows as unknown as CandidateRow[]).map(rowToCandidate);

    // (e/f) Rank and offer to the winner whose clamped quantity is positive.
    const [category] = await tx
      .select({ fractional: schema.categories.fractional })
      .from(schema.categories)
      .where(eq(schema.categories.id, request.categoryId))
      .limit(1);
    const remaining = Number(request.qty) - Number(request.qtyFulfilled);
    const ranked = rankCandidates(candidates, rng);
    for (const winner of ranked) {
      let offerQty = Math.min(remaining, winner.availableQty);
      if (!category?.fractional) offerQty = Math.floor(offerQty);
      if (offerQty <= 0) continue;

      const respondBy = new Date(Date.now() + event.offerResponseSeconds * 1000);
      const [offer] = await tx
        .insert(schema.matchOffers)
        .values({
          requestId: request.id,
          helperId: winner.helperId,
          inventoryItemId: winner.itemId,
          qty: String(offerQty),
          proximity: bucketForDistanceM(winner.distanceM),
          status: 'offered',
          respondBy,
        })
        .returning();
      await transitionRequest(tx, request, 'offering', 'system', 'offer-created', {
        attemptCount: request.attemptCount + 1,
      });
      await applyOfferReceived(tx, winner.helperId);

      const offerId = offer!.id;
      const requesterId = request.requesterId;
      effects.push(async () => {
        await offerTimeoutQueue().add(
          'timeout',
          { offerId },
          { delay: Math.max(0, respondBy.getTime() - Date.now()) + OFFER_TIMEOUT_SLACK_MS },
        );
        const offerView = await loadOfferView(offerId);
        if (offerView) await publishToUser(winner.helperId, 'offer.new', offerView);
        await notifyQueue().add('notify', {
          userId: winner.helperId,
          type: 'match_offer',
          titleKey: 'offer.title',
          bodyKey: 'notifications.vaguePreview', // never item details in push
          params: {},
          deepLink: `/offer/${offerId}`,
          dedupeKey: `offer:${offerId}`,
        });
        const requestView = await loadRequestView(requestId);
        if (requestView) await publishToUser(requesterId, 'request.update', requestView);
      });
      return effects;
    }

    // (g) Nobody eligible: widen the ring and retry now, or idle-retry at the
    // maximum radius until the expiry sweep in (a) terminates the loop.
    if (request.currentRadiusM < event.maxMatchRadiusM) {
      const widened = Math.min(
        request.currentRadiusM * LIMITS.radiusExpansionFactor,
        event.maxMatchRadiusM,
      );
      await tx
        .update(schema.requests)
        .set({ currentRadiusM: widened })
        .where(eq(schema.requests.id, requestId));
      effects.push(async () => {
        await matchQueue().add('match', { requestId });
      });
    } else {
      effects.push(async () => {
        await matchQueue().add('match', { requestId }, { delay: NO_CANDIDATE_RETRY_DELAY_MS });
      });
    }
    return effects;
  });
  for (const fn of after) await fn();
}

/* ----------------------------------------------------------- offer timeout */

export async function expireOffer(offerId: string): Promise<void> {
  const db = getDb();
  const after: AfterCommit[] = await db.transaction(async (tx) => {
    const [offer] = await tx
      .select()
      .from(schema.matchOffers)
      .where(eq(schema.matchOffers.id, offerId))
      .limit(1)
      .for('update');
    // Idempotent: only an open offer past its deadline is expired.
    if (!offer || offer.status !== 'offered' || offer.respondBy > new Date()) return [];

    const [request] = await tx
      .select()
      .from(schema.requests)
      .where(eq(schema.requests.id, offer.requestId))
      .limit(1)
      .for('update');

    await tx
      .update(schema.matchOffers)
      .set({ status: 'expired', respondedAt: new Date() })
      .where(eq(schema.matchOffers.id, offerId));
    if (request && request.status === 'offering') {
      await transitionRequest(tx, request, 'searching', 'system', 'offer-timeout');
    }

    return [
      async () => {
        await publishToUser(offer.helperId, 'offer.expired', { id: offer.id, status: 'expired' });
        await matchQueue().add('match', { requestId: offer.requestId });
      },
    ];
  });
  for (const fn of after) await fn();
}

/* ------------------------------------------------------------- job wiring */

/** Delayed 'finalize' jobs land here (see modules/matches/service.ts). */
export async function finalizeMatch(matchId: string): Promise<void> {
  await autoFinalizeMatch(matchId);
}

export async function processMatch(job: Job<MatchJob>): Promise<void> {
  if (job.name === 'finalize') {
    await finalizeMatch((job.data as MatchFinalizeJob).matchId);
    return;
  }
  await runMatchPass((job.data as MatchRunJob).requestId);
}

export async function processOfferTimeout(job: Job<OfferTimeoutJob>): Promise<void> {
  await expireOffer(job.data.offerId);
}
