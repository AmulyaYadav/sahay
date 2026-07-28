# ADR-0012: Admin-only event creation; public wants without k-anonymity

## Status
Accepted (2026-07)

## Context

The web app is being repurposed into a public, unauthenticated landing page
(showing active events and their current wants, to recruit volunteers to the
mobile app) plus a trimmed admin console. Two decisions fall out of this:

1. Today, any signed-in user can create an event (`POST /events`, gated only
   by `app.authenticate`); mobile has no equivalent create-event flow. Once
   the web app's regular-user flows are removed, only admins/moderators would
   be able to create events unless this were explicitly decided.
2. The public landing page needs to show "what does this event currently
   need" prominently and reliably, including for brand-new events with no
   real demand yet. The existing `computeDashboard` k-anonymizes demand
   (requires ≥3 distinct requesters behind a figure or it's null) — exactly
   the kind of privacy protection this app is built around (ADR context:
   avoiding inference of sensitive individual need in small groups).

## Decision

1. **Event creation becomes moderator/admin-only.** `POST /events` is
   role-gated to `moderator` (which also covers `admin` per the existing role
   hierarchy). No mobile equivalent is added in this pass. This is a
   deliberate, confirmed product decision, not an oversight.
2. **A new "public wants" concept, deliberately separate from
   `computeDashboard`, has no k-anonymity floor.** It merges admin-curated
   "current wants" (always shown, curated per event, ordered by the
   catalogue's `sortOrder`) with real aggregated demand from open requests,
   shown starting from a single requester. `computeDashboard` itself is
   unchanged for every other consumer.
3. **Event "deletion" in the admin UI reuses the existing `event_disable`
   moderation action** (already admin-gated, already cancels active matches
   and closes open requests) rather than a new hard database delete.

## Consequences

- Regular users lose the ability to create events via any client until/unless
  a future change adds it to mobile. This is accepted for now.
- The public wants view reveals demand for a category from a single
  requester — a real, deliberate reduction in the privacy margin
  `computeDashboard`'s k-anonymity gate provided elsewhere. Category-level
  aggregate counts don't reveal *who* requested; the product goal (visible
  real-time need to drive volunteer signups) was judged to outweigh this
  margin for this specific public-facing view.
- No event is ever hard-deleted; "deleted" events remain in the database with
  `status = 'disabled'`, preserving the audit trail and matching the rest of
  the system's soft-delete conventions.

## Reconsider when

- Event creation is added to mobile, at which point the moderator-only gate
  on `POST /events` should be revisited (either lifted, or replaced with a
  proper per-platform capability check).
- The single-requester demand disclosure is found to enable a real
  re-identification risk in practice (e.g. very small events where even a
  category-level signal narrows down who's present) — at which point a
  minimal floor (e.g. ≥2) should be reconsidered for this view specifically.
