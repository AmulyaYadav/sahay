/**
 * "What should I bring?" suggestions. Aggregates are k-anonymized: when too few
 * distinct people are behind the numbers the level is 'unknown' rather than a
 * potentially identifying figure.
 */
import { sql } from 'drizzle-orm';
import type { z } from 'zod';
import { LIMITS, SHORTAGE_LEVELS, zBringSuggestion, type ShortageLevel } from '@sahay/shared';

export type BringSuggestion = z.infer<typeof zBringSuggestion>;
import { getDb } from '../../db/index.js';
import { errors } from '../../lib/errors.js';
import { effectiveEventCategories, getMembership } from './service.js';

export interface ShortageInputs {
  requestedQty: number; // remaining qty across searching/offering requests
  offeredQty: number; // available (on hand - reserved) across OTHER users' items
  distinctRequesters: number;
  distinctOfferers: number;
  kAnonymityThreshold: number;
}

/** Pure shortage heuristic — unit-tested in isolation. */
export function computeShortage(i: ShortageInputs): ShortageLevel {
  if (i.distinctRequesters < i.kAnonymityThreshold && i.distinctOfferers < i.kAnonymityThreshold) {
    return 'unknown';
  }
  if (i.requestedQty <= 0) {
    return i.offeredQty > i.kAnonymityThreshold ? 'possible_surplus' : 'adequate';
  }
  const ratio = i.offeredQty / i.requestedQty;
  if (ratio < 0.25) return 'critical_shortage';
  if (ratio < 0.75) return 'high_need';
  if (ratio < 1.25) return 'moderate_need';
  if (ratio < 3) return 'adequate';
  return 'possible_surplus';
}

const severity = (level: ShortageLevel) => SHORTAGE_LEVELS.indexOf(level);

export async function getBringSuggestions(
  eventId: string,
  userId: string,
): Promise<BringSuggestion[]> {
  const membership = await getMembership(eventId, userId);
  if (!membership) throw errors.forbidden();

  const db = getDb();
  const requested = await db.execute(sql`
    SELECT category_id,
           COALESCE(SUM(qty - qty_fulfilled), 0) AS req_qty,
           COUNT(DISTINCT requester_id) AS requesters
    FROM requests
    WHERE event_id = ${eventId} AND status IN ('searching', 'offering')
    GROUP BY category_id
  `);
  const offered = await db.execute(sql`
    SELECT category_id,
           COALESCE(SUM(qty_on_hand - qty_reserved), 0) AS off_qty,
           COUNT(DISTINCT user_id) AS offerers
    FROM inventory_items
    WHERE event_id = ${eventId} AND active AND user_id <> ${userId}
    GROUP BY category_id
  `);
  const reqBy = new Map(
    requested.rows.map((r) => [
      String(r.category_id),
      { qty: Number(r.req_qty), users: Number(r.requesters) },
    ]),
  );
  const offBy = new Map(
    offered.rows.map((r) => [
      String(r.category_id),
      { qty: Number(r.off_qty), users: Number(r.offerers) },
    ]),
  );

  const cats = await effectiveEventCategories(eventId);
  const suggestions: BringSuggestion[] = cats.map(({ category, maxOfferQty }) => {
    const req = reqBy.get(category.id) ?? { qty: 0, users: 0 };
    const off = offBy.get(category.id) ?? { qty: 0, users: 0 };
    const level = computeShortage({
      requestedQty: req.qty,
      offeredQty: off.qty,
      distinctRequesters: req.users,
      distinctOfferers: off.users,
      kAnonymityThreshold: LIMITS.kAnonymityThreshold,
    });
    const suggestedQty = Math.max(Math.min(req.qty - off.qty, maxOfferQty, 10), 0);
    return {
      categoryId: category.id,
      categorySlug: category.slug,
      level,
      suggestedQty,
      unit: category.unit as BringSuggestion['unit'],
      reasonKey: `shortage.${level}`,
    };
  });

  return suggestions.sort((a, b) => severity(a.level) - severity(b.level)).slice(0, 6);
}
