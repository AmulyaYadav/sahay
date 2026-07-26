# Threat model

Scope: the Sahay platform as built in this repository — Fastify API + worker, Postgres,
Redis, single VPS, web + Expo clients. For each threat: scenario, impact, mitigations
**actually implemented** (with pointers into the code/schema), and honest residual risk.
Companion docs: [privacy-and-retention.md](privacy-and-retention.md),
[known-limitations.md](known-limitations.md), ADRs 0006/0008/0009.

Overriding design stance: the most dangerous data (participant lists, precise location,
movement history, real identities) **does not exist**, so most attacks reduce to
attacking data that isn't there.

| # | Threat | Residual risk level |
|---|---|---|
| 1 | Stalking / physical targeting | Medium (inherent to meeting in person) |
| 2 | Scraping / enumeration | Low |
| 3 | Location inference | Low–Medium |
| 4 | Membership inference | Low |
| 5 | Account takeover | Medium (SMS-bound) |
| 6 | Malicious events | Low–Medium |
| 7 | Fake requests / fake inventory | Medium |
| 8 | Harassment | Medium (human problem) |
| 9 | Notification flooding | Low |
| 10 | Database breach | Medium |
| 11 | Admin abuse | Medium |
| 12 | Session theft | Low–Medium |
| 13 | IDOR | Low |
| 14 | DoS | Medium–High (single VPS) |
| 15 | Traffic analysis | Medium (out of app-layer control) |
| 16 | Supply chain | Medium |

---

### 1. Stalking / physical targeting
**Scenario.** An abuser uses the app to locate or repeatedly reach a specific person at
an event.
**Impact.** Physical safety — the worst-case harm for this product.
**Mitigations.** No participant lists or maps exist anywhere. Location is coarse
(~110 m, rounded client- and server-side), single-row UPSERT (no history), 15-min TTL,
collected only while requesting/helping (ADR-0009). Peers see only proximity buckets,
never distance or bearing. Per-match aliases prevent recognizing a past counterpart;
`blocks` exclude pairs from all future matching in both directions;
`match_offers UNIQUE (request_id, helper_id)` means a stalker can't retry into the same
victim's request. Sequential offers expose each request to exactly one person at a time
(ADR-0008). `cancel(reason: unsafe)` is immediate, stops location processing for the
pair, and fast-paths block/report. Quick replies steer toward public meeting points.
**Residual.** Meeting a stranger is inherently risky; a matched attacker learns a
~110 m-bucketed proximity and whatever the victim says in chat. Determined targeting of
a *specific known person* is mostly thwarted by aliasing, but chance matching cannot be
ruled out. The app says plainly it guarantees nothing.

### 2. Scraping / enumeration
**Scenario.** Bulk harvesting of users, events, needs, or phone numbers via the API.
**Impact.** Privacy loss at scale; target list building.
**Mitigations.** There is no user-listing endpoint at all; peers are visible only inside
a match, by alias. Unlisted events resolve by exact code only; public listings require
moderator approval. `/auth/otp/start` always returns 200 (no phone→account oracle) and
is rate-limited per phone+IP with a **fail-closed** limiter (`lib/redis.ts`). Public
dashboard aggregates are k-anonymized (≥3 distinct users; below-threshold values are
`null`). Cursor pagination with capped limits; bearer auth on everything else.
**Residual.** Public event metadata (title, area label, schedule) is public by design.
Aggregate need levels of a public event are observable — that is the product.

### 3. Location inference
**Scenario.** Inferring someone's position via repeated requests (bucket triangulation),
ranking observation, or dashboard signals.
**Impact.** De-anonymized coarse position of a helper/requester.
**Mitigations.** Buckets (150/400/1000 m) over already-110 m-rounded points make
trilateration coarse and expensive; ranking includes random jitter and never exposes
scores; each probe request costs a real match interaction with a per-account cap
(3 active requests) and a helper is asked only once per request; dashboards carry zero
location. Exact distances exist transiently server-side only.
**Residual.** A patient adversary running many requests over time can conclude "this
alias is usually within a few hundred meters of X gate" — bounded to ~110 m granularity,
15 min freshness, and broken across matches by alias rotation. Assessed acceptable.

### 4. Membership inference
**Scenario.** Determining whether a specific person attends/attended an event.
**Impact.** Exposure of attendance (sensitive in adversarial contexts).
**Mitigations.** No attendance records exposed; memberships never listed;
k-anonymity (≥3) on all public aggregates; post-event anonymization of closed
requests/matches after `retention_days` (default 7); messages deleted on the same clock;
no phone anywhere in API/admin. Aliases mean even counterparties can't build a roster.
**Residual.** Your matched counterpart knows a person matching your alias was present;
the operator's DB knows memberships until retention runs. Someone physically present
learns attendance the old-fashioned way — out of scope.

### 5. Account takeover
**Scenario.** SIM swap, OTP interception/brute force, or phishing to hijack an account.
**Impact.** Impersonation in matches; access to active chats and inventory. Notably, an
attacker gains **no phone number, no history beyond retention, no location history** —
the account is deliberately low-value loot.
**Mitigations.** OTP: 6 digits, unbiased generation, 10-min TTL, **5 attempts max**,
stored as peppered HMAC scoped to the phone, constant-time compare
(`lib/crypto.ts`), rate-limited start endpoint (fail-closed). Sessions listed and
individually revocable (`GET /auth/sessions`, `DELETE /auth/sessions/:id`);
`account_security` notification type exists for new-login alerts.
**Residual.** SMS is the root of trust — SIM swap defeats it (industry-wide weakness,
consciously accepted in ADR-0006). No second factor at launch.

### 6. Malicious events
**Scenario.** Fake "relief operation" created to lure people, harvest interactions, or
lend legitimacy to a scam.
**Impact.** Physical/fraud risk concentrated under one banner.
**Mitigations.** Public listing requires moderator approval
(`public_approved`, flag `public_event_creation_open` default **false**); duplicate
detection on create; unlisted/invite-only events reach only people who already hold the
code; `suspicious_event` report category; moderator levers `event_pause` /
`event_disable` and per-event `matching_paused`; emergency shutdown pauses all events.
Category denylist (`PROHIBITED_PATTERNS`) binds event creators and admins alike.
**Residual.** An unlisted event among a group the attacker already controls socially —
the platform cannot vet private social graphs; blast radius is limited to code-holders.

### 7. Fake requests / fake inventory
**Scenario.** Phantom requests to waste helpers' time or lure them; phantom inventory to
absorb requests into dead ends; dashboard distortion.
**Impact.** Erosion of trust; targeted time-wasting; misleading "what to bring" signals.
**Mitigations.** Phone-verified accounts with per-account caps (3 requests, 2 active
matches, 30 inventory items/event); mandatory `safetyAcknowledged`; inventory CHECKs
stop accounting fiction (reserved ≤ on-hand, ≥0); acceptance timeout/no-show hits the
*helper-side* reliability of fake helpers (`timeouts`, `noShows`), and `false_request` /
`no_show` report categories plus `restrict_requests` / `restrict_helping` moderation
switches (`users.can_request/can_help`) handle repeat offenders. k-anonymity plus
qty caps blunt dashboard distortion.
**Residual.** First-offense fake requests are hard to pre-empt — one wasted trip can
happen before reports catch up. Requester-side abuse is not reliability-scored
(deliberately, to avoid punishing need); it is moderation's job.

### 8. Harassment
**Scenario.** Abusive chat, repeated unwanted contact, meeting misconduct.
**Impact.** Individual harm; chills participation, especially for vulnerable users.
**Mitigations.** Contact requires a match (no cold DMs anywhere in the API); per-match
aliases prevent cross-exchange pursuit; block via match cancels it and excludes the pair
from matching forever, without revealing ids; report categories incl. `harassment`,
`hate_speech`, `threat`, `unsafe_meeting` with opt-in conversation-excerpt evidence
snapshots that outlive normal chat deletion (180-day moderation retention);
`stay_public_area` / `not_comfortable` quick replies; conversations expire (readonly
60 min after close), so contact cannot linger.
**Residual.** In-person behavior is beyond software; chat is moderatable precisely
because it is not E2EE — a stated tradeoff
([privacy-and-retention.md](privacy-and-retention.md)).

### 9. Notification flooding
**Scenario.** Triggering pushes at someone (offer spam, message spam) to annoy or drain.
**Impact.** Nuisance; alert fatigue that buries real safety signals.
**Mitigations.** Sequential matching means at most one live offer per helper per request
by construction; message sends are length-capped, rate-limited, and only possible inside
an open conversation; `notifications` dedupe via partial unique
`(user_id, dedupe_key)`; per-type notification prefs + per-event mute + vague-by-default
lock-screen previews (`detailed_previews=false`).
**Residual.** A busy event is legitimately noisy; availability toggle and mutes are the
user-side relief valve.

### 10. Database breach
**Scenario.** Exfiltration of a DB dump (SQLi, stolen backup, snapshot leak).
**Impact.** The honest inventory of what an attacker gets: pseudonyms, event metadata,
requests/matches/messages *within retention windows*, reliability counters,
`phone_enc` ciphertexts + `phone_hmac` blind indexes, session/OTP **hashes**. What they
do **not** get: plaintext phones (AES-256-GCM keys live in env, not the DB), usable
session tokens, location history (never existed), anything past retention.
**Mitigations.** Field-level encryption + blind index (`lib/crypto.ts`); separate
`PII_ENCRYPTION_KEY` / `PHONE_HMAC_KEY`; production refuses example keys (`config.ts`);
parameterized queries via Drizzle throughout; aggressive retention shrinks the blast
radius continuously; backups encrypted at rest ([deployment.md](deployment.md)).
**Residual.** Full **host** compromise yields env keys and therefore phones — the
single-VPS reality (ADR-0010). Messages within retention are plaintext in the DB.
`phone_hmac` allows a *keyed* attacker to test candidate numbers.

### 11. Admin abuse
**Scenario.** A moderator/admin snoops, targets users, or quietly reshapes an event.
**Impact.** Insider betrayal of the platform's promises.
**Mitigations.** Admins **cannot see phone numbers** (`zAdminUserView` exposes only
`phoneVerified`; no decrypt path is exposed by any route). Every moderation action
requires a written reason (`zAdminModerate.reason` min 5 chars) and lands in
`moderation_actions` + append-only `audit_log` (no UPDATE/DELETE grants in production;
400-day retention; admin-readable via `/admin/audit`). Role split: moderators get an
action allowlist; destructive/config actions are admin-only; emergency shutdown demands
re-auth + reason. Appeals give users a formal challenge path.
**Residual.** Admins can read reported-conversation evidence and DB operators can read
the DB — inherent to a moderated, non-E2EE system. Accountability (audit) rather than
prevention is the control; stated honestly.

### 12. Session theft
**Scenario.** Bearer token stolen from a device, backup, or log.
**Impact.** Full account access until expiry/revocation.
**Mitigations.** Tokens are opaque 256-bit values; **only sha256 hashes are stored**, so
the DB/backup never contains usable tokens; logger redacts `authorization` and never
logs bodies/query strings (`app.ts`); WS auth failure closes 4401 and suspension
mid-connection force-closes 4403; sessions are listable/revocable per device; 60-day
expiry.
**Residual.** Malware on the user's device wins (out of scope). The WS token rides a
query string (`/ws?token=`) — TLS protects it in transit, server logging strips query
strings, but proxy logs must be configured accordingly ([deployment.md](deployment.md)).

### 13. IDOR (insecure direct object references)
**Scenario.** Fetching someone else's request/match/conversation by guessing ids.
**Impact.** Cross-user data exposure.
**Mitigations.** All ids are UUIDv4 (non-sequential); every resource route enforces
ownership/participant checks (owner-only on requests, participant-only on
matches/conversations per [api-surface.md](api-surface.md)); peer data crosses only as
`zPeerProfile` (alias, label, avatar — nothing else, enforced at the schema layer);
blocks are keyed by matchId precisely so ids never surface.
**Residual.** Standard bug-class risk — kept low by the modular route+service pattern
and integration tests over auth boundaries; no architectural exposure.

### 14. DoS
**Scenario.** Volumetric or app-layer flood, or SMS-cost attack via OTP endpoints.
**Impact.** Outage during exactly the moments the platform matters; money drain.
**Mitigations.** Fixed-window Redis rate limiting with **fail-closed** semantics for
auth scopes; 64 KB body limit; cheap health checks; queue isolation (worker starvation
doesn't take down the API and vice versa); OTP rate limits double as SMS cost caps;
Caddy can add per-IP limits at the edge.
**Residual.** A single VPS has no meaningful volumetric defense — upstream provider
filtering or fronting (only for static/API, given WS) would be the escalation. Accepted
at current scale; degradation mode is "people help each other without an app."

### 15. Traffic analysis
**Scenario.** A network observer (venue Wi-Fi, ISP, state actor) watches who talks to
Sahay and when.
**Impact.** Membership/attendance inference without touching the server.
**Mitigations.** TLS everywhere (Caddy, HSTS); uniform API shapes and WS keepalive pings
reduce distinguishability; notifications keep content out of push payloads (i18n keys,
vague previews); no third-party analytics/CDN beacons in the clients.
**Residual.** Connection metadata (server IP, timing, volume) is visible to any on-path
observer; SMS delivery metadata is visible to telecom providers. App-layer tooling
cannot fix this; users under targeted surveillance should use VPN/Tor — noted in
[known-limitations.md](known-limitations.md).

### 16. Supply chain
**Scenario.** Malicious/compromised npm dependency, base image, or CI pipeline
exfiltrates data or plants a backdoor.
**Impact.** Total compromise with valid signatures.
**Mitigations.** Deliberately small dependency surface (Fastify, Drizzle, BullMQ,
ioredis, pg, zod, ws, web-push — see `server/package.json`); root `package-lock.json`
committed and installs use it; pinned image tags (`postgis/postgis:16-3.4-alpine`,
`redis:7-alpine`); CI on GitHub Actions with typecheck/lint/test gates; no postinstall
scripts required by the stack.
**Residual.** npm remains npm. Recommended next steps (not yet implemented): `npm audit`
+ Dependabot in CI, image digest pinning, provenance/signature checks on release images.
