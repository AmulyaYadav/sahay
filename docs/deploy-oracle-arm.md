# Deploying on Oracle Cloud Always Free (ARM)

Runs the **whole stack** — Postgres+PostGIS, Redis, API, worker, Caddy with TLS —
on one always-free Oracle Ampere instance using `docker-compose.prod.yml` as it
already exists. Same-origin, always-on, real Redis, backups you control, and no
monthly bill. Read [Risks](#risks) first: "always free" here comes with real
operational strings.

Compared with [deploy-free-tier.md](deploy-free-tier.md) (Northflank + Supabase +
Cloudflare Pages), this is architecturally the *better* deployment — it is the
design in ADR-0010 — and the less reliable host.

## What you get

Oracle's Always Free Ampere A1 allowance was **halved on 15 June 2026**, from
4 OCPU / 24 GB to **2 OCPU / 12 GB**, plus 200 GB of block storage. That is
still far more than this stack needs — measured idle footprint is ~360 MB total
(API 95, worker 95, Postgres 121, Redis 27, Caddy ~20), and the API survives a
512 MB cap under concurrent logins.

## 1. The ARM caveat, and the one-line fix

The official `postgis/postgis` images are published **amd64-only** — single-arch
manifests, no arm64. On an Ampere instance the Postgres container simply will not
start. Node, Redis and Caddy are all multi-arch and fine.

`docker-compose.prod.yml` takes the image from `POSTGIS_IMAGE`, so in `.env.prod`:

```
POSTGIS_IMAGE=imresamu/postgis:16-3.4-alpine
```

That is the community multi-arch rebuild of the same thing. Verified on aarch64:
PostgreSQL 16.11, PostGIS 3.4 with GEOS and PROJ, all 7 migrations applied, both
seeds ran, `events_center_gix` and `member_locations_gix` GiST indexes created,
and `ST_DWithin` on geography returning correct results.

The server image itself needs no changes — every server dependency is pure
JavaScript, and it cross-builds and runs clean on arm64.

## 2. Create the instance

1. Sign up at cloud.oracle.com. A credit card is required for identity even on
   the free tier. **Pick your home region carefully — it cannot be changed**, and
   free capacity varies by region. Mumbai and Hyderabad both exist.
2. Compute → Create Instance:
   - Shape: **VM.Standard.A1.Flex**, 2 OCPU / 12 GB (stay inside the free
     allowance or you will be billed)
   - Image: Ubuntu 22.04 or 24.04 (**aarch64** build)
   - Add your SSH public key
   - Boot volume 50–100 GB (200 GB is the free ceiling across all volumes)
3. If you get **"Out of capacity for shape VM.Standard.A1.Flex"** — common, and
   not a mistake on your part — retry periodically or try another availability
   domain. This is the single most likely thing to block you.

## 3. Open the firewall — both layers

Oracle has two, and forgetting the second is the classic time sink.

**VCN security list:** Networking → your VCN → Subnet → Security List → add
ingress rules for TCP **80** and **443** from `0.0.0.0/0`.

**The instance's own iptables:** Oracle's Ubuntu images ship with a restrictive
`iptables` that persists across reboots.

```bash
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save
```

## 4. Install Docker

```bash
sudo apt-get update && sudo apt-get install -y ca-certificates curl git
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=arm64 signed-by=/etc/apt/keyrings/docker.asc] \
  https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list
sudo apt-get update && sudo apt-get install -y \
  docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker $USER && newgrp docker
```

Note `arch=arm64` in the apt line.

## 5. A hostname

Caddy needs a real hostname to get a Let's Encrypt certificate — an IP address
will not do. **Cloudflare does not give away domains**: Cloudflare Registrar
sells them at wholesale cost with no markup (~$10.44/yr for `.com`, so about
$0.87/month), and what is free is their DNS, proxy, and `*.pages.dev`
subdomains. Options, cheapest first:

| Option | Cost | Notes |
|---|---|---|
| `sslip.io` / `nip.io` | free, no signup | `<your-ip>.sslip.io` resolves to that IP. Ugly but instant, and HTTP-01 works. |
| **DuckDNS** or FreeDNS (afraid.org) | free | A real subdomain like `sahay.duckdns.org`. Point the A record at your instance's public IP. Best free option. |
| Cloudflare Registrar | ~$0.87/mo for `.com`, less for `.in` | At cost. Free DNS, WHOIS privacy and DNSSEC included. What you want if this outlives the prototype. |
| GitHub Student Pack | free for a year | Includes a `.me` via Namecheap, if you are eligible. |

Set `SITE_ADDRESS` to whichever you choose. Caddy handles TLS automatically.

**If you put Cloudflare's proxy (orange cloud) in front:** use Full (strict) SSL,
and note that `req.ip` then sees Cloudflare's edge unless the real client IP is
forwarded — the per-IP rate limits on login and OTP would otherwise apply to
Cloudflare as a whole rather than per user. Fastify already runs with
`trustProxy: true`, and Cloudflare puts the client IP first in
`X-Forwarded-For`, so this works — but verify it rather than assume, because
getting it wrong silently weakens a security control.

## 6. Deploy

```bash
git clone <your-repo> sahay && cd sahay
cp .env.example .env.prod
```

Fill `.env.prod`:

```
POSTGIS_IMAGE=imresamu/postgis:16-3.4-alpine   # required on ARM
POSTGRES_PASSWORD=<long random>
PII_ENCRYPTION_KEY=<openssl rand -hex 32>
IDENTITY_HMAC_KEY=<openssl rand -hex 32>       # must differ from the above
EMAIL_PROVIDER=resend
RESEND_API_KEY=<from resend.com>
RESEND_FROM=onboarding@resend.dev
SITE_ADDRESS=<your hostname, no scheme>
```

The server refuses to start in production if the two keys match, if either is an
example value, or with `EMAIL_PROVIDER=console`. Resend's free tier is 3,000
emails/month; nothing in the web console emails anyone, but mobile OTP does and
the guard is unconditional.

```bash
# Building on the box needs headroom; 12 GB is plenty.
docker compose -f docker-compose.prod.yml --env-file .env.prod build

# Migrations first, explicitly — never at startup.
docker compose -f docker-compose.prod.yml --env-file .env.prod run --rm migrate

docker compose -f docker-compose.prod.yml --env-file .env.prod up -d
```

Then seed the catalogue and mint the first admin (nothing in the product can —
ADR-0013):

```bash
C="docker compose -f docker-compose.prod.yml --env-file .env.prod"
$C run --rm api node dist/db/seed.js
$C run --rm -e BOOTSTRAP_ADMIN_USERNAME=<you> -e BOOTSTRAP_ADMIN_EMAIL=<you@example.com> \
  api node dist/db/bootstrap-admin.js     # prints a password ONCE
```

### Verify

```bash
curl -fsS https://<SITE_ADDRESS>/healthz   # {"ok":true}
curl -fsS https://<SITE_ADDRESS>/readyz    # DB + Redis reachable
```

Then sign in at `https://<SITE_ADDRESS>/auth`. You will be forced to choose a new
password before the console opens.

Unlike the split free-tier deployment there is no `WEB_ORIGIN`/`VITE_API_URL`
pair to keep in sync and no CORS to get right: Caddy serves the bundle and
proxies `/api` on the same origin.

## Backups

`ops/backup.sh` works here as designed — it is a local `pg_dump` of the compose
Postgres. Add a cron entry, and push the dumps off the box, because a reclaimed
or lost free instance takes its block volume with it:

```bash
0 3 * * * cd /home/ubuntu/sahay && ./ops/backup.sh >> /var/log/sahay-backup.log 2>&1
```

Cloudflare R2 and Backblaze B2 both have ~10 GB free tiers, which is ample for
compressed dumps of a 500 MB database.

## Risks

- **Capacity.** Free Ampere is frequently "out of capacity" in popular regions.
  You may not be able to create the instance today.
- **Idle reclaim.** Oracle reclaims idle Always Free compute. A live app with
  real traffic is usually fine; a dormant prototype is exactly what gets
  reclaimed. Assume the box can vanish and keep off-box backups.
- **Account cancellation.** Free-tier accounts get minimal support and have been
  suspended with little recourse. Do not make this the only copy of anything.
- **Region is permanent.** Home region cannot be changed after signup.
- **One machine.** Same single point of failure as any VPS deployment (ADR-0010)
  — the difference is you cannot pay to make it more reliable.

Net: architecturally the right deployment on a host you should not fully trust.
If the prototype turns into something people depend on, the same compose file
moves to a paid VPS in an Indian region (~$5–6/month) with no changes beyond
`POSTGIS_IMAGE` if you land back on x86.
