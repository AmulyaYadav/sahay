/**
 * Requester-side lifecycle without helpers around:
 *  - cancel a searching request from the home card;
 *  - let a request run out (expires_at time-warped into the past; the worker's
 *    sweep / retry loop settles it to no_match within ≤75 s), see the
 *    "no helper found" message, and renew it back into searching.
 *
 * Availability of helpers seeded by earlier specs is switched off first so
 * these requests genuinely find nobody.
 */
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import {
  apiRaw,
  contextAt,
  db,
  joinEvent,
  loginViaApi,
  readState,
  requestWaterViaUi,
  seedBrowserSession,
  type RequestView,
  type Session,
} from './helpers';

const REQUESTER_PHONE = '+915520000024';

test.describe.configure({ mode: 'serial' });

let r4: Session;
let ctx: BrowserContext;
let page: Page;

async function latestActiveRequest(token: string, request: Parameters<typeof apiRaw>[0]): Promise<RequestView> {
  const mine = await apiRaw<{ items: RequestView[] }>(request, '/requests/mine', { token });
  const req = mine.items.find((r) => ['searching', 'offering'].includes(r.status));
  expect(req, 'expected an active request').toBeTruthy();
  return req!;
}

test.beforeAll(async ({ browser, request }) => {
  const { eventId, eventCode } = readState();
  // Nobody is helping for the duration of this spec.
  await db(`UPDATE availability SET is_on = false, updated_at = now() WHERE event_id = $1`, [eventId]);

  r4 = await loginViaApi(request, REQUESTER_PHONE);
  await joinEvent(request, r4.token, eventId);
  ctx = await contextAt(browser, 0);
  await seedBrowserSession(ctx, r4.token, {
    event: { id: eventId, code: eventCode, title: 'Sahay E2E Community Event' },
    locationConsent: true,
  });
  page = await ctx.newPage();
});

test.afterAll(async () => {
  await ctx?.close();
});

test('a searching request can be cancelled from the home card', async ({ request }) => {
  const { eventId } = readState();
  await requestWaterViaUi(page, eventId, 1);
  await expect(page.getByText('Looking for a nearby helper')).toBeVisible();
  const req = await latestActiveRequest(r4.token, request);

  await page.getByRole('button', { name: 'Cancel request' }).click();
  // Cancelled requests leave the active-requests section entirely.
  await expect(page.getByText('Looking for a nearby helper')).toHaveCount(0, { timeout: 15_000 });

  const [row] = await db<{ status: string }>(`SELECT status FROM requests WHERE id = $1`, [req.id]);
  expect(row!.status).toBe('cancelled');
});

test('an expired request settles to no_match and can be renewed', async ({ request }) => {
  test.setTimeout(150_000);
  const { eventId } = readState();
  await requestWaterViaUi(page, eventId, 1);
  await expect(page.getByText('Looking for a nearby helper')).toBeVisible();
  const req = await latestActiveRequest(r4.token, request);

  // Time-warp the expiry; the engine's next pass (idle retry ≤20 s or the
  // 60 s expire_requests sweep) settles it. Nobody was ever asked → no_match.
  await db(`UPDATE requests SET expires_at = now() - interval '1 second' WHERE id = $1`, [req.id]);

  await expect(page.getByText('No helper found right now. You can renew the request or try later.')).toBeVisible({
    timeout: 75_000,
  });

  // Renew brings it back into searching with a fresh expiry.
  await page.getByRole('button', { name: 'Keep searching' }).click();
  await expect(page.getByText('Looking for a nearby helper')).toBeVisible({ timeout: 15_000 });

  const [row] = await db<{ status: string; future: boolean }>(
    `SELECT status, expires_at > now() AS future FROM requests WHERE id = $1`,
    [req.id],
  );
  expect(row!.status).toBe('searching');
  expect(row!.future).toBe(true);

  // Tidy up so later specs never see a live request from this one.
  await apiRaw(request, `/requests/${req.id}/cancel`, { token: r4.token, method: 'POST', body: {} });
});
