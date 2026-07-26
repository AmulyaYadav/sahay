/**
 * Reliability counter plumbing. Each helper mutation increments the relevant
 * counters and recomputes the displayed label with the shared reliabilityLabel()
 * math, inside the caller's transaction so it commits (or rolls back) with the
 * flow that caused it. The raw counters are never exposed to peers — only the
 * label and the completed-assist count.
 */
import { eq, sql } from 'drizzle-orm';
import { reliabilityLabel, type ReliabilityCounters } from '@sahay/shared';
import { schema, type Tx } from '../../db/index.js';

export type ReliabilityRow = typeof schema.reliabilityStats.$inferSelect;

export function rowToCounters(row: Partial<ReliabilityRow> | null | undefined): ReliabilityCounters {
  return {
    accepted: row?.accepted ?? 0,
    completed: row?.completed ?? 0,
    requesterConfirmed: row?.requesterConfirmed ?? 0,
    cancelledPreMeeting: row?.cancelledPreMeeting ?? 0,
    cancelledPostMeeting: row?.cancelledPostMeeting ?? 0,
    timeouts: row?.timeouts ?? 0,
    noShows: row?.noShows ?? 0,
    disputes: row?.disputes ?? 0,
    offersReceived30d: row?.offersReceived30d ?? 0,
    offersResponded30d: row?.offersResponded30d ?? 0,
  };
}

type CounterColumn =
  | 'accepted'
  | 'completed'
  | 'requesterConfirmed'
  | 'cancelledPreMeeting'
  | 'cancelledPostMeeting'
  | 'timeouts'
  | 'noShows'
  | 'disputes'
  | 'offersReceived30d'
  | 'offersResponded30d';

async function bump(tx: Tx, userId: string, increments: Partial<Record<CounterColumn, number>>): Promise<void> {
  await tx.insert(schema.reliabilityStats).values({ userId }).onConflictDoNothing();
  const set: Record<string, unknown> = { updatedAt: new Date() };
  for (const [col, by] of Object.entries(increments)) {
    if (!by) continue;
    const column = schema.reliabilityStats[col as CounterColumn];
    set[col] = sql`${column} + ${by}`;
  }
  const [row] = await tx
    .update(schema.reliabilityStats)
    .set(set)
    .where(eq(schema.reliabilityStats.userId, userId))
    .returning();
  if (!row) return;
  const label = reliabilityLabel(rowToCounters(row));
  if (label !== row.label) {
    await tx
      .update(schema.reliabilityStats)
      .set({ label })
      .where(eq(schema.reliabilityStats.userId, userId));
  }
}

/** An offer was extended to the helper (denominator of responsiveness). */
export const applyOfferReceived = (tx: Tx, helperId: string) =>
  bump(tx, helperId, { offersReceived30d: 1 });

/** Helper declined in time — declining is free and counts as responsive. */
export const applyOfferResponded = (tx: Tx, helperId: string) =>
  bump(tx, helperId, { offersResponded30d: 1 });

/** Helper accepted an offer (accepting also counts as responding). */
export const applyAccepted = (tx: Tx, helperId: string) =>
  bump(tx, helperId, { accepted: 1, offersResponded30d: 1 });

/** Settlement: completion only counts when something actually changed hands. */
export const applyCompleted = (
  tx: Tx,
  helperId: string,
  finalQty: number,
  requesterConfirmedPositive: boolean,
) =>
  bump(tx, helperId, {
    completed: finalQty > 0 ? 1 : 0,
    requesterConfirmed: requesterConfirmedPositive ? 1 : 0,
  });

/** Helper abandoned an active match; costlier after the meeting started. */
export const applyHelperCancel = (tx: Tx, helperId: string, postMeeting: boolean) =>
  bump(tx, helperId, postMeeting ? { cancelledPostMeeting: 1 } : { cancelledPreMeeting: 1 });

/**
 * Quantity disagreement. Counted for BOTH participants but deliberately NOT
 * fed into completionScore/label: unresolved disagreements are never publicly
 * punished (docs/reliability.md) — the counter exists for moderation signals only.
 */
export const applyDispute = (tx: Tx, userId: string) => bump(tx, userId, { disputes: 1 });
