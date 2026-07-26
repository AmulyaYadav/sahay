# ADR-0009: Coarse, expiring, single-row location

## Status
Accepted (2026-07)

## Context
Proximity matching needs *some* location signal. Location history is the most dangerous
data a platform serving public gatherings could hold: it enables stalking, retroactive
identification of attendees, and movement profiling. The safest data is data that never
exists.

## Decision
Location is engineered so that a movement profile **cannot exist by construction**:

- **Coarsened twice**: clients round to 3 decimals (~110 m, `coarsen()` in
  `packages/shared/src/geo.ts`) before coordinates leave the device; the server rounds
  again defensively before storage.
- **One row, UPSERTed**: `member_locations` has `PRIMARY KEY (user_id, event_id)` — a new
  ping overwrites the old one. There is no history table, no log, and request/response
  logging never includes bodies or query strings.
- **Expiring**: every row carries `expires_at` (default TTL 15 min,
  `LOCATION_TTL_MINUTES`); the retention worker purges expired rows every 60 s. Leaving
  an event deletes the row immediately; `DELETE /events/:id/location` does too.
- **Collected only with purpose**: pings are accepted only while the user is actively
  requesting or in "Helping Now" mode.
- **Never exposed**: peers see only proximity buckets (`very_nearby ≤150 m`,
  `nearby ≤400 m`, `short_walk ≤1 km`, `farther`); exact distances and coordinates never
  leave the server. Public dashboards contain no location at all.

## Alternatives considered
- **Precise location + short TTL** — rejected: precision is the harm; TTL alone doesn't
  stop a live stalker or an operator subpoenaed mid-event.
- **Geohash cells instead of rounding** — equivalent privacy; rounding chosen because it
  is trivially auditable in both client and server code and feeds PostGIS directly.
- **Client-computed distances (no server location)** — rejected: requires shipping peer
  coordinates to clients, which is far worse.
- **No location, landmark text only** — kept as fallback (`area_hint`), but bucket-based
  matching quality is materially better and still coarse.

## Consequences
- Matching radius effectively quantizes to ~110 m — fine at 400 m+ search radii.
- A compromised database at time T reveals at most one coarse point per active
  requester/helper, ≤15 min old — and nothing about anyone else at the event.
- The retention worker is privacy-critical; its liveness must be monitored
  ([deployment.md](../deployment.md)).
- Triangulating a user by repeatedly re-requesting is limited by bucket granularity,
  match-scoped visibility, and rate limits — see [threat-model.md](../threat-model.md).

## Reconsider when
- Never toward more precision as a default. Reconsider *finer buckets during an active
  meeting only* (mutual opt-in) if find-each-other UX proves too weak in the field.
