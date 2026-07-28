import '../env.js';
import { describe, expect, it } from 'vitest';
import {
  decryptPii,
  emailBlindIndex,
  encryptPii,
  hashOtp,
  hashToken,
  newOtpCode,
  newSessionToken,
  phoneBlindIndex,
  safeEqualHex,
  shortCode,
} from '../../src/lib/crypto.js';

describe('crypto', () => {
  it('round-trips PII encryption with a fresh IV each time', () => {
    const phone = '+919876543210';
    const a = encryptPii(phone);
    const b = encryptPii(phone);
    expect(a).not.toBe(b); // random IV
    expect(decryptPii(a)).toBe(phone);
    expect(decryptPii(b)).toBe(phone);
  });

  it('produces a deterministic blind index that differs per phone', () => {
    expect(phoneBlindIndex('+919876543210')).toBe(phoneBlindIndex('+919876543210'));
    expect(phoneBlindIndex('+919876543210')).not.toBe(phoneBlindIndex('+919876543211'));
    expect(phoneBlindIndex('+919876543210')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic for the same email and differs for different emails', () => {
    const a = emailBlindIndex('person@example.com');
    const b = emailBlindIndex('person@example.com');
    const c = emailBlindIndex('other@example.com');
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it('produces a different index space than phoneBlindIndex', () => {
    // Same underlying key, different input — just confirms no accidental collision helper.
    expect(emailBlindIndex('A@B.COM')).not.toBe(phoneBlindIndex('A@B.COM'));
  });

  it('scopes OTP hashes to the phone so codes cannot be replayed across numbers', () => {
    const h1 = phoneBlindIndex('+919876543210');
    const h2 = phoneBlindIndex('+919876543211');
    expect(hashOtp('123456', h1)).toBe(hashOtp('123456', h1));
    expect(hashOtp('123456', h1)).not.toBe(hashOtp('123456', h2));
    expect(hashOtp('123456', h1)).not.toBe(hashOtp('123457', h1));
  });

  it('compares hex digests in constant time semantics', () => {
    const h = phoneBlindIndex('+919876543210');
    expect(safeEqualHex(h, h)).toBe(true);
    expect(safeEqualHex(h, phoneBlindIndex('+919876543211'))).toBe(false);
    expect(safeEqualHex(h, h.slice(2))).toBe(false); // length mismatch
  });

  it('generates 6-digit OTP codes', () => {
    for (let i = 0; i < 50; i++) expect(newOtpCode()).toMatch(/^\d{6}$/);
  });

  it('session tokens hash to their stored form', () => {
    const { token, tokenHash } = newSessionToken();
    expect(hashToken(token)).toBe(tokenHash);
    expect(token).not.toContain(tokenHash);
  });

  it('short codes avoid confusable characters', () => {
    for (let i = 0; i < 50; i++) {
      expect(shortCode()).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$/);
    }
  });
});
