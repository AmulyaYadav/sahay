import '../env.js';
import { describe, expect, it } from 'vitest';
import { PSEUDONYM_ADJECTIVES, PSEUDONYM_NOUNS } from '@sahay/shared';
import { randomPseudonym } from '../../src/modules/auth/service.js';
import { canRegeneratePseudonym, PSEUDONYM_REGEN_DAYS } from '../../src/modules/users/service.js';

const DAY = 24 * 3600_000;

describe('canRegeneratePseudonym', () => {
  const now = new Date('2026-07-26T12:00:00Z');

  it('allows when never changed', () => {
    expect(canRegeneratePseudonym(null, now)).toBe(true);
  });

  it('denies within the 30-day window', () => {
    expect(canRegeneratePseudonym(new Date(now.getTime() - 1 * DAY), now)).toBe(false);
    expect(canRegeneratePseudonym(new Date(now.getTime() - 29 * DAY), now)).toBe(false);
    expect(
      canRegeneratePseudonym(new Date(now.getTime() - PSEUDONYM_REGEN_DAYS * DAY + 1), now),
    ).toBe(false);
  });

  it('allows at and after exactly 30 days', () => {
    expect(canRegeneratePseudonym(new Date(now.getTime() - PSEUDONYM_REGEN_DAYS * DAY), now)).toBe(true);
    expect(canRegeneratePseudonym(new Date(now.getTime() - 90 * DAY), now)).toBe(true);
  });
});

describe('randomPseudonym', () => {
  it('always composes a known adjective and noun', () => {
    for (let i = 0; i < 50; i++) {
      const [adj, noun] = randomPseudonym().split(' ');
      expect(PSEUDONYM_ADJECTIVES).toContain(adj);
      expect(PSEUDONYM_NOUNS).toContain(noun);
    }
  });
});
