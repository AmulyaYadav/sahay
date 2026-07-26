/**
 * Shared fixtures for the matching/offer/match/chat integration tests.
 * Workers are never started: tests drive the engine deterministically by
 * calling runMatchPass / expireOffer / finalizeMatch directly.
 */
import { randomBytes } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import {
  addInventoryDirect,
  categoryBySlug,
  getDb,
  joinEventDirect,
  makeAuthedUser,
  makeEvent,
  makeUser,
  schema,
  setAvailabilityOn,
  setLocation,
} from '../helpers.js';

/** Event center used by makeEvent; ~111 m per 0.001 latitude step. */
export const BASE_LAT = 18.52;
export const BASE_LNG = 73.856;

export interface Scenario {
  event: Awaited<ReturnType<typeof makeEvent>>;
  water: Awaited<ReturnType<typeof categoryBySlug>>;
  requester: Awaited<ReturnType<typeof makeAuthedUser>>;
  helper: Awaited<ReturnType<typeof makeAuthedUser>>;
  item: Awaited<ReturnType<typeof addInventoryDirect>>;
}

/**
 * One active event with a requester (at the center, with a live location) and
 * one available helper ~111 m away carrying `helperQty` water bottles.
 */
export async function matchScenario(
  opts: { helperQty?: number; helperLatOffset?: number | null } = {},
): Promise<Scenario> {
  const creator = await makeUser();
  const event = await makeEvent(creator.id);
  const water = await categoryBySlug('water-bottle');
  const requester = await makeAuthedUser();
  await joinEventDirect(requester.user.id, event.id);
  await setLocation(requester.user.id, event.id, BASE_LAT, BASE_LNG);
  const { helper, item } = await addHelper(event.id, water.id, {
    qty: opts.helperQty ?? 4,
    // null = helper has no live location (undefined falls back to ~111 m).
    latOffset: opts.helperLatOffset === undefined ? 0.001 : opts.helperLatOffset,
  });
  return { event, water, requester, helper, item };
}

/** Additional available helper with stock, offset north of the requester. */
export async function addHelper(
  eventId: string,
  categoryId: string,
  opts: { qty?: number; latOffset?: number | null } = {},
) {
  const helper = await makeAuthedUser();
  await joinEventDirect(helper.user.id, eventId);
  await setAvailabilityOn(helper.user.id, eventId);
  const item = await addInventoryDirect(helper.user.id, eventId, categoryId, opts.qty ?? 4, 'bottle');
  if (opts.latOffset !== null) {
    await setLocation(helper.user.id, eventId, BASE_LAT + (opts.latOffset ?? 0.001), BASE_LNG);
  }
  return { helper, item };
}

export function idemKey(prefix = 'key'): string {
  return `${prefix}-${randomBytes(8).toString('hex')}`;
}

/** POST /requests and return the parsed zRequestView (asserting 200). */
export async function createRequestVia(
  app: FastifyInstance,
  headers: Record<string, string>,
  input: {
    eventId: string;
    categoryId: string;
    qty?: number;
    coords?: { lat: number; lng: number } | null;
    expiresInMinutes?: number;
  },
) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/requests',
    headers,
    payload: {
      eventId: input.eventId,
      categoryId: input.categoryId,
      qty: input.qty ?? 1,
      unit: 'bottle',
      expiresInMinutes: input.expiresInMinutes ?? 15,
      ...(input.coords === null ? {} : { coords: input.coords ?? { lat: BASE_LAT, lng: BASE_LNG } }),
      safetyAcknowledged: true,
      idempotencyKey: idemKey('req'),
    },
  });
  if (res.statusCode !== 200) {
    throw new Error(`createRequest failed: ${res.statusCode} ${res.body}`);
  }
  return res.json();
}

export async function latestOffer(requestId: string) {
  const [offer] = await getDb()
    .select()
    .from(schema.matchOffers)
    .where(eq(schema.matchOffers.requestId, requestId))
    .orderBy(desc(schema.matchOffers.offeredAt))
    .limit(1);
  return offer ?? null;
}

export async function requestRow(requestId: string) {
  const [row] = await getDb()
    .select()
    .from(schema.requests)
    .where(eq(schema.requests.id, requestId))
    .limit(1);
  return row!;
}

export async function itemRow(itemId: string) {
  const [row] = await getDb()
    .select()
    .from(schema.inventoryItems)
    .where(eq(schema.inventoryItems.id, itemId))
    .limit(1);
  return row!;
}

export async function matchRowByRequest(requestId: string) {
  const [row] = await getDb()
    .select()
    .from(schema.matches)
    .where(eq(schema.matches.requestId, requestId))
    .orderBy(desc(schema.matches.createdAt))
    .limit(1);
  return row ?? null;
}

export async function conversationForMatch(matchId: string) {
  const [row] = await getDb()
    .select()
    .from(schema.conversations)
    .where(eq(schema.conversations.matchId, matchId))
    .limit(1);
  return row!;
}

export async function statsFor(userId: string) {
  const [row] = await getDb()
    .select()
    .from(schema.reliabilityStats)
    .where(eq(schema.reliabilityStats.userId, userId))
    .limit(1);
  return row ?? null;
}

/** Accept/decline an offer over HTTP; returns the raw response. */
export async function respond(
  app: FastifyInstance,
  headers: Record<string, string>,
  offerId: string,
  accept: boolean,
  alsoStopReceiving = false,
) {
  return app.inject({
    method: 'POST',
    url: `/api/v1/offers/${offerId}/respond`,
    headers,
    payload: { accept, alsoStopReceiving },
  });
}

/** Fabricate an active match for a helper (to exercise the per-helper cap). */
export async function fabricateActiveMatch(helperId: string, eventId: string, categoryId: string) {
  const db = getDb();
  const requester = await makeUser();
  await joinEventDirect(requester.id, eventId);
  const item = await addInventoryDirect(helperId, eventId, categoryId, 1, 'bottle');
  const [request] = await db
    .insert(schema.requests)
    .values({
      eventId,
      requesterId: requester.id,
      categoryId,
      qty: '1',
      unit: 'bottle',
      status: 'matched',
      expiresAt: new Date(Date.now() + 900_000),
      idempotencyKey: idemKey('fab'),
    })
    .returning();
  const [offer] = await db
    .insert(schema.matchOffers)
    .values({
      requestId: request!.id,
      helperId,
      inventoryItemId: item.id,
      qty: '1',
      status: 'accepted',
      respondBy: new Date(Date.now() + 45_000),
      respondedAt: new Date(),
    })
    .returning();
  const [match] = await db
    .insert(schema.matches)
    .values({
      requestId: request!.id,
      offerId: offer!.id,
      eventId,
      requesterId: requester.id,
      helperId,
      inventoryItemId: item.id,
      qtyReserved: '1',
      status: 'active',
      requesterAlias: 'Amber Kite',
      helperAlias: 'Teal Reed',
    })
    .returning();
  await db.insert(schema.conversations).values({ matchId: match!.id, status: 'open' });
  return match!;
}

export { and, eq };
