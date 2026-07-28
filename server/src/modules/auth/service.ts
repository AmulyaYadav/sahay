/**
 * OTP authentication. Email addresses exist here only in transit: they are
 * turned into a blind index (HMAC) for lookup and AES-GCM ciphertext for
 * storage. Neither the email nor the OTP code is ever logged.
 */
import { randomInt } from 'node:crypto';
import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import { LIMITS, pseudonymFromIndexes, type AuthSession, type Locale, type Me } from '@sahay/shared';
import { loadConfig } from '../../config.js';
import { getDb, schema, type Db, type Tx } from '../../db/index.js';
import {
  emailBlindIndex,
  encryptPii,
  hashOtp,
  newOtpCode,
  newSessionToken,
  safeEqualHex,
} from '../../lib/crypto.js';
import { errors } from '../../lib/errors.js';
import { rateLimit } from '../../lib/redis.js';
import { getOtpProvider } from '../../lib/email.js';

const OTP_RETRY_AFTER_SECONDS = 60;

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
