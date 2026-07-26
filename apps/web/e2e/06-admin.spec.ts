/**
 * Moderation console: an admin (role granted via SQL — there is deliberately
 * no in-band way to mint admins) approves a pending public event, which then
 * appears in anonymous discovery; resolves the report filed in 05 with a
 * written reason; pauses the shared aid event (a requester immediately sees
 * the paused error) and unpauses it. Every action lands in the audit log.
 */
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import {
  db,
  joinEvent,
  loginViaApi,
  loginViaUi,
  apiRaw,
  readState,
  seedBrowserSession,
  contextAt,
  type Session,
} from './helpers';

const ADMIN_PHONE = '+915510000002';
const REQUESTER_PHONE = '+915520000024'; // reuses the (member) requester from 04
const PUBLIC_EVENT_TITLE = 'Sahay E2E Public Water Fair';

test.describe.configure({ mode: 'serial' });
test.setTimeout(150_000);

let adminCtx: BrowserContext;
let adminPage: Page;
let requester: Session;

async function fillModerationReason(page: Page, reason: string): Promise<void> {
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Written reason (required)').fill(reason);
  await dialog.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(page.getByText('Submitted').first()).toBeVisible();
}

test.beforeAll(async ({ browser, request }) => {
  const { eventId, organizerPhone } = readState();

  // Promote the admin account via SQL, then sign in through the UI.
  const adminSession = await loginViaApi(request, ADMIN_PHONE);
  await db(`UPDATE users SET role = 'admin' WHERE id = $1`, [adminSession.user.id]);

  adminCtx = await contextAt(browser, 0);
  adminPage = await adminCtx.newPage();
  await loginViaUi(adminPage, ADMIN_PHONE);

  // A pending public event, created by the organizer via the API.
  const organizer = await loginViaApi(request, organizerPhone);
  const now = Date.now();
  await apiRaw(request, '/events', {
    token: organizer.token,
    body: {
      title: PUBLIC_EVENT_TITLE,
      description: 'Public fixture event awaiting moderation approval.',
      type: 'community_event',
      visibility: 'public',
      areaLabel: 'Near Sarasbaug, Pune',
      center: { lat: 18.5018, lng: 73.8636 },
      radiusM: 2000,
      startsAt: new Date(now - 30 * 60 * 1000).toISOString(),
      endsAt: new Date(now + 6 * 60 * 60 * 1000).toISOString(),
      timezone: 'Asia/Kolkata',
    },
  });

  requester = await loginViaApi(request, REQUESTER_PHONE);
  await joinEvent(request, requester.token, eventId).catch(() => undefined); // already a member is fine
});

test.afterAll(async () => {
  await adminCtx?.close();
});

test('admin approves a pending public event; it appears in anonymous discovery', async ({ browser }) => {
  await adminPage.goto('/admin/events');
  const card = adminPage.locator('section.card', { hasText: PUBLIC_EVENT_TITLE });
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: 'Approve public listing' }).click();
  await fillModerationReason(adminPage, 'Verified organizer; listing looks legitimate.');

  // Anonymous discovery (fresh, unauthenticated context).
  const anon = await browser.newContext();
  const anonPage = await anon.newPage();
  await anonPage.goto('/events');
  await anonPage.getByLabel('Search', { exact: true }).fill('Public Water Fair');
  await expect(anonPage.getByRole('link', { name: PUBLIC_EVENT_TITLE })).toBeVisible({ timeout: 15_000 });
  await anon.close();
});

test('admin resolves the report from the safety spec with a written reason', async () => {
  await adminPage.goto('/admin/reports');
  const card = adminPage.locator('section.card', { hasText: 'Unsafe meeting request' });
  await expect(card.first()).toBeVisible();
  await card.first().getByRole('button', { name: 'Resolve', exact: true }).click();
  await fillModerationReason(adminPage, 'Reviewed evidence; warned the reported account.');

  const [report] = await db<{ status: string }>(
    `SELECT status FROM reports WHERE category = 'unsafe_meeting' ORDER BY created_at DESC LIMIT 1`,
  );
  expect(report!.status).toBe('resolved');
});

test('pausing the event blocks new requests with a clear error; unpause restores', async ({ browser }) => {
  const { eventId, eventCode } = readState();

  await adminPage.goto('/admin/events');
  await adminPage.getByRole('switch', { name: 'Pending approval' }).click(); // show all events
  const card = adminPage.locator('section.card', { hasText: 'Sahay E2E Community Event' });
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: 'Pause matching' }).click();
  await fillModerationReason(adminPage, 'Crowd crush risk reported near the main gate.');

  // A member now sees the paused error when trying to request.
  const ctx = await contextAt(browser, 0);
  await seedBrowserSession(ctx, requester.token, {
    event: { id: eventId, code: eventCode, title: 'Sahay E2E Community Event' },
    locationConsent: true,
  });
  const page = await ctx.newPage();
  await page.goto(`/events/${eventId}/request`);
  await page.getByRole('button', { name: 'Sealed water bottle' }).click();
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Request help', exact: true }).click();
  await expect(page.getByText('This event is paused; matching is temporarily stopped.')).toBeVisible({
    timeout: 15_000,
  });
  await ctx.close();

  // Unpause.
  await adminPage.goto('/admin/events');
  await adminPage.getByRole('switch', { name: 'Pending approval' }).click();
  const card2 = adminPage.locator('section.card', { hasText: 'Sahay E2E Community Event' });
  await card2.getByRole('button', { name: 'Resume matching' }).click();
  await fillModerationReason(adminPage, 'Situation resolved by on-site stewards.');

  const [event] = await db<{ matching_paused: boolean }>(
    `SELECT matching_paused FROM events WHERE id = $1`,
    [eventId],
  );
  expect(event!.matching_paused).toBe(false);
});

test('every moderation action is audited', async () => {
  const rows = await db<{ action: string }>(
    `SELECT action FROM audit_log WHERE action IN
       ('event_approve_public', 'report_resolve', 'event_pause', 'event_unpause')`,
  );
  const actions = new Set(rows.map((r) => r.action));
  expect(actions).toEqual(new Set(['event_approve_public', 'report_resolve', 'event_pause', 'event_unpause']));

  // The audit page renders them too (admin-only section).
  await adminPage.goto('/admin/audit');
  await expect(adminPage.getByRole('cell', { name: 'event_approve_public' }).first()).toBeVisible();
  await expect(adminPage.getByRole('cell', { name: 'event_pause' }).first()).toBeVisible();
});
