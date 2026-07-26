# ADR-0001: TypeScript monorepo with npm workspaces

## Status
Accepted (2026-07)

## Context
Sahay ships a server, a web SPA, and a mobile app that must agree exactly on domain
vocabulary: request states, limits, zod schemas, reliability math, coordinate coarsening.
Drift between client and server in a safety-relevant app (e.g. a client rounding location
differently than the server expects) is a privacy bug, not just a UX bug. The team is
small and the budget precludes heavy tooling.

## Decision
One repository, TypeScript everywhere, plain **npm workspaces** (no pnpm/turbo/nx).
Shared code lives in `packages/shared` (`@sahay/shared`) and is the only path by which
constants, schemas, and pure domain functions reach clients. Workspaces: `packages/*`,
`server`, `apps/web`. The Expo app (`apps/mobile`) sits outside the workspaces and uses a
`file:` dependency on the built shared package (see ADR-0007).

## Alternatives considered
- **Polyrepo** — rejected: schema drift risk, triple review overhead, no atomic changes
  across server + clients.
- **pnpm / turborepo / nx** — rejected for now: npm is preinstalled, CI stays trivial,
  and the build graph (shared → server/web) is small enough to express with three npm
  scripts.
- **Publishing @sahay/shared to a registry** — rejected: versioning ceremony for a
  private package with exactly three consumers.

## Consequences
- Single `npm install`, one lockfile, atomic cross-cutting PRs.
- `packages/shared` must be built before server/web builds (`npm run build` orders this).
- npm workspaces' weaker isolation (hoisting) is acceptable at this dependency count.
- The mobile app's `file:` dependency needs a rebuilt `dist/` to pick up shared changes.

## Reconsider when
- Workspace count or build times grow enough that task orchestration/caching (turbo, nx)
  pays for itself, or React Native tooling becomes workspace-friendly enough to bring
  `apps/mobile` into the workspace graph.
