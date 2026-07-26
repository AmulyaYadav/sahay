import { describe, expect, it } from 'vitest';
import { MODERATION_ACTIONS } from '@sahay/shared';
import {
  actionAllowedForRole,
  MODERATOR_MAX_SUSPEND_HOURS,
} from '../../src/modules/admin/service.js';

describe('moderation action allowlist per role', () => {
  it('ordinary users may do nothing', () => {
    for (const action of MODERATION_ACTIONS) {
      expect(actionAllowedForRole(action, 'user')).toBe(false);
    }
  });

  it('admins may do everything, including indefinite suspensions', () => {
    for (const action of MODERATION_ACTIONS) {
      expect(actionAllowedForRole(action, 'admin')).toBe(true);
    }
    expect(actionAllowedForRole('suspend', 'admin')).toBe(true); // no duration = indefinite
    expect(actionAllowedForRole('suspend', 'admin', 24 * 90)).toBe(true);
  });

  it('moderators get the standard toolkit', () => {
    for (const action of [
      'warn', 'restrict_requests', 'restrict_helping', 'event_pause', 'event_unpause',
      'event_approve_public', 'event_reject_public', 'match_cancel', 'report_resolve', 'report_dismiss',
    ]) {
      expect(actionAllowedForRole(action, 'moderator'), action).toBe(true);
    }
  });

  it('moderators cannot unsuspend or disable events', () => {
    expect(actionAllowedForRole('unsuspend', 'moderator')).toBe(false);
    expect(actionAllowedForRole('event_disable', 'moderator')).toBe(false);
  });

  it('moderator suspensions must be bounded at 168 hours', () => {
    expect(actionAllowedForRole('suspend', 'moderator')).toBe(false); // indefinite
    expect(actionAllowedForRole('suspend', 'moderator', MODERATOR_MAX_SUSPEND_HOURS)).toBe(true);
    expect(actionAllowedForRole('suspend', 'moderator', MODERATOR_MAX_SUSPEND_HOURS + 1)).toBe(false);
  });

  it('unknown actions are rejected for every role', () => {
    expect(actionAllowedForRole('delete_database', 'admin')).toBe(false);
    expect(actionAllowedForRole('', 'moderator')).toBe(false);
  });
});
