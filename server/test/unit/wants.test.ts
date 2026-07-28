import '../env.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { closeDb, getDb, schema } from '../../src/db/index.js';
import { setupTestDb, truncateAll, makeEvent, makeUser, categoryBySlug } from '../helpers.js';
import { computePublicWants, setAdminWants } from '../../src/modules/events/wants.js';

beforeAll(async () => {
  await setupTestDb();
});
afterAll(async () => {
  await closeDb();
});
beforeEach(async () => {
  await truncateAll();
});

describe('computePublicWants', () => {
  it('returns admin-declared wants first, then real demand, with no k-anonymity floor', async () => {
    const creator = await makeUser();
    const event = await makeEvent(creator.id);
    const water = await categoryBySlug('water-bottle');
    const blanket = await categoryBySlug('blanket');

    await setAdminWants(event.id, [blanket.slug]);

    // A single open request for water — must show up despite only 1 requester.
    const db = getDb();
    const requester = await makeUser();
    await db.insert(schema.requests).values({
      eventId: event.id,
      requesterId: requester.id,
      categoryId: water.id,
      qty: '3',
      qtyFulfilled: '0',
      unit: water.unit,
      status: 'searching',
      expiresAt: new Date(Date.now() + 900_000),
      idempotencyKey: 'wants-test-water-1',
    });

    const result = await computePublicWants([event.id]);
    const wants = result.get(event.id)!;
    expect(wants[0]).toMatchObject({ categorySlug: blanket.slug, source: 'admin' });
    expect(wants.some((w) => w.categorySlug === water.slug && w.source === 'user' && w.requesterCount === 1)).toBe(
      true,
    );
  });

  it('caps nothing — returns the full merged list (callers cap for list views)', async () => {
    const creator = await makeUser();
    const event = await makeEvent(creator.id);
    const cats = ['water-bottle', 'blanket', 'sanitary-pads', 'diapers', 'bandages'];
    for (const slug of cats) {
      const c = await categoryBySlug(slug);
      await setAdminWants(event.id, [...(await getAdminWantSlugs(event.id)), c.slug]);
    }
    const result = await computePublicWants([event.id]);
    expect(result.get(event.id)!.length).toBeGreaterThanOrEqual(5);
  });

  it('deduplicates a category that is both admin-declared and has real demand', async () => {
    const creator = await makeUser();
    const event = await makeEvent(creator.id);
    const water = await categoryBySlug('water-bottle');
    await setAdminWants(event.id, [water.slug]);

    const requester = await makeUser();
    await getDb().insert(schema.requests).values({
      eventId: event.id,
      requesterId: requester.id,
      categoryId: water.id,
      qty: '5',
      qtyFulfilled: '0',
      unit: water.unit,
      status: 'searching',
      expiresAt: new Date(Date.now() + 900_000),
      idempotencyKey: 'wants-test-water-dedupe',
    });

    const result = await computePublicWants([event.id]);
    const wants = result.get(event.id)!;
    const waterEntries = wants.filter((w) => w.categorySlug === water.slug);
    expect(waterEntries).toHaveLength(1);
    expect(waterEntries[0]).toMatchObject({ source: 'admin' });
  });
});

describe('setAdminWants', () => {
  it('clears previous admin_want flags not in the new list without disturbing other fields', async () => {
    const creator = await makeUser();
    const event = await makeEvent(creator.id);
    const water = await categoryBySlug('water-bottle');
    const blanket = await categoryBySlug('blanket');
    const db = getDb();

    // Pre-existing event_categories row with custom fields, unrelated to admin_want.
    await db.insert(schema.eventCategories).values({
      eventId: event.id,
      categoryId: water.id,
      enabled: true,
      maxRequestQty: '7',
      maxOfferQty: '42',
      adminWant: false,
    });

    await setAdminWants(event.id, [water.slug]);
    let rows = await db
      .select()
      .from(schema.eventCategories)
      .where(eq(schema.eventCategories.eventId, event.id));
    let waterRow = rows.find((r) => r.categoryId === water.id)!;
    expect(waterRow.adminWant).toBe(true);
    expect(waterRow.maxRequestQty).toBe('7');
    expect(waterRow.maxOfferQty).toBe('42');
    expect(waterRow.enabled).toBe(true);

    await setAdminWants(event.id, [blanket.slug]);
    rows = await db.select().from(schema.eventCategories).where(eq(schema.eventCategories.eventId, event.id));
    waterRow = rows.find((r) => r.categoryId === water.id)!;
    const blanketRow = rows.find((r) => r.categoryId === blanket.id)!;
    expect(waterRow.adminWant).toBe(false);
    expect(waterRow.maxRequestQty).toBe('7');
    expect(waterRow.maxOfferQty).toBe('42');
    expect(blanketRow.adminWant).toBe(true);
  });
});

async function getAdminWantSlugs(eventId: string): Promise<string[]> {
  const db = getDb();
  const rows = await db
    .select({ slug: schema.categories.slug })
    .from(schema.eventCategories)
    .innerJoin(schema.categories, eq(schema.categories.id, schema.eventCategories.categoryId))
    .where(eq(schema.eventCategories.eventId, eventId));
  return rows.filter((r, i, arr) => arr.findIndex((x) => x.slug === r.slug) === i).map((r) => r.slug);
}
