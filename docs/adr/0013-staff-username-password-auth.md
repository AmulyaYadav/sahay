# ADR-0013: Username + password authentication for staff

## Status
Accepted (2026-07)

## Context

ADR-0012 reduced the web app to two audiences: anonymous visitors reading the
public landing page, and staff (moderators and admins) using the console.
Volunteers do everything on mobile. That left email OTP (ADR-0011) as the only
way into `/auth`, which fits it badly:

- Staff accounts are issued by the operators — someone requests one through
  the support form, we create it and send the credentials. There is no
  self-service signup to protect, so the OTP round-trip guards nothing.
- OTP costs a delivery on every single sign-in. Staff sign in far more often
  than volunteers, and a console login that depends on email deliverability
  is a console login that fails when the mail provider does.
- A shared operations mailbox receiving OTPs is a worse secret than a
  per-admin password: everyone with mailbox access can log in as anyone.

## Decision

Staff sign in with a username and password at `POST /auth/login`. The session
it returns is byte-for-byte the same kind email OTP issues — an opaque
256-bit bearer token, 60-day expiry, individually revocable — so everything
downstream of authentication is unchanged.

- **Username, not email.** A dedicated `users.username` column, unique and
  lowercased on both write and lookup. Staff email addresses stay encrypted
  behind the blind index (ADR-0011); they are contact details, not a login
  handle, and the console should not need to decrypt one to authenticate.
- **scrypt via `node:crypto`.** No new dependency for a security-critical
  primitive. Stored as `scrypt$N$r$p$salt$hash`, so the cost parameters
  travel with each record and can be raised without invalidating existing
  passwords. N=2^16 rather than OWASP's 2^17 — see the comment in
  `server/src/lib/crypto.ts` for why (memory exhaustion on one small VPS,
  ADR-0010).
- **Generated first, then chosen.** `newAdminPassword()` mints ~93 bits in four
  readable groups for delivery. `users.must_change_password` is set on creation
  and on every reset, and the authenticated-route gate
  (`PASSWORD_CHANGE_EXEMPT` in `server/src/plugins/auth.ts`) refuses everything
  except `/me`, `/auth/password`, and `/auth/logout` until the owner replaces
  it. Enforced server-side, not just in the console: the property being bought
  is that the password we sent over a channel we do not control stops working,
  and a client-side-only gate would leave it valid. Changing it also revokes
  every other session, so anyone who used the delivered password in the
  meantime is signed out. Owner-chosen passwords have a 12-character floor.
- **No enumeration oracle.** An unknown username costs a hash against a dummy
  record and returns the identical 401 body as a wrong password.
- **Rate limited fail-closed**, per username *and* per IP, on the same
  limiter email OTP uses. A username that trips the limit stays locked for
  the window even when the correct password arrives.
- **Existing admins create other admins** via `POST /admin/admins`, shown in
  the console's Staff section. The generated password appears in that
  response once and is never retrievable again.
- `users_credentials_paired` (migration 0005) enforces that `username` and
  `password_hash` are either both present or both absent, so no row can drift
  into a half-provisioned state.
- **Bootstrap is a one-shot command, not an endpoint.** No admin exists to
  authorize the first admin, so `npm run -w server db:bootstrap:admin` creates
  it from `BOOTSTRAP_ADMIN_USERNAME` / `BOOTSTRAP_ADMIN_EMAIL`, prints the
  generated password once, and is idempotent (existing username → no-op,
  success) so it is safe in a deploy script that runs every release. It is a
  command rather than a route because a permanent
  "create-the-first-admin" endpoint is a permanent way in.

Volunteers are unaffected: they have no username, so `/auth/login` cannot
authenticate them, and mobile continues to use email OTP.

## Tradeoff accepted

Passwords are a phishable, reusable, guessable secret in a way OTP codes are
not — the mitigation is that they start machine-generated and high-entropy and
that owner-chosen replacements have a length floor, not that the mechanism is
inherently safer. Staff accounts hold moderation powers, so this is the tier
that most warrants a second factor.

The forced change protects the delivery channel, not the account thereafter:
once an owner picks their own password there is no expiry, no history check
beyond "not the one you are replacing", and no strength requirement past
length. That is a deliberate stopping point for a handful of staff accounts,
and the wrong one for a large team.

## Consequences

- `/auth` on web is a username+password form. The OTP endpoints stay live for
  mobile; the web client no longer calls them.
- Losing a staff password means an admin reissues it via
  `POST /admin/admins/:id/reset-password`, which re-arms the forced change.
  There is no self-service reset, which is acceptable at operator scale and
  would not be at volunteer scale.
- An admin-initiated reset does NOT revoke the target's existing sessions —
  only the owner changing their own password does. Locking out a compromised
  staff account therefore still needs a suspension or an explicit session
  revoke, not just a reset.
- Audit entries record `admin_account_create` and the password reset without
  the password itself; the integration suite asserts that hygiene.

## Reconsider when

- Staff headcount grows past the point where hand-issuing credentials is
  reasonable, or self-service password reset starts being requested.
- A second factor becomes warranted for moderation-capable accounts — TOTP
  is the obvious next step and slots in behind the same `/auth/login` call.
- The bootstrap command stops being enough — e.g. the deployment grows past
  one machine, or first-admin creation needs an audit trail with a real actor.
