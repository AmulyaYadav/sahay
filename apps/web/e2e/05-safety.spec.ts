/**
 * Safety exit: from an active match, the requester hits "I no longer feel
 * safe" → the match cancels immediately, chat becomes readonly (sends are
 * rejected), and Block / Report are surfaced right in the follow-up banner.
 * The requester files a report with conversation evidence preserved, blocks
 * the helper — and a brand-new request from the same requester must never be
 * offered to the blocked helper (asserted by watching it stay searching).
 */
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import {
  apiRaw,
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
  type CategoryRef,
  type Session,
} from './helpers';

const HELPER_PHONE = '+915520000025';
const REQUESTER_PHONE = '+915520000026';

test.describe.configure({ mode: 'serial' });
test.setTimeout(150_000);

let water: CategoryRef;
let h5: Session;
let r5: Session;
let ctx: BrowserContext;
let page: Page;
let matchId: string;
let conversationId: string;

test.beforeAll(async ({ browser, request }) => {
  const { eventId, eventCode } = readState();
  // Only H5 may be available for this spec.
  await db(`UPDATE availability SET is_on = false, updated_at = now() WHERE event_id = $1`, [eventId]);
  water = await categoryBySlug(request, 'water-bottle');
  h5 = await seedHelper(request, HELPER_PHONE, eventId, water, 5, 0.001);
  r5 = await loginViaApi(request, REQUESTER_PHONE);
  await joinEvent(request, r5.token, eventId);

  ctx = await contextAt(browser, 0);
  await seedBrowserSession(ctx, r5.token, {
    event: { id: eventId, code: eventCode, title: 'Sahay E2E Community Event' },
    locationConsent: true,
  });
  page = await ctx.newPage();

  // Match the pair via the API (the journey under test starts inside the match).
  const req = await createRequest(request, r5.token, eventId, water, 1);
  const offer = await waitForOffer(request, h5.token, req.id, 30_000);
  const { match } = await respondOffer(request, h5.token, offer.id, true);
  matchId = match!.id;
  conversationId = match!.conversationId;
});

test.afterAll(async () => {
  await ctx?.close();
});

test('"I no longer feel safe" cancels, locks chat, and surfaces block/report', async ({ request }) => {
  await page.goto(`/matches/${matchId}`);

  // A message first, so the report can carry conversation evidence.
  await page.locator('#chat-input').fill('This meeting point does not feel right to me.');
  await page.getByRole('button', { name: 'OK', exact: true }).click();
  await expect(page.getByText('This meeting point does not feel right to me.')).toBeVisible();

  await page.getByRole('button', { name: 'I no longer feel safe' }).click();
  const confirmDialog = page.getByRole('dialog');
  await expect(confirmDialog.getByText('This will cancel the exchange immediately.')).toBeVisible();
  await confirmDialog.getByRole('button', { name: 'Confirm', exact: true }).click();

  // Follow-up banner with Block and Report, chat readonly.
  const banner = page.getByRole('alert');
  await expect(banner.getByText('This exchange was cancelled.')).toBeVisible();
  await expect(banner.getByRole('button', { name: 'Block' })).toBeVisible();
  await expect(banner.getByRole('button', { name: 'Report' })).toBeVisible();
  await expect(page.getByText('This conversation is closed.')).toBeVisible();

  // The server rejects further sends outright.
  await expect(
    apiRaw(request, `/conversations/${conversationId}/messages`, {
      token: r5.token,
      body: { kind: 'text', body: 'one more thing', clientMsgId: 'e2e-readonly-check-1' },
    }),
  ).rejects.toThrow(/409|403|conflict|closed|readonly/i);

  const [match] = await db<{ status: string }>(`SELECT status FROM matches WHERE id = $1`, [matchId]);
  expect(match!.status).toBe('cancelled_unsafe');

  // File a report, preserving the conversation as evidence.
  await banner.getByRole('button', { name: 'Report' }).click();
  const reportDialog = page.getByRole('dialog');
  await reportDialog.getByRole('radio', { name: 'Unsafe meeting request' }).click();
  await reportDialog
    .getByLabel('Tell us briefly (optional)')
    .fill('They insisted on meeting away from the public area.');
  await expect(reportDialog.getByRole('checkbox')).toBeChecked(); // preserve-conversation ON
  await reportDialog.getByRole('button', { name: 'Report', exact: true }).click();
  await expect(page.getByText('Report submitted. A moderator will review it.')).toBeVisible();

  // Block the helper.
  await banner.getByRole('button', { name: 'Block' }).click();
  await expect(page.getByText('Blocked. You will never be matched with this person again.')).toBeVisible();

  const [block] = await db<{ n: string }>(
    `SELECT count(*) AS n FROM blocks WHERE blocker_id = $1 AND blocked_id = $2`,
    [r5.user.id, h5.user.id],
  );
  expect(Number(block!.n)).toBe(1);

  const [report] = await db<{ category: string; evidence: unknown }>(
    `SELECT category, evidence FROM reports WHERE reporter_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [r5.user.id],
  );
  expect(report!.category).toBe('unsafe_meeting');
  expect(report!.evidence).not.toBeNull();
  expect(Array.isArray(report!.evidence)).toBe(true);
  expect((report!.evidence as unknown[]).length).toBeGreaterThan(0);
});

test('a new request never offers to the blocked helper', async ({ request }) => {
  const { eventId } = readState();
  // H5 is still available and stocked — but blocked.
  const req = await createRequest(request, r5.token, eventId, water, 1);

  // Give the engine ample time to (wrongly) produce an offer.
  await new Promise((r) => setTimeout(r, 10_000));

  const view = await apiRaw<{ status: string }>(request, `/requests/${req.id}`, { token: r5.token });
  expect(view.status).toBe('searching');
  const [offers] = await db<{ n: string }>(`SELECT count(*) AS n FROM match_offers WHERE request_id = $1`, [req.id]);
  expect(Number(offers!.n)).toBe(0);

  // Tidy up for the following specs.
  await apiRaw(request, `/requests/${req.id}/cancel`, { token: r5.token, method: 'POST', body: {} });
});
