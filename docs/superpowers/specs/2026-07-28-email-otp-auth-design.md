# Email OTP Auth — Design

## Context

Sahay currently authenticates users via phone-number OTP (ADR-0006), chosen deliberately so accounts stay bound to a real SIM — making disposable accounts and ban evasion harder in an app where abuse plays out in person, not just online. Two operational problems with the current approach prompted this redesign:

1. **SMS cost** — per-message SMS cost via Twilio/MSG91 is a real ongoing expense at scale.
2. **TRAI/DLT registration** — sending transactional SMS in India requires DLT template registration, which takes 2-3 weeks and blocks any change to OTP message content.

WhatsApp OTP (Meta Cloud API, Authentication template category) was considered as a phone-preserving alternative — cheaper (~₹0.13-0.145/message) and not subject to TRAI/DLT — but the decision was made to simplify further: **drop phone entirely and authenticate via email OTP.**

This is a bigger tradeoff than a delivery-channel swap: email accounts are free and unlimited to create, so this removes the Sybil/ban-evasion resistance that phone-binding provided. That tradeoff is accepted explicitly for MVP simplicity (see "Tradeoff accepted" below), not overlooked.

## Decision

Replace phone-OTP auth with email-OTP auth, keeping the OTP generation/verification/session mechanics unchanged — only the identifier (phone → email) and delivery channel (SMS → email) change.

### Email provider

**Resend**, via its HTTP API. 3,000 free emails/month permanently, which comfortably covers login volume at Sahay's expected scale without cost. `EMAIL_PROVIDER` env var switches between `console` (dev, logs code to stdout — same pattern as today's `SMS_PROVIDER=console`) and `resend` (production).

### Data model changes

- `users` table: add `emailEnc` (AES-256-GCM, same pattern as `phoneEnc`), `emailHmac` (blind-index lookup, unique constraint, same pattern as `phoneHmac`), `emailVerifiedAt`.
- `phoneEnc`/`phoneHmac`/`phoneVerifiedAt` remain in the `users` table, nullable and unused by the new flow — kept rather than dropped, in case phone auth is reconsidered later without a schema migration.
- `otp_codes` table: add nullable `emailHmac` column alongside the existing nullable `phoneHmac` column. Exactly one of the two is populated per row (email flow populates `emailHmac`, leaves `phoneHmac` null). This avoids a new table since verify/rate-limit logic is otherwise identical.
- Rename the crypto key `PHONE_HMAC_KEY` → `IDENTITY_HMAC_KEY` (env var + code references), since it now peppers both an email blind-index and the OTP hash, and the old name would be misleading. This requires a one-time re-encryption/rotation note in the migration (existing phone data was blind-indexed with the same key value, so renaming the env var is safe — only the variable name changes, not the key value).

### Server logic changes (`server/src/modules/auth/`)

- `server/src/lib/sms.ts` deleted. New `server/src/lib/email.ts`:
  ```ts
  export interface OtpProvider {
    send(email: string, code: string, locale: 'en' | 'hi'): Promise<void>;
  }
  ```
  - `ConsoleEmailProvider` — logs code to stdout (dev default).
  - `ResendEmailProvider` — `POST https://api.resend.com/emails` with `RESEND_API_KEY`/`RESEND_FROM` from config; simple text/HTML body containing the code, subject localized via `en`/`hi` i18n catalog.
  - `getOtpProvider()` factory, switches on `EMAIL_PROVIDER` config.
- `server/src/lib/crypto.ts`: add `emailBlindIndex(email)` (HMAC-SHA256 over lowercase-trimmed email, keyed by `IDENTITY_HMAC_KEY`) alongside the renamed `phoneBlindIndex` (unchanged logic, same key).
- `service.ts`: `startOtp(email, locale, ip)` / `verifyOtp(email, code, device)` — same control flow as today (invalidate prior OTP, insert hashed+peppered code with 10 min TTL, rate-limit fail-closed at `otp:email` 3/10min and `otp:ip` 10/hour, identical response regardless of outcome, 5-attempt max with constant-time compare, session issuance unchanged). `toMe(user)` replaces `phoneVerified` with `emailVerified: user.emailVerifiedAt != null` in the API response (phone is unused, so it's no longer meaningful to expose).
- Twilio/MSG91 provider code and their env vars (`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM`, `MSG91_AUTH_KEY`, `MSG91_SENDER_ID`) are removed entirely — dead code with live API keys is a liability, and git history preserves them if ever needed again.

### Shared package (`packages/shared`)

- `schemas.ts`: `zOtpVerify`/`zOtpStart` (or equivalent) swap phone validation for email format validation (zod's built-in email check).
- No change to `LIMITS.otpLength`/`otpTtlMinutes`/`otpMaxAttempts`/`sessionTtlDays`.

### Client changes (mobile + web)

- `apps/mobile/app/auth.tsx` / `apps/web/src/pages/Auth.tsx`: phone-input step becomes an email-input step (swap E.164 regex validation for email format validation). Same two-step start→verify UX, same 429/400/401 error-code handling, same resend-cooldown pattern.
- `apps/mobile/src/auth.tsx` / web auth context/hooks: no structural change — `signIn`, `useOtpStart`/`useOtpVerify`, token storage, `/me` refresh all operate the same way regardless of identifier type.
- i18n (`packages/shared/src/i18n/en.ts` and `hi.ts`): auth-flow strings referencing phone/SMS ("Enter your phone number", "We sent a code via SMS", etc.) updated to email wording, mirrored in both locale files per the existing "keys are the contract" rule.

### Docs

New ADR `docs/adr/0011-email-otp-auth.md`, superseding ADR-0006:
- **Context**: SMS cost + TRAI/DLT registration friction motivated moving off phone/SMS.
- **Decision**: email OTP, Resend as provider, phone columns retained but unused.
- **Tradeoff accepted**: dropping phone-binding removes the anti-Sybil/ban-evasion property ADR-0006 built in. Free, unlimited email accounts mean a banned user can trivially re-register. This is accepted for MVP simplicity rather than mitigated with disposable-domain blocking, device fingerprinting, or manual review gates.
- **Reconsider when**: abuse/ban-evasion becomes an observed real problem (at which point revisit phone, WhatsApp OTP, or a lightweight Sybil deterrent like disposable-email blocking); or email deliverability/spam-filtering becomes unreliable at scale.

## Testing

- Unit tests for `emailBlindIndex`, `ResendEmailProvider` (mocked HTTP), `getOtpProvider()` factory selection.
- Auth module tests (`server/test/` — mirror existing phone-OTP test coverage) updated to use email fixtures instead of phone fixtures; same assertions for rate-limiting fail-closed behavior, attempt-limit lockout, identical-response-regardless-of-outcome, session issuance.
- `TEST_FIXED_OTP` non-production override continues to work unchanged (it pins the code value, independent of identifier type).
- E2E (Playwright, `apps/web/e2e/`) auth spec updated to drive the email input instead of phone input; `SMS_PROVIDER=console`/`EMAIL_PROVIDER=console` dev convention lets tests read the code from server stdout/logs as today.

## Non-goals

- No email fallback for a phone-primary flow (this was considered and dropped — email is now the *only* channel, not a fallback).
- No Sybil-resistance mitigations (disposable-domain blocking, fingerprinting, manual review) in this pass — explicitly deferred per the ADR's "reconsider when" trigger.
- No changes to session, reliability, matching, or any other module beyond the identifier/channel swap in auth.
