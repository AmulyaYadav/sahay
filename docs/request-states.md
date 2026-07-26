# Request state machine

States are defined in `REQUEST_STATUSES` (`packages/shared/src/constants.ts`). **The
server is the only writer** of `requests.status`; every change appends a
`request_transitions` row (`from`, `to`, `actor` ∈ system/requester/helper/moderator,
`reason`). Clients only ever *request* transitions via the API.

## Diagram

```
                                  create
                                    │
                                    ▼
                    ┌────────── searching ◄──────────────┐
                    │            │    ▲                  │
                    │   offer    │    │ decline /        │ continue
                    │   created  │    │ timeout /        │ (requester,
                    │            ▼    │ supersede        │  remainder)
                    │          offering                  │
                    │            │                       │
                    │     helper accepts (TX)            │
                    │            ▼                       │
                    │         matched ────────────► partially_fulfilled
                    │            │                       │ (stop)
                    │            │ both confirm          ▼
                    │            ├────────────► fulfilled   [terminal]
                    │            │ qty mismatch
                    │            ├────────────► disputed    [terminal*]
                    │            │ match cancelled
                    │            └────────────► searching (resume search)
                    │
   requester cancel ├────────────► cancelled   [terminal]
   TTL reached      ├────────────► expired     [terminal, renewable]
   TTL, no offer    ├────────────► no_match    [terminal, renewable]
   ever made        │
   moderation       └────────────► moderated   [terminal]

 (cancel/expiry/moderation arrows apply from searching, offering, and — for
  cancel/moderation — matched via match cancellation)
```

`*` disputed is resolved by moderation, which may close or re-open outcomes; no public
penalty attaches to either side.

## Transition table

| From | To | Trigger | Actor | Side effects |
|---|---|---|---|---|
| — | searching | `POST /requests` (idempotent) | requester | Row created (radius 400 m); optional location upsert; enqueue match job |
| searching | offering | Candidate selected | system | `match_offers` row (`respond_by`); delayed timeout job; helper notified |
| offering | searching | Helper declines | helper | Offer→`declined` (free, no penalty); next candidate; radius may expand |
| offering | searching | `respond_by` passes | system | Offer→`expired`; counts as unresponded for helper's responsiveness; next candidate |
| offering | matched | Helper accepts | helper | **TX**: `FOR UPDATE` on inventory, `qty_reserved += qty` (CHECK-guarded); insert match (unique active-per-request) + conversation; fresh aliases; offer→`accepted`; both notified |
| matched | fulfilled | Both confirmed, quantities meet the need | both | **Deduct exactly once** (`inventory_applied`): `qty_on_hand -= min(confirmed)`, release reservation; `qty_fulfilled` set; reliability counters once (`reliability_applied`); conversation readonly after 60 min grace |
| matched | fulfilled / partially_fulfilled | One side confirmed, grace elapsed | system | Auto-close on the single confirmation; same exactly-once deduction |
| matched | partially_fulfilled | Both confirmed, less than need | both | Deduct min(confirmed); release remainder of reservation; requester prompted to continue |
| partially_fulfilled | searching | `POST /requests/:id/continue {continueSearching:true}` | requester | Re-enters matching for remaining qty; prior helpers still excluded (`UNIQUE (request_id, helper_id)`) |
| matched | disputed | Confirmed quantities mismatch | system | Reservation released **without** deduction beyond agreed min; flagged for moderation; **no public penalty**; `disputes` counter only |
| matched | searching | Match cancelled (`changed_mind`, `cannot_find`, `no_longer_needed`, `unsafe`, moderation) | either / moderator | Match→appropriate `cancelled_*`; **reservation released exactly once**; `unsafe` cancels immediately, stops location processing for the pair, offers block/report; requester may resume or cancel |
| searching / offering | cancelled | `POST /requests/:id/cancel` | requester | Open offer→`superseded`; helper hinted; no reservation exists yet (nothing to release) |
| searching / offering | expired | `expires_at` reached (≥1 offer was made) | system | Expiry sweep; requester notified (`request_expiring` beforehand) |
| searching / offering | no_match | `expires_at` reached, no offer ever made | system | Requester notified (`no_helper_found`) with renew option |
| expired / no_match | searching | `POST /requests/:id/renew` | requester | New `expires_at`; radius resets; attempt counter continues |
| any non-terminal | moderated | Moderator action (e.g. false_request) | moderator | Open offer superseded; any reservation released; audit_log + moderation_action rows |

## Invariants & idempotency

- **One active match per request** — partial unique index
  `matches (request_id) WHERE status='active'`. The DB, not the app, enforces it.
- **Reservation applied/released exactly once** — `matches.inventory_applied` flips
  inside the same transaction as the inventory mutation; retries become no-ops.
- **Reliability applied exactly once** — `matches.reliability_applied`, same pattern.
- **A helper is asked once per request** — `match_offers UNIQUE (request_id, helper_id)`.
- **Idempotent client calls** — request creation (`idempotency_key`), completion
  confirmation (`zConfirmCompletion.idempotencyKey`; repeating a confirm returns the
  current state), message send (`clientMsgId`), inventory add. Replays of a *different*
  payload under the same key are rejected (`idempotency_replay`).
- **Idempotent jobs** — timeout/expiry jobs re-read the row and exit if the state
  already moved; a delayed job firing after an accept does nothing.
- **Transitions are append-only** — `request_transitions` has no update path; it is the
  audit trail for every dispute and moderation review.
