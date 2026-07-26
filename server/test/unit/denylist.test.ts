import { describe, expect, it } from 'vitest';
import { DEFAULT_CATALOGUE } from '@sahay/shared';
import { violatesDenylist } from '../../src/modules/admin/service.js';

describe('catalogue denylist enforcement', () => {
  it('rejects prohibited slugs', () => {
    expect(violatesDenylist('pain-medicine', { en: 'Pain relief' })).toBe(true);
    expect(violatesDenylist('beer-bottle', { en: 'Cold drink' })).toBe(true);
    expect(violatesDenylist('pocket-knife', { en: 'Utility tool' })).toBe(true);
    expect(violatesDenylist('petrol-can', { en: 'Canister' })).toBe(true);
  });

  it('rejects prohibited localized names even with an innocent slug', () => {
    expect(violatesDenylist('supplies', { en: 'Antibiotic tablets', hi: 'दवा' })).toBe(true);
    expect(violatesDenylist('warmers', { en: 'Blanket', hi: 'Whisky liquor pack' })).toBe(true);
  });

  it('accepts ordinary humanitarian goods', () => {
    expect(violatesDenylist('water-bottle', { en: 'Sealed water bottle' })).toBe(false);
    expect(violatesDenylist('blanket', { en: 'Blanket', hi: 'कंबल' })).toBe(false);
    expect(violatesDenylist('power-bank', { en: 'Power bank (charged)' })).toBe(false);
  });

  it('never flags anything in the shipped default catalogue', () => {
    for (const seed of DEFAULT_CATALOGUE) {
      expect(violatesDenylist(seed.slug, seed.name), seed.slug).toBe(false);
    }
  });

  it('tolerates a missing name record', () => {
    expect(violatesDenylist('water-bottle', null)).toBe(false);
    expect(violatesDenylist('vape-pen', undefined)).toBe(true);
  });
});
