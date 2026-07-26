# Product requirements (distilled PRD)

Sahay (सहाय, "assistance") — a privacy-conscious, event-centric mutual-aid matchmaker.
This PRD describes the platform **as being built**; technical detail lives in the linked
docs.

## Mission & stance

People at community events — relief operations, festivals, campus events, community
kitchens, neighborhood aid, public gatherings — get small material needs met by nearby
strangers with surplus. Sahay's job ends at the introduction: **it is a matchmaker
only and guarantees nothing** — no delivery, no quality, no safety promises beyond
honest tooling. The platform is **non-partisan and humanitarian**: it serves any lawful
gathering identically and takes no position on any event's cause.

Trust posture: the platform protects users first **from other users** (aliases, coarse
location, blocks, moderation) and second **from the platform itself** (minimal
collection, aggressive retention, honest no-E2EE disclosure, no participant records).

## Users

1. **Requesters** — need something small, now, nearby.
2. **Helpers** — carry surplus, toggle "Helping Now," respond to one offer at a time.
3. **Event creators / organizers** — spin up an event instantly (unlisted/invite-only),
   configure categories, post notices.
4. **Moderators / admins** — approve public listings, work reports, wield the
   proportional actions ladder under a mandatory audit trail.
5. **The public** — see a k-anonymized "what's needed" dashboard for public events; no
   account required.

## Functional requirements (built or in build)

### Accounts & identity
- Phone-OTP sign-in only (explicit product decision; see ADR-0006 for tradeoff);
  sessions 60 days, per-device, revocable.
- Stable pseudonym + generated avatar (color/initials, never photos); regenerable every
  30 days; **fresh alias per match** so peers cannot correlate across exchanges.
- Locales: en, hi.

### Events
- Anyone creates unlisted/invite-only events instantly; **public listing requires
  moderator approval**; duplicate detection on create.
- Lifecycle draft→scheduled→active→paused→completed→archived/disabled; per-event
  category enables/overrides, safety/medical info, notices, matching-pause,
  retention_days (default 7), match-radius and offer-window overrides.
- Membership is never listed to anyone.

### Needs & supply
- Curated catalogue (seeded from `catalogue-defaults.ts`): hydration, food, shelter,
  hygiene, power, clothing, non-drug first aid, misc; per-category quantity caps,
  sealed/expiry flags, localized names. Denylist (medicines, intoxicants, weapons,
  fuel, blood/organ) binds admins too.
- Helper inventory with hard accounting invariants (reserved ≤ on-hand, DB-enforced).
- Requests: qty, urgency, note, TTL (default 15 min), safety acknowledgment; caps: 3
  active requests, 2 active matches as helper.

### Matching ([matching.md](matching.md), [request-states.md](request-states.md))
- Server-driven, **sequential single-candidate offers**, 45 s response window,
  expanding radius 400 m ×2 to event max (5 km default).
- Ranking: distance bucket + fairness + smoothed reliability + jitter; declines free.
- Acceptance atomically reserves inventory; both-confirm completion; partials can
  continue searching; disputes carry **no public penalty**.

### Communication
- Match-scoped chat only (no cold DMs), quick replies, read receipts; readonly 60 min
  after close; deleted with event retention. Server-readable (moderation) — stated
  honestly, no E2EE claim.
- Notifications: Expo/Web Push + in-app; vague lock-screen previews by default;
  per-type prefs and per-event mute. Voice calls: designed, behind disabled flag.

### Location ([ADR-0009](adr/0009-coarse-expiring-location.md))
- Coarse (~110 m, double-rounded), single UPSERTed row, 15-min TTL, only while
  requesting/helping; peers see buckets only; public surfaces contain zero location.

### Safety & moderation ([moderation-handbook.md](moderation-handbook.md))
- 12 report categories with opt-in conversation-excerpt evidence; blocks via match (ids
  never revealed); proportional ladder warn→restrict→suspend; every action needs a
  written reason and lands in an append-only audit log; appeals; emergency shutdown.

### Privacy ([privacy-and-retention.md](privacy-and-retention.md))
- Data inventory with per-category retention (locations 15 min … audit 400 days);
  phone AES-256-GCM + blind index, never exposed anywhere including admin UI; user
  export and delete; k-anonymity (≥3) on all public aggregates.

## Non-goals (deliberate, enforced absences)

- **No political tools** — no mobilization features, cause pages, petitions, or
  partisan anything; event descriptions are logistics, not manifestos.
- **No attendance records** — no participant lists, no check-ins, no "who was here,"
  no exportable rosters. Not hidden — nonexistent.
- **No participant maps** — no live map of people, ever; location is bucket-text only.
- **No medicine exchange** — nor any drug, intoxicant, weapon, or fuel; the denylist is
  a hard line even for admins.
- **No ads, gamification, or crypto** — no points, streaks, leaderboards, tokens,
  payments, or monetization of aid; reliability labels are the ceiling of
  status-signaling.
- **No law-enforcement portal** — no bulk access, no analytics pipeline, no special
  APIs; any disclosure is a manual, logged, case-by-case operator act against data that
  mostly no longer exists.
- Also out of scope: money/valuables transfer, delivery logistics, volunteer shift
  management, general-purpose social networking, movement profiles of any kind.

## Constraints & success criteria

- **Scale**: a few thousand concurrent users per event; **budget** $50–150/mo (single
  VPS, Mumbai suggested — ADR-0010); small team.
- **Success looks like**: median time-to-match of a couple of minutes at a live event;
  helpers not flooded (≤1 open offer each); zero incidents traceable to data the
  platform held; dashboards that make people bring the right things.
- **Explicitly accepted costs**: phone requirement excludes some users; single-region
  downtime risk; no E2EE; small-scale reliability gaming — all tracked in
  [known-limitations.md](known-limitations.md).
