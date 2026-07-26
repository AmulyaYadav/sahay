/**
 * Aggregate event dashboard. Every figure is k-anonymized: a number is exposed
 * only when at least LIMITS.kAnonymityThreshold DISTINCT users stand behind it
 * (requesters for demand, offerers/helpers for supply); below that the field is
 * null and the shortage level degrades to whatever computeShortage can still
 * say. Responses are viewer-independent, so they are cached whole in Redis.
 */
import { sql } from 'drizzle-orm';
import { LIMITS, type CategoryNeed, type EventDashboard } from '@sahay/shared';
import { getDb } from '../../db/index.js';
import { getRedis } from '../../lib/redis.js';
import { computeShortage } from '../events/bring.js';
import { effectiveEventCategories } from '../events/service.js';

const CACHE_TTL_SECONDS = 30;

/** Pure k-anonymity gate (unit-tested): a stat needs k distinct users behind it. */
export function gateValue(
  value: number,
  distinctUsers: number,
  k: number = LIMITS.kAnonymityThreshold,
): number | null {
  return distinctUsers >= k ? value : null;
}

interface Agg {
  qty: number;
  users: number;
}

function aggMap(rows: Record<string, unknown>[], qtyCol: string, usersCol: string): Map<string, Agg> {
  return new Map(
    rows.map((r) => [
      String(r.category_id),
      { qty: Number(r[qtyCol] ?? 0), users: Number(r[usersCol] ?? 0) },
    ]),
  );
}

async function computeDashboard(eventId: string): Promise<EventDashboard> {
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
    WHERE event_id = ${eventId} AND active
      AND (expires_at IS NULL OR expires_at > now())
    GROUP BY category_id
  `);
  const reserved = await db.execute(sql`
    SELECT r.category_id,
           COALESCE(SUM(m.qty_reserved), 0) AS res_qty,
           COUNT(DISTINCT m.helper_id) AS helpers
    FROM matches m
    JOIN requests r ON r.id = m.request_id
    WHERE m.event_id = ${eventId} AND m.status = 'active'
    GROUP BY r.category_id
  `);
  // Applied quantity of a settled match = LEAST of both confirmations, falling
  // back to the single reported figure for auto-finalized matches.
  const fulfilled = await db.execute(sql`
    SELECT r.category_id,
           COALESCE(SUM(LEAST(
             COALESCE(m.requester_confirmed_qty, m.helper_confirmed_qty),
             COALESCE(m.helper_confirmed_qty, m.requester_confirmed_qty)
           )), 0) AS ful_qty,
           COUNT(DISTINCT m.helper_id) AS helpers
    FROM matches m
    JOIN requests r ON r.id = m.request_id
    WHERE m.event_id = ${eventId}
      AND m.status IN ('completed', 'partially_completed')
      AND m.closed_at > now() - interval '1 hour'
    GROUP BY r.category_id
  `);
  const recent = await db.execute(sql`
    SELECT COUNT(*)::int AS n,
           (SELECT COUNT(DISTINCT uid) FROM (
              SELECT requester_id AS uid FROM matches
              WHERE event_id = ${eventId} AND status IN ('completed', 'partially_completed')
                AND closed_at > now() - interval '1 hour'
              UNION
              SELECT helper_id FROM matches
              WHERE event_id = ${eventId} AND status IN ('completed', 'partially_completed')
                AND closed_at > now() - interval '1 hour'
           ) p)::int AS participants
    FROM matches
    WHERE event_id = ${eventId} AND status IN ('completed', 'partially_completed')
      AND closed_at > now() - interval '1 hour'
  `);

  const reqBy = aggMap(requested.rows as Record<string, unknown>[], 'req_qty', 'requesters');
  const offBy = aggMap(offered.rows as Record<string, unknown>[], 'off_qty', 'offerers');
  const resBy = aggMap(reserved.rows as Record<string, unknown>[], 'res_qty', 'helpers');
  const fulBy = aggMap(fulfilled.rows as Record<string, unknown>[], 'ful_qty', 'helpers');

  // All enabled categories appear so the "what to bring" story works; ones
  // without enough contributors read as level 'unknown' with null figures.
  const cats = await effectiveEventCategories(eventId);
  const needs: CategoryNeed[] = cats.map(({ category }) => {
    const req = reqBy.get(category.id) ?? { qty: 0, users: 0 };
    const off = offBy.get(category.id) ?? { qty: 0, users: 0 };
    const res = resBy.get(category.id) ?? { qty: 0, users: 0 };
    const ful = fulBy.get(category.id) ?? { qty: 0, users: 0 };
    return {
      categoryId: category.id,
      categorySlug: category.slug,
      level: computeShortage({
        requestedQty: req.qty,
        offeredQty: off.qty,
        distinctRequesters: req.users,
        distinctOfferers: off.users,
        kAnonymityThreshold: LIMITS.kAnonymityThreshold,
      }),
      requestedQty: gateValue(req.qty, req.users),
      offeredQty: gateValue(off.qty, off.users),
      reservedQty: gateValue(res.qty, res.users),
      fulfilledRecentQty: gateValue(ful.qty, ful.users),
      unit: category.unit as CategoryNeed['unit'],
    };
  });

  const recentRow = recent.rows[0] as { n?: unknown; participants?: unknown } | undefined;
  const fulfilments = Number(recentRow?.n ?? 0);
  const participants = Number(recentRow?.participants ?? 0);

  return {
    eventId,
    generatedAt: new Date().toISOString(),
    approximate: true,
    needs,
    recentFulfilments: participants >= LIMITS.kAnonymityThreshold ? fulfilments : 0,
  };
}

export async function getEventDashboard(eventId: string): Promise<EventDashboard> {
  const redis = getRedis();
  const cacheKey = `dash:${eventId}`;
  const cached = await redis.get(cacheKey).catch(() => null);
  if (cached) return JSON.parse(cached) as EventDashboard;
  const dashboard = await computeDashboard(eventId);
  await redis.set(cacheKey, JSON.stringify(dashboard), 'EX', CACHE_TTL_SECONDS).catch(() => {});
  return dashboard;
}
