# Coding standards

TypeScript everywhere, strict mode (`tsconfig.base.json`). These rules exist to keep the
privacy and safety promises enforceable in review — the unusual ones are marked.

## Architecture rules

- **Routes are thin.** Route handlers in `server/src/modules/<name>/routes.ts` do:
  validate (zod from `@sahay/shared`), call the module's service, shape the response.
  Business logic lives in service files (see header of `server/src/app.ts`).
- **Modules talk through services**, not each other's tables. Cross-module reads happen
  via exported service functions so extraction stays possible (ADR-0002).
- **Shared vocabulary lives in `@sahay/shared` only.** No re-declared enums, limits, or
  schemas in server/web/mobile. If server and client both need it, it goes there; keep
  it a pure, dependency-light package (zod only).
- **Contract discipline**: endpoint + zod schema + [api-surface.md](api-surface.md)
  change together, never one alone. Same for SQL migration + `db/schema.ts`
  (ADR-0004).
- **State machines are server-owned.** Clients request transitions; only server code
  writes `requests.status`/`matches.status`, always appending a transition row.

## Privacy rules (enforced in review, non-negotiable)

- **Never log**: request/response bodies, query strings, `Authorization` headers, phone
  data (plaintext, `phone_enc`, or `phone_hmac`), OTP codes, session tokens,
  coordinates, or message bodies. The logger config in `app.ts` strips most of this
  structurally — don't reintroduce it via ad-hoc `log.info(obj)`.
- **User ids never cross to peers.** Peer-facing responses use aliases and
  `zPeerProfile` only. Any new endpoint returning "the other person" must go through
  that schema.
- **Exact distances/coordinates never leave the server** — buckets only
  (`bucketForDistanceM`).
- **New personal data requires**: a schema comment, a row in the
  [data inventory](privacy-and-retention.md), a retention task, and a
  [threat-model](threat-model.md) glance. No column without a deletion story.
- Config errors report **field names only, never values** (`config.ts` pattern).

## Correctness rules

- **Invariants belong in the database**: CHECK constraints, partial unique indexes, FKs
  — application checks are a UX nicety on top, not the enforcement
  ([data-model.md](data-model.md)).
- **Every job is idempotent**: re-read state, exit if already done; exactly-once side
  effects ride DB flags (`inventory_applied` pattern), not queue semantics.
- **Every client-initiated mutation that can be retried is idempotent** via an
  idempotency key or natural uniqueness.
- **Money-shaped code** (inventory reservation/deduction) runs in explicit transactions
  with `SELECT … FOR UPDATE`; never read-then-write across statements without a lock.
- Timing-sensitive comparisons of secrets use `timingSafeEqual` (`safeEqualHex`);
  secrets are generated with `crypto.randomBytes`, unbiased (see `newOtpCode`).

## Style

- ESM (`"type": "module"`), Node ≥ 20; imports use `.js` extensions in TS source.
- `snake_case` in SQL, `camelCase` in TS; Drizzle maps between them explicitly.
- Zod schemas are named `z<Thing>`; inferred types exported beside them.
- Errors: throw `AppError` via the `errors.*` factories (`lib/errors.ts`) — machine
  codes map to i18n keys; never hand-build error JSON in a handler.
- All user-visible strings go through i18n keys (`packages/shared/src/i18n`, en + hi);
  notifications store keys + params, not rendered text.
- Comments explain *why* (see the header comments across `server/src` for the tone);
  no commented-out code in main.
- Formatting/lint via the workspace `lint` scripts; no bikeshedding beyond what the
  tools enforce.
