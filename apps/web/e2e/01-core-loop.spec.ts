/**
 * THE core §49 journey, end to end through the browser, with two contexts:
 *
 *  Helper A   — UI login, joins the event by code, quick-adds 4 sealed water
 *               bottles, toggles Helping Now ON (location consent dialog).
 *  Requester B — UI login, joins the same event, requests 1 water bottle
 *               (safety ack), watches "Looking for a nearby helper…".
 *
 *  A receives the full-screen offer (countdown), accepts; both land in the
 *  match room under distinct one-time aliases; they chat (text + quick reply),
 *  step through meeting states, and both confirm qty 1. Afterwards: A's
 *  supplies show 3 available / 0 reserved, B's request is fulfilled, A's
 *  reliability shows 1 completed assist, and the event dashboard renders its
 *  k-anonymity-safe approximate view. DB cross-checks close the loop.
 */
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { contextAt, db, joinEventViaUi, loginViaUi, readState, requestWaterViaUi } from './helpers';

const HELPER_PHONE = '+915520000001';
const REQUESTER_PHONE = '+915520000002';

test.describe.configure({ mode: 'serial' });
test.setTimeout(240_000);

let ctxA: BrowserContext;
let ctxB: BrowserContext;
let pageA: Page;
let pageB: Page;

test.beforeAll(async ({ browser }) => {
  ctxA = await contextAt(browser, 0.001); // ~111 m north of the event center
  ctxB = await contextAt(browser, 0); // at the center
  pageA = await ctxA.newPage();
  pageB = await ctxB.newPage();
});

test.afterAll(async () => {
  await ctxA?.close();
  await ctxB?.close();
});

test('helper and requester complete a full water-bottle exchange', async () => {
  const { eventId, eventCode } = readState();

  /* ---------------------------------------------------- Helper A sets up */
  await loginViaUi(pageA, HELPER_PHONE);
  await joinEventViaUi(pageA, eventCode);

  // Quick-add 4 sealed 1-litre water bottles on the supplies tab.
  await pageA.getByRole('tab', { name: 'My supplies' }).click();
  await pageA.getByRole('button', { name: 'Quick add' }).click();
  const addDialog = pageA.getByRole('dialog');
  await addDialog.getByRole('button', { name: 'Sealed water bottle' }).click();
  for (let i = 0; i < 3; i += 1) {
    await addDialog.getByRole('button', { name: 'Increase' }).click();
  }
  // "Sealed" is on by default (and required); submit.
  await expect(addDialog.getByRole('switch', { name: 'Sealed' })).toHaveAttribute('aria-checked', 'true');
  await addDialog.getByRole('button', { name: 'Add supplies', exact: true }).click();
  await expect(pageA.getByRole('status').filter({ hasText: '4 bottle(s)' })).toBeVisible();

  // Helping Now ON — the one-time location consent dialog must appear.
  await pageA.goto('/home');
  await pageA.getByRole('switch', { name: 'Helping now' }).click();
  const consent = pageA.getByRole('dialog');
  await expect(consent.getByRole('heading', { name: 'Share approximate location?' })).toBeVisible();
  await consent.getByRole('button', { name: 'Allow while helping' }).click();
  await expect(pageA.getByText('ON — you may receive requests')).toBeVisible();
  await expect(pageA.getByText('Sharing approximate location')).toBeVisible();

  /* ------------------------------------------------- Requester B requests */
  await loginViaUi(pageB, REQUESTER_PHONE);
  await joinEventViaUi(pageB, eventCode);
  await requestWaterViaUi(pageB, eventId, 1);
  await expect(pageB.getByText('Looking for a nearby helper')).toBeVisible();

  /* --------------------------------------------- Offer → accept → matched */
  const offer = pageA.getByRole('dialog');
  await expect(offer.getByRole('heading', { name: 'Someone nearby needs an item you carry' })).toBeVisible({
    timeout: 30_000,
  });
  await expect(offer.getByText('seconds remaining')).toBeVisible(); // countdown ring
  await expect(offer.getByText('You have 4 bottle(s)')).toBeVisible();
  await offer.getByRole('button', { name: 'Accept', exact: true }).click();
  await pageA.waitForURL('**/matches/*');

  await pageB.getByRole('link', { name: /Matched!/ }).click({ timeout: 30_000 });
  await pageB.waitForURL('**/matches/*');

  /* ------------------------------------------------- Distinct aliases */
  const aliasOf = async (page: Page) => {
    const text = await page.getByText(/You appear as .+ in this exchange/).textContent();
    const m = /You appear as (.+) in this exchange/.exec(text ?? '');
    expect(m, `alias line not found in: ${text}`).toBeTruthy();
    return m![1]!;
  };
  const aliasA = await aliasOf(pageA);
  const aliasB = await aliasOf(pageB);
  expect(aliasA).not.toBe(aliasB);
  // Each page shows the peer's alias in the header.
  await expect(pageA.getByText(aliasB).first()).toBeVisible();
  await expect(pageB.getByText(aliasA).first()).toBeVisible();

  /* --------------------------------------------------------------- Chat */
  const chatInput = (page: Page) => page.locator('#chat-input');
  await chatInput(pageB).fill('Hello! I am near the fountain.');
  await pageB.getByRole('button', { name: 'OK', exact: true }).click();
  await expect(pageA.getByText('Hello! I am near the fountain.')).toBeVisible({ timeout: 15_000 });

  await pageB.getByRole('button', { name: 'Where would you like to meet?' }).click();
  await expect(pageA.getByText('Where would you like to meet?').first()).toBeVisible({ timeout: 15_000 });

  await chatInput(pageA).fill('On my way with the water bottle.');
  await pageA.getByRole('button', { name: 'OK', exact: true }).click();
  await expect(pageB.getByText('On my way with the water bottle.')).toBeVisible({ timeout: 15_000 });

  /* ---------------------------------------------------- Meeting states */
  for (const page of [pageA, pageB]) {
    await page.getByRole('button', { name: 'On my way', exact: true }).click();
    await expect(page.getByRole('button', { name: 'On my way', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: 'I have arrived', exact: true }).click();
    await expect(page.getByRole('button', { name: 'I have arrived', exact: true })).toBeDisabled();
  }

  /* -------------------------------------------------------- Confirm qty 1 */
  await pageA.getByRole('button', { name: 'Confirm given' }).click();
  const confirmA = pageA.getByRole('dialog');
  await expect(confirmA.getByRole('status')).toHaveText(/1/);
  await confirmA.getByRole('button', { name: 'Confirm', exact: true }).click();

  await pageB.getByRole('button', { name: 'Confirm received' }).click();
  const confirmB = pageB.getByRole('dialog');
  await confirmB.getByRole('button', { name: 'Confirm', exact: true }).click();

  // Both the status badge and the banner carry this string once completed.
  await expect(pageA.getByText('Exchange completed. Thank you!').first()).toBeVisible({ timeout: 20_000 });
  await expect(pageB.getByText('Exchange completed. Thank you!').first()).toBeVisible({ timeout: 20_000 });

  /* --------------------------------- Post-exchange state, through the UI */
  // B's peer chips now credit A with one completed assist.
  await pageB.reload();
  await expect(pageB.getByText('1 completed assists')).toBeVisible();

  // A's supplies: 3 available, nothing reserved.
  await pageA.goto(`/events/${eventCode}?tab=supplies`);
  await expect(pageA.getByRole('status').filter({ hasText: '3 bottle(s)' })).toBeVisible();
  await expect(pageA.getByText('reserved for active matches')).toHaveCount(0);

  // B's request history shows the fulfilled request.
  await pageB.goto('/profile');
  await expect(pageB.getByText('Request fulfilled')).toBeVisible();

  // Event dashboard renders the k-anonymity-safe approximate view: the
  // disclaimer is always present, and single-user activity never yields
  // exact numbers (either "too few reports" rows or no rows at all).
  await pageB.goto(`/events/${eventCode}`);
  await expect(pageB.getByText('Community-reported and approximate').first()).toBeVisible();
  const exactNumbers = pageB.getByText(/^Requested: \d/);
  await expect(exactNumbers).toHaveCount(0);

  /* -------------------------------------------------------- DB cross-checks */
  const [item] = await db<{ qty_on_hand: string; qty_reserved: string }>(
    `SELECT qty_on_hand, qty_reserved FROM inventory_items ii
     JOIN users u ON u.id = ii.user_id
     WHERE ii.event_id = $1 AND u.pseudonym IS NOT NULL
     ORDER BY ii.created_at DESC LIMIT 1`,
    [eventId],
  );
  expect(Number(item!.qty_on_hand)).toBe(3);
  expect(Number(item!.qty_reserved)).toBe(0);

  const [req] = await db<{ status: string }>(
    `SELECT status FROM requests WHERE event_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [eventId],
  );
  expect(req!.status).toBe('fulfilled');

  const [conv] = await db<{ n: string }>(
    `SELECT count(*) AS n FROM conversations c JOIN matches m ON m.id = c.match_id WHERE m.event_id = $1`,
    [eventId],
  );
  expect(Number(conv!.n)).toBe(1);

  const [rel] = await db<{ completed: number }>(
    `SELECT rs.completed FROM reliability_stats rs
     JOIN matches m ON m.helper_id = rs.user_id
     WHERE m.event_id = $1 LIMIT 1`,
    [eventId],
  );
  expect(Number(rel!.completed)).toBe(1);
});
