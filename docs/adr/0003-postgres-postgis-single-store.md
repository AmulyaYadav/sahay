# ADR-0003: PostgreSQL 16 + PostGIS as the single data store

## Status
Accepted (2026-07)

## Context
Sahay needs: transactional inventory reservation with hard invariants, proximity search
within event radii, append-only audit trails, and aggressive TTL-based deletion. A small
team must be able to reason about *exactly* where every piece of personal data lives to
honor the privacy and retention promises.

## Decision
One PostgreSQL 16 database with **PostGIS** for all durable state. Geography columns
(`geography(Point,4326)`, GiST-indexed) power event discovery and candidate distance
checks. Invariants live in the database itself: CHECK constraints
(`qty_reserved <= qty_on_hand`, quantities `>= 0`), partial unique indexes (one active
match per request, idempotency keys), and foreign keys with deliberate `CASCADE`/`SET
NULL` choices. Redis is used only for ephemeral coordination (jobs, rate-limit counters,
pub/sub) — never as a system of record. Drizzle ORM provides typed queries; the SQL DDL
remains authoritative (ADR-0004).

## Alternatives considered
- **Postgres + separate geo service / Elasticsearch** — rejected: a second store to
  secure, back up, and purge; PostGIS covers "within N meters" trivially.
- **MongoDB / DynamoDB** — rejected: the inventory invariants and multi-row matching
  transaction are exactly what relational CHECKs and `SELECT … FOR UPDATE` are for.
- **Storing location in Redis (natural TTL)** — seriously considered; rejected because
  matching joins location against blocks, availability, and inventory in one SQL query,
  and a second copy of location data doubles the purge surface. TTL is enforced by the
  retention worker plus an `expires_at` column instead.

## Consequences
- Single backup/restore story (`pg_dump` + WAL); single place to audit data retention.
- Retention is active deletion (worker jobs) rather than storage-level TTL — the worker
  becomes privacy-critical infrastructure and is monitored as such.
- Vertical scaling only, which the budget and target scale accept (ADR-0010).

## Reconsider when
- Read load on dashboards/aggregates justifies a read replica, or event count makes
  geo-queries a bottleneck GiST can't index around.
