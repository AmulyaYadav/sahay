# Incident response & disaster recovery

One document, two halves: how to respond when something breaks or leaks, and how to
rebuild when the VPS is gone. Companion runbooks: [deployment.md](deployment.md)
(backups, rotation, rollback) and [moderation-handbook.md](moderation-handbook.md)
(emergency shutdown, safety escalations).

## Severity levels

| Sev | Definition | Examples | Response |
|---|---|---|---|
| **Sev-0** | Physical safety at risk, or personal data actively leaking | Credible coordinated threat via the platform; confirmed exfiltration; stolen host | Immediately: emergency shutdown is on the table; all hands |
| **Sev-1** | Platform down or a privacy control broken during an active event | VPS dead mid-event; **retention worker stalled** (purges not running); auth broken | Work continuously until mitigated |
| **Sev-2** | Degraded core function | Matching stuck (queue backlog); SMS provider down (no new logins); WS fanout dead | Same day |
| **Sev-3** | Annoyance, no data/safety exposure | Dashboard stale; push delays; one flaky endpoint | Next business day |

A stalled retention worker is deliberately Sev-1: expired locations/OTPs/messages
persisting past their promised TTL is a broken privacy promise even though users see
nothing.

## First-hour checklist

1. **Name an incident lead** (even in a team of two — one person decides, the other
   executes). Start a timestamped notes file immediately; you will not remember.
2. **Assess scope**: `curl /readyz`; `docker compose ps`; api + worker logs; disk space;
   is this outage, data exposure, abuse, or several?
3. **Stop the bleeding, smallest lever first**:
   - abuse/safety → moderation actions, `matching_paused` per event, `signup_open` off,
     emergency shutdown last;
   - suspected credential/session compromise → revoke affected `sessions` rows (or all),
     rotate the affected secret ([deployment.md](deployment.md) rotation table);
   - suspected host compromise → snapshot for forensics, then isolate (firewall to
     SSH-only); treat **env keys as burned**: phones' encryption key lives there
     (Sev-0, see key note below);
   - runaway bug → roll back the app image.
4. **Preserve evidence before rebooting/rebuilding**: copy logs, `docker compose ps`
   output, and a DB dump if integrity is in doubt. The `audit_log` and
   `request_transitions` tables are your forensic timeline for admin/abuse incidents.
5. **Communicate** (see below) once scope is roughly known — within the first hour, even
   if the message is "we know, we're on it."
6. **Track privacy impact explicitly**: what categories of data (per the
   [data inventory](privacy-and-retention.md)) could have been exposed, for which time
   window? Retention limits the window — say so precisely, not reassuringly.

Key-compromise note: if `PII_ENCRYPTION_KEY`/`PHONE_HMAC_KEY` may be exposed together
with a DB copy, assume phone numbers are exposed. That is the single worst data outcome
this system can produce; user notification is almost certainly required (jurisdiction-
dependent — DPDP Act in India has breach-notification duties).

## Communications guidance

- **Channels**: event notices (`/admin/events/:id/notice`, urgent flag) for in-app;
  the public status/landing page for outages; push only for safety-relevant messages.
- **Tone**: plain language, no speculation, no minimizing. Sahay's brand *is* honesty
  about limits.
- **Content for privacy incidents**: what happened, what data categories and time
  windows, what we did, what users should do (usually: nothing, or re-login after mass
  session revocation), how to reach us. Never name reporters, victims, or suspects.
- **Legal demands**: don't improvise. Verify authenticity, involve counsel, log the
  interaction; remember most requested data may simply no longer exist
  ([privacy-and-retention.md](privacy-and-retention.md)).

## Post-incident

Within a week: blameless write-up (timeline, impact, root cause, what made it worse/
better, actions with owners). File follow-ups as issues; update this doc and the
[threat model](threat-model.md) if the incident revealed a new class.

---

# Disaster recovery

## Honest targets (single-VPS reality, ADR-0010)

| Metric | Target | Basis |
|---|---|---|
| **RPO** | ≤ 24 h (nightly `pg_dump`); minutes once WAL archiving is enabled; ~0 for pre-event manual dumps | [deployment.md](deployment.md) backup section |
| **RTO** | ≤ 4 h from "VPS unrecoverable" to serving traffic | measured by quarterly restore drills — keep the drill's actual number here honest |

Context that keeps these acceptable: most Sahay data is *deliberately short-lived*.
Losing the last hours of requests/matches/chats is losing coordination state for
exchanges that either already happened in person or can be re-requested in one minute.
The durable things that must survive are accounts, events, catalogue, reliability,
moderation/audit — all low-churn and fully covered by nightly dumps. Redis content
(queues, rate limits) is disposable by design.

## Restore-from-backup runbook

Precondition: provider account, DNS control, off-site backups + their decryption key,
and a copy of the production env file stored **separately from the VPS** (password
manager / sealed secret store — if the env file only lives on the dead VPS, the phone
ciphertexts in your backups are unreadable and login HMAC lookups break; verify this
today, not during the incident).

1. **Provision** a fresh VPS (same region/size), harden per
   [deployment.md](deployment.md), install Docker.
2. **Fetch** app images (registry) and latest DB dump; decrypt the dump.
3. **Configure**: recreate `/srv/sahay/.env` from the secure copy (same keys — do NOT
   generate new PII/HMAC keys, that orphans the data).
4. **Restore**: start postgres; `pg_restore -Fc` into a fresh `sahay` DB; run
   `db:migrate` (expect "up to date" unless the dump predates a release).
5. **Start** redis, api, worker; watch worker logs for retention ticks; check
   `/readyz`.
6. **Cut over DNS**; Caddy obtains certificates automatically once the record resolves.
7. **Verify**: login (OTP round-trip — confirms HMAC key correct), create/join event,
   request→offer→match on a test pair, dashboards, admin login + audit read.
8. **Clean up**: mass-revoking sessions is optional but cheap reassurance if the old
   host's fate is unclear; post an event notice acknowledging the gap (users may have
   lost up to RPO of messages/requests); write the post-incident report.

Drill this quarterly on staging (deployment doc, "restore drill") and record the wall-
clock time each run.
