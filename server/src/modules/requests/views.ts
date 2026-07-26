/**
 * zRequestView mapping. pg returns numeric columns as strings — normalized to
 * Number here, once, at the boundary (same convention as catalogue/inventory).
 */
import { and, eq } from 'drizzle-orm';
import type { RequestView } from '@sahay/shared';
import { getDb, schema, type Db, type Tx } from '../../db/index.js';
import type { RequestRow } from './transitions.js';

export function toRequestView(
  row: RequestRow,
  categorySlug: string,
  activeMatchId: string | null,
): RequestView {
  return {
    id: row.id,
    eventId: row.eventId,
    categoryId: row.categoryId,
    categorySlug,
    qty: Number(row.qty),
    qtyFulfilled: Number(row.qtyFulfilled),
    unit: row.unit as RequestView['unit'],
    urgency: row.urgency as RequestView['urgency'],
    note: row.note,
    status: row.status as RequestView['status'],
    expiresAt: row.expiresAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    attemptCount: row.attemptCount,
    activeMatchId,
  };
}

export async function activeMatchIdFor(db: Db | Tx, requestId: string): Promise<string | null> {
  const [m] = await db
    .select({ id: schema.matches.id })
    .from(schema.matches)
    .where(and(eq(schema.matches.requestId, requestId), eq(schema.matches.status, 'active')))
    .limit(1);
  return m?.id ?? null;
}

export async function loadRequestView(requestId: string): Promise<RequestView | null> {
  const db = getDb();
  const [row] = await db
    .select({ request: schema.requests, slug: schema.categories.slug })
    .from(schema.requests)
    .innerJoin(schema.categories, eq(schema.requests.categoryId, schema.categories.id))
    .where(eq(schema.requests.id, requestId))
    .limit(1);
  if (!row) return null;
  return toRequestView(row.request, row.slug, await activeMatchIdFor(db, requestId));
}
