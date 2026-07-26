/**
 * Per-event inventory. Accounting invariant (also enforced by DB CHECKs):
 * available = qty_on_hand - qty_reserved, never negative. All quantity
 * mutations run in a transaction with the item row locked FOR UPDATE.
 */
import { and, desc, eq, sql } from 'drizzle-orm';
import type { z } from 'zod';
import {
  LIMITS,
  zAddInventory,
  zUpdateInventory,
  type InventoryItem,
  type Unit,
} from '@sahay/shared';
import { getDb, schema, type Tx } from '../../db/index.js';
import { errors } from '../../lib/errors.js';
import { effectiveEventCategories, getMembership, resolveEvent } from '../events/service.js';

export type AddInventoryInput = z.infer<typeof zAddInventory>;
export type UpdateInventoryInput = z.infer<typeof zUpdateInventory>;

type ItemRow = typeof schema.inventoryItems.$inferSelect;

function toView(item: ItemRow, categorySlug: string): InventoryItem {
  const onHand = Number(item.qtyOnHand);
  const reserved = Number(item.qtyReserved);
  return {
    id: item.id,
    eventId: item.eventId,
    categoryId: item.categoryId,
    categorySlug,
    qtyTotal: onHand,
    qtyAvailable: onHand - reserved,
    qtyReserved: reserved,
    unit: item.unit as Unit,
    details: item.details as InventoryItem['details'],
    active: item.active,
    updatedAt: item.updatedAt.toISOString(),
  };
}

async function slugFor(db: Tx | ReturnType<typeof getDb>, categoryId: string): Promise<string> {
  const [cat] = await db
    .select({ slug: schema.categories.slug })
    .from(schema.categories)
    .where(eq(schema.categories.id, categoryId))
    .limit(1);
  return cat?.slug ?? '';
}

export async function listMyInventory(userId: string, eventId: string): Promise<InventoryItem[]> {
  const membership = await getMembership(eventId, userId);
  if (!membership) throw errors.forbidden();
  const db = getDb();
  const rows = await db
    .select({ item: schema.inventoryItems, slug: schema.categories.slug })
    .from(schema.inventoryItems)
    .innerJoin(schema.categories, eq(schema.inventoryItems.categoryId, schema.categories.id))
    .where(and(eq(schema.inventoryItems.userId, userId), eq(schema.inventoryItems.eventId, eventId)))
    .orderBy(desc(schema.inventoryItems.createdAt));
  return rows.map((r) => toView(r.item, r.slug));
}

export async function addInventory(
  userId: string,
  eventId: string,
  input: AddInventoryInput,
): Promise<InventoryItem> {
  const db = getDb();

  // Idempotency replay wins over everything else: return the original result.
  if (input.idempotencyKey) {
    const [existing] = await db
      .select()
      .from(schema.inventoryItems)
      .where(
        and(
          eq(schema.inventoryItems.userId, userId),
          eq(schema.inventoryItems.idempotencyKey, input.idempotencyKey),
        ),
      )
      .limit(1);
    if (existing) return toView(existing, await slugFor(db, existing.categoryId));
  }

  const event = await resolveEvent(eventId);
  if (!event) throw errors.notFound();
  if (event.status !== 'active' && event.status !== 'scheduled') throw errors.eventNotActive();
  const membership = await getMembership(eventId, userId);
  if (!membership) throw errors.forbidden();

  const cats = await effectiveEventCategories(eventId);
  const effective = cats.find((c) => c.category.id === input.categoryId);
  if (!effective) throw errors.prohibitedCategory();
  const { category, maxOfferQty } = effective;

  const allowedUnits: string[] = [category.unit, ...(category.altUnits ?? [])];
  if (!allowedUnits.includes(input.unit)) {
    throw errors.validation({ field: 'unit', allowed: allowedUnits });
  }
  if (input.qty > maxOfferQty) {
    throw errors.validation({ field: 'qty', max: maxOfferQty });
  }

  return db.transaction(async (tx) => {
    const [{ activeCount }] = (await tx
      .select({ activeCount: sql<number>`count(*)::int` })
      .from(schema.inventoryItems)
      .where(
        and(
          eq(schema.inventoryItems.userId, userId),
          eq(schema.inventoryItems.eventId, eventId),
          eq(schema.inventoryItems.active, true),
        ),
      )) as [{ activeCount: number }];
    if (activeCount >= LIMITS.maxInventoryItemsPerEvent) {
      throw errors.validation({ field: 'items', max: LIMITS.maxInventoryItemsPerEvent });
    }

    try {
      const [created] = await tx
        .insert(schema.inventoryItems)
        .values({
          userId,
          eventId,
          categoryId: input.categoryId,
          qtyOnHand: String(input.qty),
          unit: input.unit,
          details: input.details,
          expiresAt: new Date(event.endsAt.getTime() + 24 * 3600_000),
          idempotencyKey: input.idempotencyKey ?? null,
        })
        .returning();
      return toView(created!, category.slug);
    } catch (err) {
      // Idempotency-key unique race: another request with the same key won.
      if ((err as { code?: string }).code === '23505' && input.idempotencyKey) {
        const [existing] = await tx
          .select()
          .from(schema.inventoryItems)
          .where(
            and(
              eq(schema.inventoryItems.userId, userId),
              eq(schema.inventoryItems.idempotencyKey, input.idempotencyKey),
            ),
          )
          .limit(1);
        if (existing) return toView(existing, await slugFor(tx, existing.categoryId));
      }
      throw err;
    }
  });
}

export async function updateInventory(
  userId: string,
  itemId: string,
  input: UpdateInventoryInput,
): Promise<InventoryItem> {
  const db = getDb();
  return db.transaction(async (tx) => {
    const [item] = await tx
      .select()
      .from(schema.inventoryItems)
      .where(and(eq(schema.inventoryItems.id, itemId), eq(schema.inventoryItems.userId, userId)))
      .limit(1)
      .for('update');
    if (!item) throw errors.notFound();

    const set: Partial<typeof schema.inventoryItems.$inferInsert> = { updatedAt: new Date() };
    if (input.qtyTotal !== undefined) {
      if (input.qtyTotal < Number(item.qtyReserved)) throw errors.insufficientInventory();
      set.qtyOnHand = String(input.qtyTotal);
    }
    if (input.details !== undefined) set.details = input.details;
    if (input.active !== undefined) set.active = input.active;

    const [updated] = await tx
      .update(schema.inventoryItems)
      .set(set)
      .where(eq(schema.inventoryItems.id, itemId))
      .returning();
    return toView(updated!, await slugFor(tx, updated!.categoryId));
  });
}

export async function deleteInventory(userId: string, itemId: string): Promise<void> {
  const db = getDb();
  await db.transaction(async (tx) => {
    const [item] = await tx
      .select()
      .from(schema.inventoryItems)
      .where(and(eq(schema.inventoryItems.id, itemId), eq(schema.inventoryItems.userId, userId)))
      .limit(1)
      .for('update');
    if (!item) throw errors.notFound();

    const [offer] = await tx
      .select({ id: schema.matchOffers.id })
      .from(schema.matchOffers)
      .where(eq(schema.matchOffers.inventoryItemId, itemId))
      .limit(1);
    const [match] = await tx
      .select({ id: schema.matches.id })
      .from(schema.matches)
      .where(eq(schema.matches.inventoryItemId, itemId))
      .limit(1);

    if (offer || match) {
      // History references the row — keep it, just deactivate.
      await tx
        .update(schema.inventoryItems)
        .set({ active: false, updatedAt: new Date() })
        .where(eq(schema.inventoryItems.id, itemId));
    } else {
      await tx.delete(schema.inventoryItems).where(eq(schema.inventoryItems.id, itemId));
    }
  });
}
