# Deploying the prototype on free tiers

A public deployment with no monthly bill, for a prototype. The production design
is one VPS running `docker-compose.prod.yml` (ADR-0010, [deployment.md](deployment.md));
this splits that across three free providers instead. Read
[What you are giving up](#what-you-are-giving-up) before relying on it for anything real.

> Also free, and architecturally closer to the design: running the whole compose
> stack on one Oracle Always Free ARM instance — see
> [deploy-oracle-arm.md](deploy-oracle-arm.md). Better deployment, less reliable host.

| Piece | Provider | Free tier | Why this one |
|---|---|---|---|
| Postgres + PostGIS | **Supabase** | 500 MB, pauses only after 7 days of *inactivity* | PostGIS available, and no compute-hour meter. Neon's free tier caps compute at 100 hours/month — an always-connected server burns ~730, so it does not fit. |
| Redis | **Northflank** addon | included in sandbox | Real Redis on the internal network. Not Upstash: BullMQ holds blocking connections, which burn a per-command quota continuously. |
| API + worker | **Northflank** sandbox | 2 always-on services | Two long-running processes, no sleeping. Render's free tier gives one web service, no free background worker, and its free Postgres expires after 30 days. |
| Web (static SPA) | **Cloudflare Pages** | unlimited static | Free, fast, and the bundle is fully static. |
| Email (OTP) | **Resend** | 3,000/month | Required — the server refuses to start in production without it (see below). |

Redis is **not optional**: rate limiting is fail-closed, so with Redis
unreachable nobody can sign in at all.

---

## 0. Generate secrets

```bash
openssl rand -hex 32   # PII_ENCRYPTION_KEY
openssl rand -hex 32   # IDENTITY_HMAC_KEY
```

Two **different** values. The server refuses to start in production if they are
equal, or if either is an example key from `.env.example`. Keep them safe:
`PII_ENCRYPTION_KEY` decrypts stored email addresses and `IDENTITY_HMAC_KEY`
builds the blind index used to look accounts up. Lose them and existing
accounts become unreadable and unfindable.

## 1. Database — Supabase

1. Create a project. Save the database password it generates.
2. SQL Editor → `CREATE EXTENSION IF NOT EXISTS postgis;` — the schema will not
   migrate without it.
3. Project Settings → Database → **Connection string → URI**. Use the
   **connection pooler** host, not the direct one: free-tier direct connections
   are IPv6-only, which most platforms cannot reach.
4. Note the pooler's **session mode** port (5432 on the pooler host). This app
   uses transactions and `SELECT … FOR UPDATE`; transaction-mode pooling (6543)
   is a worse fit.

That URI is `DATABASE_URL`. Supabase requires TLS, so also set
`DATABASE_SSL=require`.

## 2. Email — Resend

Sign up, create an API key. Without a domain of your own, send from
`onboarding@resend.dev`.

Set `EMAIL_PROVIDER=resend`, `RESEND_API_KEY=…`, `RESEND_FROM=onboarding@resend.dev`.

Nothing in the *web* console emails anyone — staff passwords are displayed once
in the UI, never mailed. But `NODE_ENV=production` refuses `EMAIL_PROVIDER=console`
outright, and volunteers on mobile sign in by emailed OTP, so this is required
regardless.

## 3. API + worker + Redis — Northflank

Create a project, then inside it:

**Redis addon:** Addons → Redis → smallest plan. Copy its internal connection
URI — that is `REDIS_URL`.

**API service:** Create Service → Combined (build + deploy) → connect this repo.

| Setting | Value |
|---|---|
| Build type | Dockerfile |
| Dockerfile path | `server/Dockerfile` |
| Build context | `/` (repo root — the Dockerfile copies workspace manifests) |
| Port | `4000`, HTTP, **public** |
| Health check | `GET /healthz` |

Environment variables:

```
NODE_ENV=production
PORT=4000
HOST=0.0.0.0
DATABASE_URL=<Supabase pooler URI>
DATABASE_SSL=require
DATABASE_POOL_MAX=8
REDIS_URL=<Northflank Redis internal URI>
PII_ENCRYPTION_KEY=<from step 0>
IDENTITY_HMAC_KEY=<from step 0>
EMAIL_PROVIDER=resend
RESEND_API_KEY=<from step 2>
RESEND_FROM=onboarding@resend.dev
SCRYPT_COST_LOG2=15
WEB_ORIGIN=https://<your-pages-domain>   # fill in after step 4, then redeploy
```

Two of those need explaining:

- `DATABASE_POOL_MAX=8` — the default is 20 *per process*, and api + worker
  would be 40 against a free tier that caps connections.
- `SCRYPT_COST_LOG2=15` — halves the time per password check (~125ms vs
  ~250ms). Hashing is synchronous, so each one stalls the event loop and delays
  every other request; on a small shared-CPU instance that is worth trading a
  bit of cost factor for. It is not a memory measure — one hash runs at a time
  per process. Stored hashes record their own cost, so this never invalidates an
  existing password and you can raise it later.

**Worker service:** same repo, same Dockerfile, same environment variables, but
no port and no health check. Override the command:

```
node dist/worker-main.js
```

Northflank can clone the API service to save re-entering all of that.

**Migrations.** Migrations are never applied at startup, by design. Run them as
a one-off job with the same image and environment:

```
node dist/db/migrate.js
```

Run this *before* the services start, and again after any deploy that adds a
migration. It is idempotent — it prints `up to date` when there is nothing to do.

## 4. Web — Cloudflare Pages

Create a Pages project from this repo:

| Setting | Value |
|---|---|
| Build command | `npm run build -w packages/shared && npm run build:pages -w apps/web` |
| Output directory | `apps/web/dist` |
| Env var | `VITE_API_URL=https://<northflank-api-domain>` |

`VITE_API_URL` is compiled into the bundle *and* into the CSP, so it must be set
before the first build. `build:pages` generates `dist/_headers` (security headers
and a `connect-src` naming your API and its `wss://` origin — Caddy does this in
the compose path, but Pages has no proxy) and `dist/_redirects` (SPA fallback, so
reloading `/admin` does not 404).

## 4b. Using your own domain

The steps above give you `<project>.pages.dev` and a Northflank subdomain, which
work fine. With a domain of your own — say `sahay.online` — the split-origin
layout becomes tidy: the site on the apex, the API on a subdomain.

**Move DNS to Cloudflare first** (free, and it is not the same thing as buying a
domain from them). At your registrar, change the nameservers to the pair
Cloudflare gives you when you add the site. This matters for one technical
reason: the apex of a domain cannot hold a CNAME, and Cloudflare's CNAME
flattening is what lets `sahay.online` point at Pages at all. Without it you are
stuck putting the site on `www.`

Then:

| Host | Type | Points at | Set where |
|---|---|---|---|
| `sahay.online` | CNAME (flattened) | `<project>.pages.dev` | Pages → Custom domains adds this for you |
| `api.sahay.online` | CNAME | your Northflank service domain | Cloudflare DNS, and add the domain in Northflank so it provisions a cert |

Leave `api` **grey-clouded (DNS only)** to begin with. Proxying it through
Cloudflare works, but it changes what the server sees as the client address, and
the per-IP rate limits on login and OTP depend on that — get the deployment
working first, then turn the proxy on deliberately and re-check.

Update the two settings that must agree, and redeploy both:

```
WEB_ORIGIN=https://sahay.online          # Northflank, both services
VITE_API_URL=https://api.sahay.online    # Cloudflare Pages build env
```

`VITE_API_URL` is compiled into the bundle *and* into the CSP, so Pages needs a
fresh build after changing it — not just a redeploy of the existing artifact.

## 5. Close the loop

1. Set `WEB_ORIGIN` on both Northflank services to the Pages URL and redeploy.
   Production CORS allows exactly that one origin, so until this matches, every
   browser request fails.
2. Create the first admin — nothing in the product can, by design (ADR-0013).
   Run a one-off job on the API image:

   ```
   BOOTSTRAP_ADMIN_USERNAME=<you> BOOTSTRAP_ADMIN_EMAIL=<you@example.com> \
     node dist/db/bootstrap-admin.js
   ```

   It prints a password **once**. Idempotent, so it is safe to leave in place.
3. Seed the supply catalogue: `node dist/db/seed.js`.
4. Sign in at `https://<pages-domain>/auth`. You will be forced to choose a new
   password before the console opens.

### Verifying

```bash
curl -fsS https://<api-domain>/healthz     # {"ok":true}
curl -fsS https://<api-domain>/readyz      # DB + Redis both reachable
```

Then in a browser: the landing page lists events (proves cross-origin reads),
`/auth` sign-in works (proves CORS on writes), and DevTools shows no CSP
violations.

---

## What you are giving up

- **Three providers, three failure modes.** No single place to look at logs, and
  a free tier can change terms with little notice.
- **Cross-origin.** The compose deployment is same-origin behind Caddy; this is
  not. CORS and the CSP now have to be exactly right, and `WEB_ORIGIN` /
  `VITE_API_URL` must agree or nothing works.
- **500 MB of database.** Fine for a prototype, and retention jobs keep the
  bulk of it bounded.
- **No backups.** `ops/backup.sh` assumes a local Postgres container. Supabase
  free has no point-in-time recovery — take manual `pg_dump`s of anything you
  care about.
- **Supabase pauses after 7 days of no activity**, and needs a manual restore.
- **A slightly weaker password hash** than the default, as above.
- **Rate-limit windows reset if Redis restarts**, and queued jobs are lost with
  it — a delayed offer timeout could be dropped.

None of this is wrong for a prototype. It is wrong for real users in a real
emergency, which is what `docker-compose.prod.yml` on one small VPS is for.
