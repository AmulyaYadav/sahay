/**
 * PII crypto helpers. Phone numbers are the only direct identifier we hold:
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
  const key = Buffer.from(loadConfig().PHONE_HMAC_KEY, 'hex');
  return createHmac('sha256', key).update(phoneE164).digest('hex');
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

export function hashOtp(code: string, phoneHmac: string): string {
  // Peppered with the HMAC key; scoped to the phone so codes can't be replayed across numbers.
  const key = Buffer.from(loadConfig().PHONE_HMAC_KEY, 'hex');
  return createHmac('sha256', key).update(`${phoneHmac}:${code}`).digest('hex');
}

export function safeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  return ba.length === bb.length && timingSafeEqual(ba, bb);
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
