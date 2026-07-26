import type { ReliabilityLabel } from './constants.js';

/**
 * Reliability model (documented in docs/reliability.md).
 *
 * Pure functions so the exact same math runs in server code and unit tests.
 * Design goals: no five-star score, smoothing so new users aren't punished,
 * declines are free, abandonment costs, old failures decay.
 */

export interface ReliabilityCounters {
  accepted: number;
  completed: number; // includes partial completions
  requesterConfirmed: number;
  cancelledPreMeeting: number;
  cancelledPostMeeting: number;
  timeouts: number; // accepted then went silent
  noShows: number; // confirmed no-shows
  disputes: number;
  offersReceived30d: number;
  offersResponded30d: number; // accept OR decline (both count as responsive)
}

/**
 * Smoothed completion score in [0,1]. Laplace prior of 2 successes / 4 trials
 * means a brand-new helper scores 0.5 and cannot be ranked to the floor.
 */
export function completionScore(c: ReliabilityCounters): number {
  const bad = c.cancelledPostMeeting + c.timeouts + c.noShows;
  const trials = c.completed + c.cancelledPreMeeting * 0.25 + bad;
  return (c.completed + 2) / (trials + 4);
}

/** Responsiveness in [0,1]; unknown (no recent offers) treated as neutral 0.7. */
export function responsivenessScore(c: ReliabilityCounters): number {
  if (c.offersReceived30d < 3) return 0.7;
  return c.offersResponded30d / c.offersReceived30d;
}

export function reliabilityLabel(c: ReliabilityCounters): ReliabilityLabel {
  if (c.completed < 3) return 'new_helper';
  const score = completionScore(c);
  if (c.completed >= 20 && score >= 0.85) return 'highly_reliable_helper';
  if (c.completed >= 8 && score >= 0.75) return 'reliable_helper';
  return 'active_helper';
}

/** Composite used by the matching ranker (never displayed to users). */
export function rankingReliability(c: ReliabilityCounters): number {
  return 0.7 * completionScore(c) + 0.3 * responsivenessScore(c);
}
