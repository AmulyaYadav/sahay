/**
 * "24 hours to go" attendance reminders.
 *
 * An event has one startsAt and one endsAt, so a multi-day event has no explicit
 * per-day schedule. We treat it as recurring at the SAME TIME OF DAY as startsAt,
 * once per day, until endsAt — so an event running 31 Jul 09:00 → 7 Aug 18:00 has
 * daily starts at 09:00 on each of those days, and a reminder fires 24 hours
 * before each one.
 *
 * Dedupe is by (event, occurrence day) via the notify queue's job id, so a tick
 * that overlaps a previous one cannot double-send.
 */
import { and, eq, gt, isNull, inArray } from 'drizzle-orm';
import { t } from '@sahay/shared';
import { getDb, schema } from '../db/index.js';
import { notifyQueue } from '../queues.js';
import { RETENTION_EVERY_MS } from './schedule.js';

/**
 * The tick window must cover the scheduler interval, or a reminder falls
 * between ticks — hence the shared constant rather than a literal. Widening it
 * cannot cause a double send: the notify job id dedupes by (event, day).
 */
const TICK_MS = RETENTION_EVERY_MS;

/**
 * The next daily occurrence of the event's start time at or after `from`,
 * bounded by endsAt. Returns null once the event has no further days.
 */
export function nextDailyStart(startsAt: Date, endsAt: Date, from: Date): Date | null {
  const occ = new Date(startsAt);
  // Walk forward a day at a time rather than computing with fixed 24h maths, so
  // the local wall-clock time survives a daylight-saving shift.
  while (occ.getTime() < from.getTime()) {
    occ.setDate(occ.getDate() + 1);
    if (occ.getTime() > endsAt.getTime()) return null;
  }
  return occ.getTime() <= endsAt.getTime() ? occ : null;
}

/** True when `now` falls in the one-tick window 24h before the occurrence. */
export function isReminderDue(occurrence: Date, now: Date): boolean {
  const due = occurrence.getTime() - 24 * 60 * 60 * 1000;
  return now.getTime() >= due && now.getTime() < due + TICK_MS;
}

export async function sendAttendanceReminders(now: Date = new Date()): Promise<void> {
  const db = getDb();

  const events = await db
    .select({
      id: schema.events.id,
      title: schema.events.title,
      startsAt: schema.events.startsAt,
      endsAt: schema.events.endsAt,
    })
    .from(schema.events)
    .where(and(inArray(schema.events.status, ['scheduled', 'active']), gt(schema.events.endsAt, now)));

  for (const ev of events) {
    const occ = nextDailyStart(ev.startsAt, ev.endsAt, now);
    if (!occ || !isReminderDue(occ, now)) continue;

    const members = await db
      .select({ userId: schema.memberships.userId, locale: schema.users.locale })
      .from(schema.memberships)
      .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
      .where(
        and(
          eq(schema.memberships.eventId, ev.id),
          isNull(schema.memberships.leftAt),
          eq(schema.memberships.banned, false),
          isNull(schema.users.deletedAt),
        ),
      );

    const day = occ.toISOString().slice(0, 10);
    for (const m of members) {
      const locale = m.locale === 'hi' ? 'hi' : 'en';
      await notifyQueue().add(
        'notify',
        {
          userId: m.userId,
          type: 'attendance_check',
          titleKey: 'notifications.attendanceTitle',
          bodyKey: 'notifications.attendanceBody',
          // The event title is user-visible content, not a translation key.
          params: { event: ev.title, eventId: ev.id, occurrence: day },
          dedupeKey: `attendance:${ev.id}:${m.userId}:${day}`,
        },
        // Same key twice in a window is the same reminder, not two.
        { jobId: `attendance:${ev.id}:${m.userId}:${day}` },
      );
      void t; // locale is carried on the notification row; templates resolve per user
    }
  }
}
