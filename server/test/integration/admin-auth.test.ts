import '../env.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { buildApp } from '../../src/app.js';
import { closeDb, getDb, schema } from '../../src/db/index.js';
import { closeRedis } from '../../src/lib/redis.js';
import { closeQueues } from '../../src/queues.js';
import { authHeaders, makeAuthedUser, randomEmail, setupTestDb, truncateAll } from '../helpers.js';

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

const login = (username: string, password: string) =>
  app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { username, password, device: { platform: 'web', name: 'test' } },
  });

async function createAdmin(overrides: Partial<{ username: string; email: string; role: string }> = {}) {
  const admin = await makeAuthedUser({ role: 'admin' });
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/admin/admins',
    headers: admin.headers,
    payload: {
      username: overrides.username ?? 'asha.rao',
      email: overrides.email ?? randomEmail(),
      role: overrides.role ?? 'moderator',
    },
  });
  return { creator: admin, res };
}

describe('staff account creation', () => {
  it('creates an account and returns the password exactly once', async () => {
    const { res } = await createAdmin();
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.username).toBe('asha.rao');
    expect(body.role).toBe('moderator');
    expect(body.password).toMatch(/^[a-zA-Z2-9]{5}(-[a-zA-Z2-9]{5}){3}$/);

    // Only the hash is stored — the plaintext is not recoverable from the DB.
    const [row] = await getDb().select().from(schema.users).where(eq(schema.users.id, body.id));
    expect(row!.passwordHash).toMatch(/^scrypt\$/);
    expect(row!.passwordHash).not.toContain(body.password);
    expect(JSON.stringify(row)).not.toContain(body.password);
  });

  it('is refused to moderators — only admins may mint console access', async () => {
    const moderator = await makeAuthedUser({ role: 'moderator' });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/admins',
      headers: moderator.headers,
      payload: { username: 'someone', email: randomEmail(), role: 'moderator' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('rejects a duplicate username', async () => {
    const email = randomEmail();
    const { creator } = await createAdmin({ username: 'dupe', email });
    const again = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/admins',
      headers: creator.headers,
      payload: { username: 'dupe', email: randomEmail(), role: 'moderator' },
    });
    expect(again.statusCode).toBe(409);
  });

  it('rejects usernames that are not valid slugs', async () => {
    const admin = await makeAuthedUser({ role: 'admin' });
    for (const username of ['a', 'has space', '-lead', 'trail-', 'sym$bol']) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/admins',
        headers: admin.headers,
        payload: { username, email: randomEmail(), role: 'moderator' },
      });
      expect(res.statusCode, username).toBe(400);
    }
  });

  it('normalises case rather than rejecting it', async () => {
    // Typing "Asha.Rao" should produce the account "asha.rao", not an error —
    // sign-in lowercases too, so a username is never case-sensitive anywhere.
    const admin = await makeAuthedUser({ role: 'admin' });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/admins',
      headers: admin.headers,
      payload: { username: 'Asha.Rao', email: randomEmail(), role: 'moderator' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().username).toBe('asha.rao');
  });

  it('audits the creation without recording the password', async () => {
    const { res } = await createAdmin({ username: 'audited' });
    const password = res.json().password;
    const rows = await getDb().select().from(schema.auditLog);
    const entry = rows.find((r) => r.action === 'admin_account_create');
    expect(entry).toBeDefined();
    expect(JSON.stringify(rows)).not.toContain(password);
  });
});

describe('staff password login', () => {
  it('signs in with the issued credentials and the session works', async () => {
    const { res } = await createAdmin({ username: 'login.ok' });
    const { password } = res.json();

    const ok = await login('login.ok', password);
    expect(ok.statusCode).toBe(200);
    expect(ok.json().token).toBeTruthy();
    expect(ok.json().isNewAccount).toBe(false);

    const me = await app.inject({ url: '/api/v1/me', headers: authHeaders(ok.json().token) });
    expect(me.statusCode).toBe(200);
    expect(me.json().role).toBe('moderator');
  });

  it('accepts the username case-insensitively', async () => {
    const { res } = await createAdmin({ username: 'case.test' });
    const { password } = res.json();
    expect((await login('Case.Test', password)).statusCode).toBe(200);
    expect((await login('  case.test  ', password)).statusCode).toBe(200);
  });

  it('rejects a wrong password', async () => {
    const { res } = await createAdmin({ username: 'wrong.pw' });
    const bad = await login('wrong.pw', `${res.json().password}x`);
    expect(bad.statusCode).toBe(401);
  });

  it('gives an unknown username the same response as a wrong password', async () => {
    const { res } = await createAdmin({ username: 'enum.test' });
    const wrongPw = await login('enum.test', 'definitely-not-it');
    const noSuchUser = await login('no.such.user', 'definitely-not-it');
    expect(noSuchUser.statusCode).toBe(wrongPw.statusCode);
    // requestId is deliberately unique per request; everything a caller could
    // use to tell "no such user" from "wrong password" must be identical.
    const strip = (r: typeof wrongPw) => {
      const { requestId, ...rest } = r.json().error;
      return rest;
    };
    expect(strip(noSuchUser)).toEqual(strip(wrongPw));
  });

  it('refuses volunteers, who have no username or password', async () => {
    const volunteer = await makeAuthedUser();
    const [row] = await getDb().select().from(schema.users).where(eq(schema.users.id, volunteer.user.id));
    expect(row!.username).toBeNull();
    expect(row!.passwordHash).toBeNull();
    expect((await login('', 'anything')).statusCode).toBe(400);
  });

  it('rate-limits repeated failures for one username', async () => {
    const { res } = await createAdmin({ username: 'brute.force' });
    const { password } = res.json();
    for (let i = 0; i < 5; i++) expect((await login('brute.force', 'nope')).statusCode).toBe(401);
    const sixth = await login('brute.force', 'nope');
    expect(sixth.statusCode).toBe(429);
    // The lockout holds even once the caller finally supplies the real password.
    expect((await login('brute.force', password)).statusCode).toBe(429);
  });

  it('refuses a suspended account', async () => {
    const { res } = await createAdmin({ username: 'suspended.acct' });
    const { id, password } = res.json();
    await getDb().update(schema.users).set({ status: 'suspended' }).where(eq(schema.users.id, id));
    expect((await login('suspended.acct', password)).statusCode).toBe(403);
  });

  it('refuses a deleted account', async () => {
    const { res } = await createAdmin({ username: 'deleted.acct' });
    const { id, password } = res.json();
    await getDb()
      .update(schema.users)
      .set({ status: 'deleted', deletedAt: new Date() })
      .where(eq(schema.users.id, id));
    expect((await login('deleted.acct', password)).statusCode).toBe(401);
  });
});

describe('staff password reset', () => {
  it('issues a new password and invalidates the old one', async () => {
    const { creator, res } = await createAdmin({ username: 'reset.me' });
    const { id, password: original } = res.json();

    const reset = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/admins/${id}/reset-password`,
      headers: creator.headers,
    });
    expect(reset.statusCode).toBe(200);
    const fresh = reset.json().password;
    expect(fresh).not.toBe(original);

    expect((await login('reset.me', fresh)).statusCode).toBe(200);
    expect((await login('reset.me', original)).statusCode).toBe(401);
  });

  it('will not reset a volunteer account', async () => {
    const admin = await makeAuthedUser({ role: 'admin' });
    const volunteer = await makeAuthedUser();
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/admins/${volunteer.user.id}/reset-password`,
      headers: admin.headers,
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('forced first password change', () => {
  /** Creates a staff account and signs in with the generated password. */
  async function freshStaff(username = 'newbie.staff') {
    const { creator, res } = await createAdmin({ username });
    const generated = res.json().password;
    const session = await login(username, generated);
    return { creator, generated, token: session.json().token as string, id: res.json().id as string };
  }

  it('flags a newly created account and says so on the session and /me', async () => {
    const { res } = await createAdmin({ username: 'flagged.one' });
    const session = await login('flagged.one', res.json().password);
    expect(session.json().user.mustChangePassword).toBe(true);

    const me = await app.inject({ url: '/api/v1/me', headers: authHeaders(session.json().token) });
    expect(me.json().mustChangePassword).toBe(true);
  });

  it('blocks every other route until the password is changed', async () => {
    const { token } = await freshStaff();
    const headers = authHeaders(token);

    // The whole point: the password WE generated cannot be used to actually do
    // anything, so a leak in transit has a bounded blast radius. Every
    // AUTHENTICATED route is closed — public routes are unaffected, since they
    // serve the same data to anyone with or without a token.
    for (const url of ['/api/v1/admin/events', '/api/v1/admin/stats', '/api/v1/auth/sessions']) {
      const res = await app.inject({ url, headers });
      expect(res.statusCode, url).toBe(403);
      expect(res.json().error.code, url).toBe('password_change_required');
    }

    const publicRoute = await app.inject({ url: '/api/v1/events', headers });
    expect(publicRoute.statusCode).toBe(200);
  });

  it('still allows the routes needed to complete the change', async () => {
    const { token } = await freshStaff();
    const headers = authHeaders(token);
    expect((await app.inject({ url: '/api/v1/me', headers })).statusCode).toBe(200);
  });

  it('clears the flag, unblocks the console, and retires the old password', async () => {
    const { generated, token } = await freshStaff();
    const headers = authHeaders(token);

    const change = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/password',
      headers,
      payload: { currentPassword: generated, newPassword: 'a-password-i-picked-myself' },
    });
    expect(change.statusCode).toBe(200);

    // Same session, now unblocked — no re-login required.
    expect((await app.inject({ url: '/api/v1/admin/events', headers })).statusCode).toBe(200);
    const me = await app.inject({ url: '/api/v1/me', headers });
    expect(me.json().mustChangePassword).toBe(false);

    expect((await login('newbie.staff', generated)).statusCode).toBe(401);
    const relogin = await login('newbie.staff', 'a-password-i-picked-myself');
    expect(relogin.statusCode).toBe(200);
    expect(relogin.json().user.mustChangePassword).toBe(false);
  });

  it('revokes other sessions but keeps the one doing the changing', async () => {
    const { generated, token } = await freshStaff();
    const other = await login('newbie.staff', generated);
    const otherToken = other.json().token;

    const change = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/password',
      headers: authHeaders(token),
      payload: { currentPassword: generated, newPassword: 'another-fresh-password' },
    });
    expect(change.statusCode).toBe(200);

    // Whoever else was holding the delivered password is signed out by this.
    expect((await app.inject({ url: '/api/v1/me', headers: authHeaders(otherToken) })).statusCode).toBe(401);
    expect((await app.inject({ url: '/api/v1/me', headers: authHeaders(token) })).statusCode).toBe(200);
  });

  it('requires the current password, so a stolen token alone cannot take over', async () => {
    const { token } = await freshStaff();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/password',
      headers: authHeaders(token),
      payload: { currentPassword: 'not-the-right-one', newPassword: 'a-brand-new-password' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects reusing the same password, and anything under 12 characters', async () => {
    const { generated, token } = await freshStaff();
    const headers = authHeaders(token);

    const same = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/password',
      headers,
      payload: { currentPassword: generated, newPassword: generated },
    });
    expect(same.statusCode).toBe(400);

    const short = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/password',
      headers,
      payload: { currentPassword: generated, newPassword: 'short' },
    });
    expect(short.statusCode).toBe(400);

    // Still blocked — neither failed attempt cleared the flag.
    expect((await app.inject({ url: '/api/v1/admin/events', headers })).statusCode).toBe(403);
  });

  it('re-flags the account when an admin resets the password', async () => {
    const { generated, token, creator, id } = await freshStaff();
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/password',
      headers: authHeaders(token),
      payload: { currentPassword: generated, newPassword: 'chosen-by-the-owner' },
    });

    const reset = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/admins/${id}/reset-password`,
      headers: creator.headers,
    });
    const session = await login('newbie.staff', reset.json().password);
    expect(session.json().user.mustChangePassword).toBe(true);
  });

  it('refuses to change a password for a volunteer, who has none', async () => {
    const volunteer = await makeAuthedUser();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/password',
      headers: volunteer.headers,
      payload: { currentPassword: 'whatever', newPassword: 'a-perfectly-fine-password' },
    });
    expect(res.statusCode).toBe(403);
  });
});
