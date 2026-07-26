# Matching

Server-driven, sequential, single-candidate matching (ADR-0008). This document walks the
full loop; the state machine is in [request-states.md](request-states.md), the ranking's
reliability input in [reliability.md](reliability.md).

## Overview

```
POST /requests ──► requests(status=searching) ──► enqueue match job
                                                        │
                        ┌───────────────────────────────▼───────────────┐
                        │ worker: candidate query @ current_radius_m    │
                        └───────┬───────────────────────────┬───────────┘
                        candidates found                 none found
                                │                           │
                     rank, pick top 1                 radius < event max?
                     create match_offer                yes: radius ×2,
                     status=offering                        re-run
                     delayed timeout job               no: wait/expire →
                                │                          no_match
              ┌─────────────────┼──────────────────┐
           accept            decline             timeout
              │                 │                   │
   TX: FOR UPDATE reserve   offer=declined      offer=expired
   match+conversation       back to searching,  back to searching,
   status=matched           next candidate      next candidate
```

## 1. Request intake

`POST /api/v1/requests` (`zCreateRequest`) validates category (enabled for the event,
not prohibited, qty within per-category/event caps), enforces
`maxActiveRequestsPerUser` (3), requires `safetyAcknowledged: true`, and is idempotent
via `UNIQUE (requester_id, idempotency_key)`. Optional coarse `coords` upsert into
`member_locations` (15 min TTL); optional `area_hint` as a text fallback. The row starts
at `status=searching`, `current_radius_m=400`, and a `match` job is enqueued
(`MatchRunJob {requestId}`).

Matching does not run when the event is not `active` or `matching_paused` is set
(requests are rejected or held per event state).

## 2. Candidate query

One SQL query over PostGIS, all criteria ANDed. A user is a candidate iff:

1. **Stock** — has an `active` inventory item in the request's category for this event
   with `qty_on_hand - qty_reserved > 0`.
2. **Available** — `availability.is_on` and not timed out (`until` in the future / NULL).
3. **In radius** — has a fresh `member_locations` row (not expired) within
   `requests.current_radius_m` of the requester's location
   (`ST_DWithin(geog, requester_geog, radius)`). If the requester has no location, the
   event center is the anchor.
4. **Not excluded**:
   - not the requester;
   - no `blocks` row in **either direction** between the pair;
   - `users.status = 'active'` and `can_help = true` (drops suspended/restricted);
   - **no prior offer for this request** — enforced structurally by
     `match_offers UNIQUE (request_id, helper_id)`, so decliners/timeouts are never
     re-asked;
   - not overloaded: fewer than `maxActiveMatchesPerHelper` (2) matches in
     `status='active'`;
   - event membership current (`left_at IS NULL`, not `banned`).

The offered quantity is `min(remaining need, helper available)` — partial offers are
normal.

## 3. Ranking

Candidates are scored, higher is better. Components:

| Component | Source | Intent |
|---|---|---|
| Distance bucket | `bucketForDistanceM` thresholds (150 / 400 / 1000 m) | Closer buckets rank higher; **buckets, not meters**, so ranking can't be used to triangulate |
| Fairness penalty | recent offer count per helper (30d window counters) | Spread the load; a helper who just got offers ranks lower |
| Reliability | `rankingReliability = 0.7·completionScore + 0.3·responsiveness` (`@sahay/shared/reliability`) | Prefer helpers who follow through; Laplace smoothing means new helpers start at 0.5, never the floor |
| Random jitter | small random term | Breaks ties and guarantees new helpers get chances; makes probing the ranking non-deterministic |

`urgency` (`standard|soon|urgent`) tightens re-run pacing and can widen the initial
radius — it never overrides exclusions. The composite is internal only; no score is ever
displayed ([reliability.md](reliability.md)).

## 4. Offer lifecycle

- Top candidate gets a `match_offers` row (`status=offered`,
  `respond_by = now() + offer_response_seconds` — default **45 s**, per-event override,
  env default `OFFER_RESPONSE_SECONDS`). Request → `offering`.
- Helper is notified: WS hint `offer.new` + push. The clock is `respond_by` in the DB —
  a BullMQ **delayed job** (`OfferTimeoutJob`) fires at deadline; client timers are
  cosmetic.
- **Decline** (`POST /offers/:id/respond {accept:false}`) — free, never penalized
  (only *ignoring* offers lowers responsiveness). Optional
  `alsoStopReceiving` flips availability off. Offer → `declined`; request → `searching`;
  next candidate.
- **Timeout** — worker re-checks state (job is idempotent: skip if already responded),
  marks `expired`, request → `searching`, next candidate; counts against the helper's
  `offersReceived30d` without a response.
- **Accept** — one transaction:
  1. Re-validate offer is still `offered` and request still `offering` (else 410
     `offer_expired`).
  2. `SELECT … FOR UPDATE` the inventory row; `qty_reserved += offer.qty`. The DB CHECK
     `qty_reserved <= qty_on_hand` makes over-reservation **impossible** even if
     application logic is wrong.
  3. Insert `matches` (partial unique index — at most one active match per request) and
     `conversations`; generate fresh per-match aliases for both sides.
  4. Offer → `accepted`; request → `matched`; transition rows appended.
  Both parties get `match.update` hints + push.

## 5. Radius expansion

When the candidate list is exhausted at the current radius:
`current_radius_m ×= 2` (`radiusExpansionFactor`), capped at the event's
`max_match_radius_m` (default 5000). Sequence: 400 → 800 → 1600 → 3200 → 5000. At the
cap with no candidates, the request idles in `searching` and is retried as conditions
change (new inventory, availability, locations) until `expires_at`, when the expiry
sweep moves it to `expired` or `no_match` (no offer was ever made). The requester can
`renew` or adjust.

## 6. Completion, partials, failure modes

Completion and disputes are match-level ([request-states.md](request-states.md)): both
sides confirm quantities; at both-confirmed the **min** of the two is deducted
(`qty_on_hand -= q`, `qty_reserved -= reserved`) exactly once (`inventory_applied`).
Partial fulfilment updates `qty_fulfilled` and, at the requester's choice
(`/requests/:id/continue`), returns the request to `searching` for the remainder —
prior helpers stay excluded per the unique offer constraint.

| Failure | Handling |
|---|---|
| Worker down | Requests sit in `searching`; no offers time out incorrectly (deadlines re-evaluated from DB when workers resume). Alert on queue depth. |
| Duplicate job delivery | All jobs idempotent — re-check status before acting. |
| Offer accepted at deadline race | Transaction re-validation decides; loser gets `offer_expired` (410). |
| Helper inventory shrank since offer | Reservation transaction fails CHECK → accept fails cleanly with `insufficient_inventory`; request returns to searching. |
| Requester cancels mid-offer | Open offer → `superseded`; helper gets `offer.expired` hint. |
| Event paused / emergency shutdown | `matching_paused` halts new offers; open offers expire naturally; matched pairs may finish. |

## 7. Configurables

| Knob | Default | Where |
|---|---|---|
| Offer response window | 45 s | `LIMITS.offerResponseSeconds`; per-event `events.offer_response_seconds`; env `OFFER_RESPONSE_SECONDS` |
| Initial radius | 400 m | `LIMITS.initialSearchRadiusM` |
| Expansion factor | ×2 | `LIMITS.radiusExpansionFactor` |
| Max radius | 5000 m | `LIMITS.maxSearchRadiusM`; per-event `events.max_match_radius_m` |
| Max active matches per helper | 2 | `LIMITS.maxActiveMatchesPerHelper` |
| Max active requests per user | 3 | `LIMITS.maxActiveRequestsPerUser` |
| Request TTL | 15 min default; API accepts 5–120 | `zCreateRequest.expiresInMinutes` (UI presents 10/15/30/60 from `LIMITS.requestExpiryOptionsMin`) |
| Location TTL | 15 min | `LIMITS.locationTtlMinutes`; env `LOCATION_TTL_MINUTES` |

## 8. Observability

Worth metrics/log lines (structured, **never** containing coordinates, phone data, or
message bodies):

- time-to-match (request created → matched), offers-per-match, decline/timeout ratio;
- radius distribution at match time (how often expansion was needed);
- match queue depth + job latency; offer-timeout job lag (a lagging timeout queue
  silently stretches every response window);
- candidate-query duration (PostGIS + exclusion joins — the hottest query);
- no_match rate per category per event (feeds the shortage dashboard sanity check);
- reservation-transaction conflict/CHECK-failure counts (should be ~0; spikes indicate
  bugs or gaming).
