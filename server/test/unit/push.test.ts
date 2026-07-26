import '../env.js';
import { afterEach, describe, expect, it } from 'vitest';
import { resetConfigForTests } from '../../src/config.js';
import {
  ConsolePushProvider,
  ExpoPushProvider,
  WebPushProvider,
  getPushProviders,
} from '../../src/lib/push.js';
import { buildPushPayload, VAGUE_PREVIEW_TYPES } from '../../src/workers/notify.js';

const offerJob = {
  type: 'match_offer',
  titleKey: 'offer.title',
  bodyKey: 'notifications.vaguePreview',
  params: {},
  deepLink: '/offer/x',
};

afterEach(() => {
  delete process.env.PUSH_PROVIDER;
  delete process.env.VAPID_PUBLIC_KEY;
  delete process.env.VAPID_PRIVATE_KEY;
  delete process.env.VAPID_SUBJECT;
  resetConfigForTests();
});

describe('getPushProviders selection', () => {
  it('returns only the console provider when PUSH_PROVIDER=console', () => {
    process.env.PUSH_PROVIDER = 'console';
    resetConfigForTests();
    const providers = getPushProviders();
    expect(providers).toHaveLength(1);
    expect(providers[0]).toBeInstanceOf(ConsolePushProvider);
  });

  it('returns expo only when VAPID keys are absent', () => {
    process.env.PUSH_PROVIDER = 'expo';
    resetConfigForTests();
    const providers = getPushProviders();
    expect(providers).toHaveLength(1);
    expect(providers[0]).toBeInstanceOf(ExpoPushProvider);
  });

  it('adds web-push when VAPID keys are configured', () => {
    process.env.PUSH_PROVIDER = 'expo';
    // Valid P-256 VAPID pair (throwaway, generated for tests only).
    process.env.VAPID_PUBLIC_KEY =
      'BDd3_hVL9fZi9Ybo2UUzA284WG5FZR30_95YeZJsiApwXKpNcF1rRPF3foIiBHXRdJI2Qhumhf6_LFTeZaNndIo';
    process.env.VAPID_PRIVATE_KEY = 'xKZKYRNdFFn8iQyF2D1AIWWyKkQIYHzcsWAEDzgkyO0';
    process.env.VAPID_SUBJECT = 'mailto:test@example.com';
    resetConfigForTests();
    const providers = getPushProviders();
    expect(providers).toHaveLength(2);
    expect(providers[0]).toBeInstanceOf(ExpoPushProvider);
    expect(providers[1]).toBeInstanceOf(WebPushProvider);
  });
});

describe('push payload vagueness policy', () => {
  it('keeps content-bearing types vague by default', () => {
    const payload = buildPushPayload(offerJob, false, 'en');
    expect(payload.title).toBe('Sahay');
    expect(payload.body).toContain('may need an item');
    expect(payload.deepLink).toBe('/offer/x');
  });

  it('uses real localized text when detailed previews are on', () => {
    const payload = buildPushPayload(
      { ...offerJob, titleKey: 'offer.needs', params: { qty: '2', unit: 'bottles', category: 'water' } },
      true,
      'en',
    );
    expect(payload.title).toBe('Needs 2 bottles of water');
  });

  it('localizes the vague preview', () => {
    const payload = buildPushPayload(offerJob, false, 'hi');
    expect(payload.body).not.toContain('may need an item'); // hi catalog string
    expect(payload.body.length).toBeGreaterThan(0);
  });

  it('non-sensitive types always carry their real text, previews off or not', () => {
    for (const type of ['event_notice', 'moderation_outcome', 'account_security']) {
      expect(VAGUE_PREVIEW_TYPES.has(type)).toBe(false);
      const payload = buildPushPayload(
        { type, titleKey: 'notifications.moderation_outcome', bodyKey: 'moderation.outcomeBody', params: { action: 'warn' } },
        false,
        'en',
      );
      expect(payload.title).toBe('Moderation outcomes');
      expect(payload.body).toContain('warn');
    }
  });

  it('covers exactly match_offer and new_message', () => {
    expect([...VAGUE_PREVIEW_TYPES].sort()).toEqual(['match_offer', 'new_message']);
  });
});
