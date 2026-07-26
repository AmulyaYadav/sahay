# ADR-0007: Expo/React Native mobile + Vite/React web (no universal app)

## Status
Accepted (2026-07)

## Context
Participants at outdoor events live on phones; moderators and event organizers work on
laptops; the public dashboard must be linkable without an install. One small team must
ship all three. Full code sharing (react-native-web everywhere) tends to produce a web
app that feels like a port and a build system that fights every dependency.

## Decision
Two apps, one shared domain package:

- **`apps/web`** — Vite + React SPA serving participant, public, and admin surfaces;
  deployed as static files behind Caddy; Web Push for notifications.
- **`apps/mobile`** — Expo (React Native) for iOS/Android; Expo Push; managed workflow
  to keep native tooling out of the critical path.
- Both consume **`@sahay/shared`** for schemas, constants, reliability/geo math, i18n.
  What is shared is the *domain*, not the UI.
- `apps/mobile` sits **outside the npm workspaces** (Metro's resolver and hoisted
  node_modules interact badly) and consumes the built shared package via a `file:`
  dependency.

## Alternatives considered
- **Expo universal app (react-native-web) for everything** — rejected: admin tables,
  public SEO-ish pages, and dense moderation UI are exactly what RN-web does worst.
- **PWA only, no native app** — rejected: unreliable background push on iOS and worse
  location/permission ergonomics during live events.
- **Native Swift/Kotlin** — rejected: two more codebases for a small team.
- **Mobile inside the workspaces** — attempted pattern known to cause Metro/hoisting
  pain; the `file:` dependency is the pragmatic compromise.

## Consequences
- One React skill set covers both apps; domain logic is written once.
- Shared-package changes require a rebuild (`npm run build -w packages/shared`) before
  mobile picks them up — a known papercut, documented in
  [local-development.md](../local-development.md).
- Two notification providers (Expo Push, Web Push) — abstracted behind one provider
  interface with a console driver in dev.

## Reconsider when
- Expo's monorepo support stabilizes enough to bring mobile into the workspaces, or
  product surface diverges so far that shared UI components would actually pay off.
