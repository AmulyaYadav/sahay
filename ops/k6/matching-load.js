/**
 * Sahay matching-engine load test (k6).
 *
 * Scenario
 * --------
 * setup():   logs in a pool of USER_POOL (default 300) users via the OTP flow
 *            (requires the server to run with TEST_FIXED_OTP so codes are
 *            deterministic — NEVER set that in production) and joins them all
 *            to one event.
 * VUs:       ramp 0 → 200 over 2 m, hold 200 for 5 m, ramp down over 1 m.
 *            Each VU picks a pooled identity by VU id:
 *              ~60 % helpers    — list inventory once, switch Helping Now on,
 *                                 ping a coarse location every ~30 s, and
 *                                 answer any pending offer (90 % accept).
 *              ~40 % requesters — create a located request, poll its status
 *                                 every ~3 s, cancel if still unmatched after
 *                                 90 s, then breathe and go again.
 *
 * Thresholds: p95 latency < 500 ms, check success rate > 99 %.
 *
 * Run (see README.md):
 *   k6 run --env BASE_URL=https://staging.example.org \
 *          --env EVENT_CODE=MELA-XXXX \
 *          --env OTP=424242 \
 *          matching-load.js
 *
 * Config (all via --env / __ENV):
 *   BASE_URL     API origin                      default http://localhost:4000
 *   EVENT_CODE   code of the target event        REQUIRED (must be active)
 *   OTP          the TEST_FIXED_OTP value        default 424242
 *   USER_POOL    pooled identities to provision  default 300
 *   PHONE_BASE   first phone number of the pool  default +915530000000
 *   HELPER_SHARE fraction of helper VUs          default 0.6
 */
import http from 'k6/http';
import { check, fail, sleep } from 'k6';

const BASE_URL = (__ENV.BASE_URL || 'http://localhost:4000').replace(/\/+$/, '');
const API = `${BASE_URL}/api/v1`;
const EVENT_CODE = __ENV.EVENT_CODE || '';
const OTP = __ENV.OTP || '424242';
const USER_POOL = Number(__ENV.USER_POOL || 300);
const PHONE_BASE = __ENV.PHONE_BASE || '+915530000000';
const HELPER_SHARE = Number(__ENV.HELPER_SHARE || 0.6);

// Pune city center; identities scatter within ~±550 m of it.
const CENTER = { lat: 18.5204, lng: 73.8567 };

export const options = {
  stages: [
    { duration: '2m', target: 200 }, // ramp up
    { duration: '5m', target: 200 }, // hold
    { duration: '1m', target: 0 }, // ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<500'],
    checks: ['rate>0.99'],
  },
};

/* ------------------------------------------------------------------- utils */

function phoneFor(i) {
  // PHONE_BASE + i, keeping E.164 shape. Assumes the base has enough headroom.
  const base = BigInt(PHONE_BASE.replace('+', ''));
  return `+${(base + BigInt(i)).toString()}`;
}

function jitteredCoords() {
  return {
    lat: Math.round((CENTER.lat + (Math.random() - 0.5) * 0.01) * 1000) / 1000,
    lng: Math.round((CENTER.lng + (Math.random() - 0.5) * 0.01) * 1000) / 1000,
  };
}

function post(path, body, token, tag) {
  return http.post(`${API}${path}`, JSON.stringify(body), {
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    tags: { name: tag || path },
  });
}

function put(path, body, token, tag) {
  return http.put(`${API}${path}`, JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    tags: { name: tag || path },
  });
}

function get(path, token, tag) {
  return http.get(`${API}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    tags: { name: tag || path },
  });
}

function idem() {
  return `k6-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

/* ------------------------------------------------------------------- setup */

export function setup() {
  if (!EVENT_CODE) fail('EVENT_CODE is required (an active event on the target stack)');

  // Resolve the event once.
  const evRes = http.get(`${API}/events/${encodeURIComponent(EVENT_CODE)}`);
  check(evRes, { 'event resolves': (r) => r.status === 200 }) || fail(`event ${EVENT_CODE} not found`);
  const event = evRes.json();

  // Provision the identity pool: OTP login (deterministic code) + join event.
  // Sequential on purpose: setup() runs once and provider rate limits are per
  // phone; ~300 logins take well under a minute against a warm stack.
  const catRes = http.get(`${API}/catalogue`);
  check(catRes, { 'catalogue loads': (r) => r.status === 200 });
  const water = catRes.json().categories.find((c) => c.slug === 'water-bottle');
  if (!water) fail('water-bottle category missing from catalogue');

  const users = [];
  for (let i = 0; i < USER_POOL; i += 1) {
    const phone = phoneFor(i);
    const start = post('/auth/otp/start', { phone, locale: 'en' }, null, 'otp/start');
    check(start, { 'otp start ok': (r) => r.status === 200 });
    const verify = post(
      '/auth/otp/verify',
      { phone, code: OTP, device: { platform: 'web', name: 'k6' } },
      null,
      'otp/verify',
    );
    if (
      !check(verify, { 'otp verify ok': (r) => r.status === 200 })
    ) {
      fail(`login failed for ${phone} — is TEST_FIXED_OTP=${OTP} set on the server?`);
    }
    const token = verify.json().token;
    const join = post(`/events/${event.id}/join`, {}, token, 'events/join');
    check(join, { 'join ok': (r) => r.status === 200 });
    users.push({ token, helper: i < USER_POOL * HELPER_SHARE });
  }

  return { eventId: event.id, categoryId: water.id, unit: water.unit, users };
}

/* --------------------------------------------------------------- VU bodies */

function helperLoop(data, me) {
  // One-time per-iteration guarantee: inventory + availability. Both calls are
  // idempotent-ish (inventory uses an idempotency key stored per VU).
  if (!me.provisioned) {
    const inv = post(
      `/events/${data.eventId}/inventory`,
      {
        categoryId: data.categoryId,
        qty: 20,
        unit: data.unit,
        details: { sealed: true },
        idempotencyKey: `k6-helper-${__VU}`,
      },
      me.token,
      'inventory/add',
    );
    check(inv, { 'inventory added': (r) => r.status === 200 || r.status === 201 || r.status === 409 });
    me.provisioned = true;
  }

  const avail = put(
    `/events/${data.eventId}/availability`,
    { on: true, durationMinutes: 120 },
    me.token,
    'availability/on',
  );
  check(avail, { 'availability on': (r) => r.status === 200 });

  // ~30 s of helping: location ping at the start, then answer offers.
  const ping = put(
    `/events/${data.eventId}/location`,
    { coords: jitteredCoords() },
    me.token,
    'location/ping',
  );
  check(ping, { 'location ping ok': (r) => r.status === 200 });

  for (let tick = 0; tick < 10; tick += 1) {
    const pending = get('/offers/pending', me.token, 'offers/pending');
    if (check(pending, { 'offers poll ok': (r) => r.status === 200 })) {
      const items = pending.json().items || [];
      for (const offer of items) {
        if (offer.status !== 'offered') continue;
        const accept = Math.random() < 0.9;
        const res = post(
          `/offers/${offer.id}/respond`,
          { accept, alsoStopReceiving: false },
          me.token,
          'offers/respond',
        );
        // 409/410 are legitimate races (expired/superseded offers under load).
        check(res, { 'offer respond ok': (r) => r.status === 200 || r.status === 409 || r.status === 410 });
        if (accept && res.status === 200) {
          const match = res.json().match;
          if (match) {
            // Complete the exchange immediately so inventory recycles.
            const confirm = post(
              `/matches/${match.id}/confirm`,
              { qty: match.qtyReserved, idempotencyKey: idem() },
              me.token,
              'matches/confirm',
            );
            check(confirm, { 'helper confirm ok': (r) => r.status === 200 });
          }
        }
      }
    }
    sleep(3);
  }
}

function requesterLoop(data, me) {
  const req = post(
    '/requests',
    {
      eventId: data.eventId,
      categoryId: data.categoryId,
      qty: 1,
      unit: data.unit,
      urgency: 'standard',
      expiresInMinutes: 10,
      coords: jitteredCoords(),
      safetyAcknowledged: true,
      idempotencyKey: idem(),
    },
    me.token,
    'requests/create',
  );
  // 409 = this pooled identity already has the max number of active requests
  // (a previous iteration's request is still searching) — back off, not an error.
  if (req.status === 409) {
    sleep(10);
    return;
  }
  if (!check(req, { 'request created': (r) => r.status === 200 || r.status === 201 })) {
    sleep(5);
    return;
  }
  const requestId = req.json().id;

  // Poll status every ~3 s; give up (cancel) if unmatched after 90 s.
  const deadline = Date.now() + 90_000;
  for (;;) {
    sleep(3);
    const view = get(`/requests/${requestId}`, me.token, 'requests/status');
    if (!check(view, { 'request poll ok': (r) => r.status === 200 })) break;
    const status = view.json().status;
    if (status === 'matched') {
      // Confirm receipt so the match settles (helper confirms on their side).
      const matchId = view.json().activeMatchId;
      if (matchId) {
        const confirm = post(
          `/matches/${matchId}/confirm`,
          { qty: 1, idempotencyKey: idem() },
          me.token,
          'matches/confirm',
        );
        check(confirm, { 'requester confirm ok': (r) => r.status === 200 });
      }
      break;
    }
    if (['fulfilled', 'partially_fulfilled', 'cancelled', 'expired', 'no_match'].includes(status)) break;
    if (Date.now() > deadline) {
      const cancel = post(`/requests/${requestId}/cancel`, {}, me.token, 'requests/cancel');
      check(cancel, { 'cancel ok': (r) => r.status === 200 || r.status === 409 });
      break;
    }
  }
  sleep(2);
}

// Per-VU state (persists across iterations of the same VU).
const vuState = {};

export default function (data) {
  const idx = (__VU - 1) % data.users.length;
  const pooled = data.users[idx];
  if (!vuState[idx]) vuState[idx] = { token: pooled.token, provisioned: false };
  const me = vuState[idx];

  if (pooled.helper) helperLoop(data, me);
  else requesterLoop(data, me);
}
