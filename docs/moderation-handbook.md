# Moderation handbook

For moderators and admins. Tools: `/admin/*` routes ([api-surface.md](api-surface.md)),
action vocabulary `MODERATION_ACTIONS`, report categories `REPORT_CATEGORIES`
(`packages/shared/src/constants.ts`). Every action requires a **written reason** and is
recorded in `moderation_actions` and the append-only `audit_log` — assume everything you
do will be re-read during an appeal.

## Ground rules

1. **You cannot see phone numbers.** Nobody in the admin UI can; don't ask users for
   theirs, and never request identifying details in resolution messages.
2. **Minimum necessary evidence.** Open conversation excerpts only when a report
   requires it, and only excerpts attached to that report (`reports.evidence`,
   reporter-opt-in snapshots). There is no browse-all-chats tool, deliberately.
3. **Non-partisan, humanitarian.** Sahay takes no side in any event's politics. Moderate
   behavior, not viewpoints; `hate_speech` covers attacks on people, not opinions you
   dislike.
4. **Proportionality.** Smallest action that stops the harm; escalate on repetition.
5. **Reasons are user-facing in spirit.** Write reasons a reasonable appellant could
   accept as fair, without revealing reporter identity.

## Triage SLAs

Work the queue (`GET /admin/reports?status=open`) urgent-first:

| Priority | Categories | Target first response | Notes |
|---|---|---|---|
| **P0 — safety** | `threat`, `unsafe_meeting`, `hate_speech` | **≤ 15 min during active events**; ≤ 2 h otherwise | Interim action first (suspend/pause), investigate second |
| P1 — integrity | `fraud`, `impersonation`, `suspicious_event`, `prohibited_item` | ≤ 2 h during events; ≤ 12 h otherwise | |
| P2 — conduct | `harassment`, `false_request`, `no_show`, `spam` | ≤ 12 h | Pattern-driven: check `reportCount`/`riskFlags` |
| P3 | `other` | ≤ 24 h | Recategorize when possible |

## Decision guidelines per category

- **threat** — credible threat of harm: immediate `suspend`, cancel active matches
  (`match_cancel`), preserve evidence, resolve reporter-side with safety guidance. If
  imminent physical danger is described, advise the reporter to contact local emergency
  services — the platform has no emergency-response capability and must say so.
- **unsafe_meeting** — coercion to isolated locations, meeting misconduct: `match_cancel`
  if live; `warn` → `suspend` by severity; remind both parties of public-area guidance.
- **hate_speech** — slurs/dehumanization in chat or event text: `warn` for borderline
  first offense, `suspend` for clear cases; `event_disable` if the event itself is the
  vehicle.
- **prohibited_item** — attempts to trade items matching the denylist (medicines,
  intoxicants, weapons, fuel — `PROHIBITED_PATTERNS` blocks category creation, so this
  usually appears as free-text workarounds): remove via `restrict_helping` or category
  disable; educate first offense, restrict on repeat. Medicines get zero tolerance for
  repeat — the no-medicine rule is a safety cornerstone.
- **false_request** — luring or time-wasting requests: verify via request transitions
  and offer history; `restrict_requests` on pattern; single ambiguous instance → `warn`.
- **spam** — bulk or commercial content: `restrict_requests`/`restrict_helping`,
  `suspend` for bot-like behavior.
- **fraud** — soliciting money/valuables (Sahay moves no money, ever): `suspend`;
  disable any implicated event.
- **impersonation** — claiming to be an organizer/moderator: `suspend`; use
  `/admin/events/:id/notice` to warn the affected event.
- **no_show** — confirmed acceptance then absence: usually no action; reliability math
  already prices it in (`timeouts`/`noShows`, [reliability.md](reliability.md)).
  Moderate only patterns (many reports across counterparties) → `warn` →
  `restrict_helping`.
- **suspicious_event** — see the malicious-event playbook below.
- **other** — recategorize or dismiss with a reason.

Disputed matches (quantity mismatch): review transitions and confirmations, resolve with
`report_resolve` — **no public penalty for either party**; disputes never feed the
public reliability label.

## Actions ladder

`warn` → `restrict_requests` / `restrict_helping` (timed, `durationHours`) → `suspend`
(timed; auto-lifts via `suspended_until`) → indefinite suspend (admin). Event-side:
`event_pause` → `event_unpause` / `event_disable`; listing decisions
`event_approve_public` / `event_reject_public`. Match-side: `match_cancel` (releases
reservation, closes conversation). Role limits: moderators hold a server-enforced action
allowlist; event edits, catalogue, flags, appeals, and emergency shutdown are
admin-only.

Every action: pick the target (user/event/match/report id), write the reason (min 5
chars enforced, but write real sentences), set duration where applicable. Suspension
takes effect immediately — live sessions receive `session.revoked` and WS close 4403.

## Public event approval

Before `event_approve_public`: plausible title/description/area; dates sane; not a
duplicate (creation-time detection helps, verify anyway); no prohibited purpose; no
partisan-mobilization framing (unlisted events are none of our business; *public
listing* is our endorsement surface). When in doubt, reject with a reason — creators can
run unlisted meanwhile.

## Evidence handling

- Evidence exists only if the reporter opted to preserve it (`preserveConversation`,
  default true) — a snapshot at report time; it survives normal chat deletion and is
  purged at **180 days** with the report.
- Never copy evidence out of the admin UI (no screenshots into chat apps, no pasting
  into tickets). Reference report ids.
- Resolution notes visible to reporters are i18n keys (`resolutionKey`) — outcomes are
  communicated, details are not.

## Appeals

Users appeal a specific moderation action (`appeals`; admin queue
`GET /admin/appeals`). The resolving admin must not be the original actor where staffing
allows. Review the action's reason, the audit trail, and evidence; resolve
`upheld` or `overturned` (which reverses reliability/restriction side effects). Target:
≤ 72 h.

## Malicious reporting

Reports are also an attack surface (brigading a victim, weaponized `false_request`
claims):

- Volume is not validity — five reports from one clique count as one signal; check
  reporter histories and whether reporters were ever actually matched with the subject.
- Never auto-action on report count; every action is a human with a written reason.
- Demonstrated bad-faith reporting is itself sanctionable (`warn` →
  `restrict_requests`).
- Blocks require a real match (`POST /blocks` takes a matchId), which structurally
  limits block-brigading.

## Emergency shutdown

`POST /admin/emergency-shutdown` (admin-only, **re-auth + written reason required**)
pauses all events and matching platform-wide; the `signup_open` flag can additionally
freeze registration. Use for: active coordinated physical threat, confirmed data breach,
legal compulsion, or runaway abuse the ladder can't contain. Procedure:

1. Trigger shutdown; verify events show paused and matching halted.
2. Notify affected active events via `/admin/events/:id/notice` (urgent) — plain
   language, no speculation.
3. Open an incident per [incident-response.md](incident-response.md); shutdown ≥ Sev-1.
4. Re-enable deliberately: event-by-event unpause after the cause is addressed; record
   the full timeline (the audit log will already have your actions).
