/**
 * Match lifecycle: views, meeting states, cancellation, completion confirmation
 * and settlement (the single place inventory reservations are released or
 * deducted). Every mutation runs in ONE transaction with rows locked FOR UPDATE
 * in the global order offer → request → inventory → match, and is idempotent by
 * re-checking state after acquiring locks. Inventory/reliability application is
 * guarded by matches.inventory_applied / reliability_applied so each match
 * settles exactly once even if jobs retry.
 */
import { randomInt } from 'node:crypto';
import { and, asc, desc, eq, or } from 'drizzle-orm';
import {
  LIMITS,
  pseudonymFromIndexes,
  reliabilityLabel,
  MEETING_STATES,
  type MatchView,
  type MeetingState,
} from '@sahay/shared';
import { getDb, schema, type Tx } from '../../db/index.js';
import { errors } from '../../lib/errors.js';
import { redactContactDetails } from '../../lib/redact.js';
import { matchQueue, notifyQueue } from '../../queues.js';
import { publishToUser } from '../../realtime/hub.js';
import { transitionRequest, type RequestRow, type TransitionActor } from '../requests/transitions.js';
import { loadRequestView } from '../requests/views.js';
import {
  applyCompleted,
  applyDispute,
  applyHelperCancel,
  rowToCounters,
  type ReliabilityRow,
} from './reliability.js';

export type MatchRow = typeof schema.matches.$inferSelect;
type UserRow = typeof schema.users.$inferSelect;
type ItemRow = typeof schema.inventoryItems.$inferSelect;

/** Deferred side effects (WS frames, queue jobs) to run AFTER the tx commits. */
export type AfterCommit = () => Promise<void>;

/** Grace window before a closed match's conversation goes readonly. */
const CONVERSATION_GRACE_MS = LIMITS.conversationGraceMinutes * 60_000;
/** A silent peer gets this long after the first confirmation, then auto-finalize. */
const FINALIZE_AFTER_FIRST_CONFIRMATION_MS = 60 * 60_000;

const MONTHS_EN = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;

/** "March 2026" — month granularity only, always English month names. */
export function memberSinceLabel(createdAt: Date): string {
  return `${MONTHS_EN[createdAt.getUTCMonth()]} ${createdAt.getUTCFullYear()}`;
}

/**
 * Two fresh match aliases, distinct from each other and from both participants'
 * account pseudonyms, so behavior cannot be correlated across matches.
 */
export function generateMatchAliases(exclude: string[]): { requesterAlias: string; helperAlias: string } {
  const gen = () => pseudonymFromIndexes(randomInt(1024), randomInt(1024));
  let requesterAlias = gen();
  while (exclude.includes(requesterAlias)) requesterAlias = gen();
  let helperAlias = gen();
  while (helperAlias === requesterAlias || exclude.includes(helperAlias)) helperAlias = gen();
  return { requesterAlias, helperAlias };
}

/* ------------------------------------------------------------------- views */

export interface MatchBundle {
  match: MatchRow;
  request: RequestRow;
  categorySlug: string;
  conversationId: string;
  requester: UserRow;
  helper: UserRow;
  requesterStats: ReliabilityRow | null;
  helperStats: ReliabilityRow | null;
}

export async function loadMatchBundle(matchId: string): Promise<MatchBundle | null> {
  const db = getDb();
  const [row] = await db
    .select({
      match: schema.matches,
      request: schema.requests,
      categorySlug: schema.categories.slug,
      conversationId: schema.conversations.id,
    })
    .from(schema.matches)
    .innerJoin(schema.requests, eq(schema.matches.requestId, schema.requests.id))
    .innerJoin(schema.categories, eq(schema.requests.categoryId, schema.categories.id))
    .innerJoin(schema.conversations, eq(schema.conversations.matchId, schema.matches.id))
    .where(eq(schema.matches.id, matchId))
    .limit(1);
  if (!row) return null;
  const users = await db
    .select({ user: schema.users, stats: schema.reliabilityStats })
    .from(schema.users)
    .leftJoin(schema.reliabilityStats, eq(schema.reliabilityStats.userId, schema.users.id))
    .where(or(eq(schema.users.id, row.match.requesterId), eq(schema.users.id, row.match.helperId)));
  const requester = users.find((u) => u.user.id === row.match.requesterId);
  const helper = users.find((u) => u.user.id === row.match.helperId);
  if (!requester || !helper) return null;
  return {
    match: row.match,
    request: row.request,
    categorySlug: row.categorySlug,
    conversationId: row.conversationId,
    requester: requester.user,
    helper: helper.user,
    requesterStats: requester.stats,
    helperStats: helper.stats,
  };
}

export function toMatchView(bundle: MatchBundle, viewerUserId: string): MatchView {
  const { match } = bundle;
  const isRequester = match.requesterId === viewerUserId;
  const peerUser = isRequester ? bundle.helper : bundle.requester;
  const peerStats = isRequester ? bundle.helperStats : bundle.requesterStats;
  const peerAlias = isRequester ? match.helperAlias : match.requesterAlias;
  const counters = rowToCounters(peerStats);
  const myConfirmed = isRequester ? match.requesterConfirmedQty : match.helperConfirmedQty;
  const peerConfirmed = isRequester ? match.helperConfirmedQty : match.requesterConfirmedQty;
  return {
    id: match.id,
    requestId: match.requestId,
    eventId: match.eventId,
    role: isRequester ? 'requester' : 'helper',
    categorySlug: bundle.categorySlug,
    qtyReserved: Number(match.qtyReserved),
    unit: bundle.request.unit as MatchView['unit'],
    status: match.status as MatchView['status'],
    myMeetingState: (isRequester ? match.requesterMeetingState : match.helperMeetingState) as MeetingState,
    peerMeetingState: (isRequester ? match.helperMeetingState : match.requesterMeetingState) as MeetingState,
    peer: {
      alias: peerAlias,
      avatarSeed: peerAlias,
      reliabilityLabel: reliabilityLabel(counters),
      completedAssists: counters.completed,
      memberSince: memberSinceLabel(peerUser.createdAt),
      emailVerifiedLabel: peerUser.emailVerifiedAt != null,
    },
    myAlias: isRequester ? match.requesterAlias : match.helperAlias,
    conversationId: bundle.conversationId,
    proximity: match.proximity as MatchView['proximity'],
    createdAt: match.createdAt.toISOString(),
    myConfirmedQty: myConfirmed == null ? null : Number(myConfirmed),
    peerConfirmed: peerConfirmed != null,
  };
}

export async function getMatchView(matchId: string, viewerUserId: string): Promise<MatchView> {
  const bundle = await loadMatchBundle(matchId);
  if (!bundle) throw errors.notFound();
  if (bundle.match.requesterId !== viewerUserId && bundle.match.helperId !== viewerUserId) {
    throw errors.notFound(); // participant-only; existence is not leaked
  }
  return toMatchView(bundle, viewerUserId);
}

export async function listActiveMatches(viewerUserId: string): Promise<MatchView[]> {
  const db = getDb();
  const rows = await db
    .select({ id: schema.matches.id })
    .from(schema.matches)
    .where(
      and(
        eq(schema.matches.status, 'active'),
        or(eq(schema.matches.requesterId, viewerUserId), eq(schema.matches.helperId, viewerUserId)),
      ),
    )
    .orderBy(desc(schema.matches.createdAt));
  const views: MatchView[] = [];
  for (const { id } of rows) {
    const bundle = await loadMatchBundle(id);
    if (bundle) views.push(toMatchView(bundle, viewerUserId));
  }
  return views;
}

/** WS hint to both participants, each with their own role-specific view. */
export async function emitMatchUpdate(matchId: string): Promise<void> {
  const bundle = await loadMatchBundle(matchId);
  if (!bundle) return;
  await publishToUser(bundle.match.requesterId, 'match.update', toMatchView(bundle, bundle.match.requesterId));
  await publishToUser(bundle.match.helperId, 'match.update', toMatchView(bundle, bundle.match.helperId));
}

async function emitRequestUpdate(requestId: string, requesterId: string): Promise<void> {
  const view = await loadRequestView(requestId);
  if (view) await publishToUser(requesterId, 'request.update', view);
}

export async function insertSystemMessage(
  tx: Tx,
  conversationId: string,
  senderId: string,
  bodyKey: string,
): Promise<void> {
  await tx.insert(schema.messages).values({ conversationId, senderId, kind: 'system', body: bodyKey });
}

/* --------------------------------------------------------------- meeting */

export async function setMeetingState(
  matchId: string,
  viewerUserId: string,
  state: MeetingState,
): Promise<MatchView> {
  if (!MEETING_STATES.includes(state)) throw errors.validation({ field: 'state' });
  const db = getDb();
  await db.transaction(async (tx) => {
    const [match] = await tx
      .select()
      .from(schema.matches)
      .where(eq(schema.matches.id, matchId))
      .limit(1)
      .for('update');
    if (!match) throw errors.notFound();
    const isRequester = match.requesterId === viewerUserId;
    const isHelper = match.helperId === viewerUserId;
    if (!isRequester && !isHelper) throw errors.notFound();
    if (match.status !== 'active') throw errors.conflict();
    await tx
      .update(schema.matches)
      .set(isRequester ? { requesterMeetingState: state } : { helperMeetingState: state })
      .where(eq(schema.matches.id, matchId));
    // state='cannot_find' is just recorded; escalation is the user's choice.
  });
  await emitMatchUpdate(matchId);
  return getMatchView(matchId, viewerUserId);
}

/* -------------------------------------------------- lock + settle helpers */

export interface MatchLocks {
  match: MatchRow;
  request: RequestRow;
  item: ItemRow;
  fractional: boolean;
  conversationId: string;
}

/**
 * Acquire all rows a settlement/cancel needs, respecting the global lock order
 * (request → inventory → match). The match is re-read AFTER locking so state
 * checks see the latest committed values.
 */
export async function lockMatchRows(tx: Tx, matchId: string): Promise<MatchLocks | null> {
  const [m0] = await tx.select().from(schema.matches).where(eq(schema.matches.id, matchId)).limit(1);
  if (!m0) return null;
  const [request] = await tx
    .select()
    .from(schema.requests)
    .where(eq(schema.requests.id, m0.requestId))
    .limit(1)
    .for('update');
  const [item] = await tx
    .select()
    .from(schema.inventoryItems)
    .where(eq(schema.inventoryItems.id, m0.inventoryItemId))
    .limit(1)
    .for('update');
  const [match] = await tx
    .select()
    .from(schema.matches)
    .where(eq(schema.matches.id, matchId))
    .limit(1)
    .for('update');
  if (!request || !item || !match) return null;
  const [cat] = await tx
    .select({ fractional: schema.categories.fractional })
    .from(schema.categories)
    .where(eq(schema.categories.id, request.categoryId))
    .limit(1);
  const [conv] = await tx
    .select({ id: schema.conversations.id })
    .from(schema.conversations)
    .where(eq(schema.conversations.matchId, matchId))
    .limit(1);
  if (!cat || !conv) return null;
  return { match, request, item, fractional: cat.fractional, conversationId: conv.id };
}

interface SettleOptions {
  finalQty: number;
  disputed: boolean;
  closeReason: string;
  actor: TransitionActor;
  senderUserId: string;
  /** Did the requester positively confirm receiving something? */
  requesterConfirmedPositive: boolean;
}

/**
 * Apply a completion settlement exactly once: deduct finalQty from stock,
 * release the whole reservation, credit the request, close the match, start the
 * conversation grace timer, and apply reliability. Caller holds all locks and
 * has verified the match is still active.
 */
async function settleLocked(tx: Tx, locks: MatchLocks, opts: SettleOptions): Promise<AfterCommit[]> {
  const { match, request, item } = locks;
  const after: AfterCommit[] = [];
  const finalQty = opts.finalQty;

  if (!match.inventoryApplied) {
    await tx
      .update(schema.inventoryItems)
      .set({
        qtyOnHand: String(Number(item.qtyOnHand) - finalQty),
        qtyReserved: String(Number(item.qtyReserved) - Number(match.qtyReserved)),
        updatedAt: new Date(),
      })
      .where(eq(schema.inventoryItems.id, item.id));
  }

  const newFulfilled = Number(request.qtyFulfilled) + finalQty;
  const covered = newFulfilled >= Number(request.qty);
  const matchStatus = opts.disputed ? 'disputed' : covered ? 'completed' : 'partially_completed';

  await tx
    .update(schema.matches)
    .set({
      status: matchStatus,
      closedAt: new Date(),
      closeReason: opts.closeReason,
      inventoryApplied: true,
      reliabilityApplied: true,
    })
    .where(eq(schema.matches.id, match.id));

  // Request settles by the agreed quantity; the requester chooses what happens
  // after a partial via POST /requests/:id/continue.
  if (covered) {
    await transitionRequest(tx, request, 'fulfilled', opts.actor, opts.closeReason, {
      qtyFulfilled: String(newFulfilled),
      closedAt: new Date(),
    });
  } else if (newFulfilled > 0) {
    await transitionRequest(tx, request, 'partially_fulfilled', opts.actor, opts.closeReason, {
      qtyFulfilled: String(newFulfilled),
    });
  } else {
    await transitionRequest(tx, request, 'searching', opts.actor, opts.closeReason, {
      qtyFulfilled: String(newFulfilled),
    });
    after.push(async () => {
      await matchQueue().add('match', { requestId: request.id });
    });
  }

  // Conversation stays open for a short grace window, then goes readonly
  // (enforced lazily by chat + swept by retention).
  await tx
    .update(schema.conversations)
    .set({ expiresAt: new Date(Date.now() + CONVERSATION_GRACE_MS) })
    .where(eq(schema.conversations.id, locks.conversationId));

  if (!match.reliabilityApplied) {
    await applyCompleted(tx, match.helperId, finalQty, opts.requesterConfirmedPositive);
    if (opts.disputed) {
      // Disagreements are recorded for BOTH users but never publicly punished:
      // disputes do not feed completionScore or the label (see reliability.ts).
      await applyDispute(tx, match.helperId);
      await applyDispute(tx, match.requesterId);
    }
  }

  await insertSystemMessage(
    tx,
    locks.conversationId,
    opts.senderUserId,
    opts.disputed ? 'match.disputeNote' : 'match.completed',
  );

  after.push(async () => {
    await emitMatchUpdate(match.id);
    await emitRequestUpdate(request.id, match.requesterId);
  });
  return after;
}

/* ----------------------------------------------------------------- confirm */

export async function confirmCompletion(
  matchId: string,
  viewerUserId: string,
  qty: number,
): Promise<MatchView> {
  const db = getDb();
  const result = await db.transaction(async (tx) => {
    const locks = await lockMatchRows(tx, matchId);
    if (!locks) throw errors.notFound();
    const { match, fractional } = locks;
    const isRequester = match.requesterId === viewerUserId;
    const isHelper = match.helperId === viewerUserId;
    if (!isRequester && !isHelper) throw errors.notFound();

    const myRaw = isRequester ? match.requesterConfirmedQty : match.helperConfirmedQty;
    const mine = myRaw == null ? null : Number(myRaw);
    // Idempotency: re-confirming the same quantity is a no-op replay; a
    // DIFFERENT quantity after the fact is a conflict (no silent rewrites).
    if (mine != null || match.status !== 'active') {
      if (mine != null && mine === qty) return { after: [] as AfterCommit[], scheduleFinalize: false };
      throw errors.conflict();
    }

    if (qty > Number(match.qtyReserved)) throw errors.validation({ field: 'qty', max: Number(match.qtyReserved) });
    if (!fractional && !Number.isInteger(qty)) throw errors.validation({ field: 'qty' });

    const myCol = isRequester ? 'requesterConfirmedQty' : 'helperConfirmedQty';
    await tx
      .update(schema.matches)
      .set({ [myCol]: String(qty) })
      .where(eq(schema.matches.id, matchId));

    const otherRaw = isRequester ? match.helperConfirmedQty : match.requesterConfirmedQty;
    if (otherRaw == null) {
      // First confirmation: give the peer 60 minutes, then auto-finalize.
      return { after: [] as AfterCommit[], scheduleFinalize: true };
    }

    const other = Number(otherRaw);
    const requesterQty = isRequester ? qty : other;
    const helperQty = isHelper ? qty : other;
    const after = await settleLocked(
      tx,
      { ...locks, match: { ...match, [myCol]: String(qty) } },
      {
        finalQty: Math.min(requesterQty, helperQty),
        disputed: requesterQty !== helperQty,
        closeReason: requesterQty !== helperQty ? 'disputed_quantities' : 'confirmed',
        actor: isRequester ? 'requester' : 'helper',
        senderUserId: viewerUserId,
        requesterConfirmedPositive: requesterQty > 0,
      },
    );
    return { after, scheduleFinalize: false };
  });

  if (result.scheduleFinalize) {
    await matchQueue().add('finalize', { matchId }, { delay: FINALIZE_AFTER_FIRST_CONFIRMATION_MS });
    await emitMatchUpdate(matchId);
  }
  for (const fn of result.after) await fn();
  return getMatchView(matchId, viewerUserId);
}

/**
 * 60 minutes after the first confirmation with the peer still silent: settle
 * with the single reported quantity — never disputed, no penalty for anyone.
 * Idempotent: exits unless the match is still active with exactly one
 * confirmation and an unapplied reservation.
 */
export async function autoFinalizeMatch(matchId: string): Promise<void> {
  const db = getDb();
  const after = await db.transaction(async (tx) => {
    const locks = await lockMatchRows(tx, matchId);
    if (!locks) return [] as AfterCommit[];
    const { match } = locks;
    const reqQty = match.requesterConfirmedQty == null ? null : Number(match.requesterConfirmedQty);
    const helpQty = match.helperConfirmedQty == null ? null : Number(match.helperConfirmedQty);
    const confirmations = [reqQty, helpQty].filter((q) => q != null);
    if (match.status !== 'active' || match.inventoryApplied || confirmations.length !== 1) {
      return [] as AfterCommit[];
    }
    const finalQty = confirmations[0]!;
    return settleLocked(tx, locks, {
      finalQty,
      disputed: false,
      closeReason: 'auto_finalized_unconfirmed_peer',
      actor: 'system',
      senderUserId: reqQty != null ? match.requesterId : match.helperId,
      requesterConfirmedPositive: reqQty != null && reqQty > 0,
    });
  });
  for (const fn of after) await fn();
}

/* ------------------------------------------------------------------ cancel */

export interface CancelOptions {
  actor: 'requester' | 'helper' | 'moderator';
  /** The cancelling user (null for moderation). */
  cancellerUserId: string | null;
  /** close_reason token, e.g. 'changed_mind', 'unsafe', 'requester-cancel'. */
  reason: string;
  unsafe: boolean;
  note?: string;
}

/**
 * Cancel an active match on the caller's transaction (caller obtained locks
 * via lockMatchRows, i.e. in the global lock order). Releases the reservation
 * exactly once, closes the conversation appropriately, and routes the request
 * to its next state based on who cancelled.
 */
export async function cancelMatchLocked(
  tx: Tx,
  locks: MatchLocks,
  opts: CancelOptions,
): Promise<AfterCommit[]> {
  const { match, request, item } = locks;
  if (match.status !== 'active') throw errors.conflict();
  const after: AfterCommit[] = [];

  const postMeeting =
    (['arrived', 'exchanging'] as string[]).includes(match.requesterMeetingState) ||
    (['arrived', 'exchanging'] as string[]).includes(match.helperMeetingState);

  // Release the reservation exactly once (nothing was handed over).
  if (!match.inventoryApplied) {
    await tx
      .update(schema.inventoryItems)
      .set({
        qtyReserved: String(Number(item.qtyReserved) - Number(match.qtyReserved)),
        updatedAt: new Date(),
      })
      .where(eq(schema.inventoryItems.id, item.id));
  }

  const status =
    opts.actor === 'moderator'
      ? 'cancelled_moderation'
      : opts.unsafe
        ? 'cancelled_unsafe'
        : opts.actor === 'requester'
          ? 'cancelled_by_requester'
          : 'cancelled_by_helper';
  const closeReason = opts.note
    ? `${opts.reason}: ${redactContactDetails(opts.note)}`
    : opts.reason;

  await tx
    .update(schema.matches)
    .set({ status, closedAt: new Date(), closeReason, inventoryApplied: true })
    .where(eq(schema.matches.id, match.id));

  // Unsafe/moderation cancels close the chat immediately; ordinary cancels keep
  // it open for a 60-minute grace window (retention flips it to readonly).
  const conversationGrace = new Date(Date.now() + CONVERSATION_GRACE_MS);
  if (opts.unsafe || opts.actor === 'moderator') {
    await tx
      .update(schema.conversations)
      .set({ status: 'readonly', expiresAt: conversationGrace })
      .where(eq(schema.conversations.id, locks.conversationId));
    // Both clients must learn the chat is closed without waiting for a refetch.
    after.push(async () => {
      const frame = { id: locks.conversationId, matchId: match.id, status: 'readonly' };
      await publishToUser(match.requesterId, 'conversation.update', frame);
      await publishToUser(match.helperId, 'conversation.update', frame);
    });
  } else {
    await tx
      .update(schema.conversations)
      .set({ expiresAt: conversationGrace })
      .where(eq(schema.conversations.id, locks.conversationId));
  }

  // Route the request. Requester-initiated (incl. unsafe) → cancelled;
  // helper-initiated → back to searching so someone else can help;
  // moderation → terminal 'moderated'.
  if (opts.actor === 'moderator') {
    await transitionRequest(tx, request, 'moderated', 'moderator', opts.reason, { closedAt: new Date() });
  } else if (opts.actor === 'requester') {
    await transitionRequest(tx, request, 'cancelled', 'requester', opts.reason, { closedAt: new Date() });
  } else {
    await transitionRequest(tx, request, 'searching', 'helper', opts.reason);
    after.push(async () => {
      await matchQueue().add('match', { requestId: request.id });
      await notifyQueue().add('notify', {
        userId: match.requesterId,
        type: 'match_cancelled',
        titleKey: 'match.cancelled',
        // Not the offer preview: this goes to the requester, who is not
        // carrying anything and needs to know their exchange fell through.
        bodyKey: 'notifications.matchCancelledBody',
        params: {},
        deepLink: `/request/${request.id}`,
        dedupeKey: `matchcancel:${match.id}`,
      });
    });
  }

  // Unsafe: stop processing the canceller's location immediately.
  if (opts.unsafe && opts.cancellerUserId) {
    await tx
      .delete(schema.memberLocations)
      .where(
        and(
          eq(schema.memberLocations.userId, opts.cancellerUserId),
          eq(schema.memberLocations.eventId, match.eventId),
        ),
      );
  }

  // Reliability: only helper-initiated abandonment costs. Requester cancels are
  // free for the helper, moderation cancels are handled by moderation, and
  // 'unsafe' is deliberately exempt so nobody is ever penalized for leaving a
  // situation that felt wrong (see docs/api-surface.md deviation note).
  if (opts.actor === 'helper' && !opts.unsafe) {
    await applyHelperCancel(tx, match.helperId, postMeeting);
  }

  await insertSystemMessage(
    tx,
    locks.conversationId,
    opts.cancellerUserId ?? match.requesterId,
    'match.cancelled',
  );

  after.push(async () => {
    await emitMatchUpdate(match.id);
    await emitRequestUpdate(request.id, match.requesterId);
  });
  return after;
}

/** Lock + cancel in the caller's tx (used by requests.cancel while it already holds the request lock). */
export async function cancelMatchInTx(tx: Tx, matchId: string, opts: CancelOptions): Promise<AfterCommit[]> {
  const locks = await lockMatchRows(tx, matchId);
  if (!locks) throw errors.notFound();
  return cancelMatchLocked(tx, locks, opts);
}

export async function cancelMatch(
  matchId: string,
  viewerUserId: string,
  input: { reason: 'changed_mind' | 'cannot_find' | 'no_longer_needed' | 'unsafe' | 'other'; note?: string },
): Promise<MatchView> {
  const db = getDb();
  const after = await db.transaction(async (tx) => {
    const locks = await lockMatchRows(tx, matchId);
    if (!locks) throw errors.notFound();
    const { match } = locks;
    const isRequester = match.requesterId === viewerUserId;
    const isHelper = match.helperId === viewerUserId;
    if (!isRequester && !isHelper) throw errors.notFound();
    return cancelMatchLocked(tx, locks, {
      actor: isRequester ? 'requester' : 'helper',
      cancellerUserId: viewerUserId,
      reason: input.reason,
      unsafe: input.reason === 'unsafe',
      ...(input.note ? { note: input.note } : {}),
    });
  });
  for (const fn of after) await fn();
  return getMatchView(matchId, viewerUserId);
}

/**
 * Moderation cancel (exported for the moderation slice): releases the
 * reservation, closes the conversation readonly immediately, and moves the
 * request to the terminal 'moderated' state. No reliability penalty.
 */
export async function cancelMatchForModeration(matchId: string, reason: string): Promise<void> {
  const db = getDb();
  const after = await db.transaction(async (tx) =>
    cancelMatchInTx(tx, matchId, {
      actor: 'moderator',
      cancellerUserId: null,
      reason,
      unsafe: false,
    }),
  );
  for (const fn of after) await fn();
}

/* ------------------------------------------------------------ ordered feed */

/** Transitions for a request, oldest first (handy for audits/tests). */
export async function listTransitions(requestId: string) {
  const db = getDb();
  return db
    .select()
    .from(schema.requestTransitions)
    .where(eq(schema.requestTransitions.requestId, requestId))
    .orderBy(asc(schema.requestTransitions.id));
}
