/**
 * Sequential matching engine, observed from the helpers' browsers.
 *
 * Case 1 — decline: two API-seeded helpers (H1 ~111 m, H2 ~333 m). The closer
 *   helper H1 receives the offer first and declines in the UI; the offer then
 *   moves to H2, who accepts.
 *
 * Case 2 — timeout: a fresh request goes to H1 again, who simply never
 *   answers. The offer's respond_by is time-warped into the past in the DB;
 *   the worker (delayed timeout job and/or the 60 s expire_offers sweep)
 *   expires it and the engine moves on to H2. Waits are bounded ≤75 s.
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
  seedBrowserSession,
  seedHelper,
  waitForOffer,
  waitForRequestStatus,
  type CategoryRef,
  type Session,
} from './helpers';

const H1_EMAIL = 'e2e-helper1-02@example.com';
const H2_EMAIL = 'e2e-helper2-02@example.com';
const REQUESTER_EMAIL = 'e2e-requester-02@example.com';

test.describe.configure({ mode: 'serial' });

let water: CategoryRef;
let h1: Session;
let h2: Session;
let requester: Session;
let ctx1: BrowserContext;
let ctx2: BrowserContext;
let page1: Page;
let page2: Page;

test.beforeAll(async ({ browser, request }) => {
  const { eventId, eventCode } = readState();
  // Helpers from earlier specs must not intercept this spec's offers.
  await db(`UPDATE availability SET is_on = false, updated_at = now() WHERE event_id = $1`, [eventId]);
  water = await categoryBySlug(request, 'water-bottle');
  h1 = await seedHelper(request, H1_EMAIL, eventId, water, 5, 0.001);
  h2 = await seedHelper(request, H2_EMAIL, eventId, water, 5, 0.003);
  requester = await loginViaApi(request, REQUESTER_EMAIL);
  await joinEvent(request, requester.token, eventId);

  const event = { id: eventId, code: eventCode, title: 'Sahay E2E Community Event' };
  ctx1 = await contextAt(browser, 0.001);
  ctx2 = await contextAt(browser, 0.003);
  await seedBrowserSession(ctx1, h1.token, { event, locationConsent: true });
  await seedBrowserSession(ctx2, h2.token, { event, locationConsent: true });
  page1 = await ctx1.newPage();
  page2 = await ctx2.newPage();
  await page1.goto('/home');
  await page2.goto('/home');
});

test.afterAll(async () => {
  await ctx1?.close();
  await ctx2?.close();
});

test('declined offer moves on to the next-nearest helper', async ({ request }) => {
  const { eventId } = readState();
  const req = await createRequest(request, requester.token, eventId, water, 1);

  // Closer helper H1 is asked first — and declines.
  const offer1 = page1.getByRole('dialog');
  await expect(offer1.getByRole('heading', { name: 'Someone nearby needs an item you carry' })).toBeVisible({
    timeout: 30_000,
  });
  await offer1.getByRole('button', { name: 'Decline', exact: true }).click();
  await expect(page1.getByRole('dialog')).toHaveCount(0);

  // The engine moves on to H2, who accepts.
  const offer2 = page2.getByRole('dialog');
  await expect(offer2.getByRole('heading', { name: 'Someone nearby needs an item you carry' })).toBeVisible({
    timeout: 30_000,
  });
  await offer2.getByRole('button', { name: 'Accept', exact: true }).click();
  await page2.waitForURL('**/matches/*');

  const view = await waitForRequestStatus(request, requester.token, req.id, ['matched']);
  expect(view.activeMatchId).toBeTruthy();

  const offers = await db<{ helper_id: string; status: string }>(
    `SELECT helper_id, status FROM match_offers WHERE request_id = $1 ORDER BY offered_at`,
    [req.id],
  );
  expect(offers.map((o) => o.status)).toEqual(['declined', 'accepted']);
  expect(offers[0]!.helper_id).toBe(h1.user.id);
  expect(offers[1]!.helper_id).toBe(h2.user.id);
});

test('unanswered offer expires and the search continues', async ({ request }) => {
  test.setTimeout(150_000);
  const { eventId } = readState();
  const req = await createRequest(request, requester.token, eventId, water, 1);

  // H1 (closer) receives the offer and never answers.
  const offer = await waitForOffer(request, h1.token, req.id, 30_000);

  // Time-warp the deadline; the worker sweeps it within ≤75 s (the delayed
  // 45 s timeout job or the 60 s expire_offers retention pass — whichever
  // fires first). No manual enqueue: this exercises the real recovery path.
  await db(`UPDATE match_offers SET respond_by = now() - interval '3 seconds' WHERE id = $1`, [offer.id]);

  // H2 receives the follow-up offer once H1's has expired.
  const offer2 = await waitForOffer(request, h2.token, req.id, 75_000);
  expect(offer2.id).not.toBe(offer.id);

  // H1's overlay drops the stale offer (offer.expired hint → refetch).
  await expect(page1.getByRole('dialog')).toHaveCount(0);

  // H2 accepts in the UI (the sheet is already on screen).
  await page2.getByRole('dialog').getByRole('button', { name: 'Accept', exact: true }).click();
  await page2.waitForURL('**/matches/*');
  await waitForRequestStatus(request, requester.token, req.id, ['matched']);

  const [expired] = await db<{ status: string }>(`SELECT status FROM match_offers WHERE id = $1`, [offer.id]);
  expect(expired!.status).toBe('expired');
});
