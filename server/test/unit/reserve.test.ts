import '../env.js';
import { describe, expect, it } from 'vitest';
import { computeReserveQty } from '../../src/modules/offers/service.js';

describe('computeReserveQty', () => {
  it('reserves the minimum of offer, remaining need, and availability', () => {
    expect(computeReserveQty({ offerQty: 4, remainingNeed: 2, available: 10, fractional: false })).toBe(2);
    expect(computeReserveQty({ offerQty: 4, remainingNeed: 10, available: 3, fractional: false })).toBe(3);
    expect(computeReserveQty({ offerQty: 1, remainingNeed: 10, available: 10, fractional: false })).toBe(1);
  });

  it('returns 0 when nothing is available or needed', () => {
    expect(computeReserveQty({ offerQty: 2, remainingNeed: 2, available: 0, fractional: false })).toBe(0);
    expect(computeReserveQty({ offerQty: 2, remainingNeed: 0, available: 5, fractional: true })).toBe(0);
    expect(computeReserveQty({ offerQty: 2, remainingNeed: -1, available: 5, fractional: true })).toBe(0);
  });

  it('clamps non-fractional categories to whole units', () => {
    expect(computeReserveQty({ offerQty: 2.5, remainingNeed: 10, available: 10, fractional: false })).toBe(2);
    expect(computeReserveQty({ offerQty: 5, remainingNeed: 10, available: 0.9, fractional: false })).toBe(0);
    expect(computeReserveQty({ offerQty: 5, remainingNeed: 0.5, available: 10, fractional: false })).toBe(0);
  });

  it('allows fractional quantities when the category permits them', () => {
    expect(computeReserveQty({ offerQty: 2.5, remainingNeed: 10, available: 10, fractional: true })).toBe(2.5);
    expect(computeReserveQty({ offerQty: 5, remainingNeed: 0.5, available: 10, fractional: true })).toBe(0.5);
  });
});
