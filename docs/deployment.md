# Deployment

Production target: **Docker Compose on a single VPS** (ADR-0010), suggested region
Mumbai (ap-south-1 or equivalent), budget $50–150/mo. Environment variable reference:
[environment.md](environment.md). Failure planning:
[incident-response.md](incident-response.md).

> Note: the repo's root `docker-compose.yml` is **development infrastructure only**
> (postgres, postgres_test, redis). The production compose file described here lives
> under `ops/` (in progress — this section is its specification).

## Production architecture

```
Internet ──► caddy (:443, TLS auto via ACME, HSTS)
              ├── /            → static web SPA (built apps/web/dist)
              ├── /api/*, /ws  → api:4000 (reverse proxy, WS upgrade)
              └── (no other routes)
 api      — node dist/main.js       (Fastify; stateless; restart: always)
 worker   — node dist/worker-main.js (BullMQ; restart: always)
 postgres — postgis/postgis:16-3.4-alpine, volume-backed, NOT port-published
 redis    — redis:7-alpine, appendonly yes, NOT port-published
```

Rules baked into the compose spec:

- Postgres and Redis listen only on the internal compose network — never publish 5432 or
  6379 to the host.
- `api` and `worker` run the same image with different commands; both read the same env
  file (`/srv/sahay/.env`, mode 600, root-owned).
- Caddy must not log query strings (the WS token rides `/ws?token=…`): use a log format
  that drops the query, or disable access logs for `/ws`.
- Healthchecks: `api` → `GET /healthz` (liveness) and `GET /readyz` (DB + Redis ping);
  postgres → `pg_isready`.
- Host hardening: SSH keys only, firewall allowing 80/443/22, unattended security
  updates, Docker log rotation (`max-size`), NTP.

## Environments

| Env | Where | Data | Providers |
|---|---|---|---|
| local | host processes + `docker compose up -d postgres redis` | throwaway | `SMS_PROVIDER=console`, `PUSH_PROVIDER=console`, example keys |
| staging | small VPS, same compose as prod | synthetic (`db:seed:demo`) | console or sandbox SMS creds; real TLS on a staging domain |
| production | VPS Mumbai | real | `msg91`/`twilio`, `expo` push, real VAPID keys, unique 32-byte keys |

Staging exists to rehearse migrations, deploys, and restores — never point staging at
production data or keys.

## Deploy procedure

CI (GitHub Actions): typecheck → lint → unit tests → integration tests (real PG/Redis)
→ build images → push to registry. Then on the VPS:

```bash
docker compose pull api worker web        # new images
docker compose run --rm api npm run db:migrate -w server   # migrations FIRST, explicitly
docker compose up -d api worker
# caddy and databases are not restarted on app deploys
```

Verify: `curl -fsS https://<host>/readyz`, tail api/worker logs for one clean minute,
confirm retention jobs ticking (worker log), send a console/staging OTP round-trip.

### First admin account (once per deployment)

Staff accounts are minted by existing admins (ADR-0013), so a fresh database has nobody
who can create the first one. This command is that path. It is idempotent — an existing
username is a no-op that still exits 0 — so it is safe to leave in a deploy script.

```bash
docker compose run --rm \
  -e BOOTSTRAP_ADMIN_USERNAME=<username> \
  -e BOOTSTRAP_ADMIN_EMAIL=<email> \
  api npm run db:bootstrap:admin -w server
```

It prints a generated password **once** — capture it from that output, since only the
scrypt hash is stored. Set `BOOTSTRAP_ADMIN_PASSWORD` instead if the output is not
somewhere you can read back (minimum 12 characters). Either way the account is created
with `must_change_password`, so the printed password only survives until first sign-in;
the owner is forced to choose their own before the console will do anything, and that
change revokes any other session. Grant `BOOTSTRAP_ADMIN_ROLE=moderator` for a non-admin.

## Migration safety rules

Migrations are hand-written SQL applied in filename order, each in its own transaction,
recorded in `_migrations` (ADR-0004, `server/src/db/migrate.ts`).

1. **Immutable once applied anywhere.** Fixes are new files, never edits.
2. **Migrate before deploy; code must run against both schemas.** Additive first
   (add column → deploy code → backfill → constrain → remove old in a later release).
3. **No destructive DDL in the same release as the code that stops using it.**
4. Long-running backfills go in the migration only if they lock nothing important;
   otherwise a worker one-off. Remember each file is one transaction — keep them small.
5. Rehearse on staging against a production-shaped dataset; note expected duration.
6. Take a manual `pg_dump` immediately before any migration touching
   `users`, `inventory_items`, `matches`, or `requests`.

## Backups & restore drill

- **Nightly `pg_dump`** (custom format, `pg_dump -Fc`), encrypted (age/gpg), shipped
  off-site to object storage (e.g. S3 ap-south-1) with 14-day rotation. Backups contain
  everything within retention windows — treat them with production-data care; their
  encryption key is a first-class secret.
- **WAL note:** plain nightly dumps mean up to 24 h data loss (RPO). When the platform
  hosts real events, enable WAL archiving (`archive_command` to object storage, or
  wal-g/pgbackrest) to bring RPO to minutes. Until then, run an extra manual dump right
  before and after each major event.
- Redis is **not backed up**: queues/rate-limits are reconstructible; after restore,
  in-flight jobs are re-derived from DB state by the idempotent workers.
- **Restore drill (quarterly, on staging):** fetch latest dump → decrypt →
  `pg_restore -d sahay_restore` → run migrator (should say "up to date") → point a
  staging api at it → verify `/readyz`, login, request/match loop. Record time taken;
  that number is your real RTO input.

## Secret rotation

All secrets live in the env file; rotation = edit + `docker compose up -d api worker`.

| Secret | Procedure | Impact |
|---|---|---|
| `PII_ENCRYPTION_KEY` | **Not hot-rotatable** — requires a re-encryption migration (decrypt with old, encrypt with new, versioned key ids). Plan one; until then treat as rotate-only-if-compromised (see incident runbook) | Phone decryption |
| `PHONE_HMAC_KEY` | Same: blind indexes must be recomputed from decrypted phones in a migration | Phone lookup + OTP hashes: rotating breaks login until recompute completes |
| SMS creds (`TWILIO_*`/`MSG91_*`) | Issue new at provider → update env → restart → revoke old | None if sequenced |
| VAPID keypair | Generate (`npx web-push generate-vapid-keys`) → update env → restart | All web-push subscriptions invalidate; clients re-subscribe |
| DB/Redis passwords | Change in compose/env for db and app together; restart stack | Seconds of downtime |
| Compromised session(s) | No key to rotate — revoke rows in `sessions` (or all, forcing re-login) | Users re-authenticate via OTP |

## Rollback

- **App:** redeploy the previous image tag (`docker compose up -d api worker` with the
  pinned tag). Because migrations are additive-first, previous code runs on the new
  schema.
- **Schema:** no down-migrations. Either roll forward with a corrective migration, or —
  data-loss-accepting — restore the pre-migration dump. Deciding which is a Sev-2+
  incident decision, not an on-the-fly one.
- **Bad deploy detection:** `/readyz` failing, error-rate spike in api logs, queue depth
  growth in worker logs.

## Monitoring & alerting (suggested minimal set)

Single VPS reality: keep it lightweight — Uptime-Kuma or a hosted pinger + node exporter
level metrics is enough to start.

| Signal | Alert when |
|---|---|
| `GET /readyz` from outside | fails 2× in a row (page) |
| TLS cert expiry | < 14 days (Caddy auto-renews; alert = renewal broke) |
| Disk usage (pg volume) | > 80% |
| **Retention worker liveness** | no retention-job log line for > 5 min — **privacy-critical**, a stalled purge is an incident, not a nuisance |
| BullMQ queue depth / offer-timeout lag | match queue depth sustained > 100 or timeout jobs firing > 10 s late (silently stretches every offer window) |
| Backup job | nightly dump missing or unrestorable size delta |
| SMS spend / OTP volume | provider spend anomaly (cost attack, see threat #14) |
| Postgres connections / slow queries | near max_connections; candidate query p95 regressions |

Logs are structured (pino), body-free and query-string-free by construction
(`app.ts` serializers); ship them nowhere by default — grep on the box, rotate
aggressively.
