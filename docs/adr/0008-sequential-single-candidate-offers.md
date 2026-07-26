# ADR-0008: Sequential single-candidate offers (no broadcast)

## Status
Accepted (2026-07)

## Context
The obvious design — broadcast a request to all nearby helpers, first-come-first-served —
optimizes for latency but has serious failure modes here: it reveals that *someone
nearby needs X* to many people (a stalking/inference channel), causes pile-ons and
awkward races ("I already got it"), floods notifications, and systematically rewards
whoever taps fastest rather than distributing effort fairly.

## Decision
The server offers a request to **exactly one candidate at a time** (`match_offers`, with
`UNIQUE (request_id, helper_id)` — a helper is asked once per request ever). Each offer
has a response window (default **45 s**, per-event override `offer_response_seconds`)
enforced by a BullMQ **delayed job**, not by client timers. Decline or timeout moves on
to the next ranked candidate; when candidates run out the radius expands (400 m, ×2, up
to the event max, default 5 km) and the search re-runs. Ranking mixes distance bucket,
fairness (recent-offer penalty), smoothed reliability, and random jitter
([matching.md](../matching.md)). Acceptance is transactional and reserves inventory
atomically.

## Alternatives considered
- **Broadcast + first-accept** — rejected: privacy leak (need + approximate location
  broadcast widely), notification flooding, racing, unfair to slower/newer helpers.
- **Small-batch parallel offers (e.g. 3 at once)** — considered as a latency middle
  ground; rejected for v1: needs supersede semantics ("offer withdrawn") and still
  multiplies the inference surface. `superseded` exists in `OFFER_STATUSES` so batching
  can be added without a schema change.
- **Requester-browses-helpers marketplace** — rejected outright: it *is* a participant
  list; violates the core privacy stance.

## Consequences
- Worst-case time-to-match grows linearly with declines (~45 s per silent candidate);
  urgency raises ranking aggressiveness, and responsiveness scoring reduces offers to
  chronic ignorers, which bounds this in practice.
- Exactly one helper learns about any given request at any moment — the minimum possible
  disclosure.
- Matching correctness depends on the worker being up; monitor queue depth and offer
  latency ([matching.md](../matching.md) observability section).

## Reconsider when
- Median time-to-match at real events exceeds a couple of minutes because of timeout
  chains — then implement small-batch offers using the existing `superseded` status.
