import '../env.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { closeDb } from '../../src/db/index.js';
import { closeRedis } from '../../src/lib/redis.js';
import { closeQueues } from '../../src/queues.js';
import { authHeaders, randomPhone, setupTestDb, truncateAll } from '../helpers.js';

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
  vi.restoreAllMocks();
});

/** The console SMS provider logs the OTP; steal it from there like a dev would. */
function captureOtp(): { code: () => string } {
  const spy = vi.spyOn(console, 'log');
  return {
    code: () => {
      const lines = spy.mock.calls.map((c) => c.join(' ')).filter((l) => /code: \d{6}/.test(l));
      const line = lines[lines.length - 1];
      const match = line?.match(/code: (\d{6})/);
      if (!match) throw new Error('no OTP logged');
      return match[1]!;
    },
  };
}

async function signup(phone: string) {
  const otp = captureOtp();
  const start = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/otp/start',
    payload: { phone, locale: 'en' },
  });
  expect(start.statusCode).toBe(200);
  const verify = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/otp/verify',
    payload: { phone, code: otp.code(), device: { platform: 'web', name: 'test' } },
  });
  return verify;
}

describe('OTP auth flow', () => {
  it('signs up a new account end to end', async () => {
    const phone = randomPhone();
    const res = await signup(phone);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.isNewAccount).toBe(true);
    expect(body.token).toBeTruthy();
    expect(body.user.pseudonym).toMatch(/^\w+ \w+$/);
    expect(body.user.phoneVerified).toBe(true);
    // The phone number must never appear in any response.
    expect(res.body).not.toContain(phone);

    const me = await app.inject({ url: '/api/v1/me', headers: authHeaders(body.token) });
    expect(me.statusCode).toBe(200);
    expect(me.json().id).toBe(body.user.id);
  });

  it('start responds identically whether or not the account exists', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/otp/start',
      payload: { phone: randomPhone(), locale: 'en' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, retryAfterSeconds: 60 });
  });

  it('signs an existing user back in (isNewAccount=false, same user)', async () => {
    const phone = randomPhone();
    const first = await signup(phone);
    const second = await signup(phone);
    expect(second.statusCode).toBe(200);
    expect(second.json().isNewAccount).toBe(false);
    expect(second.json().user.id).toBe(first.json().user.id);
  });

  it('rejects wrong codes and rate-limits after 5 attempts, consuming the code', async () => {
    const phone = randomPhone();
    const otp = captureOtp();
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/otp/start',
      payload: { phone, locale: 'en' },
    });
    const realCode = otp.code();
    const wrongCode = realCode === '000000' ? '000001' : '000000';
    const attempt = (code: string) =>
      app.inject({
        method: 'POST',
        url: '/api/v1/auth/otp/verify',
        payload: { phone, code, device: { platform: 'web' } },
      });

    for (let i = 0; i < 4; i++) {
      const res = await attempt(wrongCode);
      expect(res.statusCode).toBe(401);
    }
    const fifth = await attempt(wrongCode);
    expect(fifth.statusCode).toBe(429);
    expect(fifth.json().error.code).toBe('rate_limited');

    // Code was consumed by the lockout — even the real code no longer works.
    const real = await attempt(realCode);
    expect(real.statusCode).toBe(401);
  });

  it('lists and revokes sessions', async () => {
    const phone = randomPhone();
    const s1 = (await signup(phone)).json();
    const s2 = (await signup(phone)).json();

    const list = await app.inject({ url: '/api/v1/auth/sessions', headers: authHeaders(s2.token) });
    expect(list.statusCode).toBe(200);
    const sessions = list.json();
    expect(sessions).toHaveLength(2);
    expect(sessions.filter((s: { current: boolean }) => s.current)).toHaveLength(1);

    const otherId = sessions.find((s: { current: boolean }) => !s.current).id;
    const del = await app.inject({
      method: 'DELETE',
      url: `/api/v1/auth/sessions/${otherId}`,
      headers: authHeaders(s2.token),
    });
    expect(del.statusCode).toBe(200);

    // The revoked session's token no longer authenticates.
    const me = await app.inject({ url: '/api/v1/me', headers: authHeaders(s1.token) });
    expect(me.statusCode).toBe(401);
  });

  it('logout revokes the current session', async () => {
    const s = (await signup(randomPhone())).json();
    const out = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: authHeaders(s.token),
    });
    expect(out.statusCode).toBe(200);
    const me = await app.inject({ url: '/api/v1/me', headers: authHeaders(s.token) });
    expect(me.statusCode).toBe(401);
  });
});
