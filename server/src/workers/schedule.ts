/**
 * How often the repeatable retention tasks run.
 *
 * Its own module because two places must agree on it: the scheduler in
 * index.ts, and the tick window in attendance.ts that decides whether a
 * reminder is due. If the window were shorter than the interval, reminders
 * would fall between ticks and never send. Importing it from index.ts instead
 * would close a cycle (index → retention → attendance → index).
 *
 * Five minutes, not one: nothing here is user-facing enough to need
 * minute-level latency, and every tick costs a job record per task in Redis.
 * At eleven tasks that is the difference between ~16k and ~3k records a day.
 */
export const RETENTION_EVERY_MS = 5 * 60_000;
