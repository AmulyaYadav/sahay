/**
 * Notify worker pipeline: persistence, dedupe, per-type push muting (feed row
 * survives), vague previews, suspended/deleted gating, and dead-token cleanup.
 * Push is captured with an injected fake provider — nothing leaves the process.
 */
import '../env.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { closeDb } from '../../src/db/index.js';
import { closeRedis } from '../../src/lib/redis.js';
import { closeQueues } from '../../src/queues.js';
import type { PushPayload, PushProvider, PushToken } from '../../src/lib/push.js';
import { deliverNotification } from '../../src/workers/notify.js';
import type { NotifyJob } from '../../src/queues.js';
import { getDb, makeUser, schema, setupTestDb, truncateAll } from '../helpers.js';

class FakeProvider implements PushProvider {
  calls: { tokens: PushToken[]; payload: PushPayload }[] = [];
  failWith: string[] = [];
  async send(tokens: PushToken[], payload: PushPayload) {
    this.calls.push({ tokens, payload });
    return { failed: this.failWith };
  }
}

beforeAll(async () => {
  await setupTestDb();
});

afterAll(async () => {
  await closeQueues();
  await closeRedis();
  await closeDb();
});

beforeEach(async () => {
  await truncateAll();
});

function offerJob(userId: string, overrides: Partial<NotifyJob> = {}): NotifyJob {
  return {
    userId,
    type: 'match_offer',
    titleKey: 'offer.title',
    bodyKey: 'notifications.vaguePreview',
    params: {},
    deepLink: '/offer/o1',
    dedupeKey: 'offer:o1',
    ...overrides,
  };
}

async function rowsFor(userId: string) {
  return getDb().select().from(schema.notifications).where(eq(schema.notifications.userId, userId));
}

describe('notify worker', () => {
  it('persists the row and dedupes on (user, dedupeKey) — second delivery is a no-op', async () => {
    const user = await makeUser();
    const provider = new FakeProvider();
    await getDb().insert(schema.pushTokens).values({ userId: user.id, provider: 'expo', token: 'tok-1' });

    await deliverNotification(offerJob(user.id), [provider]);
    await deliverNotification(offerJob(user.id), [provider]);

    const rows = await rowsFor(user.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ type: 'match_offer', dedupeKey: 'offer:o1', deepLink: '/offer/o1' });
    expect(provider.calls).toHaveLength(1); // deduped run sent no push either
  });

  it('per-type OFF suppresses push only — the feed row is still created', async () => {
    const user = await makeUser();
    const provider = new FakeProvider();
    await getDb().insert(schema.pushTokens).values({ userId: user.id, provider: 'expo', token: 'tok-1' });
    await getDb()
      .insert(schema.notificationPrefs)
      .values({ userId: user.id, detailedPreviews: false, perType: { match_offer: false } });

    await deliverNotification(offerJob(user.id), [provider]);

    expect(await rowsFor(user.id)).toHaveLength(1); // in-app history intact
    expect(provider.calls).toHaveLength(0); // no push
  });

  it('sends the vague preview for match_offer unless detailed previews are on', async () => {
    const user = await makeUser();
    const provider = new FakeProvider();
    await getDb().insert(schema.pushTokens).values({ userId: user.id, provider: 'expo', token: 'tok-1' });

    await deliverNotification(offerJob(user.id), [provider]);
    expect(provider.calls[0]!.payload.title).toBe('Sahay');
    expect(provider.calls[0]!.payload.body).toContain('may need an item');

    await getDb()
      .insert(schema.notificationPrefs)
      .values({ userId: user.id, detailedPreviews: true, perType: {} });
    await deliverNotification(offerJob(user.id, { dedupeKey: 'offer:o2' }), [provider]);
    expect(provider.calls[1]!.payload.title).toBe('Someone nearby needs an item you carry');
  });

  it('skips suspended users for ordinary types but always delivers account_security', async () => {
    const user = await makeUser({ status: 'suspended' });
    const provider = new FakeProvider();

    await deliverNotification(offerJob(user.id), [provider]);
    expect(await rowsFor(user.id)).toHaveLength(0);

    await deliverNotification(
      offerJob(user.id, {
        type: 'account_security',
        titleKey: 'settings.exportData',
        bodyKey: 'settings.exportReady',
        dedupeKey: 'sec:1',
      }),
      [provider],
    );
    expect(await rowsFor(user.id)).toHaveLength(1);
  });

  it('never writes rows for deleted users', async () => {
    const user = await makeUser({ status: 'deleted', deletedAt: new Date() });
    await deliverNotification(offerJob(user.id, { type: 'account_security' }), [new FakeProvider()]);
    expect(await rowsFor(user.id)).toHaveLength(0);
  });

  it('disables tokens the provider reports as permanently failed', async () => {
    const user = await makeUser();
    const provider = new FakeProvider();
    provider.failWith = ['tok-dead'];
    await getDb().insert(schema.pushTokens).values([
      { userId: user.id, provider: 'expo', token: 'tok-dead' },
      { userId: user.id, provider: 'expo', token: 'tok-live' },
    ]);

    await deliverNotification(offerJob(user.id), [provider]);

    const tokens = await getDb()
      .select()
      .from(schema.pushTokens)
      .where(eq(schema.pushTokens.userId, user.id));
    expect(tokens.find((t) => t.token === 'tok-dead')!.disabled).toBe(true);
    expect(tokens.find((t) => t.token === 'tok-live')!.disabled).toBe(false);

    // Disabled tokens are excluded from the next send.
    provider.failWith = [];
    await deliverNotification(offerJob(user.id, { dedupeKey: 'offer:o3' }), [provider]);
    expect(provider.calls[1]!.tokens.map((t) => t.token)).toEqual(['tok-live']);
  });
});
