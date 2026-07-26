/**
 * zOfferView mapping. qtyRequested is the OFFER quantity (what the helper is
 * being asked to give = min(remaining need, their available)), and qtyYouHave
 * is their live availability (on_hand − reserved). The requester note is
 * already redacted at storage time.
 */
import { eq } from 'drizzle-orm';
import type { OfferView } from '@sahay/shared';
import { getDb, schema } from '../../db/index.js';

export type OfferRow = typeof schema.matchOffers.$inferSelect;

export interface OfferViewSource {
  offer: OfferRow;
  request: Pick<
    typeof schema.requests.$inferSelect,
    'id' | 'eventId' | 'unit' | 'urgency' | 'note'
  >;
  categorySlug: string;
  qtyOnHand: string | number;
  qtyReserved: string | number;
}

export function toOfferView(src: OfferViewSource): OfferView {
  return {
    id: src.offer.id,
    requestId: src.offer.requestId,
    eventId: src.request.eventId,
    categorySlug: src.categorySlug,
    qtyRequested: Number(src.offer.qty),
    qtyYouHave: Number(src.qtyOnHand) - Number(src.qtyReserved),
    unit: src.request.unit as OfferView['unit'],
    urgency: src.request.urgency as OfferView['urgency'],
    proximity: src.offer.proximity as OfferView['proximity'],
    note: src.request.note,
    respondBy: src.offer.respondBy.toISOString(),
    status: src.offer.status as OfferView['status'],
  };
}

export async function loadOfferView(offerId: string): Promise<OfferView | null> {
  const db = getDb();
  const [row] = await db
    .select({
      offer: schema.matchOffers,
      request: schema.requests,
      categorySlug: schema.categories.slug,
      qtyOnHand: schema.inventoryItems.qtyOnHand,
      qtyReserved: schema.inventoryItems.qtyReserved,
    })
    .from(schema.matchOffers)
    .innerJoin(schema.requests, eq(schema.matchOffers.requestId, schema.requests.id))
    .innerJoin(schema.categories, eq(schema.requests.categoryId, schema.categories.id))
    .innerJoin(schema.inventoryItems, eq(schema.matchOffers.inventoryItemId, schema.inventoryItems.id))
    .where(eq(schema.matchOffers.id, offerId))
    .limit(1);
  return row ? toOfferView(row) : null;
}
