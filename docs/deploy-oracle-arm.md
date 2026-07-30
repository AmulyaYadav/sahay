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

Caddy needs a real hostname to get a Let's Encrypt certificate — an IP will not
do. **Cloudflare does not give away domains:** Cloudflare Registrar sells them at
wholesale cost with no markup (~$10.44/yr for `.com`, about $0.87/month), and
what is free is their DNS, proxy, and `*.pages.dev` subdomains.

Two things decide whether a free option actually works, and both were measured
from an Indian consumer connection (BSNL resolver) in July 2026:

**Does it resolve for your users?**

| Name | ISP resolver | 1.1.1.1 / 8.8.8.8 / 9.9.9.9 |
|---|---|---|
| `duckdns.org` | **no answer** | resolves |
| `*.sslip.io`, `*.nip.io` | resolves | resolves |
| `freedns.afraid.org` | resolves, but to an address in the **ISP's own range** | resolves to the real host |

DuckDNS returning NXDOMAIN on a major Indian ISP while every public resolver
answers is consistent with ISP-level DNS filtering — several Indian ISPs block
dynamic-DNS providers because they get used for malware command-and-control.
This is the nastiest possible failure mode for an India-facing app: Let's
Encrypt uses its own resolvers so the certificate issues fine, the site looks
healthy from most of the world, and the users you built it for cannot reach it.
Nothing you can do server-side fixes it, and you cannot ask visitors to change
their DNS.

**Will Let's Encrypt actually issue?** Rate limits apply per registered domain,
which the Public Suffix List defines:

| Name | On the PSL? | Consequence |
|---|---|---|
| `duckdns.org` | **yes** | Your subdomain gets its own rate-limit bucket. Clean. |
| `sslip.io`, `nip.io`, `afraid.org` | **no** | Every user of that service shares one bucket (50 certs/week). Issuance can fail for reasons that have nothing to do with you. |

So each free option is defective in a different way, and they are not the same
kind of defect: DuckDNS is clean on certificates but unreachable for your
audience; sslip.io is reachable but its certificates depend on strangers.

**Recommendation: buy the domain.** It is the only line item in this whole
deployment, and it removes every problem above at once: resolves everywhere, its
own registrable domain for rate limits, no 30-day renewal chore, and it works
behind Cloudflare's free DNS and proxy.

Buy **`.in`** — $7.83/yr at Porkbun (~₹690, about $0.65/month), flat, no
promotional first year and no renewal jump. It is the cheapest TLD that stays
cheap, and it is the national TLD for the people this app is for. `.in` is open
to anyone; no local-presence requirement.

Ignore the sub-$2 TLDs. Their first year is bait: at Porkbun (July 2026) `.site`
and `.online` are $1.96 to register and **$28.84** to renew, `.store` $2.57 then
**$43.77**, `.shop` $2.06 then **$31.41**. Anything you keep past a year costs
more than `.com`. `.xyz` is the least bad of them at $2.04 then $12.98.

There is a second reason to avoid the bargain-bin TLDs here, and it is the same
lesson as DuckDNS: `.xyz`, `.site`, `.top` and friends carry poor reputation with
spam filters and corporate/ISP blocklists because of how heavily they are abused.
A hostname that resolves but gets filtered fails exactly like one that does not
resolve at all, and it matters more than usual for an app people are supposed to
reach during an emergency. `.in`, `.com` and `.org` are clean.

Registrar: **Porkbun** or **Cloudflare** — both sell at or near cost with free
WHOIS privacy, and neither runs a renewal trap (Cloudflare `.com` $10.46,
Porkbun `.com` $11.08; Cloudflare's TLD selection is narrower, so check `.in` is
offered before assuming). Avoid registrars advertising a cheap first year and
quietly doubling at renewal. Indian registrars add 18% GST, which usually makes
a US registrar cheaper net.

### If you use DuckDNS anyway

Sign up at duckdns.org, pick a label, and note the token. Then in `.env.prod`:

```
SITE_ADDRESS=<label>.duckdns.org
DUCKDNS_DOMAIN=<label>          # the label only, no ".duckdns.org"
DUCKDNS_TOKEN=<your token>
```

DuckDNS releases a subdomain that has not been updated for 30 days, so the
update is what keeps the name, not just what moves it. `ops/duckdns-update.sh`
does one update and fails loudly if the API answers `KO` (it returns HTTP 200
either way, so the exit code alone is not enough to tell). Schedule it:

```bash
*/5 * * * * cd /srv/sahay && ./ops/duckdns-update.sh >> /var/log/duckdns.log 2>&1
```

Run it once by hand and confirm the name resolves to your instance **before**
starting the stack — Caddy's HTTP-01 challenge needs the A record live, or it
will fail and back off.

### If you use sslip.io

No signup and nothing to schedule: `SITE_ADDRESS=<your-ip-with-dashes>.sslip.io`,
e.g. `129-153-1-2.sslip.io`. Accept that certificate issuance shares a rate-limit
bucket with every other user of the service.

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
