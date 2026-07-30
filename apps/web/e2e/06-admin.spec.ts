/**
 * Moderation console: an admin (role granted via SQL — there is deliberately
 * no in-band way to mint admins) approves a pending public event, which then
 * appears in public discovery on the landing page; resolves a filed report
 * with a written reason; pauses the shared aid event (a direct API request
 * immediately sees the paused error) and unpauses it. Every action lands in
 * the audit log.
 *
 * The web app no longer has a request/match/chat UI (RequestFlow etc. were
 * removed), so anything that used to be exercised through that UI here is
 * now seeded/asserted via direct API calls instead.
 *
 * The admin console web UI was also trimmed to event CRUD + wants management
 * only (reports/users/categories/flags/appeals/audit/stats sections were
 * removed from this web app — see ADR-0012). The server endpoints backing
 * report resolution and the audit log are unchanged and still enforced, so
 * this spec now drives report resolution through the `/admin/moderate` API
 * directly (the same endpoint the removed Reports section used to call) and
 * asserts the audit trail via the database rather than a deleted admin UI
 * page.
 */
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import {
  ApiError,
  categoryBySlug,
  contextAt,
  createRequest,
  db,
  joinEvent,
  issueStaffCredentials,
  loginViaApi,
  loginViaUi,
  apiRaw,
  readState,
  type Session,
} from './helpers';

const ADMIN_EMAIL = 'e2e-admin-06@example.com';
const REQUESTER_EMAIL = 'e2e-requester-06@example.com';
const PUBLIC_EVENT_TITLE = 'Sahay E2E Public Water Fair';

test.describe.configure({ mode: 'serial' });
test.setTimeout(150_000);

let adminCtx: BrowserContext;
let adminPage: Page;
let requester: Session;
let admin: Session;

async function fillModerationReason(page: Page, reason: string): Promise<void> {
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Written reason (required)').fill(reason);
  await dialog.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(page.getByText('Submitted').first()).toBeVisible();
}

test.beforeAll(async ({ browser, request }) => {
  const { eventId, organizerEmail } = readState();

  // Promote the admin via SQL, then have it issue itself web console
  // credentials — the console is username+password only (ADR-0013).
  admin = await loginViaApi(request, ADMIN_EMAIL);
  await db(`UPDATE users SET role = 'admin' WHERE id = $1`, [admin.user.id]);
  const creds = await issueStaffCredentials(request, admin.token, 'e2e.admin06', 'e2e-admin-06-console@example.com');

  adminCtx = await contextAt(browser, 0);
  adminPage = await adminCtx.newPage();
  await loginViaUi(adminPage, creds.username, creds.password);

  // A pending public event, created by the organizer via the API.
  const organizer = await loginViaApi(request, organizerEmail);
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

  requester = await loginViaApi(request, REQUESTER_EMAIL);
  await joinEvent(request, requester.token, eventId).catch(() => undefined); // already a member is fine

  // File a report directly against the event (no match/chat UI exists on web
  // anymore, but the API still accepts event-scoped reports without a
  // matchId) so the moderation-console test below has something to resolve.
  await apiRaw(request, '/reports', {
    token: requester.token,
    body: {
      category: 'unsafe_meeting',
      eventId,
      note: 'Reported via e2e fixture.',
      preserveConversation: false,
    },
  });
});

test.afterAll(async () => {
  await adminCtx?.close();
});

test('admin approves a pending public event; it appears in public discovery', async ({ browser, request }) => {
  await adminPage.goto('/admin/events');
  const card = adminPage.locator('section.card', { hasText: PUBLIC_EVENT_TITLE });
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: 'Approve public listing' }).click();
  await fillModerationReason(adminPage, 'Verified organizer; listing looks legitimate.');

  // Public discovery via the API — `/` (the landing page) lists exactly
  // this: public, approved, active/scheduled events.
  const { items } = await apiRaw<{ items: Array<{ title: string; visibility: string }> }>(request, '/events');
  const listed = items.find((ev) => ev.title === PUBLIC_EVENT_TITLE);
  expect(listed).toBeTruthy();
  expect(listed!.visibility).toBe('public');

  // And on the landing page itself, anonymously.
  const anon = await browser.newContext();
  const anonPage = await anon.newPage();
  await anonPage.goto('/');
  await expect(anonPage.getByRole('link', { name: PUBLIC_EVENT_TITLE })).toBeVisible({ timeout: 15_000 });
  await anon.close();
});

test('admin resolves a filed report with a written reason', async ({ request }) => {
  // The web app's Reports section was removed (admin console is trimmed to
  // event CRUD + wants management only), but the server's report-resolution
  // endpoint is unchanged and still audited — exercise it directly via the
  // same `/admin/moderate` API the old UI used to call.
  const [pending] = await db<{ id: string }>(
    `SELECT id FROM reports WHERE category = 'unsafe_meeting' ORDER BY created_at DESC LIMIT 1`,
  );
  expect(pending).toBeTruthy();

  await apiRaw(request, '/admin/moderate', {
    token: admin.token,
    body: {
      action: 'report_resolve',
      reportId: pending!.id,
      reason: 'Reviewed evidence; warned the reported account.',
    },
  });

  const [report] = await db<{ status: string }>(`SELECT status FROM reports WHERE id = $1`, [pending!.id]);
  expect(report!.status).toBe('resolved');
});

test('pausing the event blocks new requests with a clear error; unpause restores', async ({ request }) => {
  const { eventId } = readState();

  await adminPage.goto('/admin/events'); // "Pending approval" defaults off, so all events already show
  const card = adminPage.locator('section.card', { hasText: 'Sahay E2E Community Event' });
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: 'Pause matching' }).click();
  await fillModerationReason(adminPage, 'Crowd crush risk reported near the main gate.');

  // A member now sees the paused error when trying to request. The web app
  // no longer has a request-flow UI (RequestFlow was removed), so this hits
  // the API directly — the server-side guard (and its error) still exists.
  const waterBottle = await categoryBySlug(request, 'water-bottle');
  let error: unknown;
  try {
    await createRequest(request, requester.token, eventId, waterBottle, 1);
  } catch (err) {
    error = err;
  }
  expect(error).toBeInstanceOf(ApiError);
  expect((error as ApiError).code).toBe('event_paused');

  // Unpause.
  await adminPage.goto('/admin/events');
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

  // The admin console no longer has an audit log UI section (trimmed to
  // event CRUD + wants management — see ADR-0012), so there is no page to
  // render these against; the database assertion above is the full check.
});

// Last in this file on purpose: it ends the shared adminPage session.
test('logging out returns to the public landing page and closes the console', async () => {
  await adminPage.goto('/admin');
  await adminPage.getByRole('button', { name: /Log out/i }).click();

  // Regression: this used to leave the admin sitting on /admin. The token was
  // cleared, but RequireModerator never re-rendered (getToken() is not
  // reactive) and the cached `me` still reported a moderator, so the console
  // stayed on screen after sign-out.
  await adminPage.waitForURL('/');
  await expect(adminPage.getByRole('link', { name: 'Admin Sign in' })).toBeVisible();
  await expect(adminPage.getByRole('button', { name: /Log out/i })).toBeHidden();
  await expect(adminPage.getByRole('link', { name: /Moderation/i })).toBeHidden();

  expect(await adminPage.evaluate(() => localStorage.getItem('sahay.token'))).toBeNull();

  // The guard holds afterwards: the console is no longer reachable.
  await adminPage.goto('/admin');
  await adminPage.waitForURL(/\/auth\?next=/);
});
