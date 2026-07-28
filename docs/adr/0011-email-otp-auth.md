# ADR-0011: Email OTP authentication (supersedes 0006)

## Status
Accepted (2026-07)

## Context

ADR-0006 chose phone-number OTP so accounts stay bound to a real SIM, making
disposable accounts and ban evasion harder in an app where abuse plays out
in person, not just online. Two operational problems surfaced before launch:

- **Cost:** per-message SMS cost via Twilio/MSG91 is a real ongoing expense.
- **Regulatory friction:** sending transactional SMS in India requires TRAI
  DLT template registration, which takes 2-3 weeks and blocks any change to
  OTP message wording.

WhatsApp OTP (Meta Cloud API) was evaluated as a phone-preserving alternative
— cheaper and not subject to TRAI/DLT — but the decision was made to
simplify further and drop phone entirely in favor of email.

## Decision

Authenticate users via email OTP. The OTP mechanics are unchanged from
ADR-0006 (6-digit code, 10 min TTL, 5 max attempts, unbiased generation,
peppered hash, constant-time compare, fixed-window rate limits per
identifier and per IP, opaque 256-bit bearer sessions, 60-day expiry,
individually revocable). Only the identifier (phone → email) and delivery
channel (SMS → Resend email API) change.

`phoneEnc`/`phoneHmac`/`phoneVerifiedAt` and `otp_codes.phone_hmac` remain in
the schema, nullable and unused, rather than being dropped — a conscious
choice to avoid a second migration if phone is reconsidered.

## Tradeoff accepted

Dropping phone-binding removes the anti-Sybil / ban-evasion property
ADR-0006 was built around. Email addresses are free and unlimited to create,
so a banned user can trivially register a new account with a new address —
this is exactly the weakness ADR-0006 explicitly rejected "email magic
links" for. This tradeoff is accepted deliberately for MVP simplicity, not
overlooked: no mitigation (disposable-domain blocking, device fingerprinting,
manual review gates) ships in this pass.

## Consequences

- Signup/login no longer requires a phone number or SMS delivery; email
  deliverability (spam filtering, provider reputation) becomes the new
  failure mode to monitor.
- Any user who was already phone-verified under the old scheme has no
  phone-based path forward — this only matters if phone-OTP had already
  shipped to real users; if not (pre-launch), no migration of existing
  accounts is needed.
- Admins, peers, and the user's own profile now see "email verified" instead
  of "phone verified" — the claim is exactly as narrow as before (an email
  round-trip happened, nothing about identity beyond that).

## Reconsider when

- Ban evasion via disposable email accounts becomes an observed real
  problem — at which point revisit phone-binding, WhatsApp OTP, or a
  lightweight Sybil deterrent (disposable-domain blocklist, rate limiting
  by device, manual review before first request/offer).
- Email deliverability or spam-filtering becomes unreliable at the
  operating scale.
