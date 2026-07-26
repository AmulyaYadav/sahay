/**
 * Idempotent catalogue seed: upserts DEFAULT_CATALOGUE by slug. Safe to run any
 * number of times; admin-added categories are untouched, seed-managed fields of
 * default categories are refreshed. sort_order = position in the seed array.
 */
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { DEFAULT_CATALOGUE } from '@sahay/shared';
import { loadConfig } from '../config.js';
import { getDb, schema, closeDb } from './index.js';
import { runMigrations } from './migrate.js';

export async function seedCatalogue(): Promise<void> {
  const db = getDb();
  for (const [index, seed] of DEFAULT_CATALOGUE.entries()) {
    const values = {
      slug: seed.slug,
      group: seed.group,
      name: seed.name,
      icon: seed.icon,
      unit: seed.unit,
      altUnits: seed.altUnits ?? [],
      fractional: seed.fractional ?? false,
      sealedRequired: seed.sealedRequired ?? false,
      expiryRelevant: seed.expiryRelevant ?? false,
      restricted: seed.restricted ?? false,
      warningKey: seed.warningKey ?? null,
      maxRequestQty: String(seed.maxRequestQty),
      maxOfferQty: String(seed.maxOfferQty),
      sortOrder: index,
    };
    await db
      .insert(schema.categories)
      .values(values)
      .onConflictDoUpdate({ target: schema.categories.slug, set: values });
  }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const config = loadConfig();
  await runMigrations(config.DATABASE_URL);
  await seedCatalogue();
  console.log(`seeded ${DEFAULT_CATALOGUE.length} catalogue categories`);
  await closeDb();
}
