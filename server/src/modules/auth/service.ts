/**
 * OTP authentication. Email addresses exist here only in transit: they are
 * turned into a blind index (HMAC) for lookup and AES-GCM ciphertext for
 * storage. Neither the email nor the OTP code is ever logged.
 */
import { randomBytes, randomInt } from 'node:crypto';
import { and, desc, eq, gt, isNull, ne, sql } from 'drizzle-orm';
import { LIMITS, pseudonymFromIndexes, type AuthSession, type Locale, type Me } from '@sahay/shared';
import { loadConfig } from '../../config.js';
import { getDb, schema, type Db, type Tx } from '../../db/index.js';
import {
  emailBlindIndex,
  encryptPii,
  hashOtp,
  hashPassword,
  newOtpCode,
  newSessionToken,
  safeEqualHex,
  verifyPassword,
} from '../../lib/crypto.js';
import { errors } from '../../lib/errors.js';
import { rateLimit } from '../../lib/redis.js';
import { getOtpProvider } from '../../lib/email.js';

const OTP_RETRY_AFTER_SECONDS = 60;

/**
 * Hash of an unguessable value, compared against when a username does not
 * exist so that unknown-user and wrong-password attempts cost the same time.
 * Built on first use rather than at import so startup isn't blocked by scrypt.
 */
let dummyPasswordHash: string | null = null;
function dummyHash(): string {
  dummyPasswordHash ??= hashPassword(randomBytes(32).toString('hex'));
  return dummyPasswordHash;
}

export function randomPseudonym(): string {
  return pseudonymFromIndexes(randomInt(1024), randomInt(1024));
}

export function toMe(user: typeof schema.users.$inferSelect): Me {
  return {
    id: user.id,
    pseudonym: user.pseudonym,
    avatarSeed: user.avatarSeed,
    locale: user.locale === 'hi' ? 'hi' : 'en',
    role: user.role as Me['role'],
    status: user.status as Me['status'],
    emailVerified: user.emailVerifiedAt != null,
    createdAt: user.createdAt.toISOString(),
    mustChangePassword: user.mustChangePassword,
  };
}

/**
 * Always resolves to the same "sent" response regardless of whether the email
 * has an account or the rate limit tripped — no enumeration, no oracle.
 */
export async function startOtp(
  email: string,
  locale: Locale,
  ip: string,
): Promise<{ ok: true; retryAfterSeconds: number }> {
  const emailHmac = emailBlindIndex(email);
  // Fail CLOSED: any Redis error counts as "denied".
  const emailOk = await rateLimit('otp:email', emailHmac, 3, 600).catch(() => false);
  const ipOk = await rateLimit('otp:ip', ip, 10, 3600).catch(() => false);
  if (!emailOk || !ipOk) return { ok: true, retryAfterSeconds: OTP_RETRY_AFTER_SECONDS };

  const db = getDb();
  // TEST_FIXED_OTP (non-production only, see config.ts) pins the code for e2e/load
  // tests; hashing, storage, and verification are identical either way.
  const code = loadConfig().TEST_FIXED_OTP ?? newOtpCode(LIMITS.otpLength);
  await db.transaction(async (tx) => {
    await tx
      .update(schema.otpCodes)
      .set({ consumedAt: new Date() })
      .where(and(eq(schema.otpCodes.emailHmac, emailHmac), isNull(schema.otpCodes.consumedAt)));
    await tx.insert(schema.otpCodes).values({
      emailHmac,
      codeHash: hashOtp(code, emailHmac),
      expiresAt: new Date(Date.now() + LIMITS.otpTtlMinutes * 60_000),
    });
  });

  try {
    await getOtpProvider().send(email, code, locale);
  } catch {
    // Swallow provider failures: the response must not reveal delivery state.
  }
  return { ok: true, retryAfterSeconds: OTP_RETRY_AFTER_SECONDS };
}

async function isSignupOpen(db: Db | Tx): Promise<boolean> {
  const [flag] = await db
    .select({ enabled: schema.featureFlags.enabled })
    .from(schema.featureFlags)
    .where(eq(schema.featureFlags.key, 'signup_open'))
    .limit(1);
  return flag ? flag.enabled : true; // missing flag = open (migration seeds it enabled)
}

export async function verifyOtp(
  email: string,
  code: string,
  device: { platform: 'ios' | 'android' | 'web'; name?: string },
): Promise<AuthSession> {
  const db = getDb();
  const emailHmac = emailBlindIndex(email);

  const [otp] = await db
    .select()
    .from(schema.otpCodes)
    .where(
      and(
        eq(schema.otpCodes.emailHmac, emailHmac),
        isNull(schema.otpCodes.consumedAt),
        gt(schema.otpCodes.expiresAt, sql`now()`),
      ),
    )
    .orderBy(desc(schema.otpCodes.createdAt))
    .limit(1);
  if (!otp) throw errors.unauthorized();

  const [bumped] = await db
    .update(schema.otpCodes)
    .set({ attempts: sql`${schema.otpCodes.attempts} + 1` })
    .where(eq(schema.otpCodes.id, otp.id))
    .returning({ attempts: schema.otpCodes.attempts });
  const attempts = bumped?.attempts ?? otp.attempts + 1;

  if (!safeEqualHex(hashOtp(code, emailHmac), otp.codeHash)) {
    if (attempts >= LIMITS.otpMaxAttempts) {
      await db
        .update(schema.otpCodes)
        .set({ consumedAt: new Date() })
        .where(eq(schema.otpCodes.id, otp.id));
      throw errors.rateLimited();
    }
    throw errors.unauthorized();
  }
  if (attempts > LIMITS.otpMaxAttempts) throw errors.rateLimited();

  const { user, isNewAccount } = await db.transaction(async (tx) => {
    await tx
      .update(schema.otpCodes)
      .set({ consumedAt: new Date() })
      .where(eq(schema.otpCodes.id, otp.id));

    const [existing] = await tx
      .select()
      .from(schema.users)
      .where(eq(schema.users.emailHmac, emailHmac))
      .limit(1);

    if (existing && existing.status !== 'deleted' && !existing.deletedAt) {
      return { user: existing, isNewAccount: false };
    }
    if (existing) {
      // Deleted account: detach the email so a fresh account can claim it.
      await tx
        .update(schema.users)
        .set({ emailHmac: null, emailEnc: null })
        .where(eq(schema.users.id, existing.id));
    }

    if (!(await isSignupOpen(tx))) throw errors.forbidden();

    const pseudonym = randomPseudonym();
    const [created] = await tx
      .insert(schema.users)
      .values({
        pseudonym,
        avatarSeed: pseudonym,
        emailEnc: encryptPii(email),
        emailHmac,
        emailVerifiedAt: new Date(),
      })
      .returning();
    if (!created) throw new Error('user insert returned no row');
    await tx.insert(schema.reliabilityStats).values({ userId: created.id }).onConflictDoNothing();
    return { user: created, isNewAccount: true };
  });

  const { token, tokenHash } = newSessionToken();
  const expiresAt = new Date(Date.now() + LIMITS.sessionTtlDays * 24 * 3600_000);
  await db.insert(schema.sessions).values({
    userId: user.id,
    tokenHash,
    platform: device.platform,
    deviceName: device.name ?? null,
    expiresAt,
  });

  return { token, expiresAt: expiresAt.toISOString(), user: toMe(user), isNewAccount };
}

/**
 * Staff sign-in with username + password (web admin console). Volunteers keep
 * using email OTP; this path exists because admin credentials are issued by the
 * operators rather than self-served (ADR-0013).
 *
 * Every failure returns the same `unauthorized` error so the response cannot be
 * used to discover which usernames exist, and a password is always hashed even
 * when the username is unknown, so timing cannot either.
 */
export async function loginWithPassword(
  username: string,
  password: string,
  device: { platform: 'ios' | 'android' | 'web'; name?: string },
  ip: string,
): Promise<AuthSession> {
  const normalized = username.trim().toLowerCase();

  // Fail CLOSED, as with OTP: a Redis error denies the attempt. The per-IP cap
  // also bounds how much scrypt work one caller can force the server to do.
  const userOk = await rateLimit('login:user', normalized, 5, 900).catch(() => false);
  const ipOk = await rateLimit('login:ip', ip, 20, 900).catch(() => false);
  if (!userOk || !ipOk) throw errors.rateLimited();

  const db = getDb();
  const [user] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.username, normalized))
    .limit(1);

  // Compare against a dummy hash when there is no such user, so the work done
  // (and therefore the time taken) does not reveal whether the account exists.
  const stored = user?.passwordHash ?? dummyHash();
  const passwordOk = verifyPassword(password, stored);
  if (!user || !user.passwordHash || !passwordOk) throw errors.unauthorized();

  if (user.status === 'deleted' || user.deletedAt) throw errors.unauthorized();
  if (user.status === 'suspended' || (user.suspendedUntil && user.suspendedUntil > new Date())) {
    throw errors.accountRestricted();
  }

  const { token, tokenHash } = newSessionToken();
  const expiresAt = new Date(Date.now() + LIMITS.sessionTtlDays * 24 * 3600_000);
  await db.insert(schema.sessions).values({
    userId: user.id,
    tokenHash,
    platform: device.platform,
    deviceName: device.name ?? null,
    expiresAt,
  });
  return { token, expiresAt: expiresAt.toISOString(), user: toMe(user), isNewAccount: false };
}

/**
 * Lets a staff member replace their password. Requires the current one, so a
 * stolen session token alone cannot lock the real owner out. Every OTHER
 * session is revoked: if the generated password leaked in transit, whoever
 * used it is signed out by the act of the owner choosing a new one.
 */
export async function changeOwnPassword(
  userId: string,
  sessionId: string,
  currentPassword: string,
  newPassword: string,
): Promise<{ ok: true }> {
  const db = getDb();
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1);
  if (!user?.passwordHash) throw errors.forbidden(); // volunteers have no password to change

  // Bounds how much scrypt work one session can force, and slows an attacker
  // who holds a token but not the password.
  const ok = await rateLimit('password:change', userId, 10, 900).catch(() => false);
  if (!ok) throw errors.rateLimited();

  if (!verifyPassword(currentPassword, user.passwordHash)) throw errors.unauthorized();
  if (verifyPassword(newPassword, user.passwordHash)) {
    throw errors.validation({ field: 'newPassword', reason: 'same_as_current' });
  }

  await db.transaction(async (tx) => {
    await tx
      .update(schema.users)
      .set({
        passwordHash: hashPassword(newPassword),
        passwordSetAt: new Date(),
        mustChangePassword: false,
      })
      .where(eq(schema.users.id, userId));
    await tx
      .update(schema.sessions)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(schema.sessions.userId, userId),
          ne(schema.sessions.id, sessionId),
          isNull(schema.sessions.revokedAt),
        ),
      );
  });
  return { ok: true };
}

export async function revokeSession(userId: string, sessionId: string): Promise<boolean> {
  const db = getDb();
  const rows = await db
    .update(schema.sessions)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(schema.sessions.id, sessionId),
        eq(schema.sessions.userId, userId),
        isNull(schema.sessions.revokedAt),
      ),
    )
    .returning({ id: schema.sessions.id });
  return rows.length > 0;
}

export async function listSessions(userId: string, currentSessionId: string) {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.sessions)
    .where(
      and(
        eq(schema.sessions.userId, userId),
        isNull(schema.sessions.revokedAt),
        gt(schema.sessions.expiresAt, sql`now()`),
      ),
    )
    .orderBy(desc(schema.sessions.lastSeenAt));
  return rows.map((s) => ({
    id: s.id,
    current: s.id === currentSessionId,
    platform: s.platform,
    deviceName: s.deviceName,
    createdAt: s.createdAt.toISOString(),
    lastSeenAt: s.lastSeenAt.toISOString(),
  }));
}
