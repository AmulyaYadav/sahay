# ADR-0006: Phone-number OTP authentication

## Status
Accepted (2026-07) — explicit product decision by the owner

## Context
Sahay's abuse surface is physical: fake requests can lure people to locations; helper
inventory can be spammed; harassment happens face to face. Some real-world friction per
account is the strongest cheap deterrent. At the same time, a phone number is the single
most identifying datum the platform could hold, and Sahay's entire posture is data
minimization. These pull in opposite directions. **The product owner explicitly chose
phone verification, accepting the privacy tradeoff** in exchange for accountability and
for matching how people in the target region actually sign up for services.

## Decision
Accounts are created and authenticated solely by **phone OTP** (6 digits, 10 min TTL,
max 5 attempts, unbiased generation). Mitigations that bound the tradeoff:

- Phone stored **AES-256-GCM encrypted** (`phone_enc`, random IV per value) with a keyed
  **HMAC-SHA256 blind index** (`phone_hmac`) for lookup — plaintext never hits an index,
  a log, the API, or the admin UI (`zAdminUserView` exposes only `phoneVerified`).
- OTP codes stored as peppered hashes scoped to the phone's HMAC (`hashOtp`), compared
  in constant time; `otp/start` always returns 200 (no account enumeration) and is
  rate-limited per phone + IP (fail-closed limiter).
- Sessions are opaque 256-bit bearer tokens, **sha256-hashed at rest**, 60-day expiry,
  individually revocable.
- SMS delivery is a pluggable provider (`console` | `twilio` | `msg91`) so no vendor
  sees more than it must and dev environments send nothing.
- Encryption and HMAC keys are separate (`PII_ENCRYPTION_KEY`, `PHONE_HMAC_KEY`); the
  server refuses to start in production with the example keys.

## Alternatives considered
- **Email magic links** — weaker abuse friction (free unlimited addresses), poor fit for
  the target audience's habits.
- **Anonymous accounts + proof-of-work / invite graphs** — best privacy, but inadequate
  against motivated in-person abuse and Sybil re-registration.
- **Third-party OAuth** — hands the social graph to a platform; contradicts neutrality.
- **Device attestation** — opaque, vendor-dependent, excludes older devices.

## Consequences
- The operator + SMS provider can link an account to a phone number; users must be told
  this plainly ([privacy-and-retention.md](../privacy-and-retention.md)).
- People without personal phones are excluded ([known-limitations.md](../known-limitations.md)).
- SMS is the dominant variable cost and a congestion risk at large events.
- A DB breach alone does not yield phone numbers (keys live in env, not the DB) — but
  host compromise yields both; see [threat-model.md](../threat-model.md).

## Reconsider when
- A credible anonymous-but-abuse-resistant credential becomes practical (e.g. privacy
  pass–style attestation), SMS costs/deliverability become untenable at target events,
  or legal exposure of holding phone numbers in a deployment region outweighs the
  abuse-deterrence benefit.
