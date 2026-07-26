import { describe, expect, it } from 'vitest';
import { computeShortage } from '../../src/modules/events/bring.js';

const base = { kAnonymityThreshold: 3 };

describe('computeShortage', () => {
  it('returns unknown when both sides are below the k-anonymity threshold', () => {
    expect(
      computeShortage({ ...base, requestedQty: 50, offeredQty: 0, distinctRequesters: 2, distinctOfferers: 2 }),
    ).toBe('unknown');
    expect(
      computeShortage({ ...base, requestedQty: 0, offeredQty: 0, distinctRequesters: 0, distinctOfferers: 0 }),
    ).toBe('unknown');
  });

  it('is not unknown when one side alone clears the threshold', () => {
    expect(
      computeShortage({ ...base, requestedQty: 40, offeredQty: 0, distinctRequesters: 5, distinctOfferers: 0 }),
    ).toBe('critical_shortage');
  });

  it('handles zero demand', () => {
    expect(
      computeShortage({ ...base, requestedQty: 0, offeredQty: 50, distinctRequesters: 0, distinctOfferers: 4 }),
    ).toBe('possible_surplus');
    expect(
      computeShortage({ ...base, requestedQty: 0, offeredQty: 2, distinctRequesters: 0, distinctOfferers: 4 }),
    ).toBe('adequate');
  });

  it('buckets by offered/requested ratio', () => {
    const at = (offered: number, requested: number) =>
      computeShortage({
        ...base,
        requestedQty: requested,
        offeredQty: offered,
        distinctRequesters: 5,
        distinctOfferers: 5,
      });
    expect(at(2, 10)).toBe('critical_shortage'); // 0.2
    expect(at(5, 10)).toBe('high_need'); // 0.5
    expect(at(10, 10)).toBe('moderate_need'); // 1.0
    expect(at(20, 10)).toBe('adequate'); // 2.0
    expect(at(40, 10)).toBe('possible_surplus'); // 4.0
  });

  it('treats exact boundaries as the next-less-severe bucket', () => {
    const at = (ratio: number) =>
      computeShortage({
        ...base,
        requestedQty: 100,
        offeredQty: ratio * 100,
        distinctRequesters: 5,
        distinctOfferers: 5,
      });
    expect(at(0.25)).toBe('high_need');
    expect(at(0.75)).toBe('moderate_need');
    expect(at(1.25)).toBe('adequate');
    expect(at(3)).toBe('possible_surplus');
  });
});
