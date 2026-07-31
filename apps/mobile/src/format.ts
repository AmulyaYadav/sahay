import type { Locale } from '@sahay/shared';

/** Locale-aware short date-time, e.g. "26 Jul, 10:24". */
export function formatDateTime(iso: string, locale: Locale): string {
  try {
    return new Date(iso).toLocaleString(locale === 'hi' ? 'hi-IN' : 'en-IN', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export function formatTime(iso: string, locale: Locale): string {
  try {
    return new Date(iso).toLocaleTimeString(locale === 'hi' ? 'hi-IN' : 'en-IN', {
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export function formatMonthYear(iso: string, locale: Locale): string {
  try {
    return new Date(iso).toLocaleDateString(locale === 'hi' ? 'hi-IN' : 'en-IN', {
      month: 'long',
      year: 'numeric',
    });
  } catch {
    return iso;
  }
}

export function secondsUntil(iso: string): number {
  return Math.max(0, Math.floor((new Date(iso).getTime() - Date.now()) / 1000));
}

export function minutesUntil(iso: string): number {
  return Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 60000));
}

/**
 * "30 Jul – 1 Aug" — the compact range the event cards use in the mockups. Drops
 * the year and the time, which the card has no room for; the event detail screen
 * still shows the full range.
 */
export function shortDateRange(startsAt: string, endsAt: string, locale: 'en' | 'hi'): string {
  const tag = locale === 'hi' ? 'hi-IN' : 'en-IN';
  const fmt = new Intl.DateTimeFormat(tag, { day: 'numeric', month: 'short' });
  const from = fmt.format(new Date(startsAt));
  const to = fmt.format(new Date(endsAt));
  return from === to ? from : `${from} – ${to}`;
}
