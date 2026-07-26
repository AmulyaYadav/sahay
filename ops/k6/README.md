# k6 load tests — Sahay matching engine

Load-testing assets for the matching hot path (OTP login → join → inventory /
availability / location pings vs. request → offer → match → confirm). These
run against a **staging** stack only — the deterministic-OTP switch they rely
on is refused by the server in production.

## Prerequisites

- [k6](https://k6.io/docs/get-started/installation/) installed on the load
  generator (it is intentionally **not** an npm dependency of this repo).
- A staging deployment of the full stack: API, **worker** (matching happens
  there — without it every request just sits in `searching`), Postgres+PostGIS,
  Redis.
- The API and worker started with `TEST_FIXED_OTP=424242` (or your own
  6-digit value) so `setup()` can log in the user pool. The server refuses
  this variable when `NODE_ENV=production` — use a staging environment.
- An **active** event to load against. Create one via the API or UI and note
  its code; make sure its active window covers the test and its radius covers
  the ~±550 m jitter the script applies around Pune's center
  (`18.5204, 73.8567`) — a `radiusM` of 3000+ with `maxSearchRadius` defaults
  is fine. If your event is elsewhere, adjust `CENTER` in the script.
- Phone-number headroom: the pool uses `PHONE_BASE + i`. The default
  `+915530000000…+915530000299` range does not collide with the e2e suite's
  fixtures.

## Running

```sh
k6 run \
  --env BASE_URL=https://staging-api.example.org \
  --env EVENT_CODE=MELA-XXXX \
  --env OTP=424242 \
  matching-load.js
```

Optional knobs: `USER_POOL` (default 300), `PHONE_BASE` (default
`+915530000000`), `HELPER_SHARE` (default `0.6`).

## Scenario: `matching-load.js`

- **Stages**: ramp 0 → 200 VUs over 2 m, hold 200 for 5 m, ramp down 1 m.
- **setup()**: resolves the event, logs in `USER_POOL` (300) pooled users via
  the OTP flow, joins them all to the event.
- **60 % helper VUs**: list 20 sealed water bottles once (idempotency key per
  VU), switch Helping Now on, ping a coarsened location, then poll pending
  offers for ~30 s per iteration, accepting 90 % (and confirming completion
  immediately so stock recycles) and declining the rest. `409/410` responses
  on offer responses are counted as OK — they are legitimate races with offer
  expiry under load.
- **40 % requester VUs**: create a 1-bottle request with coordinates, poll its
  status every ~3 s, confirm receipt when matched, and cancel if still
  unmatched after 90 s.
- **Thresholds** (fail the run when breached):
  - `http_req_duration: p(95) < 500ms`
  - `checks: rate > 0.99`

Per-endpoint timings are tagged (`otp/verify`, `requests/create`,
`offers/respond`, …) — use `--out json=result.json` or a k6 dashboard output
to break p95 down by `name`.

### Reconnection storm

The WebSocket channel is hint-only (clients refetch REST state on reconnect),
so the nastiest real-world burst is not steady load but a **reconnection
storm**: thousands of clients dropping and re-attaching at once (cell handover
at a venue, a proxy restart). Approximate it by running this script at hold
load and restarting the API process (or bouncing the load balancer) mid-run:
every VU's next poll doubles as the "refetch after reconnect", so you get the
thundering-herd read pattern against `/offers/pending`, `/requests/:id` and
`/matches/active` while OTP/session state stays warm. Watch p95 on the poll
endpoints and Redis CPU during the minute after the restart. A dedicated
`k6/ws` scenario (N×1000 socket connects + REST refetch) is a worthwhile
follow-up if WS fan-out becomes a suspect.

## Resilience runbook (manual, alongside a load run)

Run each drill while `matching-load.js` holds 200 VUs; the pass criterion for
every one of them is: **no lost state** (requests/offers/matches settle
correctly afterwards) and thresholds recover within ~2 minutes of the fault
clearing. All jobs are idempotent and re-checked under row locks, so
duplicate processing must never corrupt state — that is exactly what these
drills verify.

1. **Worker restart** — `kill`/restart the worker process (or
   `docker restart <worker>`), leave it down ~60 s.
   Expect: matching pauses (requests stay `searching`, offers past
   `respond_by` linger), then the repeatable retention sweeps
   (`expire_offers`, `expire_requests`, every 60 s) drain the backlog after
   restart. No request may be stuck in `offering` with an expired offer more
   than ~2 minutes after the worker returns.

2. **Cache flush** — `redis-cli -u $REDIS_URL flushdb` mid-run.
   This wipes queues, schedulers, rate-limit windows and pub/sub state.
   Expect: the API stays up (rate limiter fails closed on errors, open on a
   clean-but-empty db), workers re-register their repeatable schedulers within
   60 s, and in-flight requests recover via the sweeps. Some in-flight
   offer-timeout jobs are lost by design — the `expire_offers` retention sweep
   is the backstop; verify it catches them.

3. **DB slowdown** — `docker pause <postgres-container>` for 20–30 s, then
   `docker unpause`.
   Expect: requests time out or queue (thresholds will breach during the
   pause — that is fine), `/readyz` flips unhealthy, nothing crashes, and the
   system settles to a consistent state after unpause: no reservation leaks
   (`inventory_items.qty_reserved` sums must match active matches), no
   double-completed matches, worker reconnects without manual intervention.

After each drill, spot-check invariants in SQL:

```sql
-- reserved quantities must equal open reservations
SELECT ii.id FROM inventory_items ii
WHERE ii.qty_reserved <> COALESCE((
  SELECT sum(m.qty_reserved) FROM matches m
  WHERE m.inventory_item_id = ii.id AND m.status = 'active'), 0);

-- no open offer may belong to a settled request
SELECT mo.id FROM match_offers mo
JOIN requests r ON r.id = mo.request_id
WHERE mo.status = 'offered' AND r.status NOT IN ('searching', 'offering');
```

(Both queries must return zero rows.)
