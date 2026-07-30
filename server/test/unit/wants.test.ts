import '../env.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { asc, eq } from 'drizzle-orm';
import { closeDb, getDb, schema } from '../../src/db/index.js';
import { setupTestDb, truncateAll, makeEvent, makeUser, categoryBySlug } from '../helpers.js';
import { computePublicWants, setAdminWants } from '../../src/modules/events/wants.js';
import { effectiveEventCategories } from '../../src/modules/events/service.js';

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

    await setAdminWants(event.id, [{ categorySlug: blanket.slug, qty: null }]);

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
      const existing = await getAdminWantSlugs(event.id);
      await setAdminWants(event.id, [
        ...existing.map((existingSlug) => ({ categorySlug: existingSlug, qty: null })),
        { categorySlug: c.slug, qty: null },
      ]);
    }
    const result = await computePublicWants([event.id]);
    expect(result.get(event.id)!.length).toBeGreaterThanOrEqual(5);
  });

  it('deduplicates a category that is both admin-declared and has real demand', async () => {
    const creator = await makeUser();
    const event = await makeEvent(creator.id);
    const water = await categoryBySlug('water-bottle');
    await setAdminWants(event.id, [{ categorySlug: water.slug, qty: null }]);

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
  it('lives in a table separate from event_categories, so it never disturbs event_categories fields', async () => {
    const creator = await makeUser();
    const event = await makeEvent(creator.id);
    const water = await categoryBySlug('water-bottle');
    const blanket = await categoryBySlug('blanket');
    const db = getDb();

    // Pre-existing event_categories row with custom fields, entirely unrelated
    // to admin wants (which now live in event_admin_wants).
    await db.insert(schema.eventCategories).values({
      eventId: event.id,
      categoryId: water.id,
      enabled: true,
      maxRequestQty: '7',
      maxOfferQty: '42',
    });

    await setAdminWants(event.id, [{ categorySlug: water.slug, qty: null }]);
    let ecRows = await db
      .select()
      .from(schema.eventCategories)
      .where(eq(schema.eventCategories.eventId, event.id));
    let waterRow = ecRows.find((r) => r.categoryId === water.id)!;
    expect(waterRow.maxRequestQty).toBe('7');
    expect(waterRow.maxOfferQty).toBe('42');
    expect(waterRow.enabled).toBe(true);
    expect(await getAdminWantSlugs(event.id)).toEqual([water.slug]);

    await setAdminWants(event.id, [{ categorySlug: blanket.slug, qty: null }]);
    ecRows = await db.select().from(schema.eventCategories).where(eq(schema.eventCategories.eventId, event.id));
    waterRow = ecRows.find((r) => r.categoryId === water.id)!;
    expect(waterRow.maxRequestQty).toBe('7');
    expect(waterRow.maxOfferQty).toBe('42');
    expect(await getAdminWantSlugs(event.id)).toEqual([blanket.slug]);
  });

  it('regression: declaring an admin want must NOT switch the event into category-override mode', async () => {
    // The original bug: setAdminWants inserted rows into event_categories,
    // and effectiveEventCategories treats ANY row there as an override list —
    // silently blocking every other category. Admin wants must be tracked in
    // a table decoupled from that override semantics.
    const creator = await makeUser();
    const event = await makeEvent(creator.id); // no event_categories rows — all active globals allowed
    const before = await effectiveEventCategories(event.id);
    expect(before.length).toBeGreaterThan(1); // sanity: several active global categories

    const blanket = await categoryBySlug('blanket');
    await setAdminWants(event.id, [{ categorySlug: blanket.slug, qty: null }]);

    const after = await effectiveEventCategories(event.id);
    expect(after.length).toBe(before.length); // still ALL active globals, not just the declared want
  });

  it('stores a declared quantity and surfaces it as requestedQty on the public want', async () => {
    const creator = await makeUser();
    const event = await makeEvent(creator.id);
    const torch = await categoryBySlug('torch');
    const blanket = await categoryBySlug('blanket');

    await setAdminWants(event.id, [
      { categorySlug: torch.slug, qty: 5 },
      { categorySlug: blanket.slug, qty: null }, // needed, amount unspecified
    ]);

    const wants = (await computePublicWants([event.id])).get(event.id)!;
    const torchWant = wants.find((w) => w.categorySlug === torch.slug)!;
    const blanketWant = wants.find((w) => w.categorySlug === blanket.slug)!;

    expect(torchWant).toMatchObject({ source: 'admin', requestedQty: 5 });
    expect(blanketWant).toMatchObject({ source: 'admin', requestedQty: null });
    // requesterCount stays null for admin wants either way: a declared target
    // is not a count of people who asked.
    expect(torchWant.requesterCount).toBeNull();
  });

  it('overwrites a previously declared quantity, including back to unspecified', async () => {
    const creator = await makeUser();
    const event = await makeEvent(creator.id);
    const torch = await categoryBySlug('torch');

    await setAdminWants(event.id, [{ categorySlug: torch.slug, qty: 12 }]);
    await setAdminWants(event.id, [{ categorySlug: torch.slug, qty: 40 }]);
    let wants = (await computePublicWants([event.id])).get(event.id)!;
    expect(wants.find((w) => w.categorySlug === torch.slug)!.requestedQty).toBe(40);

    await setAdminWants(event.id, [{ categorySlug: torch.slug, qty: null }]);
    wants = (await computePublicWants([event.id])).get(event.id)!;
    expect(wants.find((w) => w.categorySlug === torch.slug)!.requestedQty).toBeNull();
  });

  it('takes the last quantity when the same category is sent twice', async () => {
    // Guards the primary key on (event_id, category_id): a duplicated slug in
    // one payload must not make the insert fail.
    const creator = await makeUser();
    const event = await makeEvent(creator.id);
    const torch = await categoryBySlug('torch');

    await setAdminWants(event.id, [
      { categorySlug: torch.slug, qty: 3 },
      { categorySlug: torch.slug, qty: 9 },
    ]);

    const wants = (await computePublicWants([event.id])).get(event.id)!;
    expect(wants.filter((w) => w.categorySlug === torch.slug)).toHaveLength(1);
    expect(wants[0]!.requestedQty).toBe(9);
  });

  it('rejects an unknown category slug without writing anything', async () => {
    const creator = await makeUser();
    const event = await makeEvent(creator.id);
    const torch = await categoryBySlug('torch');
    await setAdminWants(event.id, [{ categorySlug: torch.slug, qty: 5 }]);

    await expect(
      setAdminWants(event.id, [{ categorySlug: 'not-a-real-category', qty: 1 }]),
    ).rejects.toMatchObject({ code: 'validation' });

    // The transaction rolled back, so the earlier declaration survives.
    expect(await getAdminWantSlugs(event.id)).toEqual([torch.slug]);
  });

  it('throws not-found for a nonexistent event, before touching any table', async () => {
    await expect(setAdminWants('00000000-0000-0000-0000-000000000000', [])).rejects.toMatchObject({
      code: 'not_found',
    });
  });
});

async function getAdminWantSlugs(eventId: string): Promise<string[]> {
  const db = getDb();
  const rows = await db
    .select({ slug: schema.categories.slug })
    .from(schema.eventAdminWants)
    .innerJoin(schema.categories, eq(schema.categories.id, schema.eventAdminWants.categoryId))
    .where(eq(schema.eventAdminWants.eventId, eventId))
    .orderBy(asc(schema.categories.sortOrder));
  return rows.map((r) => r.slug);
}
