# ADR-0002: Modular monolith on Fastify, separate worker process

## Status
Accepted (2026-07)

## Context
Target scale is a few thousand concurrent users per event on a $50–150/mo single VPS.
The domain (matching, inventory reservation, chat, moderation) is transactional and
benefits from one database with real transactions. Matching and retention involve timed
background work that must not compete with request latency.

## Decision
A single Fastify API process organized as a **modular monolith**: one route module per
domain under `server/src/modules/<name>/` (routes thin, logic in service files), wired in
`server/src/app.ts` under `/api/v1`. Background work runs in a **separate BullMQ worker
process** (`worker-main.ts`) sharing the same codebase and database. Fastify chosen for
schema-friendly validation, speed, and a small dependency surface; logging is configured
to redact auth headers and to never log bodies or query strings (privacy requirement).

## Alternatives considered
- **Microservices** — rejected: operational overhead (service discovery, N deployments,
  distributed transactions for inventory reservation) with zero benefit at this scale.
- **Single process for API + jobs** — rejected: a matching burst or retention sweep would
  starve request handling; separating them is one extra `docker compose` service.
- **Express/Nest** — Express lacks built-in schema validation hooks; Nest adds a DI
  framework the team doesn't need. Fastify hits the middle.
- **Serverless** — rejected: WebSockets, BullMQ delayed jobs, and PostGIS proximity
  queries all fight the model; costs are less predictable than a fixed VPS.

## Consequences
- One deployable API image + one worker image; trivial local dev (`dev:server`,
  `dev:worker`).
- Module boundaries are convention, not process boundaries — enforced by review and the
  rule that modules interact via service functions, not each other's tables ad hoc.
- All jobs must be idempotent (they re-check DB state) because worker restarts and BullMQ
  retries can re-deliver.

## Reconsider when
- A single module (likely chat or matching) needs independent scaling or a different
  runtime; the module layout is designed so extraction is a refactor, not a rewrite.
