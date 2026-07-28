/**
 * Partial fulfilment: helper H3 carries 2 bottles, the requester asks for 4.
 * Accepting reserves the available 2; both confirm 2; the requester sees
 * "Partially fulfilled — 2 bottle(s) still needed", taps "Search for the
 * rest", and a second (API-seeded) helper fulfils the remaining 2 → fulfilled.
 */
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import {
  apiRaw,
  categoryBySlug,
  confirmMatch,
  contextAt,
  db,
  joinEvent,
  loginViaApi,
  readState,
  respondOffer,
  seedBrowserSession,
  seedHelper,
  requestWaterViaUi,
  waitForOffer,
  waitForRequestStatus,
  type CategoryRef,
  type RequestView,
  type Session,
} from './helpers';

const H3_EMAIL = 'e2e-helper3-03@example.com';
const H4_EMAIL = 'e2e-helper4-03@example.com';
const REQUESTER_EMAIL = 'e2e-requester-03@example.com';

test.describe.configure({ mode: 'serial' });
test.setTimeout(180_000);

let water: CategoryRef;
let h3: Session;
let r3: Session;
let ctxH: BrowserContext;
let ctxR: BrowserContext;
let pageH: Page;
let pageR: Page;

test.beforeAll(async ({ browser, request }) => {
  const { eventId, eventCode } = readState();
  // Helpers from earlier specs must not intercept this spec's offers.
  await db(`UPDATE availability SET is_on = false, updated_at = now() WHERE event_id = $1`, [eventId]);
  water = await categoryBySlug(request, 'water-bottle');
  h3 = await seedHelper(request, H3_EMAIL, eventId, water, 2, 0.001);
  r3 = await loginViaApi(request, REQUESTER_EMAIL);
  await joinEvent(request, r3.token, eventId);

  const event = { id: eventId, code: eventCode, title: 'Sahay E2E Community Event' };
  ctxH = await contextAt(browser, 0.001);
  ctxR = await contextAt(browser, 0);
  await seedBrowserSession(ctxH, h3.token, { event, locationConsent: true });
  await seedBrowserSession(ctxR, r3.token, { event, locationConsent: true });
  pageH = await ctxH.newPage();
  pageR = await ctxR.newPage();
  await pageH.goto('/home');
});

test.afterAll(async () => {
  await ctxH?.close();
  await ctxR?.close();
});

test('partial fulfilment, continue search, second helper completes it', async ({ request }) => {
  const { eventId } = readState();

  // Request 4 bottles through the UI.
  await pageR.goto('/home');
  await requestWaterViaUi(pageR, eventId, 4);

  const mine = await apiRaw<{ items: RequestView[] }>(request, '/requests/mine', { token: r3.token });
  const req = mine.items.find((r) => ['searching', 'offering', 'matched'].includes(r.status));
  expect(req).toBeTruthy();

  // H3's offer is clamped to what H3 can actually give (2 of the 4 asked).
  const offer = pageH.getByRole('dialog');
  await expect(offer.getByText('Needs 2 bottle(s)')).toBeVisible({ timeout: 30_000 });
  await expect(offer.getByText('You have 2 bottle(s)')).toBeVisible();
  await offer.getByRole('button', { name: 'Accept', exact: true }).click();
  await pageH.waitForURL('**/matches/*');

  // Both confirm the 2 that actually changed hands.
  await pageR.getByRole('link', { name: /Matched!/ }).click({ timeout: 30_000 });
  await pageR.waitForURL('**/matches/*');

  await pageH.getByRole('button', { name: 'Confirm given' }).click();
  await expect(pageH.getByRole('dialog').getByRole('status')).toHaveText(/2/);
  await pageH.getByRole('dialog').getByRole('button', { name: 'Confirm', exact: true }).click();

  await pageR.getByRole('button', { name: 'Confirm received' }).click();
  await expect(pageR.getByRole('dialog').getByRole('status')).toHaveText(/2/);
  await pageR.getByRole('dialog').getByRole('button', { name: 'Confirm', exact: true }).click();

  // Requester lands on "partially fulfilled" with 2 still needed.
  await pageR.goto('/home');
  await expect(pageR.getByText('Partially fulfilled — 2 bottle(s) still needed')).toBeVisible({
    timeout: 20_000,
  });

  // Second helper appears (seeded only now, so it never competed for pass 1).
  const h4 = await seedHelper(request, H4_EMAIL, eventId, water, 3, 0.002);

  // Continue searching for the rest.
  await pageR.getByRole('button', { name: 'Search for the rest' }).click();
  await expect(pageR.getByText('Looking for a nearby helper')).toBeVisible({ timeout: 20_000 });

  // H4 accepts and confirms via API (auxiliary side of the journey).
  const offer2 = await waitForOffer(request, h4.token, req!.id, 30_000);
  const { match } = await respondOffer(request, h4.token, offer2.id, true);
  expect(match).toBeTruthy();

  // Requester confirms receipt of the remaining 2 in the UI.
  await expect(pageR.getByRole('link', { name: /Matched!/ })).toBeVisible({ timeout: 20_000 });
  await pageR.getByRole('link', { name: /Matched!/ }).click();
  await pageR.waitForURL('**/matches/*');
  await pageR.getByRole('button', { name: 'Confirm received' }).click();
  await expect(pageR.getByRole('dialog').getByRole('status')).toHaveText(/2/);
  await pageR.getByRole('dialog').getByRole('button', { name: 'Confirm', exact: true }).click();
  await confirmMatch(request, h4.token, match!.id, 2);

  await expect(pageR.getByText('Exchange completed. Thank you!').first()).toBeVisible({ timeout: 20_000 });

  const view = await waitForRequestStatus(request, r3.token, req!.id, ['fulfilled']);
  expect(view.qtyFulfilled).toBe(4);

  const [row] = await db<{ status: string; qty_fulfilled: string }>(
    `SELECT status, qty_fulfilled FROM requests WHERE id = $1`,
    [req!.id],
  );
  expect(row!.status).toBe('fulfilled');
  expect(Number(row!.qty_fulfilled)).toBe(4);
});
