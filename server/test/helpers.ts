/**
 * Integration test helpers: real postgres (docker postgres_test on :5433) and
 * redis (db 15). Tables are truncated between tests; categories and feature
 * flags survive (categories are reseeded once, flags come from the migration).
 */
import './env.js';
import { randomBytes } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { loadConfig } from '../src/config.js';
import { getDb, schema, type Db } from '../src/db/index.js';
import { runMigrations } from '../src/db/migrate.js';
import { seedCatalogue } from '../src/db/seed.js';
import { newSessionToken, phoneBlindIndex, shortCode } from '../src/lib/crypto.js';
import { getRedis } from '../src/lib/redis.js';

let migrated = false;

export async function setupTestDb(): Promise<Db> {
  if (!migrated) {
    await runMigrations(loadConfig().DATABASE_URL, () => {});
    await seedCatalogue();
    migrated = true;
  }
  return getDb();
}

/** Everything except _migrations, categories, feature_flags, and PostGIS internals. */
export async function truncateAll(): Promise<void> {
  const db = getDb();
  const result = await db.execute(sql`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename NOT IN ('_migrations', 'categories', 'feature_flags', 'spatial_ref_sys')
  `);
  const tables = result.rows.map((r) => `"${String(r.tablename)}"`).join(', ');
  if (tables) await db.execute(sql.raw(`TRUNCATE TABLE ${tables} CASCADE`));
  await getRedis().flushdb();
}

export function randomPhone(): string {
  return `+9198${String(10000000 + Math.floor(Math.random() * 89999999))}`;
}

export async function makeUser(
  overrides: Partial<typeof schema.users.$inferInsert> = {},
): Promise<typeof schema.users.$inferSelect> {
  const db = getDb();
  const [user] = await db
    .insert(schema.users)
    .values({
      pseudonym: 'Blue Sparrow',
      avatarSeed: 'Blue Sparrow',
      phoneHmac: overrides.phoneHmac ?? phoneBlindIndex(randomPhone()),
      phoneVerifiedAt: new Date(),
      ...overrides,
    })
    .returning();
  await db.insert(schema.reliabilityStats).values({ userId: user!.id }).onConflictDoNothing();
  return user!;
}

export async function makeSession(userId: string): Promise<string> {
  const db = getDb();
  const { token, tokenHash } = newSessionToken();
  await db.insert(schema.sessions).values({
    userId,
    tokenHash,
    platform: 'web',
    expiresAt: new Date(Date.now() + 60 * 24 * 3600_000),
  });
  return token;
}

export function authHeaders(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

/** Insert a user + session in one go; returns both. */
export async function makeAuthedUser(overrides: Partial<typeof schema.users.$inferInsert> = {}) {
  const user = await makeUser(overrides);
  const token = await makeSession(user.id);
  return { user, token, headers: authHeaders(token) };
}

export interface MakeEventOptions {
  status?: string;
  visibility?: string;
  publicApproved?: boolean;
  inviteCode?: string | null;
  title?: string;
  startsAt?: Date;
  endsAt?: Date;
  lat?: number;
  lng?: number;
  matchingPaused?: boolean;
}

export async function makeEvent(
  creatorId: string,
  opts: MakeEventOptions = {},
): Promise<typeof schema.events.$inferSelect> {
  const db = getDb();
  const lat = opts.lat ?? 18.52;
  const lng = opts.lng ?? 73.856;
  const [event] = await db
    .insert(schema.events)
    .values({
      code: shortCode(),
      title: opts.title ?? `Test Event ${randomBytes(4).toString('hex')}`,
      description: 'A test event',
      type: 'community_event',
      status: opts.status ?? 'active',
      visibility: opts.visibility ?? 'unlisted',
      publicApproved: opts.publicApproved ?? false,
      inviteCode: opts.inviteCode ?? null,
      areaLabel: 'Near City Park, Pune',
      center: `SRID=4326;POINT(${lng} ${lat})`,
      startsAt: opts.startsAt ?? new Date(Date.now() - 3600_000),
      endsAt: opts.endsAt ?? new Date(Date.now() + 6 * 3600_000),
      matchingPaused: opts.matchingPaused ?? false,
      createdBy: creatorId,
    })
    .returning();
  await db
    .insert(schema.memberships)
    .values({ userId: creatorId, eventId: event!.id, role: 'event_admin' });
  return event!;
}

export async function joinEventDirect(userId: string, eventId: string): Promise<void> {
  await getDb().insert(schema.memberships).values({ userId, eventId });
}

/** Direct member_locations upsert (already-coarse test coordinates). */
export async function setLocation(
  userId: string,
  eventId: string,
  lat: number,
  lng: number,
  expiresInMin = 15,
): Promise<void> {
  const expiresAt = new Date(Date.now() + expiresInMin * 60_000);
  await getDb().execute(sql`
    INSERT INTO member_locations (user_id, event_id, geog, updated_at, expires_at)
    VALUES (${userId}, ${eventId}, ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography, now(), ${expiresAt})
    ON CONFLICT (user_id, event_id)
    DO UPDATE SET geog = EXCLUDED.geog, updated_at = now(), expires_at = EXCLUDED.expires_at
  `);
}

/** Direct availability upsert ("Helping Now" on/off). */
export async function setAvailabilityOn(userId: string, eventId: string, on = true): Promise<void> {
  await getDb()
    .insert(schema.availability)
    .values({ userId, eventId, isOn: on, until: null, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: [schema.availability.userId, schema.availability.eventId],
      set: { isOn: on, until: null, updatedAt: new Date() },
    });
}

/** Direct inventory insert (bypasses the API for fixture setup). */
export async function addInventoryDirect(
  userId: string,
  eventId: string,
  categoryId: string,
  qty: number,
  unit: string,
): Promise<typeof schema.inventoryItems.$inferSelect> {
  const [item] = await getDb()
    .insert(schema.inventoryItems)
    .values({ userId, eventId, categoryId, qtyOnHand: String(qty), unit })
    .returning();
  return item!;
}

export async function categoryBySlug(slug: string): Promise<typeof schema.categories.$inferSelect> {
  const db = getDb();
  const [cat] = await db
    .select()
    .from(schema.categories)
    .where(sql`slug = ${slug}`)
    .limit(1);
  if (!cat) throw new Error(`category ${slug} not seeded`);
  return cat;
}

export { getDb, schema };
