import { describe, expect, it } from 'vitest';
import { en } from '../src/i18n/en.js';
import { hi } from '../src/i18n/hi.js';
import { ACTIVE_NOTIFICATION_TYPES, NOTIFICATION_TYPES } from '../src/constants.js';

function flatten(obj: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    typeof v === 'object' && v !== null ? flatten(v as Record<string, unknown>, `${prefix}${k}.`) : [`${prefix}${k}`],
  );
}

describe('i18n key parity', () => {
  it('en and hi expose exactly the same keys', () => {
    const enKeys = flatten(en as Record<string, unknown>).sort();
    const hiKeys = flatten(hi as Record<string, unknown>).sort();
    expect(hiKeys).toEqual(enKeys);
  });

  it('has no leftover phone-labelled auth/reliability keys', () => {
    const enKeys = flatten(en as Record<string, unknown>);
    expect(enKeys).toContain('auth.emailLabel');
    expect(enKeys).toContain('auth.emailWhy');
    expect(enKeys).toContain('reliability.emailVerified');
    expect(enKeys).not.toContain('auth.phoneLabel');
    expect(enKeys).not.toContain('reliability.phoneVerified');
  });

  it('reliability.verifiedMeaning does not reference "Phone"', () => {
    expect(en.reliability.verifiedMeaning).not.toContain('Phone');
  });

  it('every switchable notification type has a label to switch', () => {
    // The settings screen renders one row per ACTIVE_NOTIFICATION_TYPES entry
    // and labels it from this catalogue; a missing key would render a blank row.
    for (const type of ACTIVE_NOTIFICATION_TYPES) {
      expect(flatten(en as Record<string, unknown>)).toContain(`notifications.${type}`);
    }
  });

  it('only lists notification types that something actually sends', () => {
    // Five types were declared but never emitted, so settings offered switches
    // over notifications that could not arrive. Keep the two lists honest.
    for (const type of ACTIVE_NOTIFICATION_TYPES) {
      expect(NOTIFICATION_TYPES).toContain(type);
    }
    for (const dead of ['request_expiring', 'inventory_low', 'event_starting'] as const) {
      expect(ACTIVE_NOTIFICATION_TYPES).not.toContain(dead);
    }
  });
});
