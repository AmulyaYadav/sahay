# Environment variables

Authoritative source: `server/src/config.ts` (zod-validated at boot; invalid config
fails fast and reports **field names only, never values**). Template: `.env.example`
(copy to `server/.env` for local dev). Both API and worker read the same env.

Production guard: with `NODE_ENV=production` the server **refuses to start** if
`PII_ENCRYPTION_KEY`/`PHONE_HMAC_KEY` still hold the example values from
`.env.example`.

## Core

| Var | Required | Default | Purpose / format |
|---|---|---|---|
| `NODE_ENV` | no | `development` | `development` \| `test` \| `production` |
| `PORT` | no | `4000` | API listen port |
| `HOST` | no | `0.0.0.0` | API bind address |
| `DATABASE_URL` | **yes** | — | Postgres URL, e.g. `postgres://sahay:sahay_dev@localhost:5432/sahay` (matches docker-compose) |
| `DATABASE_SSL` | no | `off` | `off` \| `require` \| `verify`. Managed Postgres needs TLS; `require` encrypts without verifying the chain (stops passive eavesdropping, not an active MITM), `verify` also checks it. Set explicitly rather than via `sslmode` in the URL. |
| `DATABASE_POOL_MAX` | no | `20` | Pool size **per process**. api + worker both open one, so halve this against a provider that caps connections. |
| `REDIS_URL` | no | `redis://localhost:6379` | Redis URL (BullMQ, rate limits, WS fanout). Not optional in practice: rate limiting is fail-closed, so an unreachable Redis blocks all sign-in. |

## Cryptographic keys

Generate each with `openssl rand -hex 32`. Store production values **outside the VPS
as well** (password manager) — they are required to read backups
([incident-response.md](incident-response.md)).

| Var | Required | Format | Purpose |
|---|---|---|---|
| `PII_ENCRYPTION_KEY` | **yes** | 64 hex chars (32 bytes) | AES-256-GCM key encrypting phone numbers at rest (`lib/crypto.ts`). Not hot-rotatable — see [deployment.md](deployment.md) |
| `PHONE_HMAC_KEY` | **yes** | 64 hex chars (32 bytes) | Keyed blind index for phone lookup **and** pepper for OTP hashes. Must differ from the encryption key. Rotating breaks phone lookup until indexes are recomputed |

## SMS (OTP delivery)

| Var | Required | Default | Purpose |
|---|---|---|---|
| `SMS_PROVIDER` | no | `console` | `console` (logs OTP to stdout — dev only) \| `twilio` \| `msg91` |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_FROM` | when `twilio` | — | Twilio credentials + sender number/id |
| `MSG91_AUTH_KEY` / `MSG91_SENDER_ID` | when `msg91` | — | MSG91 credentials + approved sender id (DLT-registered for India) |

Note: provider-specific vars are `optional` in the schema — the server will boot with a
provider selected but unconfigured; delivery then fails at runtime. Check these
carefully when switching providers.

## Push notifications

| Var | Required | Default | Purpose |
|---|---|---|---|
| `PUSH_PROVIDER` | no | `console` | `console` (log only) \| `expo` (Expo Push for mobile) |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | for Web Push | — | Generate with `npx web-push generate-vapid-keys`. Rotating invalidates all web subscriptions |
| `VAPID_SUBJECT` | for Web Push | — | `mailto:` or URL contact, e.g. `mailto:ops@example.org` |

## Web / matching tunables

| Var | Required | Default | Purpose |
|---|---|---|---|
| `WEB_ORIGIN` | no | `http://localhost:5173` | Public origin of the SPA — the **only** allowed CORS origin in production, and the base for links in notifications |
| `SCRYPT_COST_LOG2` | no | `16` | log2(N) for **new** staff password hashes: ~250ms and 64 MiB per verification at 16, ~125ms and 32 MiB at 15. Hashing is synchronous, so lower it on a slow instance to keep logins from stalling other requests — not to avoid OOM (one hash runs at a time per process). Stored hashes carry their own cost, so this never invalidates an existing password (ADR-0013). |
| `OFFER_RESPONSE_SECONDS` | no | `45` | Default offer response window; events can override per-row (`events.offer_response_seconds`) |
| `LOCATION_TTL_MINUTES` | no | `15` | Coarse-location row lifetime; the retention worker purges past this. Raising it weakens a privacy promise — treat as a product decision, not a knob |

## Non-server environments

- **Web (`apps/web`)**: Vite-style `VITE_*` vars (API base URL, VAPID public key) —
  defined in that workspace as it lands.
- **Mobile (`apps/mobile`)**: Expo config (API URL) via `app.json`/`app.config`.
- **CI**: needs `DATABASE_URL` pointing at the tmpfs `postgres_test` service (:5433)
  and a local Redis for integration tests; never real provider credentials.
