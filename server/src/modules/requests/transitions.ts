/**
 * Request state machine. The server is the only writer of request.status and
 * every change goes through transitionRequest(), which enforces the permitted-
 * transition table below and appends a request_transitions audit row in the
 * same transaction. Invalid transitions are a request_conflict (409), never a
 * silent overwrite.
 */
import { eq } from 'drizzle-orm';
import type { RequestStatus } from '@sahay/shared';
import { schema, type Tx } from '../../db/index.js';
import { errors } from '../../lib/errors.js';

export type RequestRow = typeof schema.requests.$inferSelect;
export type TransitionActor = 'system' | 'requester' | 'helper' | 'moderator';

/**
 * from → allowed to. 'none' is the virtual pre-creation state.
 * Notes:
 *  - offering → expired (never no_match): an offering request by definition has
 *    at least one prior offer.
 *  - 'disputed' as a REQUEST status is intentionally unreachable: quantity
 *    disagreements mark the MATCH disputed while the request settles into
 *    fulfilled / partially_fulfilled / searching by what both sides agree on.
 *  - terminal: fulfilled, disputed, moderated. cancelled/expired/no_match can
 *    be revived by the owner via renew.
 */
export const REQUEST_TRANSITIONS: Record<'none' | RequestStatus, readonly RequestStatus[]> = {
  none: ['searching'],
  searching: ['offering', 'cancelled', 'expired', 'no_match', 'moderated'],
  offering: ['searching', 'matched', 'cancelled', 'expired', 'moderated'],
  matched: ['fulfilled', 'partially_fulfilled', 'searching', 'cancelled', 'moderated'],
  fulfilled: [],
  partially_fulfilled: ['searching', 'fulfilled', 'cancelled', 'moderated'],
  cancelled: ['searching'],
  expired: ['searching'],
  no_match: ['searching'],
  disputed: [],
  moderated: [],
};

export function canTransition(from: 'none' | RequestStatus, to: RequestStatus): boolean {
  return (REQUEST_TRANSITIONS[from] ?? []).includes(to);
}

/** Audit row for the creation pseudo-transition ('none' → 'searching'). */
export async function recordCreationTransition(
  tx: Tx,
  requestId: string,
  actor: TransitionActor,
  reason?: string,
): Promise<void> {
  await tx.insert(schema.requestTransitions).values({
    requestId,
    fromStatus: 'none',
    toStatus: 'searching',
    actor,
    reason: reason ?? null,
  });
}

/**
 * Validate + apply a status change + append the audit row, all on the caller's
 * transaction (the caller must hold the request row lock). `set` carries any
 * additional column updates that belong to the same state change (expires_at,
 * closed_at, current_radius_m, ...).
 */
export async function transitionRequest(
  tx: Tx,
  request: Pick<RequestRow, 'id' | 'status'>,
  to: RequestStatus,
  actor: TransitionActor,
  reason?: string,
  set?: Partial<typeof schema.requests.$inferInsert>,
): Promise<RequestRow> {
  const from = request.status as RequestStatus;
  if (!canTransition(from, to)) throw errors.conflict();
  const [updated] = await tx
    .update(schema.requests)
    .set({ status: to, ...set })
    .where(eq(schema.requests.id, request.id))
    .returning();
  if (!updated) throw errors.notFound();
  await tx.insert(schema.requestTransitions).values({
    requestId: request.id,
    fromStatus: from,
    toStatus: to,
    actor,
    reason: reason ?? null,
  });
  return updated;
}
