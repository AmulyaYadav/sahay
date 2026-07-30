import { describe, expect, it } from 'vitest';
import { zOtpStart, zOtpVerify, zMe, zEventSummary, zPublicWant, zSetAdminWants } from '../src/schemas.js';
import { DEFAULT_CATALOGUE, categoryDisplayName } from '../src/catalogue-defaults.js';

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

describe('categoryDisplayName', () => {
  const torch = { slug: 'torch', name: { en: 'Torch', hi: 'टॉर्च' }, namePlural: { en: 'Torches' } };
  const biscuits = { slug: 'biscuits', name: { en: 'Biscuits', hi: 'बिस्कुट' } };

  it('uses the singular with no count and with exactly one', () => {
    expect(categoryDisplayName(torch, 'en')).toBe('Torch');
    expect(categoryDisplayName(torch, 'en', null)).toBe('Torch');
    expect(categoryDisplayName(torch, 'en', 1)).toBe('Torch');
  });

  it('uses the plural for any other count', () => {
    expect(categoryDisplayName(torch, 'en', 2)).toBe('Torches');
    expect(categoryDisplayName(torch, 'en', 40)).toBe('Torches');
    // 0 is not a count we render, but it must not silently read as singular.
    expect(categoryDisplayName(torch, 'en', 0)).toBe('Torches');
  });

  it('keeps the name when no distinct plural is recorded', () => {
    // Already-plural and mass nouns carry no namePlural on purpose.
    expect(categoryDisplayName(biscuits, 'en', 12)).toBe('Biscuits');
  });

  it('falls back to the singular in a locale that has no plural form', () => {
    // Hindi records no plurals: the counted string puts the number after the
    // noun, so inflection is not called for.
    expect(categoryDisplayName(torch, 'hi', 40)).toBe('टॉर्च');
  });

  it('falls back through locale, then English, then slug', () => {
    expect(categoryDisplayName(torch, 'ta', 40)).toBe('Torches'); // no 'ta' plural → en plural
    expect(categoryDisplayName({ slug: 'x', name: {} }, 'en', 3)).toBe('x');
  });

  it('every default-catalogue plural differs from its singular', () => {
    // A plural identical to the name is dead data — it should have been omitted.
    for (const c of DEFAULT_CATALOGUE) {
      if (c.namePlural?.en) expect(c.namePlural.en, c.slug).not.toBe(c.name.en);
    }
  });
});
