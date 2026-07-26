# ADR-0010: Docker Compose on a single VPS

## Status
Accepted (2026-07)

## Context
Budget is $50–150/mo; target load is a few thousand concurrent users per event, bursty
and event-shaped (idle most days). The operator is a tiny team without a platform
engineer. Users are primarily in India, so low latency to Mumbai matters.

## Decision
Production runs as **Docker Compose on one VPS** (Mumbai / ap-south-1 or equivalent):
`caddy` (TLS + static web SPA), `api` (Fastify), `worker` (BullMQ), `postgres`
(PostGIS), `redis`. Caddy terminates TLS with automatic certificates and reverse-proxies
`/api` and `/ws` to the API. CI is GitHub Actions (typecheck, lint, tests, image build);
deploys are image pull + `docker compose up -d` with migrations run explicitly first.
Nightly `pg_dump` shipped off-site is the disaster-recovery backbone
([incident-response.md](../incident-response.md)).

## Alternatives considered
- **Kubernetes (managed)** — rejected: control-plane cost alone eats the budget;
  operational complexity vastly exceeds the need.
- **PaaS (Fly/Render/Railway)** — attractive, but PostGIS support, worker processes, and
  predictable pricing at burst are each caveated; a VPS is boring and fully understood.
- **Managed Postgres/Redis + VPS app** — deferred, not rejected: it doubles the cost
  today but is the designated first scaling/reliability step (see below).
- **nginx + certbot** — Caddy does the same with near-zero config.

## Consequences
- **The VPS is a single point of failure** — accepted consciously. Sahay degrades to
  "people help each other without an app," which is the correct failure mode for a
  humanitarian matchmaker; stated honestly in
  [known-limitations.md](../known-limitations.md). RPO/RTO are bounded by backup cadence
  and rebuild time (targets in [incident-response.md](../incident-response.md)).
- One machine to harden, patch, and monitor; secrets live in one env file with tight
  permissions ([deployment.md](../deployment.md)).
- Vertical scaling first; the stateless API and Redis-fanout WS design keep multi-node
  open later (ADR-0002, ADR-0005).

## Reconsider when
- An event's projected load exceeds one big VPS, uptime expectations formalize (SLOs
  with consequences), or funding allows managed Postgres — move the database first, keep
  the app on compose.
