/**
 * Global setup for the e2e suite. Runs BEFORE Playwright starts the webServer
 * processes (API + Vite), so the database is ready when the API boots.
 *
 *  1. create database sahay_e2e if missing
 *  2. run server migrations + catalogue seed (spawned via tsx, cwd=server)
 *  3. flush redis db 14 (queues, rate limits, pub/sub leftovers)
 *  4. truncate all data tables for a clean slate (keeps _migrations,
 *     categories, feature_flags and postgis metadata)
 *  5. start the BullMQ worker as a child process (it has no HTTP port, so it
 *     cannot be a webServer entry); the returned teardown kills it.
 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { Redis } from 'ioredis';
import pg from 'pg';
import { ADMIN_DATABASE_URL, DATABASE_URL, REDIS_URL, SERVER_DIR, SERVER_ENV, STATE_FILE } from './env';

const KEEP_TABLES = new Set(['_migrations', 'categories', 'feature_flags', 'spatial_ref_sys']);

async function ensureDatabase(): Promise<void> {
  const admin = new pg.Client({ connectionString: ADMIN_DATABASE_URL });
  await admin.connect();
  try {
    const { rowCount } = await admin.query("SELECT 1 FROM pg_database WHERE datname = 'sahay_e2e'");
    if (!rowCount) await admin.query('CREATE DATABASE sahay_e2e');
  } finally {
    await admin.end();
  }
}

function runServerScript(script: string): void {
  const res = spawnSync('npx', ['tsx', script], {
    cwd: SERVER_DIR,
    env: { ...process.env, ...SERVER_ENV },
    stdio: 'inherit',
    timeout: 120_000,
  });
  if (res.status !== 0) throw new Error(`${script} exited with ${res.status}`);
}

async function truncateDataTables(): Promise<void> {
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    const { rows } = await client.query<{ tablename: string }>(
      "SELECT tablename FROM pg_tables WHERE schemaname = 'public'",
    );
    const targets = rows.map((r) => r.tablename).filter((t) => !KEEP_TABLES.has(t));
    if (targets.length > 0) {
      await client.query(`TRUNCATE ${targets.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`);
    }
  } finally {
    await client.end();
  }
}

async function flushRedis(): Promise<void> {
  const redis = new Redis(REDIS_URL, { lazyConnect: true });
  await redis.connect();
  await redis.flushdb();
  await redis.quit();
}

export default async function globalSetup(): Promise<() => Promise<void>> {
  if (fs.existsSync(STATE_FILE)) fs.rmSync(STATE_FILE);

  await ensureDatabase();
  runServerScript('src/db/migrate.ts');
  runServerScript('src/db/seed.ts');
  await flushRedis();
  await truncateDataTables();

  // Worker (BullMQ). No port to wait on — it is ready as soon as it connects,
  // and every consumer of its work polls/waits anyway.
  const worker = spawn('npx', ['tsx', 'src/worker-main.ts'], {
    cwd: SERVER_DIR,
    env: { ...process.env, ...SERVER_ENV },
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  let stopping = false;
  worker.on('exit', (code, signal) => {
    if (!stopping && code !== null && code !== 0) {
      // Surfaced in the run output; specs relying on worker jobs will fail loudly.
      console.error(`[e2e] worker exited unexpectedly with code ${code} (signal ${signal ?? 'none'})`);
    }
  });

  return async () => {
    stopping = true;
    worker.kill('SIGTERM');
    await new Promise<void>((resolve) => {
      const t = setTimeout(() => {
        worker.kill('SIGKILL');
        resolve();
      }, 5000);
      worker.on('exit', () => {
        clearTimeout(t);
        resolve();
      });
    });
  };
}
