# Sahay (सहाय)

Sahay is a privacy-conscious, event-centric mutual-aid coordination platform. During a
community event — a relief operation, festival, campus event, community kitchen — people
who need small supplies (water, blankets, batteries, sanitary pads) are matched, one at a
time, with nearby people who have them to give. The platform is a **matchmaker only**: it
guarantees nothing, holds no goods, moves no money, and deliberately knows as little as
possible about the people who use it.

Sahay is non-partisan and humanitarian. There are no participant lists, no live maps, no
movement profiles, and no attendance records — by construction, not by policy alone.

## What it does

- **Event-scoped exchanges** — everything happens inside an event with a lifecycle
  (draft → scheduled → active → paused → completed → archived/disabled). Anyone can create
  an unlisted or invite-only event instantly; public listing requires moderator approval.
- **Server-driven matching** — a request is offered to one candidate helper at a time
  (45 s response window by default), with an expanding search radius (400 m, doubling up
  to the event maximum, default 5 km). Acceptance atomically reserves inventory; DB CHECK
  constraints make over-reservation impossible.
- **Pseudonymous identity** — stable account pseudonym (regenerable every 30 days) plus a
  fresh alias per match, so peers cannot correlate you across exchanges. Generated
  color+initials avatars; no photos, ever.
- **Coarse, expiring location** — a single UPSERTed row per user per event, rounded to
  ~110 m on the client *and* the server, purged after 15 minutes. Peers only ever see
  proximity buckets ("very nearby" … "farther"), never coordinates or distances.
- **Phone-OTP auth** — phone numbers are AES-256-GCM encrypted at rest with an HMAC blind
  index for lookup; they are never exposed via the API, logs, or the admin UI.
- **In-match chat** — ephemeral conversations with quick replies; read-only 60 minutes
  after a match closes and deleted with the event's retention window. Chat is TLS in
  transit and server-readable for moderation — Sahay does **not** claim end-to-end
  encryption (see [privacy & retention](docs/privacy-and-retention.md)).
- **Smoothed reliability** — Laplace-smoothed completion score and labels
  (new/active/reliable/highly reliable); declines are free, new helpers aren't buried.
- **k-anonymous dashboards** — public event aggregates ("what should I bring") only show
  numbers backed by at least 3 distinct users.
- **Moderation & safety** — 12 report categories with opt-in conversation-excerpt
  evidence, blocks that never reveal user ids, written-reason-required admin actions in an
  append-only audit log, appeals, and an emergency shutdown lever.
- **Aggressive retention** — background jobs purge locations, OTPs, sessions, messages,
  and anonymize closed requests/matches on short, documented schedules
  ([retention policy](docs/privacy-and-retention.md)).

## Stack

TypeScript npm-workspaces monorepo. Fastify modular-monolith API + separate BullMQ worker
process. PostgreSQL 16 + PostGIS (Drizzle ORM; hand-written SQL migrations). Redis 7
(jobs, rate limits, WebSocket fanout). Plain WebSockets as an at-most-once hint channel
with REST as source of truth. Web: Vite + React SPA. Mobile: Expo / React Native. Push:
Expo Push + Web Push behind a provider abstraction. Deploy: Docker Compose on a single
VPS behind Caddy TLS.

## Repository layout

```
packages/shared/   @sahay/shared — constants, zod schemas, reliability math, geo,
                   pseudonyms, default catalogue, i18n (en/hi). Shared by all apps.
server/            Fastify API (src/modules/*), BullMQ worker, DB schema + migrations.
  migrations/      Hand-written SQL, applied by server/src/db/migrate.ts.
apps/web/          Vite + React SPA (participant + public + admin). In progress.
apps/mobile/       Expo / React Native app. NOT in npm workspaces; depends on
                   @sahay/shared via a file: dependency. In progress.
ops/               Production compose / deployment assets. In progress.
docs/              Everything below.
```

## Quickstart (local development)

Prerequisites: Node.js ≥ 20, Docker.

```bash
# 1. Infrastructure (PostGIS + Redis)
docker compose up -d postgres redis

# 2. Server config
cp .env.example server/.env        # dev keys are fine locally; see docs/environment.md

# 3. Install & database
npm install
npm run db:migrate -w server
npm run db:seed -w server          # default catalogue + feature flags

# 4. Run (separate terminals)
npm run dev:server                 # API on :4000
npm run dev:worker                 # BullMQ worker (matching, retention, notifications)
npm run dev:web                    # SPA on :5173

# Mobile (not part of npm workspaces)
cd apps/mobile && npm install && npx expo start
```

With `SMS_PROVIDER=console` (the default), OTP codes are printed to the server's stdout.
See [local development](docs/local-development.md) for details and troubleshooting.

## Documentation

| Area | Docs |
|---|---|
| Product | [Product requirements](docs/product-requirements.md) · [Known limitations](docs/known-limitations.md) · [Progress](docs/progress.md) |
| Architecture | [Architecture](docs/architecture.md) · [ADRs](docs/adr/) · [API surface](docs/api-surface.md) |
| Domain | [Data model](docs/data-model.md) · [Matching](docs/matching.md) · [Request states](docs/request-states.md) · [Reliability](docs/reliability.md) |
| Security & privacy | [Threat model](docs/threat-model.md) · [Privacy & retention](docs/privacy-and-retention.md) |
| Operations | [Deployment](docs/deployment.md) · [Incident response & DR](docs/incident-response.md) · [Moderation handbook](docs/moderation-handbook.md) · [Environment variables](docs/environment.md) |
| Development | [Local development](docs/local-development.md) · [Testing](docs/testing.md) · [Coding standards](docs/coding-standards.md) · [Contributing](docs/contributing.md) |

## License

**TBD by the project owner.** Recommendation: **AGPL-3.0** — it keeps hosted forks of a
safety-sensitive platform open to inspection, which matters when users must trust the
operator's privacy claims. Until a license file is added, all rights are reserved.
