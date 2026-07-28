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
    expect(table.rows.map((r) => r.column_name).sort()).toEqual(['category_id', 'event_id']);

    const dropped = await db.execute(sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'event_categories' AND column_name = 'admin_want'
    `);
    expect(dropped.rows).toHaveLength(0);
  });
});
