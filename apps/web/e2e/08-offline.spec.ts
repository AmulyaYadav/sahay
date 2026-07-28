/**
 * Weak-network behavior: the offline banner appears when connectivity drops,
 * a chat message sent while offline surfaces the failed-with-retry affordance,
 * and tapping it after reconnecting delivers the message.
 */
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import {
  categoryBySlug,
  contextAt,
  createRequest,
  db,
  joinEvent,
  loginViaApi,
  readState,
  respondOffer,
  seedBrowserSession,
  seedHelper,
  waitForOffer,
  type Session,
} from './helpers';

const HELPER_EMAIL = 'e2e-helper-08@example.com';
const REQUESTER_EMAIL = 'e2e-requester-08@example.com';

test.describe.configure({ mode: 'serial' });
test.setTimeout(150_000);

let ctx: BrowserContext;
let page: Page;
let r8: Session;
let matchId: string;

test.beforeAll(async ({ browser, request }) => {
  const { eventId, eventCode } = readState();
  // Deterministic pairing: only H8 is available.
  await db(`UPDATE availability SET is_on = false, updated_at = now() WHERE event_id = $1`, [eventId]);
  const water = await categoryBySlug(request, 'water-bottle');
  const h8 = await seedHelper(request, HELPER_EMAIL, eventId, water, 3, 0.001);
  r8 = await loginViaApi(request, REQUESTER_EMAIL);
  await joinEvent(request, r8.token, eventId);

  const req = await createRequest(request, r8.token, eventId, water, 1);
  const offer = await waitForOffer(request, h8.token, req.id, 30_000);
  const { match } = await respondOffer(request, h8.token, offer.id, true);
  matchId = match!.id;

  ctx = await contextAt(browser, 0);
  await seedBrowserSession(ctx, r8.token, {
    event: { id: eventId, code: eventCode, title: 'Sahay E2E Community Event' },
    locationConsent: true,
  });
  page = await ctx.newPage();
});

test.afterAll(async () => {
  await ctx?.close();
});

test('offline banner, failed chat send with retry, successful retry when back online', async () => {
  await page.goto(`/matches/${matchId}`);
  await expect(page.locator('#chat-input')).toBeVisible();

  // Drop the network.
  await ctx.setOffline(true);
  await expect(page.getByText('You appear to be offline')).toBeVisible({ timeout: 15_000 });

  // Sending now fails but stays on screen with a retry affordance.
  await page.locator('#chat-input').fill('Meet you by the ticket booth.');
  await page.getByRole('button', { name: 'OK', exact: true }).click();
  await expect(page.getByText('Not sent — tap to retry')).toBeVisible({ timeout: 15_000 });

  // Back online: tap the failed bubble to retry.
  await ctx.setOffline(false);
  await expect(page.getByText('You appear to be offline')).toHaveCount(0, { timeout: 15_000 });
  await page.getByRole('button', { name: /Meet you by the ticket booth/ }).click();

  // The pending bubble resolves into a delivered message (retry marker gone).
  await expect(page.getByText('Not sent — tap to retry')).toHaveCount(0, { timeout: 15_000 });
  await expect(page.locator('.msg-mine').filter({ hasText: 'Meet you by the ticket booth.' })).toBeVisible();

  const [msg] = await db<{ n: string }>(
    `SELECT count(*) AS n FROM messages m
     JOIN conversations c ON c.id = m.conversation_id
     WHERE c.match_id = $1 AND m.kind = 'text'`,
    [matchId],
  );
  expect(Number(msg!.n)).toBe(1);
});
