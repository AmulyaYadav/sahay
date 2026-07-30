import '../env.js';
import { scryptSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  decryptPii,
  emailBlindIndex,
  encryptPii,
  hashOtp,
  hashPassword,
  hashToken,
  newAdminPassword,
  newOtpCode,
  newSessionToken,
  phoneBlindIndex,
  safeEqualHex,
  shortCode,
  verifyPassword,
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
    // Uppercase input is required: emailBlindIndex lowercases before hashing, so this only produces a different digest than phoneBlindIndex because normalization actually changes the string. Do not simplify to a lowercase input — that would make phoneBlindIndex and emailBlindIndex hash the identical string and this assertion would pass vacuously.
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

describe('admin password hashing', () => {
  it('verifies a correct password and rejects a wrong one', () => {
    const stored = hashPassword('correct horse battery staple');
    expect(verifyPassword('correct horse battery staple', stored)).toBe(true);
    expect(verifyPassword('Correct horse battery staple', stored)).toBe(false);
    expect(verifyPassword('', stored)).toBe(false);
  });

  it('salts each hash, so the same password stores differently every time', () => {
    const a = hashPassword('same-password');
    const b = hashPassword('same-password');
    expect(a).not.toBe(b);
    expect(verifyPassword('same-password', a)).toBe(true);
    expect(verifyPassword('same-password', b)).toBe(true);
  });

  it('records its own cost parameters so they can be retuned later', () => {
    const stored = hashPassword('pw');
    const [scheme, n, r, p] = stored.split('$');
    expect(scheme).toBe('scrypt');
    expect(Number(n)).toBeGreaterThanOrEqual(2 ** 14);
    expect([Number(r), Number(p)]).toEqual([8, 1]);
  });

  it('still verifies a hash written with different cost parameters', () => {
    // Simulates a record from before SCRYPT was retuned.
    const salt = Buffer.from('0123456789abcdef');
    const weak = scryptSync('legacy-pw', salt, 32, { N: 2 ** 14, r: 8, p: 1 });
    const stored = `scrypt$${2 ** 14}$8$1$${salt.toString('base64')}$${weak.toString('base64')}`;
    expect(verifyPassword('legacy-pw', stored)).toBe(true);
    expect(verifyPassword('other-pw', stored)).toBe(false);
  });

  it('returns false for malformed or tampered records instead of throwing', () => {
    for (const bad of ['', 'nonsense', 'scrypt$1$2$3', 'bcrypt$1$8$1$c2FsdA==$aGFzaA==', 'scrypt$x$8$1$c2FsdA==$aGFzaA==']) {
      expect(verifyPassword('pw', bad)).toBe(false);
    }
  });

  it('generates distinct, unambiguous passwords', () => {
    const pws = Array.from({ length: 20 }, () => newAdminPassword());
    expect(new Set(pws).size).toBe(20);
    for (const pw of pws) {
      expect(pw).toMatch(/^[a-zA-Z2-9]{5}(-[a-zA-Z2-9]{5}){3}$/);
      expect(pw).not.toMatch(/[ilIO01]/); // confusable characters excluded
    }
  });
});
