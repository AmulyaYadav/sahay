# API surface (v1) — canonical endpoint list

Base path `/api/v1`. All request/response bodies are defined by zod schemas in
`@sahay/shared` (`packages/shared/src/schemas.ts`); the schema name for each route is
listed here. Errors use the `zApiError` envelope. Auth = `Authorization: Bearer <token>`
unless marked *public*. This file is the contract between server and clients — change it
and the schemas together, never one alone.

## Auth
| Method | Path | Body → Response | Notes |
|---|---|---|---|
| POST | `/auth/otp/start` | `zOtpStart` → `{ok, retryAfterSeconds}` | *public*; rate-limited per phone+IP; always 200 (no account enumeration) |
| POST | `/auth/otp/verify` | `zOtpVerify` → `zAuthSession` | *public*; creates account on first verify |
| POST | `/auth/logout` | — → `{ok}` | revokes current session |
| GET | `/auth/sessions` | — → `zSessionInfo[]` | |
| DELETE | `/auth/sessions/:id` | — → `{ok}` | revoke any of own sessions |

## Me / profile
| GET | `/me` | — → `zMe` |
| PATCH | `/me` | `zUpdateMe` → `zMe` | pseudonym regen rate-limited (30 days) |
| GET | `/me/blocks` | — → `{blocks: {createdAt, alias}[]}` | aliases only, never ids |
| POST | `/me/push-tokens` | `zRegisterPush` → `{ok}` |
| GET/PUT | `/me/notification-prefs` | `zNotificationPrefs` |
| GET | `/me/notifications` | `zPagination` → `{items: zNotification[], nextCursor}` |
| POST | `/me/notifications/:id/read` | — → `{ok}` |

## Events
| GET | `/events` | query `zEventSearch` → `{items: zEventSummary[], nextCursor}` | *public*; only `public_approved` active/scheduled events |
| GET | `/events/:idOrCode` | — → `zEventDetail` | *public* for public events; membership fields when authed; unlisted resolvable by exact code only |
| POST | `/events` | `zCreateEvent` → `zEventDetail` | moderator/admin only; public listing pends approval |
| POST | `/events/:id/join` | `zJoinEvent` → `zEventDetail` | invite code enforced for invite_only |
| POST | `/events/:id/leave` | — → `{ok}` | turns availability off, deletes location |
| POST | `/events/:id/mute` | `{muted: boolean}` → `{ok}` |
| GET | `/events/:id/dashboard` | — → `zEventDashboard` | *public*; k-anonymized aggregates |
| GET | `/events/:id/bring` | — → `{suggestions: zBringSuggestion[]}` | member only |

## Catalogue
| GET | `/catalogue` | — → `{categories: zCategory[]}` | *public*; active global categories |

## Inventory (member of event)
| GET | `/events/:id/inventory` | — → `{items: zInventoryItem[]}` | own items |
| POST | `/events/:id/inventory` | `zAddInventory` → `zInventoryItem` | idempotent via key |
| PATCH | `/inventory/:itemId` | `zUpdateInventory` → `zInventoryItem` | qty edits clamp at reserved |
| DELETE | `/inventory/:itemId` | — → `{ok}` | soft: sets inactive; hard-delete if never matched |

## Availability & location
| GET | `/events/:id/availability` | — → `zAvailability` |
| PUT | `/events/:id/availability` | `zSetAvailability` → `zAvailability` |
| PUT | `/events/:id/location` | `zLocationPing` → `{ok, expiresAt}` | only while requesting/helping; coarsened server-side |
| DELETE | `/events/:id/location` | — → `{ok}` |

## Requests (requester)
| POST | `/requests` | `zCreateRequest` → `zRequestView` | idempotent; starts matching |
| GET | `/requests/mine` | query `{eventId?}` → `{items: zRequestView[]}` |
| GET | `/requests/:id` | — → `zRequestView` | owner only |
| POST | `/requests/:id/cancel` | — → `zRequestView` |
| POST | `/requests/:id/renew` | `zRenewRequest` → `zRequestView` | from expired/no_match |
| POST | `/requests/:id/continue` | `zContinueRequest` → `zRequestView` | after partial fulfilment |

## Offers (helper)
| GET | `/offers/pending` | — → `{items: zOfferView[]}` | current open offers for me |
| POST | `/offers/:id/respond` | `zOfferRespond` → `{offer: zOfferView, match?: zMatchView}` | accept = atomic reservation |

## Matches
| GET | `/matches/active` | — → `{items: zMatchView[]}` |
| GET | `/matches/:id` | — → `zMatchView` | participant only |
| POST | `/matches/:id/meeting` | `zMeetingUpdate` → `zMatchView` |
| POST | `/matches/:id/cancel` | `zCancelMatch` → `zMatchView` | reason `unsafe` = immediate, stops location processing, offers block/report |
| POST | `/matches/:id/confirm` | `zConfirmCompletion` → `zMatchView` | role-appropriate confirmation; idempotent |

## Chat
| GET | `/conversations/:id` | — → `zConversationView` | participant only |
| GET | `/conversations/:id/messages` | `zPagination` → `{items: zMessage[], nextCursor}` |
| POST | `/conversations/:id/messages` | `zSendMessage` → `zMessage` | idempotent via clientMsgId |
| POST | `/conversations/:id/read` | — → `{ok}` | marks peer messages read |

## Safety
| POST | `/reports` | `zCreateReport` → `zReportView` |
| GET | `/reports/mine` | — → `{items: zReportView[]}` |
| POST | `/blocks` | `zBlockUser` → `{ok}` | via matchId; also cancels the match |

## Privacy
| POST | `/me/export` | — → `zDataExport` | async; poll GET |
| GET | `/me/export` | — → `zDataExport` |
| POST | `/me/delete` | `zDeleteAccount` → `{ok}` | revokes sessions, queues deletion job |
| GET | `/me/consents` | — → `{items: {kind, granted, createdAt}[]}` |

## Admin (`/admin/*`, role moderator/admin as noted)
| GET | `/admin/reports?status=` | mod | `{items: zAdminReportView[]}` |
| POST | `/admin/moderate` | mod | `zAdminModerate` → `{ok}` — action allowlist per role; writes audit + moderation_action |
| GET | `/admin/users?q=` | mod | `{items: zAdminUserView[]}` |
| GET | `/admin/events?status=&pendingApproval=` | mod | event list incl. unlisted |
| POST | `/admin/events/:id/notice` | mod | `{body, urgent}` → `{ok}` |
| PATCH | `/admin/events/:id` | admin | event edits incl. status/pause/retention |
| PATCH | `/admin/events/:id/wants` | admin | `{categorySlugs}` → `{ok}` — replaces the event's admin-declared "current wants" |
| GET/PATCH | `/admin/categories` | admin | full catalogue management (denylist enforced) |
| GET/PATCH | `/admin/flags` | admin | feature flags |
| GET | `/admin/appeals` / POST `/admin/appeals/:id/resolve` | admin |
| GET | `/admin/audit?cursor=` | admin | read-only audit log |
| GET | `/admin/stats` | mod | privacy-safe operational aggregates |
| POST | `/admin/emergency-shutdown` | admin | pauses all events + matching; reauth reason required |

## Ops
| GET | `/healthz` | liveness (no auth) — root level, not under /api/v1 |
| GET | `/readyz` | readiness: DB + Redis ping |

## WebSocket
`GET /ws?token=<bearer>` — server sends `zWsFrame` frames with `event` ∈ `WS_EVENTS`.
Client sends `{"type":"ping"}` keepalives. Frames are hints; clients refetch REST state
on reconnect. Invalid/expired token → close code 4401. Suspension mid-connection →
`session.revoked` frame then close 4403.

## Notes
- `zEventSummary`/`zEventDetail` both include a `wants: zPublicWant[]` field — the public
  landing page's "current wants" list (admin-declared, then real aggregated demand, no
  k-anonymity floor). Search results cap it at 3; the detail response returns the full
  merged list. Only computed for `visibility: 'public'` events with `publicApproved: true`
  (the same access rule as `/events/:id/dashboard`); every other event gets `wants: []`.
- POST `/events` responds `{event: zEventDetail, inviteCode?: string}` rather than a bare
  `zEventDetail`: the invite code for `invite_only` events is issued exactly once, at creation
  time, to the creator. `zEventDetail` intentionally never carries the invite code, so
  subsequent GETs cannot leak it.
- POST `/matches/:id/confirm`: the server accepts `qty: 0` even though the shared
  `zConfirmCompletion` requires a positive quantity. A participant must be able to state
  "nothing was exchanged" so quantity disagreements can surface (→ match `disputed`,
  reservation released, request resumes searching). `zConfirmCompletion.qty` should be
  relaxed to `min(0)` in a future shared-schema change; until then the server widens it
  locally (`modules/matches/routes.ts`).
- Helper-initiated match cancellation notifies the requester with notification type
  `match_cancelled`, which is not (yet) in `NOTIFICATION_TYPES`. The notifications slice
  should add it to the shared enum (the notify worker is still a stub, so nothing is
  persisted with the out-of-enum type today).
- There is no `offer.updated` WS event, so when a pending offer stops being actionable for
  its helper (accepted, superseded by cancel/expiry), the server publishes `offer.expired`
  with the offer's current status so clients drop it from the pending list. Frames are
  hints; REST remains the source of truth.
- Reliability: `reason: 'unsafe'` cancellations by the helper do NOT increment
  `cancelled_pre/post_meeting`. Penalizing "I no longer feel safe" would discourage using
  the safety exit; abuse of it is a moderation concern, not a ranking one. Ordinary
  helper cancels are penalized per meeting progress as specified.
- GET `/me/export/download` (auth) is an addition to the Privacy table: it streams the
  latest READY export as a JSON attachment (`content-disposition: attachment`). GET
  `/me/export` advertises it via `downloadUrl` once the export worker finishes.
- Appeals gained two user-facing endpoints: POST `/appeals`
  (`{moderationActionId, body}` — only the action's target may appeal; one OPEN appeal
  per action, 409 otherwise) and GET `/appeals/mine`. Both endpoints deliberately accept
  SUSPENDED accounts (a fresh OTP login works while suspended): appeals are the remedy
  channel for moderation, so the suspension itself cannot lock the appellant out. Every
  other authenticated route still rejects suspended accounts.
- Notification prefs: turning a type off in `perType` suppresses PUSH ONLY. The
  notifications row (and `notification.new` WS hint) is still written so the in-app feed
  history stays complete. `detailedPreviews` governs lock-screen content for the
  content-bearing types (`match_offer`, `new_message`); all other types always push
  their real localized text — they carry no peer/request details.
- The notify worker skips deleted users entirely and, for SUSPENDED users, delivers only
  `account_security` and `moderation_outcome` (the target must still learn about — and be
  able to appeal — the action).
- POST `/blocks` on an active match cancels it via the moderation path, which moves the
  request to the terminal `moderated` status (not renewable). The requester creates a new
  request to keep searching; this reuses the single audited cancel path rather than
  adding a second, block-specific one.
- Retention `anonymize_closed`: match_offers referenced by a matches row are retained
  (FK `matches.offer_id`); only unreferenced offers are deleted. The match row carries
  the same pseudonym-only linkage, so nothing extra is kept.
- Moderation expiry (auto-unsuspend when `suspended_until` passes, restoring
  `can_request`/`can_help` once no unexpired `restrict_*` action remains) runs inside the
  existing `event_lifecycle` retention task — no new task names were added.
- `match_cancelled` is now part of the shared `NOTIFICATION_TYPES` enum, resolving the
  earlier note above; the notify worker persists it normally.
- POST `/admin/events/:id/notice` fans out to current, non-banned, NON-MUTED members
  (membership mute is precisely the "no event notifications" switch); delivery dedupes on
  `notice:<noticeId>` per user, so retries never duplicate feed rows.
