import '../env.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq, sql } from 'drizzle-orm';
import { buildApp } from '../../src/app.js';
import { closeDb } from '../../src/db/index.js';
import { closeRedis } from '../../src/lib/redis.js';
import { closeQueues } from '../../src/queues.js';
import {
  categoryBySlug,
  getDb,
  joinEventDirect,
  makeAuthedUser,
  makeEvent,
  makeUser,
  schema,
  setupTestDb,
  truncateAll,
} from '../helpers.js';

let app: FastifyInstance;

beforeAll(async () => {
  await setupTestDb();
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  if (app) await app.close();
  await closeQueues();
  await closeRedis();
  await closeDb();
});

beforeEach(async () => {
  await truncateAll();
});

async function memberSetup() {
  const creator = await makeUser();
  const event = await makeEvent(creator.id);
  const { user, headers } = await makeAuthedUser();
  await joinEventDirect(user.id, event.id);
  const water = await categoryBySlug('water-bottle');
  return { creator, event, user, headers, water };
}

describe('POST /events/:id/inventory', () => {
  it('adds an item for a member and computes availability', async () => {
    const { event, headers, water } = await memberSetup();
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/events/${event.id}/inventory`,
      headers,
      payload: { categoryId: water.id, qty: 10, unit: 'bottle', details: { sealed: true } },
    });
    expect(res.statusCode).toBe(200);
    const item = res.json();
    expect(item.categorySlug).toBe('water-bottle');
    expect(item.qtyTotal).toBe(10);
    expect(item.qtyAvailable).toBe(10);
    expect(item.qtyReserved).toBe(0);
    expect(item.active).toBe(true);

    const list = await app.inject({ url: `/api/v1/events/${event.id}/inventory`, headers });
    expect(list.json().items).toHaveLength(1);
  });

  it('rejects non-members', async () => {
    const creator = await makeUser();
    const event = await makeEvent(creator.id);
    const { headers } = await makeAuthedUser();
    const water = await categoryBySlug('water-bottle');
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/events/${event.id}/inventory`,
      headers,
      payload: { categoryId: water.id, qty: 5, unit: 'bottle' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('is idempotent by key', async () => {
    const { event, headers, water } = await memberSetup();
    const payload = { categoryId: water.id, qty: 5, unit: 'bottle', idempotencyKey: 'inv-key-0001' };
    const first = await app.inject({ method: 'POST', url: `/api/v1/events/${event.id}/inventory`, headers, payload });
    const second = await app.inject({ method: 'POST', url: `/api/v1/events/${event.id}/inventory`, headers, payload });
    expect(second.statusCode).toBe(200);
    expect(second.json().id).toBe(first.json().id);
    const rows = await getDb().select().from(schema.inventoryItems);
    expect(rows).toHaveLength(1);
  });

  it('validates unit against the category unit + altUnits', async () => {
    const { event, headers, water } = await memberSetup();
    const litre = await app.inject({
      method: 'POST',
      url: `/api/v1/events/${event.id}/inventory`,
      headers,
      payload: { categoryId: water.id, qty: 5, unit: 'litre' }, // altUnit — ok
    });
    expect(litre.statusCode).toBe(200);
    const meal = await app.inject({
      method: 'POST',
      url: `/api/v1/events/${event.id}/inventory`,
      headers,
      payload: { categoryId: water.id, qty: 5, unit: 'meal' },
    });
    expect(meal.statusCode).toBe(400);
  });

  it('clamps qty at the category maxOfferQty (event override wins)', async () => {
    const { event, headers, water } = await memberSetup();
    const tooMany = await app.inject({
      method: 'POST',
      url: `/api/v1/events/${event.id}/inventory`,
      headers,
      payload: { categoryId: water.id, qty: 101, unit: 'bottle' }, // global max 100
    });
    expect(tooMany.statusCode).toBe(400);

    // Event override lowers the ceiling to 10.
    await getDb()
      .insert(schema.eventCategories)
      .values({ eventId: event.id, categoryId: water.id, maxOfferQty: '10' });
    const overLimit = await app.inject({
      method: 'POST',
      url: `/api/v1/events/${event.id}/inventory`,
      headers,
      payload: { categoryId: water.id, qty: 11, unit: 'bottle' },
    });
    expect(overLimit.statusCode).toBe(400);
    const ok = await app.inject({
      method: 'POST',
      url: `/api/v1/events/${event.id}/inventory`,
      headers,
      payload: { categoryId: water.id, qty: 10, unit: 'bottle' },
    });
    expect(ok.statusCode).toBe(200);
  });

  it('rejects categories not enabled for the event and inactive events', async () => {
    const { event, headers, water } = await memberSetup();
    const blanket = await categoryBySlug('blanket');
    // Restrict the event to water only.
    await getDb().insert(schema.eventCategories).values({ eventId: event.id, categoryId: water.id });
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/events/${event.id}/inventory`,
      headers,
      payload: { categoryId: blanket.id, qty: 1, unit: 'blanket' },
    });
    expect(res.statusCode).toBe(422);

    const creator = await makeUser();
    const ended = await makeEvent(creator.id, { status: 'completed' });
    const { user: u2, headers: h2 } = await makeAuthedUser();
    await joinEventDirect(u2.id, ended.id);
    const inactive = await app.inject({
      method: 'POST',
      url: `/api/v1/events/${ended.id}/inventory`,
      headers: h2,
      payload: { categoryId: water.id, qty: 1, unit: 'bottle' },
    });
    expect(inactive.statusCode).toBe(409);
    expect(inactive.json().error.code).toBe('event_not_active');
  });

  it('enforces the 30 active items per user per event limit', async () => {
    const { event, user, headers, water } = await memberSetup();
    const db = getDb();
    await db.insert(schema.inventoryItems).values(
      Array.from({ length: 30 }, () => ({
        userId: user.id,
        eventId: event.id,
        categoryId: water.id,
        qtyOnHand: '1',
        unit: 'bottle' as const,
      })),
    );
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/events/${event.id}/inventory`,
      headers,
      payload: { categoryId: water.id, qty: 1, unit: 'bottle' },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('PATCH /inventory/:itemId', () => {
  it('edits quantity but never below the reserved amount', async () => {
    const { event, headers, water } = await memberSetup();
    const created = (
      await app.inject({
        method: 'POST',
        url: `/api/v1/events/${event.id}/inventory`,
        headers,
        payload: { categoryId: water.id, qty: 10, unit: 'bottle' },
      })
    ).json();

    await getDb().execute(sql`UPDATE inventory_items SET qty_reserved = 5 WHERE id = ${created.id}`);

    const tooLow = await app.inject({
      method: 'PATCH',
      url: `/api/v1/inventory/${created.id}`,
      headers,
      payload: { qtyTotal: 3 },
    });
    expect(tooLow.statusCode).toBe(409);
    expect(tooLow.json().error.code).toBe('insufficient_inventory');

    const ok = await app.inject({
      method: 'PATCH',
      url: `/api/v1/inventory/${created.id}`,
      headers,
      payload: { qtyTotal: 8, details: { sealed: true }, active: true },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().qtyTotal).toBe(8);
    expect(ok.json().qtyReserved).toBe(5);
    expect(ok.json().qtyAvailable).toBe(3);
    expect(ok.json().details.sealed).toBe(true);
  });

  it('is owner-only', async () => {
    const { event, headers, water } = await memberSetup();
    const created = (
      await app.inject({
        method: 'POST',
        url: `/api/v1/events/${event.id}/inventory`,
        headers,
        payload: { categoryId: water.id, qty: 10, unit: 'bottle' },
      })
    ).json();
    const { headers: strangerHeaders } = await makeAuthedUser();
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/inventory/${created.id}`,
      headers: strangerHeaders,
      payload: { qtyTotal: 1 },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('DELETE /inventory/:itemId', () => {
  it('hard-deletes never-matched items, soft-deletes referenced ones', async () => {
    const { event, user, headers, water } = await memberSetup();
    const db = getDb();
    const fresh = (
      await app.inject({
        method: 'POST',
        url: `/api/v1/events/${event.id}/inventory`,
        headers,
        payload: { categoryId: water.id, qty: 3, unit: 'bottle' },
      })
    ).json();
    const referenced = (
      await app.inject({
        method: 'POST',
        url: `/api/v1/events/${event.id}/inventory`,
        headers,
        payload: { categoryId: water.id, qty: 3, unit: 'bottle' },
      })
    ).json();

    // Reference the second item from an offer.
    const requester = await makeUser();
    const [request] = await db
      .insert(schema.requests)
      .values({
        eventId: event.id,
        requesterId: requester.id,
        categoryId: water.id,
        qty: '2',
        unit: 'bottle',
        expiresAt: new Date(Date.now() + 900_000),
        idempotencyKey: 'del-key-1',
      })
      .returning();
    await db.insert(schema.matchOffers).values({
      requestId: request!.id,
      helperId: user.id,
      inventoryItemId: referenced.id,
      qty: '2',
      respondBy: new Date(Date.now() + 45_000),
    });

    expect(
      (await app.inject({ method: 'DELETE', url: `/api/v1/inventory/${fresh.id}`, headers })).statusCode,
    ).toBe(200);
    expect(
      (await app.inject({ method: 'DELETE', url: `/api/v1/inventory/${referenced.id}`, headers }))
        .statusCode,
    ).toBe(200);

    const freshRows = await db.select().from(schema.inventoryItems).where(eq(schema.inventoryItems.id, fresh.id));
    expect(freshRows).toHaveLength(0); // gone
    const refRows = await db
      .select()
      .from(schema.inventoryItems)
      .where(eq(schema.inventoryItems.id, referenced.id));
    expect(refRows).toHaveLength(1); // kept
    expect(refRows[0]!.active).toBe(false); // but inactive
  });
});
