# Known limitations

Honest list, kept current. Users deserve these stated plainly; contributors should not
"fix" the deliberate ones without reading the linked rationale.

## By design (deliberate tradeoffs)

- **No end-to-end encrypted chat.** Messages are TLS in transit but server-readable at
  rest, so opt-in evidence-based moderation can exist. The operator could read chats; a
  legal order could compel what exists within retention. Stated fully in
  [privacy-and-retention.md](privacy-and-retention.md). Mitigation: short retention,
  say-nothing-you-wouldn't-say-in-person guidance.
- **Email addresses are free, so bans are evadable.** ADR-0011 replaced phone-binding
  with email, knowingly giving up the anti-Sybil property ADR-0006 was built around: a
  banned user can register again with a new address. No mitigation ships in this pass —
  no disposable-domain blocklist, no device fingerprinting, no review gate before a
  first request. Revisit when it becomes an observed problem, not before.
- **Email requirement still excludes some users** — one account per address
  (`email_hmac` UNIQUE), so a shared family inbox is a shared account. Assisted /
  organizer-mediated requests are a possible future.
- **No self-service password reset for staff.** Credentials are issued by existing
  admins, who also reissue lost ones (ADR-0013). The first admin on a deployment comes
  from `npm run -w server db:bootstrap:admin`. Both paths force a password change at
  next sign-in, but an admin-initiated reset does NOT revoke the target's live sessions —
  locking out a compromised staff account needs a suspension or explicit session revoke,
  not just a reset. Owner-chosen passwords have a 12-character floor and no expiry,
  history, or complexity rules beyond that.
- **The platform guarantees nothing.** It is a matchmaker: no delivery promises, no
  vetting of goods beyond category rules and sealed-item guidance, no background checks.
  UX copy must never imply otherwise.
- **No medicines, ever** — the prohibited-category denylist is a hard safety line even
  where the need is real ([product-requirements.md](product-requirements.md)).
- **Coarse location limits matching finesse.** ~110 m rounding + buckets mean
  "very nearby" can still be a few minutes' walk in a crowd; `area_hint` and chat exist
  to close the last 100 meters (ADR-0009 — will not be "fixed" with precision).

## Operational / scale

- **Single-region, single-VPS SPOF** (ADR-0010). Machine dies → platform down until
  restore; RPO up to 24 h on nightly dumps until WAL archiving is enabled
  ([incident-response.md](incident-response.md)). Accepted for budget; degradation mode
  is people helping each other without an app.
- **Email OTP delivery is a launch-blocking dependency for new sign-ins.** Spam
  filtering, provider reputation, and mobile data at a congested event all sit between
  a volunteer and their code. Existing sessions (60-day) keep working — encourage
  sign-in *before* the event. Outbound email is also the main cost-attack surface
  (rate limits double as spend caps). Staff are insulated: username+password needs no
  delivery at all (ADR-0013).
- **WebSocket hints are at-most-once** — clients on flaky networks may run seconds
  behind until refetch (ADR-0005). Offer deadlines are server-side, so correctness
  holds; perceived snappiness degrades.
- **Worker liveness is privacy-critical.** Retention runs as 60 s jobs; a stalled
  worker means TTLs silently stop being honored. Monitored as Sev-1
  ([deployment.md](deployment.md), [incident-response.md](incident-response.md)).

## Integrity / privacy edges

- **Reliability is gameable at small scale.** Laplace smoothing and phone friction raise
  the cost, but a collusion ring of a few real numbers can farm `completed` counters at
  low volume ([reliability.md](reliability.md) anti-gaming). Detection is manual
  (moderation stats) until scale justifies more.
- **k-anonymity (k=3) is a floor, not a proof.** Aggregates suppress below 3 distinct
  users, but an observer with outside knowledge ("only one person here has power
  banks") can still infer; small events have inherently thin cover.
- **Location inference is bounded, not eliminated** — a patient adversary paying the
  cost of real matches can learn bucket-grade patterns
  ([threat-model.md](threat-model.md) #3).
- **Traffic analysis is out of app-layer control**: on-path observers see that a device
  talks to Sahay; telecoms see OTP SMS metadata. Users under targeted surveillance
  should use a VPN/Tor and app-lock their device.
- **First-offense abuse lands before moderation can.** One fake request can waste one
  helper's trip before any report exists; sequential offers cap the blast radius at one
  person.

## Current implementation gaps (as of 2026-07-26)

- `apps/web`, `apps/mobile`, and `ops/` are scaffolding-empty; server route modules,
  realtime gateway, workers, and seeds referenced by `app.ts`/`package.json` are being
  built by parallel workstreams ([progress.md](progress.md)).
- Voice calling is designed but ships **disabled** behind the `voice_calls` feature
  flag.
- PII key rotation requires a purpose-built re-encryption migration that does not exist
  yet ([deployment.md](deployment.md)).
- Production compose file, WAL archiving, and k6 scenarios are specified in docs but not
  yet in `ops/`.
- English and Hindi only.
