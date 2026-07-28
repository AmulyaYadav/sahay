import { describe, expect, it } from 'vitest';
import { en } from '../src/i18n/en.js';
import { hi } from '../src/i18n/hi.js';

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
});
