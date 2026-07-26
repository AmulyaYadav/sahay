import type { Category, Locale, Unit } from '@sahay/shared';
import type { TFunc } from '../i18n/LocaleContext';

/** Localized category name with sensible fallbacks. */
export function categoryName(cat: Pick<Category, 'name' | 'slug'> | undefined, locale: Locale): string {
  if (!cat) return '';
  return cat.name[locale] ?? cat.name.en ?? cat.name.hi ?? cat.slug;
}

export function unitLabel(t: TFunc, unit: Unit): string {
  return t(`units.${unit}`);
}

export function formatDateTime(iso: string, locale: Locale): string {
  try {
    return new Intl.DateTimeFormat(locale === 'hi' ? 'hi-IN' : 'en-IN', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function formatTime(iso: string, locale: Locale): string {
  try {
    return new Intl.DateTimeFormat(locale === 'hi' ? 'hi-IN' : 'en-IN', { timeStyle: 'short' }).format(
      new Date(iso),
    );
  } catch {
    return iso;
  }
}

/** "March 2026" style month label for memberSince values that are already formatted or ISO. */
export function formatMonth(value: string, locale: Locale): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value; // server already sends "March 2026"
  try {
    return new Intl.DateTimeFormat(locale === 'hi' ? 'hi-IN' : 'en-IN', {
      month: 'long',
      year: 'numeric',
    }).format(d);
  } catch {
    return value;
  }
}

export function minutesUntil(iso: string): number {
  return Math.max(0, Math.round((new Date(iso).getTime() - Date.now()) / 60000));
}

export function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `k${Date.now()}${Math.random().toString(36).slice(2, 12)}`;
}
