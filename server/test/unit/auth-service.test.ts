import '../env.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeDb } from '../../src/db/index.js';
import { closeRedis } from '../../src/lib/redis.js';
import { setupTestDb, truncateAll } from '../helpers.js';
import { startOtp, verifyOtp } from '../../src/modules/auth/service.js';

beforeAll(async () => {
  await setupTestDb();
});
afterAll(async () => {
  await closeDb();
  await closeRedis();
});
beforeEach(async () => {
  await truncateAll();
  vi.restoreAllMocks();
});

describe('email OTP service', () => {
  it('signs up a new account with an email and marks it emailVerified', async () => {
    const spy = vi.spyOn(console, 'log');
    await startOtp('newperson@example.com', 'en', '127.0.0.1');
    const code = (() => {
      const line = spy.mock.calls.map((c) => c.join(' ')).find((l) => /OTP for .*: \d{6}/.test(l));
      return line!.match(/: (\d{6})$/)![1]!;
    })();
    const session = await verifyOtp('newperson@example.com', code, { platform: 'web' });
    expect(session.isNewAccount).toBe(true);
    expect(session.user.emailVerified).toBe(true);
  });
});
