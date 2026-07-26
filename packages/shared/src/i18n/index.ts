import { en, type StringCatalog } from './en.js';
import { hi } from './hi.js';

export type Locale = 'en' | 'hi';
export const catalogs: Record<Locale, StringCatalog> = { en, hi };
export { en, hi };
export type { StringCatalog };

/** Dot-path lookup with {{param}} interpolation. Falls back to English, then the key itself. */
export function t(
  locale: Locale,
  key: string,
  params?: Record<string, string | number>,
): string {
  const resolve = (cat: StringCatalog): string | undefined => {
    let node: unknown = cat;
    for (const part of key.split('.')) {
      if (node == null || typeof node !== 'object') return undefined;
      node = (node as Record<string, unknown>)[part];
    }
    return typeof node === 'string' ? node : undefined;
  };
  let s = resolve(catalogs[locale]) ?? resolve(en) ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      s = s.replaceAll(`{{${k}}}`, String(v));
    }
  }
  return s;
}
