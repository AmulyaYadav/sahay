/**
 * Public landing: anonymous visitors see active, public, moderator-approved
 * events with their area/wants info, can click into full event detail, and
 * see the volunteer CTA. No login is used anywhere in this spec.
 *
 * Depends on 06-admin.spec.ts having already approved a public event
 * ("Sahay E2E Public Water Fair" — visibility: public, publicApproved: true,
 * still active) — the shared 00-setup fixture event is deliberately
 * `visibility: 'unlisted'` and never appears in public discovery, so it
 * can't be used here. Runs after 00/06 by filename order (single worker).
 */
import { expect, test } from '@playwright/test';
import { apiRaw } from './helpers';

const PUBLIC_EVENT_TITLE = 'Sahay E2E Public Water Fair';
const PUBLIC_EVENT_AREA = 'Near Sarasbaug, Pune';

interface PublicEventSummary {
  id: string;
  code: string;
  title: string;
  areaLabel: string;
}

test('anonymous visitor sees the event on the landing page with its area and wants', async ({ page, request }) => {
  const { items } = await apiRaw<{ items: PublicEventSummary[] }>(request, '/events');
  const fixture = items.find((ev) => ev.title === PUBLIC_EVENT_TITLE);
  expect(fixture, 'expected 06-admin.spec.ts to have approved this event for public discovery').toBeTruthy();

  await page.goto('/');

  // The get-the-app CTA is present on the landing page without any login.
  await expect(page.getByRole('heading', { name: 'Works on any device' })).toBeVisible();

  const card = page.getByRole('link', { name: PUBLIC_EVENT_TITLE });
  await expect(card).toBeVisible();
  await expect(card.getByText(PUBLIC_EVENT_AREA)).toBeVisible();

  await card.click();
  await expect(page).toHaveURL(new RegExp(`/events/${fixture!.code}`));
  await expect(page.getByRole('heading', { name: 'What this event needs' })).toBeVisible();
  await expect(page.getByText(PUBLIC_EVENT_AREA)).toBeVisible();

});

test('signing in is not required to view any public page', async ({ page, request }) => {
  await page.goto('/');
  // The web app is the admin console, so the only sign-in affordance is the
  // header's "Admin Sign in" pill (AppShell renders it on every page).
  await expect(page.getByRole('link', { name: 'Admin Sign in' })).toBeVisible();
  // No redirect to /auth happens just from visiting the landing page.
  await expect(page).toHaveURL('/');

  // Nor from visiting an event's public detail page directly.
  const { items } = await apiRaw<{ items: PublicEventSummary[] }>(request, '/events').catch(() => ({ items: [] }));
  const fixture = items.find((ev) => ev.title === PUBLIC_EVENT_TITLE);
  if (fixture) {
    await page.goto(`/events/${fixture.code}`);
    await expect(page).toHaveURL(new RegExp(`/events/${fixture.code}`));
    await expect(page.getByRole('heading', { name: fixture.title })).toBeVisible();
  }
});
