import { describe, expect, it } from 'vitest';
import { LIMITS } from '@sahay/shared';
import { gateValue } from '../../src/modules/dashboard/service.js';

describe('dashboard k-anonymity gate', () => {
  it('hides values with fewer than k distinct users behind them', () => {
    expect(gateValue(42, 0)).toBeNull();
    expect(gateValue(42, 1)).toBeNull();
    expect(gateValue(42, 2)).toBeNull();
  });

  it('exposes values at and above the threshold', () => {
    expect(gateValue(42, LIMITS.kAnonymityThreshold)).toBe(42);
    expect(gateValue(42, LIMITS.kAnonymityThreshold + 5)).toBe(42);
  });

  it('gates zero the same way as any other figure (zero is information too)', () => {
    expect(gateValue(0, 1)).toBeNull();
    expect(gateValue(0, 3)).toBe(0);
  });

  it('honors a custom threshold', () => {
    expect(gateValue(7, 4, 5)).toBeNull();
    expect(gateValue(7, 5, 5)).toBe(7);
  });
});
