#!/usr/bin/env bash
# Points a DuckDNS subdomain at this machine's current public IP.
#
# DuckDNS releases a subdomain that has not been updated for 30 days, so this
# has to run on a schedule even on a host with a static address — the update is
# what keeps the name, not just what moves it. Run from the repo directory on the
# VPS via cron, e.g.:  */5 * * * *  /srv/sahay/ops/duckdns-update.sh
#
# Reads DUCKDNS_DOMAIN (the label only, no ".duckdns.org") and DUCKDNS_TOKEN
# from the environment, or from .env.prod if present.
set -euo pipefail

if [[ -f .env.prod ]]; then
  # shellcheck disable=SC1091
  set -a; source .env.prod; set +a
fi

: "${DUCKDNS_DOMAIN:?set DUCKDNS_DOMAIN (the label only, e.g. 'sahay')}"
: "${DUCKDNS_TOKEN:?set DUCKDNS_TOKEN (from duckdns.org)}"

if [[ "$DUCKDNS_DOMAIN" == *.* ]]; then
  echo "DUCKDNS_DOMAIN should be the label only ('sahay'), not '$DUCKDNS_DOMAIN'" >&2
  exit 2
fi

# Empty ip= tells DuckDNS to use the source address of this request, which is
# what we want: the box reports its own address rather than us guessing it.
response="$(curl -fsS --max-time 30 \
  "https://www.duckdns.org/update?domains=${DUCKDNS_DOMAIN}&token=${DUCKDNS_TOKEN}&ip=")"

# The API answers "OK" or "KO" in the body with HTTP 200 either way, so the exit
# code of curl is not enough to tell success from a rejected token.
if [[ "$response" != OK* ]]; then
  echo "$(date -Is) duckdns update FAILED for ${DUCKDNS_DOMAIN} (response: ${response:-empty})" >&2
  exit 1
fi

echo "$(date -Is) duckdns ${DUCKDNS_DOMAIN}.duckdns.org updated"
