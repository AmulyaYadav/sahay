/**
 * Shared helpers for the e2e suite.
 *
 * Philosophy: the journey under test goes through the browser UI; auxiliary
 * fixtures (extra helpers, inventory, availability, locations) are seeded via
 * plain API calls for speed; direct SQL is reserved for assertions and
 * time-warping (e.g. forcing an offer past its respond_by).
 */
import fs from 'node:fs';
import { randomBytes } from 'node:crypto';
import { expect, type APIRequestContext, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { Redis } from 'ioredis';
import pg from 'pg';
import { API_URL, DATABASE_URL, EVENT_CENTER, FIXED_OTP, REDIS_URL, STATE_FILE } from './env';

/* ----------------------------------------------------------------- DB/redis */

let pool: pg.Pool | null = null;

/** Direct SQL access to the e2e database — for assertions and time-warping only. */
export async function db<T extends Record<string, unknown> = Record<string, unknown>>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  if (!pool) pool = new pg.Pool({ connectionString: DATABASE_URL, max: 2 });
  const res = await pool.query(text, params);
  return res.rows as T[];
}

/** Grant a user the admin role directly via SQL — there is deliberately no
 * in-band (HTTP) way to mint admins/moderators, so tests that need one
 * (e.g. the organizer creating events, which now requires moderator/admin)
 * must promote via direct DB access. */
export async function promoteToAdmin(userId: string): Promise<void> {
  await db(`UPDATE users SET role = 'admin' WHERE id = $1`, [userId]);
}

/**
 * OTP starts are rate-limited per email (3/10 min) AND per IP (10/h) — far too
 * tight for a test suite that logs in dozens of times from 127.0.0.1. Clearing
 * the fixed-window keys before each login keeps the limiter code in play while
 * making logins deterministic.
 */
export async function clearOtpRateLimits(): Promise<void> {
  const redis = new Redis(REDIS_URL, { lazyConnect: true });
  await redis.connect();
  const keys = await redis.keys('rl:otp:*');
  if (keys.length > 0) await redis.del(...keys);
  await redis.quit();
}

/* -------------------------------------------------------------------- state */

export interface SuiteState {
  eventId: string;
  eventCode: string;
  organizerEmail: string;
}

export function readState(): SuiteState {
  return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) as SuiteState;
}

export function writeState(state: SuiteState): void {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

/* ---------------------------------------------------------------------- api */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(`${status} ${code}: ${message}`);
  }
}

export interface ApiOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  token?: string;
}

/** Minimal fetch wrapper against the API (absolute URL, bypasses the Vite proxy). */
export async function apiRaw<T>(request: APIRequestContext, path: string, opts: ApiOptions = {}): Promise<T> {
  const method = opts.method ?? (opts.body !== undefined ? 'POST' : 'GET');
  const res = await request.fetch(`${API_URL}/api/v1${path}`, {
    method,
    headers: opts.token ? { Authorization: `Bearer ${opts.token}` } : {},
    data: opts.body !== undefined ? (opts.body as Record<string, unknown>) : undefined,
  });
  const text = await res.text();
  const json = text ? (JSON.parse(text) as Record<string, unknown>) : undefined;
  if (!res.ok()) {
    const err = (json as { error?: { code?: string; message?: string } } | undefined)?.error;
    throw new ApiError(res.status(), err?.code ?? `http_${res.status()}`, err?.message ?? text);
  }
  return json as T;
}

/** Bound wrapper: `const call = api(request, token); await call('/me')`. */
export function api(request: APIRequestContext, token: string) {
  return <T>(path: string, opts: Omit<ApiOptions, 'token'> = {}) => apiRaw<T>(request, path, { ...opts, token });
}

export function idemKey(): string {
  return `e2e-${randomBytes(12).toString('hex')}`;
}

/* --------------------------------------------------------------------- auth */

export interface Session {
  token: string;
  user: { id: string; pseudonym: string; role: string };
}

/** OTP login via the API (fast path for fixture users). Creates the account on first use. */
export async function loginViaApi(request: APIRequestContext, email: string): Promise<Session> {
  await clearOtpRateLimits();
  await apiRaw(request, '/auth/otp/start', { body: { email, locale: 'en' } });
  const session = await apiRaw<{ token: string; user: Session['user'] }>(request, '/auth/otp/verify', {
    body: { email, code: FIXED_OTP, device: { platform: 'web', name: 'e2e' } },
  });
  return { token: session.token, user: session.user };
}

/**
 * Issues staff credentials for an existing admin through the real
 * POST /admin/admins endpoint. The web console is username+password only
 * (ADR-0013), so UI sign-in needs credentials rather than an OTP.
 */
export async function issueStaffCredentials(
  request: APIRequestContext,
  adminToken: string,
  username: string,
  email: string,
): Promise<{ username: string; password: string }> {
  const created = await apiRaw<{ username: string; password: string }>(request, '/admin/admins', {
    token: adminToken,
    body: { username, email, role: 'admin' },
  });
  return { username: created.username, password: created.password };
}

/**
 * Full UI sign-in through the admin console's username + password form, ending
 * on /admin.
 *
 * Freshly issued staff credentials carry `mustChangePassword` (ADR-0013), so
 * the console sends them to /auth/password first. This walks that screen too
 * and returns whatever password is live afterwards — callers that sign in again
 * later must use the returned value, not the one they passed in.
 */
export async function loginViaUi(page: Page, username: string, password: string): Promise<string> {
  await page.goto('/auth');
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();

  await page.waitForURL(/\/(admin|auth\/password)/);
  if (!new URL(page.url()).pathname.startsWith('/auth/password')) return password;

  const chosen = `e2e-chosen-${username}-pw`;
  await page.getByLabel('Current password').fill(password);
  await page.getByLabel('New password', { exact: true }).fill(chosen);
  await page.getByLabel('Confirm new password').fill(chosen);
  await page.getByRole('button', { name: 'Save new password' }).click();
  await page.waitForURL('**/admin');
  return chosen;
}

export interface SeedSessionOptions {
  /** Pre-populate the joined-events localStorage so /home has an active event. */
  event?: { id: string; code: string; title: string };
  /** Pre-grant the app-level location consent (skips the consent dialog). */
  locationConsent?: boolean;
}

/**
 * Make every page in `context` already logged in (and optionally already
 * "joined" to an event) by seeding localStorage before app scripts run.
 */
export async function seedBrowserSession(
  context: BrowserContext,
  token: string,
  opts: SeedSessionOptions = {},
): Promise<void> {
  await context.addInitScript(
    ({ token, event, locationConsent }) => {
      localStorage.setItem('sahay.token', token);
      localStorage.setItem('sahay.locale', JSON.stringify('en'));
      if (event) {
        localStorage.setItem('sahay.joinedEvents', JSON.stringify([event]));
        localStorage.setItem('sahay.activeEvent', JSON.stringify(event.id));
      }
      if (locationConsent) localStorage.setItem('sahay.locationConsent', 'true');
    },
    { token, event: opts.event ?? null, locationConsent: opts.locationConsent ?? false },
  );
}

/** New browser context with geolocation granted at an offset from the event center. */
export async function contextAt(browser: Browser, latOffset = 0, lngOffset = 0): Promise<BrowserContext> {
  return browser.newContext({
    permissions: ['geolocation'],
    geolocation: { latitude: EVENT_CENTER.lat + latOffset, longitude: EVENT_CENTER.lng + lngOffset },
    baseURL: 'http://localhost:5173',
  });
}

/* ----------------------------------------------------------- event fixtures */

export interface CategoryRef {
  id: string;
  slug: string;
  unit: string;
}

export async function categoryBySlug(request: APIRequestContext, slug: string): Promise<CategoryRef> {
  const { categories } = await apiRaw<{ categories: CategoryRef[] }>(request, '/catalogue');
  const cat = categories.find((c) => c.slug === slug);
  if (!cat) throw new Error(`catalogue category not found: ${slug}`);
  return cat;
}

export async function joinEvent(request: APIRequestContext, token: string, eventId: string): Promise<void> {
  await apiRaw(request, `/events/${eventId}/join`, { token, body: {} });
}

export async function addInventory(
  request: APIRequestContext,
  token: string,
  eventId: string,
  category: CategoryRef,
  qty: number,
  details: Record<string, unknown> = { sealed: true },
): Promise<{ id: string }> {
  return apiRaw(request, `/events/${eventId}/inventory`, {
    token,
    body: { categoryId: category.id, qty, unit: category.unit, details, idempotencyKey: idemKey() },
  });
}

export async function setAvailability(
  request: APIRequestContext,
  token: string,
  eventId: string,
  on: boolean,
): Promise<void> {
  await apiRaw(request, `/events/${eventId}/availability`, {
    token,
    method: 'PUT',
    body: on ? { on: true, durationMinutes: 120 } : { on: false },
  });
}

export async function pingLocation(
  request: APIRequestContext,
  token: string,
  eventId: string,
  latOffset = 0,
  lngOffset = 0,
): Promise<void> {
  await apiRaw(request, `/events/${eventId}/location`, {
    token,
    method: 'PUT',
    body: { coords: { lat: EVENT_CENTER.lat + latOffset, lng: EVENT_CENTER.lng + lngOffset } },
  });
}

/**
 * Fully seeded helper: joins the event, lists `qty` water bottles, switches
 * Helping Now on and pings a coarse location `latOffset` north of the center.
 */
export async function seedHelper(
  request: APIRequestContext,
  email: string,
  eventId: string,
  category: CategoryRef,
  qty: number,
  latOffset = 0.001,
): Promise<Session> {
  const session = await loginViaApi(request, email);
  await joinEvent(request, session.token, eventId);
  await addInventory(request, session.token, eventId, category, qty);
  await setAvailability(request, session.token, eventId, true);
  await pingLocation(request, session.token, eventId, latOffset);
  return session;
}

export interface RequestView {
  id: string;
  status: string;
  qty: number;
  qtyFulfilled: number;
  attemptCount: number;
  activeMatchId: string | null;
}

export async function createRequest(
  request: APIRequestContext,
  token: string,
  eventId: string,
  category: CategoryRef,
  qty: number,
  opts: { latOffset?: number; lngOffset?: number; expiresInMinutes?: number } = {},
): Promise<RequestView> {
  return apiRaw<RequestView>(request, '/requests', {
    token,
    body: {
      eventId,
      categoryId: category.id,
      qty,
      unit: category.unit,
      urgency: 'standard',
      expiresInMinutes: opts.expiresInMinutes ?? 30,
      coords: {
        lat: EVENT_CENTER.lat + (opts.latOffset ?? 0),
        lng: EVENT_CENTER.lng + (opts.lngOffset ?? 0),
      },
      safetyAcknowledged: true,
      idempotencyKey: idemKey(),
    },
  });
}

export interface OfferView {
  id: string;
  requestId: string;
  status: string;
}

/** Poll /offers/pending for `token` until an offer for `requestId` shows up. */
export async function waitForOffer(
  request: APIRequestContext,
  token: string,
  requestId: string,
  timeoutMs = 20_000,
): Promise<OfferView> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const { items } = await apiRaw<{ items: OfferView[] }>(request, '/offers/pending', { token });
    const offer = items.find((o) => o.requestId === requestId && o.status === 'offered');
    if (offer) return offer;
    if (Date.now() > deadline) throw new Error(`no pending offer for request ${requestId} within ${timeoutMs}ms`);
    await new Promise((r) => setTimeout(r, 500));
  }
}

export interface MatchView {
  id: string;
  conversationId: string;
  status: string;
  qtyReserved: number;
}

export async function respondOffer(
  request: APIRequestContext,
  token: string,
  offerId: string,
  accept: boolean,
): Promise<{ match?: MatchView }> {
  return apiRaw(request, `/offers/${offerId}/respond`, { token, body: { accept, alsoStopReceiving: false } });
}

export async function confirmMatch(
  request: APIRequestContext,
  token: string,
  matchId: string,
  qty: number,
): Promise<void> {
  await apiRaw(request, `/matches/${matchId}/confirm`, { token, body: { qty, idempotencyKey: idemKey() } });
}

/** Poll a request via the API until its status is one of `statuses`. */
export async function waitForRequestStatus(
  request: APIRequestContext,
  token: string,
  requestId: string,
  statuses: string[],
  timeoutMs = 20_000,
): Promise<RequestView> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const view = await apiRaw<RequestView>(request, `/requests/${requestId}`, { token });
    if (statuses.includes(view.status)) return view;
    if (Date.now() > deadline) {
      throw new Error(`request ${requestId} stuck in ${view.status}; wanted ${statuses.join('/')}`);
    }
    await new Promise((r) => setTimeout(r, 500));
  }
}

/* ---------------------------------------------------------------- UI moves */

/** Join an event through the UI: /events → enter code → event page → Join. */
export async function joinEventViaUi(page: Page, eventCode: string): Promise<void> {
  await page.goto('/events');
  await page.getByLabel('Enter event code').fill(eventCode);
  await page.getByRole('button', { name: 'Open', exact: true }).click();
  await page.getByRole('button', { name: 'Join event' }).click();
  await expect(page.getByText('Joined').first()).toBeVisible();
}

/** Fill and submit the request flow for the water-bottle category. */
export async function requestWaterViaUi(page: Page, eventId: string, qty: number): Promise<void> {
  await page.goto(`/events/${eventId}/request`);
  await page.getByRole('button', { name: 'Sealed water bottle' }).click();
  for (let i = 1; i < qty; i += 1) {
    await page.getByRole('button', { name: 'Increase' }).first().click();
  }
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Request help', exact: true }).click();
  await page.waitForURL('**/home');
}
