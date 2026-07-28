# Public Web Landing — Design

## Context

The web app and mobile app currently duplicate almost the same authenticated feature set (request help, offer help, matching, chat, profile, settings). Going forward, mobile is the app for volunteers/requesters. The web app is repurposed into two things only:

1. A **public, unauthenticated landing page** showing currently-active events and their top wants, to drive awareness and volunteer sign-ups (directing people to the mobile app).
2. A **trimmed admin console**, reachable via the existing email-OTP `/auth` login, scoped to exactly two capabilities: event CRUD, and declaring an event's curated "wants."

Everything else currently in the web app — the regular-user authenticated flows (`/home`, `/matches/:id`, `/settings`, `/profile`, `/events/new`, `/events/:id/request`) and every other admin capability (moderation, reports, audit, user management, feature flags, catalogue denylist) — is removed from web. Mobile is untouched; it remains the full authenticated app.

## Decision

### Routes (web)

| Route | Before | After |
|---|---|---|
| `/` | Marketing landing page | Public event list (merges today's marketing intro content + today's `/events` discovery list) |
| `/events/:idOrCode` | Public event page, many gated actions inside | Public, fully read-only: description, safety notices, full wants list, volunteer CTA |
| `/events` | Public discovery list | Removed (folded into `/`) |
| `/events/new` | Authenticated user create-event | Removed |
| `/events/:id/request` | Authenticated request wizard | Removed |
| `/home`, `/matches/:id`, `/settings`, `/profile` | Authenticated | Removed |
| `/auth` | Phone/email OTP sign-in | Unchanged mechanically; now admin/moderator sign-in only in practice |
| `/admin`, `/admin/:section` | Full moderation console | Trimmed to event CRUD + wants management only |
| `/guidelines`, `/privacy`, `/terms`, `/support` | Static | Unchanged |

### Data model

New column: `event_categories.admin_want boolean not null default false` (migration `0003_public_wants.sql`). Ordering among admin-declared wants uses the existing `categories.sort_order` — no new ordering column.

No schema change is needed to compute user-requested demand — it already lives in `requests` (status `searching`/`offering`, `qty - qty_fulfilled`).

### Wants computation — deliberate privacy-model deviation for this view only

A new server function, separate from the existing k-anonymized `computeDashboard`, computes what this document calls **public wants** for an event:

1. **Admin-declared wants**: categories where `event_categories.admin_want = true`, ordered by `categories.sort_order`. Always shown, always first, marked with a distinct badge (a checkmark) to distinguish them from user-requested wants.
2. **User-requested wants**: per category, `SUM(qty - qty_fulfilled)` and `COUNT(DISTINCT requester_id)` from open requests (`status IN ('searching','offering')`), sorted by total requested qty descending.

**Explicit, deliberate deviation from `computeDashboard`'s k-anonymity floor (≥3 distinct users)**: this view shows user-requested demand starting from a single requester. This was raised and confirmed directly with the product owner as an accepted tradeoff specific to this public recruitment page — category-level aggregate counts don't reveal who requested, only that the need exists, and the product goal (showing real-time need to drive volunteer signups) outweighs the privacy margin the ≥3 floor provided elsewhere. `computeDashboard` itself is unchanged and continues to k-anonymize wherever it's still used (there is no other web/mobile consumer of it after this change removes `/matches`/`/home`'s use of the event dashboard — mobile's own event dashboard view is unaffected, since mobile is out of scope for this change).

Merge/display rule:
- **Event card** (list view): admin wants first, then top user-requested wants not already admin-declared, **capped at 3 total**.
- **Event detail page**: the full merged list, uncapped.

### API changes

- `GET /events` (existing public discovery endpoint): for the anonymous landing use, filters to `visibility=public AND publicApproved=true AND status=active`. Each returned event includes its top-3 merged wants inline (avoids N+1 requests from the card list).
- `GET /events/:idOrCode` (existing public event endpoint): payload extended with the full merged wants list.
- New admin-only endpoints for: creating/editing/deleting events (if not already fully present in the current admin surface — confirm exact current admin event-management coverage during planning and fill any gap), and setting which categories are `admin_want=true` for an event.

### UI

Both pages reuse the existing "Warm Relief" design system (`docs/design-system.md`, `apps/web/src/ui/tokens.css`, `components.tsx`, `patterns.tsx`) — no new visual language. Calm single-column event list, each card showing title, `areaLabel`, status, and up to 3 want chips (admin ones carrying a checkmark badge). A clear but non-competing "become a Sahay volunteer" section with App Store / Play Store badge placeholders (no live store links yet — the mobile app isn't published), placed after the event list rather than interrupting it.

### Event creation becomes admin-only — scope narrowing

Today, any signed-in user can create an event via web (`/events/new`); mobile has no equivalent. Removing `/events/new` without adding event creation to mobile means only admins/moderators can create events going forward. This is a deliberate, confirmed product decision (not an oversight) — recorded as ADR-0012.

## Non-goals

- No changes to the mobile app.
- No changes to `computeDashboard`'s k-anonymity behavior for any consumer other than this new public-wants view.
- No real app-store links (placeholders only, pending publication).
- No new visual design system — reuse "Warm Relief" as-is.
- No drag-and-drop reordering UI for admin wants in this pass — ordering is inherited from the catalogue's existing `sortOrder`.

## Testing

- Server: unit tests for the new public-wants computation (admin wants ordering, user-requested merge/sort, no k-anonymity floor, cap-at-3 behavior on the list endpoint vs uncapped on detail).
- Server: integration tests for the trimmed admin endpoints (event CRUD, wants toggling) and for the extended public `/events`/`/events/:idOrCode` payloads.
- Web: e2e coverage for the new anonymous landing flow (list renders, click into event detail, wants display correctly with admin/user badges) and for the trimmed admin flow (login, create/edit/delete event, toggle wants) — replacing e2e coverage for now-removed flows (request/match/settings) which will be deleted alongside those pages.
