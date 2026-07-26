import '../env.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { DEFAULT_CATALOGUE } from '@sahay/shared';
import { buildApp } from '../../src/app.js';
import { closeDb, getDb, schema } from '../../src/db/index.js';
import { seedCatalogue } from '../../src/db/seed.js';
import { closeRedis } from '../../src/lib/redis.js';
import { closeQueues } from '../../src/queues.js';
import { setupTestDb } from '../helpers.js';

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

describe('catalogue seed + GET /catalogue', () => {
  it('seeds idempotently', async () => {
    await seedCatalogue();
    await seedCatalogue();
    const rows = await getDb().select().from(schema.categories);
    expect(rows).toHaveLength(DEFAULT_CATALOGUE.length);
  });

  it('returns active categories with proper numeric types (public)', async () => {
    const res = await app.inject({ url: '/api/v1/catalogue' });
    expect(res.statusCode).toBe(200);
    const { categories } = res.json();
    expect(categories).toHaveLength(DEFAULT_CATALOGUE.length);

    const water = categories.find((c: { slug: string }) => c.slug === 'water-bottle');
    expect(water).toBeDefined();
    expect(typeof water.maxRequestQty).toBe('number'); // pg numeric → Number()
    expect(water.maxRequestQty).toBe(6);
    expect(water.maxOfferQty).toBe(100);
    expect(water.unit).toBe('bottle');
    expect(water.altUnits).toEqual(['litre']);
    expect(water.sealedRequired).toBe(true);
    expect(water.name.en).toBe('Sealed water bottle');
    expect(water.name.hi).toBeTruthy();
    expect(water.sortOrder).toBe(0); // seed array position

    // Sorted by sortOrder.
    const orders = categories.map((c: { sortOrder: number }) => c.sortOrder);
    expect(orders).toEqual([...orders].sort((a, b) => a - b));
  });
});
