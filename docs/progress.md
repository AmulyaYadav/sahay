# Progress log

Living document — newest entries first. Add a line for meaningful milestones
([contributing.md](contributing.md)). Status vocabulary: **done** (merged, tested),
**in progress**, **planned**.

## Status snapshot (2026-07-26)

| Area | Status | Notes |
|---|---|---|
| `packages/shared` (constants, schemas, reliability, geo, pseudonyms, catalogue, i18n en/hi) | **done** | 2026-07-25 |
| DB schema + migration `0001_init.sql` + migrator | **done** | Validated against a real PostGIS database |
| Server foundation (config, crypto, redis/rate-limit, errors, auth plugin, app assembly, queue defs, realtime hub, entrypoints) | **done** | 2026-07-25 |
| API surface contract (`docs/api-surface.md`) | **done** | Change with schemas, never alone |
| Server domain modules (`src/modules/*`: auth…admin), realtime gateway, error handler wiring | **done** | 177 vitest tests green (61 unit / 116 integration) |
| Workers (`src/workers/`: match, offer-timeout, notify, retention, data-request) | **done** | All processors implemented + repeatable retention schedule |
| DB seeds (`db/seed.ts`, `db/seed-demo.ts`) | **done** | 43 categories; fictional demo set (3 events, 14 users) |
| Web SPA (`apps/web`) | **done** | Full participant + public + admin UI; 17 Playwright e2e tests green |
| Mobile (`apps/mobile`, Expo) | **done** | tsc clean; `expo export` build verified |
| Ops (`ops/`: production compose, Caddyfile, CI, k6) | **done** | Prod compose + Caddy + GitHub Actions CI + backup/restore + k6 |
| Documentation set (README, ADRs 0001–0010, domain/security/ops/dev docs) | **done** | 2026-07-26, this changeset |
| Voice calls | **designed, disabled** | Feature flag `voice_calls=false` |

## Log

- **2026-07-26** — Final validation: all suites green (shared build, server typecheck,
  61 unit + 116 integration, web typecheck + prod build, mobile tsc + expo export,
  17/17 Playwright e2e across two full runs), fresh-database setup verified
  (migrate + seed from empty DB), live smoke test against demo data (OTP login,
  k-anonymized dashboard), production Docker images built, log-privacy scan clean
  (only the dev console SMS provider prints masked numbers). Fixed along the way:
  peer `conversation.update` WS frame on unsafe cancel; account-deletion redirect
  race in the web app; production config guard hardened (example/reused keys).
- **2026-07-26** — E2E + load assets: Playwright suite (9 specs incl. the full §49
  two-context journey, decline/timeout, partial fulfilment, safety/block/report,
  admin moderation, privacy/export/delete, offline recovery), `TEST_FIXED_OTP`
  test hook (refused in production), k6 matching-load script + resilience runbook.
- **2026-07-26** — Trust/admin/privacy slice: notifications pipeline (vague-by-default
  push, dedupe, per-type prefs), reports with alias-only evidence snapshots, blocks,
  full admin/moderation API with per-role allowlist + append-only audit, appeals,
  data export/delete workers, k-anonymized event dashboards, 10 retention tasks,
  demo seed. 177 server tests green.
- **2026-07-26** — Matching engine slice: request state machine with append-only
  transitions, sequential single-candidate offers with expanding radius, atomic
  reservation (SELECT FOR UPDATE + DB CHECKs + one-active-match index), completion/
  partial fulfilment/dispute settlement, auto-finalize, anonymous chat with
  quick replies + idempotent sends + redaction, reliability plumbing. Found and
  fixed a text-vs-int comparison bug in the radius SQL.
- **2026-07-26** — Web app complete (all routes incl. admin, design system, en/hi,
  offline handling); mobile app complete (Expo, offline queues, push, deep links);
  event-creation UI + Web Push added; mobile i18n polish.

- **2026-07-26** — Full documentation set written: README, architecture, ADRs
  0001–0010, data-model, matching, request-states, reliability, threat-model,
  privacy-and-retention, moderation-handbook, deployment, incident-response (incl. DR),
  local-development, testing, coding-standards, contributing, environment,
  known-limitations, product-requirements, this log.
- **2026-07-26** — Migration `0001_init.sql` validated against a real PostGIS database.
- **2026-07-25** — Server foundation merged: config loader (fail-fast, value-free
  errors), PII crypto (AES-256-GCM + blind index), sessions/auth plugin, Redis
  rate-limiter (fail-closed), BullMQ queue definitions, realtime hub (Redis pub/sub),
  API/worker entrypoints, minimal SQL migrator.
- **2026-07-25** — Initial DB schema `0001_init.sql`: full table set incl. inventory
  CHECK invariants, one-active-match partial index, append-only audit/transitions,
  feature-flag seed.
- **2026-07-25** — `@sahay/shared` package complete: domain constants/limits, zod API
  schemas, reliability math, geo coarsening/buckets, pseudonym/avatar generation,
  default catalogue + prohibited patterns, en/hi i18n.
- **2026-07-25** — Dev infrastructure: docker-compose (PostGIS 16-3.4, tmpfs test DB,
  Redis 7), `.env.example`, npm workspaces layout.
