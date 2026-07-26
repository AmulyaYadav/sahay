# Testing

Test pyramid, bottom-up: **vitest unit** → **vitest integration on real Postgres/Redis**
→ **Playwright e2e** → **k6 load**. CI (GitHub Actions) runs typecheck, lint, unit, and
integration on every PR; e2e on main; load tests before events.

## 1. Unit (vitest, `--project unit`)

```bash
npm test                        # root alias → vitest run --project unit (server)
```

Pure logic, no I/O. Highest-value targets are the shared pure functions — the same code
runs on server and clients, so tests here protect everything at once:

- `reliability.ts` — score math, label thresholds, prior behavior (new helper = 0.5)
- `geo.ts` — coarsening (~110 m), bucket boundaries (150/400/1000), haversine sanity
- `pseudonyms.ts` — determinism, neutrality of outputs
- schema edge cases (`schemas.ts` zod parsing), request state transition guards,
  ranking composition, crypto helpers (`hashOtp` scoping, `safeEqualHex`)

## 2. Integration (vitest, `--project integration`)

```bash
docker compose up -d postgres_test redis   # tmpfs Postgres on :5433
npm run test:integration
```

Real PostGIS + Redis; each suite migrates a clean database (tmpfs makes this fast) and
drives the API via Fastify's `app.inject()` or HTTP. These tests exist to prove the
**invariants the docs promise**:

- inventory CHECKs: concurrent accepts cannot over-reserve
  (`qty_reserved <= qty_on_hand` holds under racing transactions);
- one active match per request (partial unique index) under concurrency;
- idempotency: replayed request-create / confirm / message-send / inventory-add;
- offer timeout → next candidate; radius expansion; decliner never re-asked;
- auth boundaries: IDOR attempts on requests/matches/conversations return 403/404;
- retention jobs actually delete (insert expired rows, run job, assert gone);
- OTP flow incl. attempt cap, rate limiting (fail-closed), and no-enumeration 200s;
- k-anonymity: dashboard returns `null` quantities below 3 distinct users.

Migration files themselves are exercised by every integration run (fresh DB each time),
which is what keeps `schema.ts` and the SQL honest (ADR-0004).

## 3. End-to-end (Playwright, `apps/web`)

```bash
npm run test:e2e                # requires api + worker + web running against a dev DB
```

Browser-level flows across the SPA: OTP login (console code scraped from server
output in test mode) → join event → create request → second browser accepts offer →
chat → both confirm → reliability label visible. Keep the suite small (happy paths +
block/report flow); everything else belongs a level down.

## 4. Load (k6)

Scenario scripts (under `ops/`, in progress) model an event burst: a few thousand
virtual users joining one event, ~10% requesting over 10 minutes, helpers responding
within the 45 s window, WS connections held open. Watch the
[matching observability metrics](matching.md): time-to-match, offer-timeout job lag,
candidate-query p95, queue depth. Run against **staging**, never production; before
each real event, run with that event's projected numbers.

## Conventions

- Tests live next to code (`*.test.ts`) for unit; integration under
  `server/test/` with the vitest project split configured in `server/`.
- Never use production-like keys/creds in fixtures; console providers only.
- No test may depend on wall-clock sleeps for offer windows — inject short
  `offer_response_seconds` via the event row or env instead.
- A bug fix lands with the test that would have caught it ([contributing.md](contributing.md)).
