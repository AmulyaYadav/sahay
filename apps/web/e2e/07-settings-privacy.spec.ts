/**
 * Settings & privacy rights:
 *  - the language toggle flips the whole UI to Hindi and back;
 *  - "Export my data" runs the async export (worker), the download contains
 *    NO email address;
 *  - deleting the account (typed pseudonym confirmation) logs the user out,
 *    and logging in again with the same email creates a FRESH pseudonymous
 *    account (old pseudonym gone for good).
 */
import { expect, test, type APIRequestContext, type BrowserContext, type Page } from '@playwright/test';
import { API_URL } from './env';
import { apiRaw, contextAt, loginViaUi } from './helpers';

const EMAIL = 'e2e-settings-privacy@example.com';

test.describe.configure({ mode: 'serial' });
test.setTimeout(150_000);

let ctx: BrowserContext;
let page: Page;

async function tokenFromPage(p: Page): Promise<string> {
  const token = await p.evaluate(() => localStorage.getItem('sahay.token'));
  expect(token).toBeTruthy();
  return token!;
}

async function pseudonymOf(request: APIRequestContext, token: string): Promise<string> {
  const me = await apiRaw<{ pseudonym: string }>(request, '/me', { token });
  return me.pseudonym;
}

test.beforeAll(async ({ browser }) => {
  ctx = await contextAt(browser, 0);
  page = await ctx.newPage();
  await loginViaUi(page, EMAIL);
});

test.afterAll(async () => {
  await ctx?.close();
});

test('language toggle flips the UI to Hindi and back', async () => {
  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();

  await page.getByRole('radio', { name: 'हिन्दी' }).click();
  await expect(page.getByRole('heading', { name: 'सेटिंग्स', exact: true })).toBeVisible();
  await expect(page.getByText('भाषा')).toBeVisible(); // settings.language in hi

  await page.getByRole('radio', { name: 'English' }).click();
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
});

test('data export completes and never contains the email address', async ({ request }) => {
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Request export' }).click();
  await expect(page.getByText('Preparing your export')).toBeVisible();

  // The export worker fulfils the job; the page polls every 4 s.
  await expect(page.getByText('Your export is ready.')).toBeVisible({ timeout: 60_000 });
  const link = page.getByRole('link', { name: 'Download my data (JSON)' });
  await expect(link).toBeVisible();
  const href = await link.getAttribute('href');
  expect(href).toBeTruthy();

  const token = await tokenFromPage(page);
  const res = await request.fetch(`${API_URL}${href}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(res.ok()).toBe(true);
  const body = await res.text();
  expect(body.length).toBeGreaterThan(2);
  expect(body).not.toContain(EMAIL);
});

test('account deletion logs out; the same email gets a fresh pseudonym', async ({ request }) => {
  const token = await tokenFromPage(page);
  const oldPseudonym = await pseudonymOf(request, token);

  await page.goto('/settings');
  await page.getByRole('button', { name: 'Delete my account' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('This permanently removes your account')).toBeVisible();
  await dialog.getByRole('textbox').fill(oldPseudonym);
  await dialog.getByRole('button', { name: 'Delete my account' }).click();

  // Logged out, back on the landing page.
  await page.waitForURL((url) => new URL(url).pathname === '/');
  await expect(page.getByRole('link', { name: 'Sign in', exact: true }).first()).toBeVisible();

  // Same email, brand-new identity.
  await loginViaUi(page, EMAIL);
  const newToken = await tokenFromPage(page);
  const newPseudonym = await pseudonymOf(request, newToken);
  expect(newPseudonym).not.toBe(oldPseudonym);

  await page.goto('/profile');
  await expect(page.getByText(newPseudonym).first()).toBeVisible();
});
