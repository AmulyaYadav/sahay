import '../env.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { closeDb, getDb } from '../../src/db/index.js';
import { setupTestDb } from '../helpers.js';

beforeAll(async () => {
  await setupTestDb();
});

afterAll(async () => {
  await closeDb();
});

describe('0002_email_auth migration', () => {
  it('adds nullable email columns to users and otp_codes', async () => {
    const db = getDb();
    const usersCols = await db.execute(sql`
      SELECT column_name, is_nullable FROM information_schema.columns
      WHERE table_name = 'users' AND column_name IN ('email_enc', 'email_hmac', 'email_verified_at')
    `);
    expect(usersCols.rows).toHaveLength(3);
    expect(usersCols.rows.every((r) => r.is_nullable === 'YES')).toBe(true);

    const otpCols = await db.execute(sql`
      SELECT column_name, is_nullable FROM information_schema.columns
      WHERE table_name = 'otp_codes' AND column_name IN ('phone_hmac', 'email_hmac')
    `);
    expect(otpCols.rows).toHaveLength(2);
    expect(otpCols.rows.every((r) => r.is_nullable === 'YES')).toBe(true);
  });

});

describe('0004_event_admin_wants migration', () => {
  it('creates the event_admin_wants table and drops event_categories.admin_want', async () => {
    const db = getDb();
    const table = await db.execute(sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'event_admin_wants'
      ORDER BY column_name
    `);
    // qty arrives in 0006 — see the migration test below.
    expect(table.rows.map((r) => r.column_name).sort()).toEqual(['category_id', 'event_id', 'qty']);

    const dropped = await db.execute(sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'event_categories' AND column_name = 'admin_want'
    `);
    expect(dropped.rows).toHaveLength(0);
  });
});

describe('0006_password_change_and_want_qty migration', () => {
  it('adds must_change_password to users, defaulting to false for existing rows', async () => {
    const db = getDb();
    const col = await db.execute(sql`
      SELECT is_nullable, column_default FROM information_schema.columns
      WHERE table_name = 'users' AND column_name = 'must_change_password'
    `);
    expect(col.rows).toHaveLength(1);
    // NOT NULL with a false default: staff who already had working passwords
    // when this shipped are not locked out of the console.
    expect(col.rows[0]!.is_nullable).toBe('NO');
    expect(String(col.rows[0]!.column_default)).toContain('false');
  });

  it('constrains admin want quantities to a sane positive range', async () => {
    const db = getDb();
    const check = await db.execute(sql`
      SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
      WHERE conname = 'event_admin_wants_qty_sane'
    `);
    expect(check.rows).toHaveLength(1);
    const def = String(check.rows[0]!.def);
    // NULL stays legal — it means "needed, amount unspecified".
    expect(def).toContain('IS NULL');
    expect(def).toContain('> 0');
  });
});
