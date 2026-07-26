# Local development

Prerequisites: Node.js ≥ 20 (`engines` in root `package.json`), Docker, npm.

## Setup

```bash
git clone <repo> && cd mutual-aid-app

# 1. Infra: PostGIS on :5432, Redis on :6379 (plus postgres_test on :5433)
docker compose up -d postgres redis        # or: npm run dev:infra

# 2. Server env — the example file works as-is for local dev
cp .env.example server/.env

# 3. Dependencies (npm workspaces: packages/*, server, apps/web)
npm install

# 4. Database
npm run db:migrate -w server               # applies server/migrations/*.sql
npm run db:seed -w server                  # default catalogue + feature flags
npm run db:seed:demo -w server             # optional: demo event + users

# 5. Run — three terminals
npm run dev:server                         # Fastify API on :4000 (tsx watch)
npm run dev:worker                         # BullMQ worker (matching, retention, notify)
npm run dev:web                            # Vite SPA on :5173
```

## Mobile (Expo)

`apps/mobile` is **not** an npm workspace (ADR-0007); it consumes `@sahay/shared` via a
`file:` dependency on the built package.

```bash
npm run build -w packages/shared           # mobile reads dist/, so build first
cd apps/mobile
npm install
npx expo start
```

After changing anything in `packages/shared/src`, rebuild it and restart Metro with a
cleared cache (`npx expo start -c`) — Metro caches the old dist.

## Everyday facts

- **OTP codes**: with `SMS_PROVIDER=console` (default) the code is printed on the API
  process stdout. Push notifications likewise log to console
  (`PUSH_PROVIDER=console`).
- **The worker matters**: without `dev:worker` running, requests will sit in
  `searching` forever, offers never time out, and retention never purges. If matching
  "does nothing," this is why.
- **Source of truth chain**: change endpoints and zod schemas together
  ([api-surface.md](api-surface.md)); change SQL migrations and
  `server/src/db/schema.ts` together (ADR-0004); shared enums/limits only in
  `packages/shared/src/constants.ts`.
- **Auth in dev**: everything is phone OTP — there is no password backdoor. Create test
  users by verifying console OTPs; `db:seed:demo` provides pre-made users. Promote a
  moderator/admin by updating `users.role` directly in SQL (no API self-promotion,
  deliberately).
- **WebSocket**: `GET ws://localhost:4000/ws?token=<bearer>`; frames are hints — if
  your client seems to miss updates, that's the contract: refetch REST (ADR-0005).
- **Health**: `curl localhost:4000/healthz` (liveness), `/readyz` (DB + Redis).

## Reset / troubleshooting

| Symptom | Fix |
|---|---|
| Fresh database wanted | `docker compose down -v && docker compose up -d postgres redis && npm run db:migrate -w server && npm run db:seed -w server` |
| `Invalid configuration for: …` at boot | `server/.env` missing/malformed — the error names fields only (never values); check [environment.md](environment.md) |
| Server refuses to start in production mode | Example crypto keys are rejected when `NODE_ENV=production` — generate real ones (`openssl rand -hex 32`) |
| Port already in use | Something else on 4000/5173/5432/6379; stop it or change `PORT` |
| Integration tests can't connect | `postgres_test` service (tmpfs, :5433) not up: `docker compose up -d postgres_test` |
| Shared changes not visible in mobile | Rebuild `packages/shared`, reinstall/refresh in `apps/mobile`, `expo start -c` |
| Matching never fires | Worker not running, or Redis down (`docker compose ps`) |

See also: [testing.md](testing.md), [coding-standards.md](coding-standards.md),
[contributing.md](contributing.md).
