# Contributing

Thanks for helping build Sahay. Two things make this project unusual to contribute to:
the privacy properties are **load-bearing product features**, and several documents are
contracts, not descriptions.

## Ground rules

- Read [product-requirements.md](product-requirements.md) — especially the
  **non-goals**. PRs adding participant lists, precise location, movement history,
  ratings/gamification, medicine categories, ads, or law-enforcement tooling will be
  declined regardless of quality; these are deliberate absences.
- Read [coding-standards.md](coding-standards.md); the privacy rules there are hard
  requirements.
- Be honest in UX copy: Sahay guarantees nothing; never write "verified," "safe," or
  "guaranteed" into user-facing text beyond exactly what is verified (a phone).

## Workflow

1. Open or claim an issue first for anything non-trivial; sketch the approach before
   writing code (cheap to redirect early).
2. Branch from `main`; keep PRs small and single-purpose.
3. Before pushing: `npm run typecheck && npm run lint && npm test`, plus
   `npm run test:integration` if you touched server logic, SQL, or queries
   ([testing.md](testing.md)).
4. Bug fixes land **with the test that would have caught them**.
5. PR description: what/why, any contract files touched, and — for anything touching
   personal data — a sentence on retention/threat-model impact.

## Contracts that change together (CI/review will hold you to these)

| If you change… | You must also change… |
|---|---|
| An endpoint | The zod schema in `@sahay/shared` **and** [api-surface.md](api-surface.md) |
| SQL (`server/migrations/`, new file only — applied migrations are immutable) | `server/src/db/schema.ts` and [data-model.md](data-model.md) |
| Enums/limits in `constants.ts` | Every doc quoting them (grep the value) — and expect a migration |
| Matching/ranking behavior | [matching.md](matching.md), [request-states.md](request-states.md) |
| Reliability math | [reliability.md](reliability.md) — the doc mirrors the code exactly |
| Anything storing personal data | [privacy-and-retention.md](privacy-and-retention.md) data inventory + a retention task + [threat-model.md](threat-model.md) if a new surface |
| An architectural decision | A new ADR in `docs/adr/` (next number, same template); don't edit accepted ADRs except Status |

## Review expectations

- At least one review; two for auth, crypto, matching transactions, or migrations.
- Reviewers will check the privacy rules mechanically (no new logging of bodies, no ids
  crossing to peers, no unbucketed distances) — make it easy for them.
- Security-sensitive reports (vulnerabilities) go privately to the maintainer, not the
  public issue tracker.

## Progress log

Meaningful milestones get a line in [progress.md](progress.md) — it is the living record
parallel workstreams coordinate through.
