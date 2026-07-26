# Architecture

Sahay is a **modular monolith**: one Fastify API process, one BullMQ worker process, one
PostgreSQL (+PostGIS) database, one Redis. Clients (web SPA, Expo mobile) speak REST and
receive WebSocket *hints*; REST is always the source of truth. Decisions are recorded as
[ADRs](adr/); the endpoint contract is [api-surface.md](api-surface.md).

## Component diagram

```
        ┌──────────────┐        ┌──────────────┐
        │  Web SPA     │        │  Mobile app  │
        │  Vite+React  │        │  Expo / RN   │
        └──────┬───────┘        └──────┬───────┘
               │  HTTPS (REST /api/v1 + WS /ws)
        ┌──────▼────────────────────────▼──────┐
        │            Caddy (TLS, static web)   │   ── single VPS ──
        └──────┬────────────────────────┬──────┘
               │                        │
        ┌──────▼──────────┐      ┌──────▼──────────┐
        │  API (Fastify)  │      │ (WS connections │
        │  src/modules/*  │      │  live on API)   │
        └──┬──────┬───────┘      └─────────────────┘
           │      │  enqueue jobs / publish ws:out
           │      ▼
           │   ┌────────────┐   BullMQ + pub/sub  ┌───────────────────┐
           │   │  Redis 7   │◄────────────────────┤  Worker (BullMQ)  │
           │   │ jobs, rate │────────────────────►│  matching, offer  │
           │   │ limits, WS │                     │  timeouts, notify,│
           │   │ fanout     │                     │  retention, data  │
           │   └────────────┘                     │  requests         │
           │                                      └────────┬──────────┘
           ▼                                               │
        ┌──────────────────────────────────────────────────▼──┐
        │        PostgreSQL 16 + PostGIS (source of truth)    │
        └─────────────────────────────────────────────────────┘
                             │ push side-effects
                             ▼
              Expo Push / Web Push / SMS provider
              (console driver in development)
```

## Processes

| Process | Entry | Responsibilities |
|---|---|---|
| API | `server/src/main.ts` → `app.ts` | REST `/api/v1`, WebSocket gateway, auth, validation, transactions. Enqueues jobs; never does slow work inline. |
| Worker | `server/src/worker-main.ts` | BullMQ workers: `match` (candidate selection + offers), `offer-timeout` (delayed jobs), `notify` (push/in-app), `retention` (repeatable purge/expiry jobs, every 60 s), `data-request` (export/delete). All jobs are idempotent — they re-check DB state before acting. |

Both processes share `server/src` code; only the entrypoints differ. Queue definitions
live in `server/src/queues.ts`.

## Module map (server)

`server/src/app.ts` wires one route module per domain; business logic lives in each
module's service file, never in route handlers.

| Module (`src/modules/…`) | Owns |
|---|---|
| `auth` | OTP start/verify, sessions, logout |
| `users` | `/me`, pseudonym regeneration, blocks list, push tokens, notification prefs |
| `events` | create/join/leave, lifecycle, notices, invite codes |
| `catalogue` | global category list |
| `inventory` | helper stock, idempotent adds, reservation accounting |
| `availability` | "Helping Now" toggle + coarse location pings |
| `requests` | request lifecycle, renew/continue |
| `offers` | pending offers, accept/decline (atomic reservation) |
| `matches` | meeting states, cancel, completion confirmation |
| `chat` | conversations, messages, read receipts |
| `dashboard` | k-anonymized needs aggregates, bring suggestions |
| `notifications` | in-app notification feed |
| `safety` | reports, blocks |
| `privacy` | data export/delete, consents |
| `admin` | moderation, catalogue/flags/appeals/audit, emergency shutdown |
| `health` | `/healthz`, `/readyz` (registered outside `/api/v1`) |

Cross-cutting pieces: `plugins/auth.ts` (bearer sessions, `requireRole`),
`plugins/error-handler.ts` (uniform `zApiError` envelope, i18n error codes),
`lib/crypto.ts` (PII encryption, blind index, tokens, OTP), `lib/redis.ts` (client +
fixed-window rate limiter), `realtime/hub.ts` + `realtime/gateway.ts` (Redis pub/sub →
WS), `db/` (Drizzle schema mirroring the SQL, migrator).

## Shared package

`packages/shared` (`@sahay/shared`) is the single vocabulary for all three apps:
enums/limits (`constants.ts`), zod request/response schemas (`schemas.ts`), reliability
math (`reliability.ts`), coordinate coarsening + proximity buckets (`geo.ts`), pseudonym
and avatar generation (`pseudonyms.ts`), the default supply catalogue and prohibited
patterns (`catalogue-defaults.ts`), and en/hi i18n strings. The mobile app consumes it
via a `file:` dependency (it is outside the npm workspaces, see ADR-0007).

## Data flow: request → match → chat → complete

1. **Request** — `POST /api/v1/requests` (`zCreateRequest`, idempotency key). API writes
   the `requests` row (`status=searching`), records the transition, and enqueues a
   `match` job.
2. **Candidate selection** — the worker runs the candidate SQL (PostGIS distance within
   the current radius; excludes blocked pairs, suspended users, prior decliners,
   overloaded helpers), ranks (distance bucket + fairness + reliability + jitter), and
   creates **one** `match_offers` row. Request → `offering`. A delayed `offer-timeout`
   job is scheduled for `respond_by` (45 s default). The helper gets a WS hint + push.
3. **Response** — decline/timeout returns the request to `searching` and re-enqueues
   matching (radius may expand). Accept runs a transaction: `SELECT … FOR UPDATE` on the
   inventory row, `qty_reserved += qty` (DB CHECKs forbid over-reservation), insert
   `matches` (partial unique index: one active match per request) + `conversations`,
   assign per-match aliases. Request → `matched`.
4. **Chat & meeting** — participants exchange messages/quick replies and meeting states
   (`on_my_way` … `done`) under aliases; proximity shown as buckets only. WS frames are
   hints; clients refetch on reconnect.
5. **Complete** — both parties confirm a quantity. At both-confirmed the minimum is
   deducted from `qty_on_hand` and released from `qty_reserved` exactly once
   (`inventory_applied` flag); reliability counters update once (`reliability_applied`).
   Single confirmation auto-closes after a grace period; mismatch → `disputed` with no
   public penalty. Partial fulfilment can return the request to `searching` at the
   requester's choice. Conversation goes read-only 60 min after close.

## Realtime semantics

WebSocket frames (`WS_EVENTS` in `@sahay/shared`) are **at-most-once hints** published
via Redis pub/sub (`ws:out` channel, `realtime/hub.ts`), so any API or worker process can
reach a user connected anywhere. Missed frames are safe: clients refetch REST state on
reconnect (ADR-0005). Auth failures close with 4401; suspension mid-connection sends
`session.revoked` then closes 4403.

## Scaling path

Designed for a few thousand concurrent users per event on one VPS. In order, when needed:

1. **Vertical** — bigger VPS; Postgres and Redis are far from their limits at this scale.
2. **Split processes** — run N API replicas behind Caddy (stateless: sessions in PG, WS
   fanout already via Redis pub/sub) and scale worker concurrency independently.
3. **Move Postgres/Redis to managed services** — removes backup/failover toil; the app
   only needs `DATABASE_URL`/`REDIS_URL` changed.
4. **Partition by event** — the schema is event-scoped throughout; hot events could be
   served by dedicated deployments before any need for sharding.

Not planned: microservices, multi-region active-active. See
[known-limitations.md](known-limitations.md) for the single-region SPOF discussion.

## Cost estimate (budget target $50–150/mo)

| Item | Est. monthly |
|---|---|
| VPS, 4 vCPU / 8 GB, Mumbai (ap-south-1 or equivalent) | $40–70 |
| Off-site backup storage (object storage, ~50 GB) | $2–5 |
| SMS OTP (MSG91/Twilio, usage-based; dominant variable cost) | $10–60 |
| Domain + misc | $2–5 |
| Expo Push / Web Push / Caddy / GitHub Actions (free tiers) | $0 |

Total ≈ $55–140/mo. SMS volume is the lever to watch: rate limits on `/auth/otp/start`
are as much a cost control as an abuse control.
