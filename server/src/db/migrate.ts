/**
 * Minimal, explicit migrator: applies migrations/*.sql in filename order inside a
 * transaction each, recording them in _migrations. Hand-written SQL is our
 * migration format (ADR-0004) — reviewable, no codegen surprises.
 */
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import pg from 'pg';

export async function runMigrations(databaseUrl: string, log = console.log): Promise<string[]> {
  const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../migrations');
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  const applied: string[] = [];
  try {
    await client.query(
      'CREATE TABLE IF NOT EXISTS _migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',
    );
    for (const file of files) {
      const { rowCount } = await client.query('SELECT 1 FROM _migrations WHERE name = $1', [file]);
      if (rowCount) continue;
      const sql = await readFile(path.join(dir, file), 'utf8');
      log(`applying migration ${file}`);
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO _migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        applied.push(file);
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`migration ${file} failed: ${(err as Error).message}`);
      }
    }
  } finally {
    await client.end();
  }
  return applied;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  runMigrations(url)
    .then((applied) => console.log(applied.length ? `applied: ${applied.join(', ')}` : 'up to date'))
    .catch((err) => {
      console.error(err.message);
      process.exit(1);
    });
}
