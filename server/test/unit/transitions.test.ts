import '../env.js';
import { describe, expect, it } from 'vitest';
import { REQUEST_STATUSES, type RequestStatus } from '@sahay/shared';
import { canTransition, REQUEST_TRANSITIONS } from '../../src/modules/requests/transitions.js';

describe('request transition table', () => {
  it('covers every status (plus the virtual pre-creation state)', () => {
    for (const status of REQUEST_STATUSES) {
      expect(REQUEST_TRANSITIONS[status], status).toBeDefined();
    }
    expect(REQUEST_TRANSITIONS.none).toEqual(['searching']);
  });

  it('permits the lifecycle transitions the flows rely on', () => {
    const allowed: ['none' | RequestStatus, RequestStatus][] = [
      ['none', 'searching'], // create
      ['searching', 'offering'], // offer created
      ['offering', 'searching'], // decline / timeout / insufficient inventory
      ['offering', 'matched'], // accept
      ['matched', 'fulfilled'], // both confirm, covered
      ['matched', 'partially_fulfilled'], // both confirm, partial
      ['matched', 'searching'], // helper cancel / settled with 0
      ['matched', 'cancelled'], // requester cancel
      ['searching', 'cancelled'],
      ['offering', 'cancelled'],
      ['searching', 'expired'],
      ['searching', 'no_match'],
      ['offering', 'expired'],
      ['expired', 'searching'], // renew
      ['no_match', 'searching'], // renew
      ['cancelled', 'searching'], // renew
      ['partially_fulfilled', 'searching'], // continue
      ['partially_fulfilled', 'fulfilled'], // close after partial
      ['searching', 'moderated'],
      ['matched', 'moderated'],
    ];
    for (const [from, to] of allowed) {
      expect(canTransition(from, to), `${from} -> ${to}`).toBe(true);
    }
  });

  it('rejects transitions the state machine forbids', () => {
    const rejected: ['none' | RequestStatus, RequestStatus][] = [
      ['fulfilled', 'searching'], // terminal
      ['disputed', 'searching'], // terminal
      ['moderated', 'searching'], // terminal
      ['searching', 'matched'], // must pass through offering
      ['searching', 'fulfilled'],
      ['offering', 'no_match'], // offering implies a prior offer → 'expired'
      ['matched', 'offering'],
      ['matched', 'expired'],
      ['cancelled', 'offering'],
      ['none', 'offering'],
      ['fulfilled', 'fulfilled'],
    ];
    for (const [from, to] of rejected) {
      expect(canTransition(from, to), `${from} -> ${to}`).toBe(false);
    }
  });

  it('never allows entering the unused request-level disputed state', () => {
    for (const from of Object.keys(REQUEST_TRANSITIONS) as ('none' | RequestStatus)[]) {
      expect(canTransition(from, 'disputed'), `${from} -> disputed`).toBe(false);
    }
  });
});
