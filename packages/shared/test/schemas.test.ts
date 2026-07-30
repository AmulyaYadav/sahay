import { describe, expect, it } from 'vitest';
import { zOtpStart, zOtpVerify, zMe, zEventSummary, zPublicWant, zSetAdminWants } from '../src/schemas.js';

describe('email auth schemas', () => {
  it('zOtpStart requires a valid email, rejects phone-shaped strings', () => {
    expect(zOtpStart.safeParse({ email: 'person@example.com', locale: 'en' }).success).toBe(true);
    expect(zOtpStart.safeParse({ email: '+919876543210', locale: 'en' }).success).toBe(false);
  });

  it('zOtpVerify requires email + 6-digit code', () => {
    const result = zOtpVerify.safeParse({
      email: 'person@example.com',
      code: '123456',
      device: { platform: 'web' },
    });
    expect(result.success).toBe(true);
  });

  it('zMe exposes emailVerified, not phoneVerified', () => {
    expect(zMe.shape).toHaveProperty('emailVerified');
    expect(zMe.shape).not.toHaveProperty('phoneVerified');
  });
});

describe('public wants schemas', () => {
  it('zPublicWant requires categorySlug, source, and qty', () => {
    const result = zPublicWant.safeParse({
      categorySlug: 'water-bottle',
      source: 'admin',
      requestedQty: null,
      requesterCount: null,
    });
    expect(result.success).toBe(true);
    expect(zPublicWant.safeParse({ categorySlug: 'x', source: 'bogus' }).success).toBe(false);
  });

  it('zEventSummary includes a wants array', () => {
    expect(zEventSummary.shape).toHaveProperty('wants');
  });

  it('zSetAdminWants accepts wants with and without a quantity', () => {
    const parsed = zSetAdminWants.safeParse({
      wants: [
        { categorySlug: 'water-bottle', qty: 500 },
        { categorySlug: 'blanket', qty: null }, // needed, amount unspecified
      ],
    });
    expect(parsed.success).toBe(true);
  });

  it('zSetAdminWants rejects zero and negative quantities', () => {
    // A want of zero is not a declaration anyone can act on; omitting the
    // category says "not needed" and null says "amount unspecified".
    expect(zSetAdminWants.safeParse({ wants: [{ categorySlug: 'blanket', qty: 0 }] }).success).toBe(false);
    expect(zSetAdminWants.safeParse({ wants: [{ categorySlug: 'blanket', qty: -5 }] }).success).toBe(false);
    expect(zSetAdminWants.safeParse({ wants: [{ categorySlug: 'blanket', qty: 2.5 }] }).success).toBe(false);
  });
});
