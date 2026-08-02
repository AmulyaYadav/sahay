import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * When to ask "are you coming?".
 *
 * The attend → warrior → carry flow had no trigger at all: `event_starting`
 * exists as a notification type but nothing ever emits it, and there is no
 * scheduled job. So the flow was unreachable except by typing a URL.
 *
 * A push at a fixed hour cannot be the only trigger anyway. Someone who joins at
 * 13:00 for an event starting at 14:00 would be told nothing until the evening,
 * by which point the event is over. So the app asks at the moment the question
 * becomes answerable — on joining, and on opening the app — and remembers the
 * answer for the rest of that day.
 */

/** One key per event; the value is the local date the question was last answered. */
const key = (eventId: string) => `sahay.attendanceAnswered.${eventId}`;

/** Local calendar day, not UTC: "today" means the user's today. */
export function localDayStamp(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export async function markAttendanceAnswered(eventId: string): Promise<void> {
  await AsyncStorage.setItem(key(eventId), localDayStamp()).catch(() => {});
}

export async function answeredToday(eventId: string): Promise<boolean> {
  const v = await AsyncStorage.getItem(key(eventId)).catch(() => null);
  return v === localDayStamp();
}

/**
 * True when the event is running today — it has started (or starts today) and has
 * not ended. Anything further out is not yet a question worth asking; the
 * evening-before nudge is the scheduled job's job, once that exists.
 */
export function happeningToday(startsAt: string, endsAt: string, now: Date = new Date()): boolean {
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  if (end.getTime() <= now.getTime()) return false; // already over
  const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  // Either it is already under way, or it begins before midnight tonight.
  return start.getTime() <= endOfToday.getTime();
}

/** Combines the two checks a caller actually wants. */
export async function shouldAskAttendance(event: {
  id: string;
  startsAt: string;
  endsAt: string;
}): Promise<boolean> {
  if (!happeningToday(event.startsAt, event.endsAt)) return false;
  return !(await answeredToday(event.id));
}

/**
 * The day this prompt is about: today if the event is already running or starts
 * later today, otherwise its next start. Used for the heading and the date, both
 * of which previously showed the event's original startsAt — so a multi-day event
 * already under way said "Tomorrow's the day!" above a date in the past.
 */
export function relevantOccurrence(
  startsAt: string,
  endsAt: string,
  now: Date = new Date(),
): { when: Date; isToday: boolean } {
  const occ = new Date(startsAt);
  const end = new Date(endsAt);
  while (occ.getTime() < now.getTime() && occ.getTime() < end.getTime()) {
    occ.setDate(occ.getDate() + 1);
  }
  const running = happeningToday(startsAt, endsAt, now);
  const sameDay =
    occ.getFullYear() === now.getFullYear() &&
    occ.getMonth() === now.getMonth() &&
    occ.getDate() === now.getDate();
  return { when: occ, isToday: running && (sameDay || new Date(startsAt) <= now) };
}
