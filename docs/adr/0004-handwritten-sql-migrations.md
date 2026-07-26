# ADR-0004: Hand-written SQL migrations, minimal migrator

## Status
Accepted (2026-07)

## Context
The schema encodes privacy guarantees (blind indexes, single-row location, append-only
audit) and safety invariants (inventory CHECKs, partial unique indexes). Generated
migrations hide exactly the details a reviewer must see. PostGIS types and partial
indexes are also poorly supported by most codegen.

## Decision
Migrations are **hand-written SQL files** in `server/migrations/`, applied in filename
order by a ~50-line migrator (`server/src/db/migrate.ts`): each file runs in its own
transaction and is recorded in a `_migrations` table; already-applied files are skipped.
`server/src/db/schema.ts` (Drizzle) *mirrors* the DDL for the query builder — the SQL is
the source of truth, and the two must change together. Migration 0001 has been validated
against a real PostGIS database.

## Alternatives considered
- **drizzle-kit generated migrations** — rejected: diffs are machine-oriented, custom
  types (`geography`) and partial indexes need escape hatches anyway, and generated DDL
  weakens review of privacy-critical schema changes.
- **Flyway/Liquibase** — rejected: a JVM dependency and config surface for what a tiny
  script does.
- **No migration table (idempotent DDL)** — rejected: `IF NOT EXISTS` everywhere hides
  drift and makes ordering fragile.

## Consequences
- Every schema change is a reviewable SQL diff; reviewers see constraints and indexes
  verbatim.
- Discipline required: schema.ts and the SQL can drift; integration tests run against a
  migrated database to catch mismatches.
- No down-migrations: rollback is restore-from-backup or a new forward migration
  (documented in [deployment.md](../deployment.md)).
- Files are immutable once applied anywhere; fixes are new files.

## Reconsider when
- Migration count or team size makes hand-ordering error-prone, or drizzle-kit's SQL
  output becomes clean enough to review as first-class DDL.
