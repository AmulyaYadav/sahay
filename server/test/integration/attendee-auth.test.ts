import '../env.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { buildApp } from '../../src/app.js';
import { closeDb, getDb, schema } from '../../src/db/index.js';
import { closeRedis } from '../../src/lib/redis.js';
import { closeQueues } from '../../src/queues.js';
import { authHeaders, randomEmail, setupTestDb, truncateAll } from '../helpers.js';

/**
 * Attendee auth: an emailed code proves the address ONCE at sign-up, then the
 * account is username + password. Signing in must never need email again — an
 * attendee on congested mobile data should not depend on a mail round-trip.
 */
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
beforeEach(async () => {
  await truncateAll();
});

/**
 * Reads the code out of the console provider's output, the same way the other
 * auth suites do — the code is only ever hashed in the database.
 */
function captureOtp(): { code: () => string } {
  const spy = vi.spyOn(console, 'log');
  return {
    code: () => {
      const lines = spy.mock.calls.map((c) => c.join(' ')).filter((l) => /OTP for .*: \d{6}/.test(l));
      const match = lines[lines.length - 1]?.match(/: (\d{6})$/);
      if (!match) throw new Error('no OTP logged');
      return match[1]!;
    },
  };
}

/** Sends a code to `email` and returns it. */
async function requestCode(email: string): Promise<string> {
  const otp = captureOtp();
  await app.inject({ method: 'POST', url: '/api/v1/auth/otp/start', payload: { email, locale: 'en' } });
  return otp.code();
}

/** Creates an account by verifying an emailed code; returns its session token. */
async function newAccount(email = randomEmail()) {
  const code = await requestCode(email);
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/otp/verify',
    payload: { email, code, device: { platform: 'android' } },
  });
  expect(res.statusCode).toBe(200);
  return { email, token: res.json().token as string, userId: res.json().user.id as string };
}

const setCredentials = (token: string, username: string, password: string) =>
  app.inject({
    method: 'POST',
    url: '/api/v1/auth/credentials',
    headers: authHeaders(token),
    payload: { username, password },
  });

const login = (username: string, password: string) =>
  app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { username, password, device: { platform: 'android' } },
  });

describe('attendee sign-up', () => {
  it('cannot sign in until credentials are set, then can', async () => {
    const { token } = await newAccount();
    // The account exists after verification, but has no password to sign in with.
    expect((await login('newbie.attendee', 'a-password-here')).statusCode).toBe(401);

    expect((await setCredentials(token, 'newbie.attendee', 'a-password-here')).statusCode).toBe(200);
    const session = await login('newbie.attendee', 'a-password-here');
    expect(session.statusCode).toBe(200);
    expect(session.json().token).toBeTruthy();
  });

  it('stores only a hash, and does not force a password change', async () => {
    const { token, userId } = await newAccount();
    await setCredentials(token, 'hash.check', 'a-password-here');
    const [row] = await getDb().select().from(schema.users).where(eq(schema.users.id, userId));
    expect(row!.passwordHash).toMatch(/^scrypt\$/);
    expect(JSON.stringify(row)).not.toContain('a-password-here');
    // Unlike a staff account (ADR-0013), this password was chosen by its owner.
    expect(row!.mustChangePassword).toBe(false);
  });

  it('lowercases the username, so sign-in is not case-sensitive', async () => {
    const { token } = await newAccount();
    await setCredentials(token, 'MiXeD.CaSe', 'a-password-here');
    expect((await login('mixed.case', 'a-password-here')).statusCode).toBe(200);
    expect((await login('MIXED.CASE', 'a-password-here')).statusCode).toBe(200);
  });

  it('refuses a username already taken', async () => {
    const first = await newAccount();
    await setCredentials(first.token, 'contested', 'a-password-here');
    const second = await newAccount();
    expect((await setCredentials(second.token, 'contested', 'another-password')).statusCode).toBe(409);
  });

  it('refuses a second attempt: this is setup, not renaming', async () => {
    const { token } = await newAccount();
    await setCredentials(token, 'first.choice', 'a-password-here');
    expect((await setCredentials(token, 'second.choice', 'a-password-here')).statusCode).toBe(409);
    // The original still works, so the refusal changed nothing.
    expect((await login('first.choice', 'a-password-here')).statusCode).toBe(200);
  });

  it('rejects malformed usernames and short passwords', async () => {
    const { token } = await newAccount();
    for (const username of ['ab', 'Has Space', 'trailing-', '.leading', 'no@at']) {
      expect((await setCredentials(token, username, 'a-password-here')).statusCode, username).toBe(400);
    }
    expect((await setCredentials(token, 'fine.name', 'short')).statusCode).toBe(400);
  });

  it('requires a session — an anonymous caller cannot claim a username', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/credentials',
      payload: { username: 'squatter', password: 'a-password-here' },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('forgot username', () => {
  it('answers identically whether or not the address has an account', async () => {
    const { token, email } = await newAccount();
    await setCredentials(token, 'findable', 'a-password-here');

    const known = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/forgot-username',
      payload: { email, locale: 'en' },
    });
    const unknown = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/forgot-username',
      payload: { email: randomEmail(), locale: 'en' },
    });

    expect(known.statusCode).toBe(unknown.statusCode);
    // Byte-identical: the response must not become a way to test which addresses
    // are registered.
    expect(known.body).toBe(unknown.body);
  });
});

describe('password reset', () => {
  async function accountWithPassword(username: string, password: string) {
    const acct = await newAccount();
    await setCredentials(acct.token, username, password);
    return acct;
  }

  it('replaces the password using an emailed code, with no session', async () => {
    const { email } = await accountWithPassword('resetme', 'the-old-password');
    const code = await requestCode(email);

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/password/reset',
      payload: { email, code, newPassword: 'the-new-password' },
    });
    expect(res.statusCode).toBe(200);
    expect((await login('resetme', 'the-old-password')).statusCode).toBe(401);
    expect((await login('resetme', 'the-new-password')).statusCode).toBe(200);
  });

  it('revokes existing sessions, since recovery is when a takeover should end', async () => {
    const { email, token } = await accountWithPassword('revoked', 'the-old-password');
    expect((await app.inject({ url: '/api/v1/me', headers: authHeaders(token) })).statusCode).toBe(200);

    const code = await requestCode(email);
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/password/reset',
      payload: { email, code, newPassword: 'the-new-password' },
    });

    expect((await app.inject({ url: '/api/v1/me', headers: authHeaders(token) })).statusCode).toBe(401);
  });

  it('rejects a wrong code and leaves the password alone', async () => {
    const { email } = await accountWithPassword('unchanged', 'the-old-password');
    const real = await requestCode(email);

    const wrong = real === '999999' ? '111111' : '999999';
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/password/reset',
      payload: { email, code: wrong, newPassword: 'should-not-apply' },
    });
    expect(res.statusCode).toBe(401);
    expect((await login('unchanged', 'the-old-password')).statusCode).toBe(200);
  });

  it('refuses for an address with no account, using the same error as a bad code', async () => {
    const email = randomEmail();
    const code = await requestCode(email);
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/password/reset',
      payload: { email, code, newPassword: 'a-new-password-here' },
    });
    expect(res.statusCode).toBe(401);
  });
});
