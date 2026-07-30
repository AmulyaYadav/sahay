/**
 * "Public wants" for an event: a merge of admin-curated categories and real
 * aggregated demand, shown on the anonymous public pages. Deliberately has NO
 * k-anonymity floor (unlike computeDashboard) — see ADR-0012. Admin wants are
 * always first, ordered by the catalogue's own sortOrder; user-requested wants
 * follow, sorted by total requested quantity.
 */
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { AdminWant, PublicWant } from '@sahay/shared';
import { getDb } from '../../db/index.js';
import { schema } from '../../db/index.js';
import { errors } from '../../lib/errors.js';
import { requireEvent } from '../admin/service.js';

export async function computePublicWants(eventIds: string[]): Promise<Map<string, PublicWant[]>> {
  const result = new Map<string, PublicWant[]>();
  if (eventIds.length === 0) return result;
  const db = getDb();

  const adminRows = await db
    .select({
      eventId: schema.eventAdminWants.eventId,
      slug: schema.categories.slug,
      qty: schema.eventAdminWants.qty,
    })
    .from(schema.eventAdminWants)
    .innerJoin(schema.categories, eq(schema.categories.id, schema.eventAdminWants.categoryId))
    .where(inArray(schema.eventAdminWants.eventId, eventIds))
    .orderBy(asc(schema.categories.sortOrder));

  const reqQty = sql<string>`COALESCE(SUM(${schema.requests.qty} - ${schema.requests.qtyFulfilled}), 0)`;
  const requesterCount = sql<string>`COUNT(DISTINCT ${schema.requests.requesterId})`;
  const demandRows = await db
    .select({
      eventId: schema.requests.eventId,
      slug: schema.categories.slug,
      reqQty,
      requesterCount,
    })
    .from(schema.requests)
    .innerJoin(schema.categories, eq(schema.categories.id, schema.requests.categoryId))
    .where(
      and(inArray(schema.requests.eventId, eventIds), inArray(schema.requests.status, ['searching', 'offering'])),
    )
    .groupBy(schema.requests.eventId, schema.categories.slug)
    .orderBy(desc(reqQty));

  for (const eventId of eventIds) {
    const adminSlugs = new Set(adminRows.filter((r) => r.eventId === eventId).map((r) => r.slug));
    const admin: PublicWant[] = adminRows
      .filter((r) => r.eventId === eventId)
      .map((r) => ({
        categorySlug: r.slug,
        source: 'admin' as const,
        // The organiser's target, when they gave one. requesterCount stays null:
        // this number is a declared need, not a count of people who asked.
        requestedQty: r.qty,
        requesterCount: null,
      }));
    const user: PublicWant[] = demandRows
      .filter((r) => r.eventId === eventId && !adminSlugs.has(r.slug))
      .map((r) => ({
        categorySlug: r.slug,
        source: 'user' as const,
        requestedQty: Number(r.reqQty),
        requesterCount: Number(r.requesterCount),
      }));
    result.set(eventId, [...admin, ...user]);
  }
  return result;
}

export async function setAdminWants(eventId: string, wants: AdminWant[]): Promise<void> {
  const db = getDb();

  // Last write per slug wins, so a duplicated slug in the payload cannot make
  // the insert below fail on the (event_id, category_id) primary key.
  const bySlug = new Map(wants.map((w) => [w.categorySlug, w.qty]));

  await db.transaction(async (tx) => {
    await requireEvent(tx, eventId);

    const slugs = [...bySlug.keys()];
    const cats = slugs.length
      ? await tx
          .select({ id: schema.categories.id, slug: schema.categories.slug })
          .from(schema.categories)
          .where(inArray(schema.categories.slug, slugs))
      : [];
    if (cats.length !== slugs.length) {
      throw errors.validation({ field: 'wants' });
    }

    // Replace the admin-wants list wholesale — this table holds nothing but
    // the category and its quantity (unlike event_categories), so
    // delete+insert loses no state.
    await tx.delete(schema.eventAdminWants).where(eq(schema.eventAdminWants.eventId, eventId));
    if (cats.length > 0) {
      await tx
        .insert(schema.eventAdminWants)
        .values(cats.map((c) => ({ eventId, categoryId: c.id, qty: bySlug.get(c.slug) ?? null })));
    }
  });
}
