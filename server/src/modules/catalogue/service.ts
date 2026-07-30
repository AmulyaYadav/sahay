import { asc, eq } from 'drizzle-orm';
import type { Category, Locale, Unit } from '@sahay/shared';
import { getDb, schema } from '../../db/index.js';

type CategoryRow = typeof schema.categories.$inferSelect;

export interface CategoryOverrides {
  maxRequestQty?: string | number | null;
  maxOfferQty?: string | number | null;
}

/**
 * pg returns numeric columns as strings — normalize here, once, at the boundary.
 * Event-level overrides (event_categories) win over the global limits.
 */
export function mapCategory(row: CategoryRow, overrides?: CategoryOverrides): Category {
  return {
    id: row.id,
    slug: row.slug,
    group: row.group as Category['group'],
    name: row.name as Record<Locale, string>,
    ...(row.namePlural ? { namePlural: row.namePlural as Record<Locale, string> } : {}),
    ...(row.description ? { description: row.description as Record<Locale, string> } : {}),
    icon: row.icon,
    unit: row.unit as Unit,
    altUnits: (row.altUnits ?? []) as Unit[],
    fractional: row.fractional,
    sealedRequired: row.sealedRequired,
    expiryRelevant: row.expiryRelevant,
    restricted: row.restricted,
    warningKey: row.warningKey,
    maxRequestQty: Number(overrides?.maxRequestQty ?? row.maxRequestQty),
    maxOfferQty: Number(overrides?.maxOfferQty ?? row.maxOfferQty),
    sortOrder: row.sortOrder,
    active: row.active,
  };
}

export async function listActiveCategories(): Promise<Category[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.categories)
    .where(eq(schema.categories.active, true))
    .orderBy(asc(schema.categories.sortOrder), asc(schema.categories.slug));
  return rows.map((r) => mapCategory(r));
}
