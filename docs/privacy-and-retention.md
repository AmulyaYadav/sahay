# Privacy model & retention policy

This document is the single honest statement of what Sahay stores, why, for how long,
and who can see it. It covers both the privacy model and the retention policy.
Enforcement lives in the schema ([data-model.md](data-model.md)), the crypto helpers
(`server/src/lib/crypto.ts`), and the retention worker (repeatable BullMQ jobs every
60 s; task list in `server/src/queues.ts`).

## Principles

1. **Don't collect it.** No names, emails, photos, government ids, payment data,
   contacts, or device fingerprints. No participant lists, maps, or movement history —
   these are absent from the schema, not merely hidden.
2. **Coarsen it.** Location rounds to ~110 m on device *and* server; peers see buckets;
   public aggregates are k-anonymous (≥3 distinct users).
3. **Expire it.** Every category below has a deletion clock, enforced by jobs, not
   promises.
4. **Compartmentalize it.** Per-match aliases stop peers correlating you across
   exchanges; admins never see phone numbers; blind indexes keep plaintext out of
   indexes and logs.

## The honesty note: no end-to-end encryption

Sahay does **not** claim E2EE. Concretely:

- All traffic is TLS in transit (Caddy).
- Phone numbers are AES-256-GCM encrypted at rest with an HMAC-SHA256 blind index for
  lookup; keys live in server environment, not the database.
- **Chat messages are stored in plaintext on the server and are server-readable.** This
  is a deliberate choice: it makes report-with-evidence moderation possible
  (reporter-opt-in conversation excerpts), which we judged more protective for this
  product's users than unreadable chats. Consequences you should assume: the operator
  *could* read active conversations; a court order *could* compel disclosure of whatever
  exists within the retention window; a database breach exposes messages that haven't
  yet been deleted. Do not put anything in chat you wouldn't say at the meeting point.
- Session tokens and OTP codes are stored only as hashes; a DB copy contains no usable
  credentials.

## Data inventory

"Justification" is a lawful-basis-style rationale (GDPR-flavored vocabulary used for
rigor; applicable law depends on deployment — India's DPDP Act for the suggested region).

| Data | Where | Why (justification) | Protection | Retention |
|---|---|---|---|---|
| Phone number | `users.phone_enc/_hmac` | Account integrity & abuse friction (legitimate interest / contract) — explicit product decision, ADR-0006 | AES-256-GCM + keyed blind index; never in API, logs, or admin UI | Life of account; erased on deletion |
| OTP codes | `otp_codes` | Authentication (contract) | Peppered HMAC per phone; 5-attempt cap | 10 min TTL; purged shortly after |
| Sessions | `sessions` | Authentication (contract) | sha256 of opaque token only | 60 days or revocation; expired rows purged |
| Pseudonym, avatar seed, locale | `users` | Product identity (contract) | Non-identifying by design; regenerable every 30 days | Life of account |
| Push tokens | `push_tokens` | Notifications (consent — user registers) | Opaque vendor tokens | Until unregistered/disabled |
| Event memberships | `memberships` | Scoping exchanges (contract) | Never listed to anyone | Life of membership; anonymization wave post-event |
| Coarse location | `member_locations` | Proximity matching (consent — sent only while requesting/helping; `consent_records`) | ~110 m double coarsening; single UPSERTed row; bucket-only exposure | **15 min TTL**; purged every 60 s; deleted on leave |
| Requests & matches | `requests`, `matches`, offers, transitions | Core service (contract) | Aliases; ownership-checked routes | Active + event `retention_days` (default 7 post-event), then **anonymized** (user links + free text severed) |
| Chat messages | `messages` | Coordination (contract) | Server-readable (see above); alias-attributed | Readonly 60 min after match close; **deleted after event retention** |
| Inventory | `inventory_items` | Core service (contract) | Own-items visibility only | Expires with event; same anonymization wave |
| Reliability counters | `reliability_stats` | Matching quality (legitimate interest) | Aggregate integers only; label shown, math never | Life of account |
| Reports + evidence excerpts | `reports.evidence` | Safety & moderation (legitimate interest / legal obligation) | Snapshot only on reporter opt-in; moderator-visible | **180 days** |
| Moderation actions & appeals | `moderation_actions`, `appeals` | Accountability (legitimate interest) | Written reason mandatory | 180 days (appeals resolution retained with audit) |
| Audit log | `audit_log` | Admin accountability (legitimate interest) | Append-only; no UPDATE/DELETE grants | **400 days** |
| Notifications | `notifications` | Product function (contract) | i18n keys, vague previews by default | **30 days** |
| Consents | `consent_records` | Proof of consent (legal obligation) | Append-only | Life of account |
| Server logs | stdout/journald | Ops & security (legitimate interest) | No bodies, no query strings, auth headers redacted, request-id only | Short rotation ([deployment.md](deployment.md)) |

## Retention schedule (worker tasks)

Repeatable jobs run **every 60 s** (`RetentionJob` in `server/src/queues.ts`); each is
idempotent and privacy-critical (monitor liveness — a stalled worker is a privacy
incident, see [incident-response.md](incident-response.md)).

| Task | Effect |
|---|---|
| `purge_locations` | Delete `member_locations` past `expires_at` (15 min TTL) |
| `purge_otps_sessions` | Delete expired/consumed OTPs (10 min TTL) and expired/revoked sessions |
| `expire_requests` | Move past-TTL requests to `expired` / `no_match` |
| `expire_offers` | Expire open offers past `respond_by` (safety net behind delayed jobs) |
| `expire_availability` | Turn off stale "Helping Now" rows |
| `expire_conversations` | Readonly 60 min after match close; expire with event retention |
| `purge_messages` | Delete messages past event retention (default `retention_days`=7 after event end) |
| `anonymize_closed` | Sever user links and free text from closed requests/matches past event retention |
| `purge_notifications` | Delete notifications older than 30 days |
| `event_lifecycle` | Advance event statuses by time (scheduled→active→completed→archived) |

## User rights mechanics

- **Export** — `POST /me/export` queues a `data-request` job; the worker assembles a
  bundle of everything currently linked to the account (profile, memberships, own
  requests/matches/messages within retention, consents, reports filed) into
  `data_requests.payload`; poll `GET /me/export` for `downloadUrl`. What has already
  been purged cannot be exported — deletion is real.
- **Delete** — `POST /me/delete` (retype pseudonym to confirm) immediately revokes all
  sessions and queues deletion: `phone_enc`/`phone_hmac` cleared, profile scrubbed and
  `deleted_at` set, push tokens/notifications/prefs/locations/availability removed, and
  content anonymized. Rows that must survive do so **unlinked or aliased**: reports and
  audit entries (safety/accountability, own clocks above) and counterparties' match
  history (which only ever contained your per-match alias).
- **Consents** — `GET /me/consents` lists recorded grants (`safety_ack`, `location`,
  `notifications`); location consent is re-expressed every time by the act of sending a
  ping, and stopping is immediate (`DELETE /events/:id/location`, leave event, or
  availability off).

## What we can and cannot give third parties

Within retention windows the operator holds: encrypted phone ↔ account linkage, event
memberships, requests/matches/messages, coarse ≤15-min location for actively
matching users. Past those windows the honest answer to any demand is "that data no
longer exists." There is deliberately **no law-enforcement portal, no bulk access API,
and no analytics pipeline**; any disclosure would be a manual, logged, case-by-case act
of the operator. Users should still assume the operator's jurisdiction applies to
whatever currently exists — see the E2EE note above and
[known-limitations.md](known-limitations.md).
