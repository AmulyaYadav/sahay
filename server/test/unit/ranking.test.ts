import '../env.js';
import { describe, expect, it } from 'vitest';
import type { ReliabilityCounters } from '@sahay/shared';
import {
  rankCandidates,
  scoreCandidate,
  type Candidate,
} from '../../src/workers/matching.js';

const zeroCounters: ReliabilityCounters = {
  accepted: 0,
  completed: 0,
  requesterConfirmed: 0,
  cancelledPreMeeting: 0,
  cancelledPostMeeting: 0,
  timeouts: 0,
  noShows: 0,
  disputes: 0,
  offersReceived30d: 0,
  offersResponded30d: 0,
};

const stellarCounters: ReliabilityCounters = {
  ...zeroCounters,
  accepted: 30,
  completed: 30,
  requesterConfirmed: 30,
  offersReceived30d: 10,
  offersResponded30d: 10,
};

const poorCounters: ReliabilityCounters = {
  ...zeroCounters,
  accepted: 20,
  completed: 2,
  cancelledPostMeeting: 10,
  noShows: 5,
  offersReceived30d: 10,
  offersResponded30d: 2,
};

function candidate(overrides: Partial<Candidate>): Candidate {
  return {
    helperId: 'h',
    itemId: 'i',
    availableQty: 1,
    distanceM: 100,
    recentOffers: 0,
    counters: zeroCounters,
    ...overrides,
  };
}

// rng pinned to 0 so ordering is deterministic.
const noJitter = () => 0;

describe('matching ranker', () => {
  it('distance bucket beats reliability: a nearby poor helper outranks a farther stellar one', () => {
    const nearPoor = candidate({ helperId: 'near-poor', distanceM: 100, counters: poorCounters });
    const farStellar = candidate({ helperId: 'far-stellar', distanceM: 900, counters: stellarCounters });
    const ranked = rankCandidates([farStellar, nearPoor], noJitter);
    expect(ranked[0]!.helperId).toBe('near-poor');
  });

  it('within the same bucket, higher reliability wins', () => {
    const poor = candidate({ helperId: 'poor', distanceM: 100, counters: poorCounters });
    const stellar = candidate({ helperId: 'stellar', distanceM: 120, counters: stellarCounters });
    const ranked = rankCandidates([poor, stellar], noJitter);
    expect(ranked[0]!.helperId).toBe('stellar');
  });

  it('fairness penalty: a recently-asked helper yields to an equal peer, capped at 5', () => {
    const fresh = candidate({ helperId: 'fresh', recentOffers: 0 });
    const hammered = candidate({ helperId: 'hammered', recentOffers: 4 });
    expect(rankCandidates([hammered, fresh], noJitter)[0]!.helperId).toBe('fresh');
    // Cap: 5 and 50 recent offers score the same.
    expect(scoreCandidate(candidate({ recentOffers: 5 }), 0)).toBe(
      scoreCandidate(candidate({ recentOffers: 50 }), 0),
    );
  });

  it('fairness cannot outweigh a distance bucket, jitter cannot flip a bucket', () => {
    const nearButHammered = candidate({ helperId: 'near', distanceM: 100, recentOffers: 3 });
    const fartherFresh = candidate({ helperId: 'far', distanceM: 900, recentOffers: 0 });
    expect(rankCandidates([fartherFresh, nearButHammered], noJitter)[0]!.helperId).toBe('near');
    // Worst case for near (jitter 1) still beats best case for far (jitter 0).
    expect(scoreCandidate(nearButHammered, 1)).toBeLessThan(scoreCandidate(fartherFresh, 0));
  });

  it('helpers with unknown location always sort last', () => {
    const unknownStellar = candidate({ helperId: 'unknown', distanceM: null, counters: stellarCounters });
    const fartherPoor = candidate({ helperId: 'farther', distanceM: 3000, counters: poorCounters });
    const ranked = rankCandidates([unknownStellar, fartherPoor], noJitter);
    expect(ranked[ranked.length - 1]!.helperId).toBe('unknown');
  });

  it('lower score ranks first and jitter is bounded by the injected rng', () => {
    const a = candidate({ helperId: 'a', distanceM: 50 });
    const b = candidate({ helperId: 'b', distanceM: 50 });
    // Identical candidates: rng decides.
    let calls = 0;
    const rng = () => (calls++ === 0 ? 0.9 : 0.1);
    expect(rankCandidates([a, b], rng)[0]!.helperId).toBe('b');
  });
});
