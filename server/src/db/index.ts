import pg from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { loadConfig } from '../config.js';
import * as schema from './schema.js';

export type Db = NodePgDatabase<typeof schema>;
/** Transaction handle — same query API as Db. */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

let pool: pg.Pool | null = null;
let db: Db | null = null;

export function getPool(): pg.Pool {
  if (!pool) {
    const config = loadConfig();
    pool = new pg.Pool({
      connectionString: config.DATABASE_URL,
      max: config.DATABASE_POOL_MAX,
      // Set explicitly rather than relying on sslmode in the URL: node-postgres'
      // handling of that varies by version, and silently falling back to
      // plaintext against a managed database is not a failure mode we want.
      ...(config.DATABASE_SSL === 'off'
        ? {}
        : { ssl: { rejectUnauthorized: config.DATABASE_SSL === 'verify' } }),
    });
  }
  return pool;
}

export function getDb(): Db {
  if (!db) db = drizzle(getPool(), { schema });
  return db;
}

export async function closeDb(): Promise<void> {
  await pool?.end();
  pool = null;
  db = null;
}

export { schema };
