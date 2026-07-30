/**
 * PII crypto helpers. Phone numbers and email addresses are the only direct identifiers we hold:
 *  - encrypted at rest with AES-256-GCM (random IV per value)
 *  - looked up via a keyed blind index (HMAC-SHA256), so plaintext never hits an index
 * Neither the plaintext nor these outputs may ever be logged.
 */
import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  createHash,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';
import { loadConfig } from '../config.js';

export function encryptPii(plaintext: string): string {
  const key = Buffer.from(loadConfig().PII_ENCRYPTION_KEY, 'hex');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), enc]).toString('base64');
}

export function decryptPii(payload: string): string {
  const key = Buffer.from(loadConfig().PII_ENCRYPTION_KEY, 'hex');
  const buf = Buffer.from(payload, 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const enc = buf.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}

export function phoneBlindIndex(phoneE164: string): string {
  const key = Buffer.from(loadConfig().IDENTITY_HMAC_KEY, 'hex');
  return createHmac('sha256', key).update(phoneE164).digest('hex');
}

export function emailBlindIndex(email: string): string {
  const key = Buffer.from(loadConfig().IDENTITY_HMAC_KEY, 'hex');
  return createHmac('sha256', key).update(email.trim().toLowerCase()).digest('hex');
}

/** Session tokens are opaque 256-bit values; only their sha256 is stored. */
export function newSessionToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, tokenHash: hashToken(token) };
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function newOtpCode(length = 6): string {
  // Unbiased digits via rejection sampling.
  let code = '';
  while (code.length < length) {
    const b = randomBytes(1)[0]!;
    if (b < 250) code += String(b % 10);
  }
  return code;
}

export function hashOtp(code: string, identityHmac: string): string {
  // Peppered with the HMAC key; scoped to the identity so codes can't be replayed across accounts.
  const key = Buffer.from(loadConfig().IDENTITY_HMAC_KEY, 'hex');
  return createHmac('sha256', key).update(`${identityHmac}:${code}`).digest('hex');
}

export function safeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/* ------------------------------------------------------ admin passwords */

/**
 * scrypt cost parameters. OWASP's stated minimum is N=2^17, which measures
 * ~520ms and ~128 MiB per verification here. Sahay runs on one small machine
 * (ADR-0010), so a handful of concurrent login attempts at that setting is a
 * genuine memory-exhaustion vector; the default is N=2^16 (~250ms, ~64 MiB),
 * overridable per deployment via SCRYPT_COST_LOG2 because a free-tier instance
 * may not afford even that. Tight per-username and per-IP rate limits carry the
 * rest of the load. Stored hashes carry their own parameters, so changing this
 * never invalidates an existing password.
 */
const SCRYPT = { r: 8, p: 1, keyLen: 32 } as const;
const SCRYPT_MAXMEM = 192 * 1024 * 1024;

/** Work factor for NEW hashes. Verification uses whatever the record recorded. */
function scryptN(): number {
  return 2 ** loadConfig().SCRYPT_COST_LOG2;
}

/**
 * Hashes an admin password. Output is self-describing —
 * `scrypt$N$r$p$saltB64$hashB64` — so the cost parameters can be raised later
 * without breaking passwords already on record.
 */
export function hashPassword(password: string): string {
  const N = scryptN();
  const salt = randomBytes(16);
  const hash = scryptSync(password.normalize('NFKC'), salt, SCRYPT.keyLen, {
    ...SCRYPT,
    N,
    maxmem: SCRYPT_MAXMEM,
  });
  return `scrypt$${N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

/**
 * Constant-time password check. Re-derives with the parameters recorded in the
 * stored value, so old hashes keep verifying after SCRYPT is retuned. Returns
 * false rather than throwing on a malformed record.
 */
export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, nRaw, rRaw, pRaw, saltB64, hashB64] = parts as [string, string, string, string, string, string];
  const N = Number(nRaw);
  const r = Number(rRaw);
  const p = Number(pRaw);
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return false;
  const expected = Buffer.from(hashB64, 'base64');
  if (expected.length === 0) return false;
  let actual: Buffer;
  try {
    actual = scryptSync(password.normalize('NFKC'), Buffer.from(saltB64, 'base64'), expected.length, {
      N,
      r,
      p,
      maxmem: SCRYPT_MAXMEM,
    });
  } catch {
    return false; // absurd parameters in a tampered record
  }
  return timingSafeEqual(actual, expected);
}

/**
 * Generated password handed to a new admin. 4 groups of 5 characters from an
 * unambiguous alphabet (~93 bits) — readable enough to send in a message, and
 * strong enough that these accounts never need a rotation policy.
 */
export function newAdminPassword(): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const pick = (n: number) =>
    Array.from(randomBytes(n))
      .map((b) => alphabet[b % alphabet.length])
      .join('');
  return [pick(5), pick(5), pick(5), pick(5)].join('-');
}

/** Short human-friendly code for events/invites, e.g. "K7F2-9XQ4" (no confusable chars). */
export function shortCode(prefixLen = 4, suffixLen = 4): string {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const pick = (n: number) =>
    Array.from(randomBytes(n))
      .map((b) => alphabet[b % alphabet.length])
      .join('');
  return `${pick(prefixLen)}-${pick(suffixLen)}`;
}
