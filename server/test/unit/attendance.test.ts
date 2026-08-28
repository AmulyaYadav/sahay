import '../env.js';
import { describe, expect, it } from 'vitest';
import { isReminderDue, nextDailyStart } from '../../src/workers/attendance.js';

/**
 * A multi-day event has one startsAt and one endsAt, so "the start on a given
 * day" is defined as the same time of day, repeating until endsAt.
 */
describe('nextDailyStart', () => {
  const start = new Date('2026-08-01T09:00:00Z');
  const end = new Date('2026-08-04T18:00:00Z');

  it('returns the first start when the event has not begun', () => {
    expect(nextDailyStart(start, end, new Date('2026-07-31T12:00:00Z'))?.toISOString()).toBe(
      '2026-08-01T09:00:00.000Z',
    );
  });

  it('rolls to tomorrow once today’s start has passed', () => {
    expect(nextDailyStart(start, end, new Date('2026-08-01T10:00:00Z'))?.toISOString()).toBe(
      '2026-08-02T09:00:00.000Z',
    );
  });

  it('returns null once no further day fits before the end', () => {
    // 5 Aug 09:00 would be past the 4 Aug 18:00 end.
    expect(nextDailyStart(start, end, new Date('2026-08-04T10:00:00Z'))).toBeNull();
  });

  it('returns null for an event already over', () => {
    expect(nextDailyStart(start, end, new Date('2026-08-09T10:00:00Z'))).toBeNull();
  });
});

describe('isReminderDue', () => {
  const occ = new Date('2026-08-02T09:00:00Z');

  it('fires anywhere in the tick beginning exactly 24 hours before', () => {
    expect(isReminderDue(occ, new Date('2026-08-01T09:00:00Z'))).toBe(true);
    expect(isReminderDue(occ, new Date('2026-08-01T09:00:30Z'))).toBe(true);
    // Still inside the window: it spans the whole scheduler interval, so a
    // tick landing late in it must not miss the reminder.
    expect(isReminderDue(occ, new Date('2026-08-01T09:04:59Z'))).toBe(true);
  });

  it('does not fire before or after that window', () => {
    expect(isReminderDue(occ, new Date('2026-08-01T08:59:00Z'))).toBe(false);
    // One interval later the window has passed — this is what stops it
    // re-sending on every tick for the rest of the day.
    expect(isReminderDue(occ, new Date('2026-08-01T09:05:00Z'))).toBe(false);
  });
});
