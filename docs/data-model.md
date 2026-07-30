# Data model

Source of truth: `server/migrations/0001_init.sql` (hand-written DDL, ADR-0004;
validated against a real PostGIS database). `server/src/db/schema.ts` mirrors it for
Drizzle. Conventions: uuid PKs (`gen_random_uuid()`), `timestamptz` everywhere,
snake_case. Extensions: `postgis`, `pgcrypto`.

Retention behavior referenced below is executed by the retention worker
([privacy-and-retention.md](privacy-and-retention.md) has the full schedule).

## ER overview

```
                 users ──────────────┐
                   │ 1:1             │
      ┌────────────┼──────────────┐  │
 otp_codes*   sessions      push_tokens
 (by phone_hmac)   │              reliability_stats (1:1)
                   │              notification_prefs (1:1)
                   │              notifications, consent_records, data_requests
                   │
 events ◄── memberships ──► users          categories ◄── event_categories ──► events
   │  ▲                                        ▲
   │  └─ event_notices                         │
   │                                           │
   ├──► requests (requester: users) ───────────┤
   │       │ 1:N append-only                   │
   │       ├──► request_transitions            │
   │       ├──► match_offers ──► inventory_items (helper stock, CHECK invariants)
   │       │        │ accepted ↓
   │       └──────► matches ──► conversations ──► messages
   │                   │
   ├──► availability   ├──► reports ──► moderation_actions ──► appeals
   └──► member_locations (1 row per user+event, TTL)
                        blocks (user↔user)      audit_log (append-only)
                        feature_flags           _migrations

 * otp_codes reference accounts only via phone_hmac (blind index), not user_id.
```

## Identity & auth

### users
One row per account. Peers never see this row directly — they see per-match aliases.

| Notable column | Meaning |
|---|---|
| `pseudonym`, `avatar_seed` | Stable public-ish identity; regeneration rate-limited via `pseudonym_changed_at` (30 days) |
| `phone_enc` | Phone, AES-256-GCM encrypted (nullable — cleared on deletion) |
| `phone_hmac` | **UNIQUE** keyed blind index; the only way to look up an account by phone |
| `role` / `status` | `user\|moderator\|admin` / `active\|restricted\|suspended\|deleted` |
| `can_request`, `can_help` | Moderation restriction switches (proportional actions ladder) |
| `suspended_until`, `risk_flags` | Timed suspensions auto-lift at auth time; flags feed admin triage |
| `deleted_at` | Soft-delete marker; auth joins on `deleted_at IS NULL` |

### otp_codes
OTP challenges keyed by `phone_hmac` (works pre-account). `code_hash` is a peppered
HMAC scoped to the phone; `attempts` capped at 5; `expires_at` = 10 min.
**Retention:** purged shortly after expiry/consumption.

### sessions
Opaque bearer tokens: only `token_hash` (**UNIQUE**, sha256) is stored. `expires_at`
(60 days), `revoked_at` (logout / revoke / suspension), `platform`, `device_name`,
`last_seen_at` (touched at most once/min). **Retention:** expired/revoked rows purged.

### push_tokens
Expo/WebPush tokens, `UNIQUE (user_id, token)`, `disabled` for dead endpoints.

## Events & membership

### events
| Notable column | Meaning |
|---|---|
| `code` | **UNIQUE** short shareable id (e.g. `MELA-7K2F`); unlisted events resolvable by exact code only |
| `status` | `draft→scheduled→active→paused→completed→archived/disabled` (worker `event_lifecycle` job advances by time) |
| `visibility` + `public_approved` | `public` listing appears only when a moderator approves; `invite_code` gates `invite_only` joins |
| `center geography(Point,4326)`, `radius_m` | Coarse center for discovery + matching (GiST-indexed); never a precise venue point |
| `max_match_radius_m` (5000), `offer_response_seconds` (45) | Per-event matching overrides |
| `matching_paused` | Moderation/emergency lever, distinct from status |
| `retention_days` (7) | Post-event data lifetime driving message deletion and anonymization |
| CHECK | `ends_at > starts_at` |

### event_notices — organizer/moderator announcements, `urgent` flag.

### memberships
`UNIQUE (user_id, event_id)`; `role` `member|event_admin`; `muted`, `banned`, `left_at`
(partial index on active members). Membership is never listed to anyone — no
participant-list endpoint exists.

## Catalogue

### categories
Global supply catalogue (seeded from `packages/shared/src/catalogue-defaults.ts`).
Localized `name`/`description` jsonb; `name_plural` jsonb is the plural form used
when a count is shown ("40 torches needed") — NULL means no distinct plural, which
is correct for already-plural names and mass nouns, and callers fall back to `name`
via `categoryDisplayName()`. Then `unit` + `alt_units`; safety flags
(`sealed_required`, `expiry_relevant`, `restricted`, `warning_key`); per-category
`max_request_qty` / `max_offer_qty`. Creation/enable is checked against
`PROHIBITED_PATTERNS` (medicines, intoxicants, weapons, fuel, blood/organ) — the
denylist binds admins too.

### event_categories
Per-event enable/override: `PRIMARY KEY (event_id, category_id)`, `enabled`, optional
qty-cap overrides.

## Inventory

### inventory_items — the accounting invariant

`qty_on_hand` = current stock; `qty_reserved` = held by active matches;
available = on_hand − reserved. The database itself forbids corruption:

```sql
CHECK (qty_on_hand >= 0),
CHECK (qty_reserved >= 0),
CHECK (qty_reserved <= qty_on_hand)
```

Over-reservation is impossible **even under application bugs** — acceptance runs
`SELECT … FOR UPDATE` then increments `qty_reserved`, and any violation aborts the
transaction. Other columns: `details` jsonb (condition/sealed/expiry/size…), `active`
(soft delete; qty edits clamp at reserved), `expires_at` (auto-expire with the event),
and `idempotency_key` with partial unique index
`(user_id, idempotency_key) WHERE idempotency_key IS NOT NULL` making adds replay-safe.

## Availability & location

### availability
`PRIMARY KEY (user_id, event_id)`; `is_on`, `until` (NULL = until manually off/event
end). Worker `expire_availability` turns stale rows off.

### member_locations
The privacy-critical table (ADR-0009): `PRIMARY KEY (user_id, event_id)` — **one UPSERTed
row, so no movement history can exist**. `geog` is coarsened to ~110 m before storage;
`expires_at` (15 min TTL) is purged by the worker every 60 s; GiST index for candidate
queries. Deleted immediately on leave-event or explicit delete.

## Requests & matching

### requests
| Notable column | Meaning |
|---|---|
| `status` | `REQUEST_STATUSES` — server is the only writer ([request-states.md](request-states.md)) |
| `qty`, `qty_fulfilled` | CHECK `qty > 0` and `0 ≤ qty_fulfilled ≤ qty` |
| `current_radius_m` (400), `attempt_count` | Expanding-radius search state |
| `expires_at` | Requester-chosen TTL; partial index on `(expires_at) WHERE status IN ('searching','offering')` drives expiry sweeps |
| `note`, `area_hint` | Free text (length-capped); anonymized after event retention |
| `idempotency_key` | `UNIQUE (requester_id, idempotency_key)` — create is replay-safe |

### request_transitions
Append-only audit of every state change (`from_status`, `to_status`,
`actor` ∈ system/requester/helper/moderator, `reason`). `bigint` identity PK. The server
is sole writer; there is no update path.

### match_offers
One row per (request, candidate): **`UNIQUE (request_id, helper_id)`** — a helper is
asked at most once per request, which also implements "prior decliners are excluded".
`qty` = min(remaining need, helper available); `proximity` bucket (never meters);
`respond_by` enforced by a delayed job (partial index on open offers); `status`
`offered|accepted|declined|expired|superseded`.

### matches
Created on acceptance. **`CREATE UNIQUE INDEX matches_one_active_per_request ON matches
(request_id) WHERE status = 'active'`** — the database guarantees at most one active
match per request. Key columns: `qty_reserved`; `requester_alias` / `helper_alias`
(match-scoped pseudonyms — peers never see stable ids); per-side meeting states;
per-side `*_confirmed_qty` (NULL until confirmed); and two exactly-once flags:
`inventory_applied` (reservation released/deducted once) and `reliability_applied`
(counters updated once). `close_reason` records why. **Retention:** closed matches
anonymized after event retention.

## Chat

### conversations
1:1 with a match (`match_id` UNIQUE). `status` `open|readonly|expired`; `expires_at` set
when the match closes (readonly after 60 min grace; expired/deleted with event
retention).

### messages
`kind` `text|quick|system` (quick = key into the shared quick-reply catalogue); sender
identified to peers only by alias at the API layer. Idempotent sends via partial unique
index `(sender_id, client_msg_id)`. `delivered_at`/`read_at` receipts.
**Retention:** deleted after event retention (default 7 days post-event); report
evidence snapshots survive separately (below).

## Reliability

### reliability_stats
One row per user; the counters consumed by `packages/shared/src/reliability.ts`
(`accepted`, `completed`, `requester_confirmed`, `cancelled_pre/post_meeting`,
`timeouts`, `no_shows`, `disputes`, `offers_received_30d`, `offers_responded_30d`) plus
the cached `label`. Updated exactly once per match via `matches.reliability_applied`.
Disputes are counted but deliberately **not** part of the public score
([reliability.md](reliability.md)).

## Trust & safety

### blocks
`PRIMARY KEY (blocker_id, blocked_id)`. Created via a match (`POST /blocks {matchId}`) —
users never learn each other's ids. Candidate SQL excludes blocked pairs in both
directions.

### reports
Reporter/subject/event/match references all `ON DELETE SET NULL` so reports survive
account deletion. `evidence` jsonb holds the **opt-in conversation-excerpt snapshot**
taken at report time — it survives normal chat expiry and is instead deleted by
moderation retention (180 days). `status` `open|reviewing|resolved|dismissed`.

### moderation_actions
Every admin/moderator action with mandatory `reason`, optional `expires_at` (timed
restrictions), and links to targets/report. Feeds appeals.

### appeals
User challenge to a moderation action; `status` `open|upheld|overturned`.

### audit_log
Append-only (`bigint` identity): actor, action, `target` ("user:<id>", …), reason, meta.
**No UPDATE/DELETE grants in production.** Retention: 400 days.

## Notifications

### notifications
In-app feed rows with i18n keys (`title_key`, `body_key`, `params`) — content is
localized client-side and stays vague on lock screens by default. Partial unique index
`(user_id, dedupe_key)` prevents duplicate alerts. Retention: 30 days.

### notification_prefs
1:1 with user: `detailed_previews` (default false) + per-type toggles jsonb.

## Privacy & ops

### consent_records — append-only record of `safety_ack` / `location` / `notifications` grants.
### data_requests — export/delete jobs: `kind`, `status` `pending|ready|done|failed`, small `payload` for export bundles.
### feature_flags — key/enabled/description. Seeded: `voice_calls` (false — designed, not shipped), `public_event_creation_open` (false), `signup_open` (true — emergency shutdown lever).
### _migrations — created by the migrator (`db/migrate.ts`); one row per applied SQL file.

## Deliberate absences

No participant-list table or endpoint; no location history; no message search index; no
phone number in any index, log, or admin view; no photos; no payment or rating tables.
These absences are load-bearing — see [threat-model.md](threat-model.md).
