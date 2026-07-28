# Email OTP Auth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace phone-number OTP authentication with email OTP authentication across the server, shared package, web app, mobile app, and e2e suite — keeping OTP mechanics (hashing, rate limiting, session issuance) unchanged and dropping phone entirely (kept as unused nullable columns, not deleted).

**Architecture:** The OTP generation/verification/session pipeline is channel-agnostic already (hash + pepper + constant-time compare + fixed-window rate limit). This plan swaps the identifier (`phone` → `email`) and delivery provider (`SmsProvider`/Twilio/MSG91 → `OtpProvider`/Resend) at every layer, and renames `phoneVerified`/`phoneVerifiedLabel` to `emailVerified`/`emailVerifiedLabel` everywhere it's exposed to a client.

**Tech Stack:** Fastify + Drizzle + PostgreSQL (server), Resend HTTP API via native `fetch` (no new dependency), Zod schemas in `@sahay/shared`, React/Vite (web), Expo Router (mobile), Playwright (e2e), Vitest (unit/integration).

## Global Constraints

- Every user-facing string change must be mirrored in both `packages/shared/src/i18n/en.ts` and `hi.ts` — "keys are the contract" (existing i18n comment).
- Never log a plaintext email address or OTP code — mirror the existing `maskPhone`-style discipline (mask emails in any diagnostic output).
- OTP responses must remain identical regardless of whether the account exists or the rate limit tripped (no enumeration oracle) — this behavior must not regress.
- `phoneEnc`/`phoneHmac`/`phoneVerifiedAt` columns and the `otp_codes.phone_hmac` column stay in the schema, nullable and unused — do not drop them (per design decision to keep phone data for a possible future re-add).
- Hand-written SQL migrations only, filename-ordered, one transaction per file (`server/src/db/migrate.ts`) — never edit `0001_init.sql`, add a new file.
- No new runtime dependency for the Resend call — use the same raw `fetch` pattern as the existing (soon-removed) `TwilioSmsProvider`.

---

## File Structure

**Server:**
- `server/migrations/0002_email_auth.sql` — new. Adds email columns, makes `otp_codes.phone_hmac` nullable, adds `otp_codes.email_hmac`.
- `server/src/db/schema.ts` — modify: add `emailEnc`/`emailHmac`/`emailVerifiedAt` to `users`; add `emailHmac` to `otpCodes`; make `otpCodes.phoneHmac` nullable.
- `server/src/lib/crypto.ts` — modify: rename `PHONE_HMAC_KEY` references to `IDENTITY_HMAC_KEY`, add `emailBlindIndex`.
- `server/src/lib/email.ts` — new, replaces `server/src/lib/sms.ts` (deleted). `OtpProvider` interface + `ConsoleEmailProvider` + `ResendEmailProvider` + `getOtpProvider()`.
- `server/src/config.ts` — modify: env var renames/removals/additions.
- `server/src/modules/auth/service.ts` — modify: `startOtp`/`verifyOtp`/`toMe` swap phone→email.
- `server/src/modules/auth/routes.ts` — modify: pass `body.email` instead of `body.phone`.
- `server/src/modules/matches/service.ts`, `server/src/modules/admin/service.ts`, `server/src/workers/data-request.ts` — modify: `phoneVerified(Label)` → `emailVerified(Label)`.
- `server/src/db/seed-demo.ts` — modify: fake identities become emails.
- `server/test/env.ts`, `server/test/helpers.ts`, `server/test/integration/auth.test.ts` — modify.
- `server/test/unit/sms.test.ts` — deleted, replaced by `server/test/unit/email.test.ts`.

**Shared:**
- `packages/shared/src/schemas.ts` — modify: `zOtpStart`, `zOtpVerify`, `zMe`, `zPeerProfile`, `zAdminUserView`.
- `packages/shared/src/i18n/en.ts`, `hi.ts` — modify: `auth.*` and `reliability.phoneVerified` keys.

**Web:**
- `apps/web/src/pages/Auth.tsx`, `apps/web/src/api/hooks.ts`, `apps/web/src/pages/Profile.tsx`, `apps/web/src/pages/admin/AdminPage.tsx`, `apps/web/src/components/ReliabilityChips.tsx` — modify.
- `apps/web/e2e/env.ts`, `apps/web/e2e/helpers.ts`, and all 9 `apps/web/e2e/*.spec.ts` files that log in — modify.

**Mobile:**
- `apps/mobile/app/auth.tsx`, `apps/mobile/app/(tabs)/profile.tsx`, `apps/mobile/app/match/[id].tsx` — modify.
- `apps/mobile/app/settings/privacy.tsx`, `apps/mobile/app/settings/legal.tsx` — modify (i18n key references only, no logic change).

**Ops/config:**
- `.env.example`, `docker-compose.prod.yml` — modify.

**Docs:**
- `docs/adr/0011-email-otp-auth.md` — new.

---

### Task 1: Migration + Drizzle schema for email columns

**Files:**
- Create: `server/migrations/0002_email_auth.sql`
- Modify: `server/src/db/schema.ts:28-55`
- Test: `server/test/integration/schema.test.ts` (new)

**Interfaces:**
- Produces: `schema.users.emailEnc` (text, nullable), `schema.users.emailHmac` (text, nullable, unique), `schema.users.emailVerifiedAt` (timestamp, nullable), `schema.otpCodes.emailHmac` (text, nullable). `schema.otpCodes.phoneHmac` becomes nullable (was `notNull()`).

- [ ] **Step 1: Write the migration SQL**

Create `server/migrations/0002_email_auth.sql`:

```sql
-- Adds email-based identity alongside the existing (now unused) phone columns.
-- Phone columns are kept, nullable, in case phone auth is reconsidered later.

ALTER TABLE users
  ADD COLUMN email_enc text,
  ADD COLUMN email_hmac text UNIQUE,
  ADD COLUMN email_verified_at timestamptz;

ALTER TABLE otp_codes
  ADD COLUMN email_hmac text,
  ALTER COLUMN phone_hmac DROP NOT NULL;

CREATE INDEX otp_codes_email_idx ON otp_codes (email_hmac, created_at DESC);
```

- [ ] **Step 2: Update the Drizzle schema to mirror it**

In `server/src/db/schema.ts`, in the `users` table definition, add after `phoneVerifiedAt: ts('phone_verified_at'),` (line 37):

```ts
  emailEnc: text('email_enc'),
  emailHmac: text('email_hmac').unique(),
  emailVerifiedAt: ts('email_verified_at'),
```

In the `otpCodes` table definition, change `phoneHmac: text('phone_hmac').notNull(),` (line 49) to:

```ts
  phoneHmac: text('phone_hmac'),
  emailHmac: text('email_hmac'),
```

- [ ] **Step 3: Write a migration-applies test**

Create `server/test/integration/schema.test.ts`:

```ts
import '../env.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { closeDb, getDb } from '../../src/db/index.js';
import { setupTestDb } from '../helpers.js';

beforeAll(async () => {
  await setupTestDb();
});

afterAll(async () => {
  await closeDb();
});

describe('0002_email_auth migration', () => {
  it('adds nullable email columns to users and otp_codes', async () => {
    const db = getDb();
    const usersCols = await db.execute(sql`
      SELECT column_name, is_nullable FROM information_schema.columns
      WHERE table_name = 'users' AND column_name IN ('email_enc', 'email_hmac', 'email_verified_at')
    `);
    expect(usersCols.rows).toHaveLength(3);
    expect(usersCols.rows.every((r) => r.is_nullable === 'YES')).toBe(true);

    const otpCols = await db.execute(sql`
      SELECT column_name, is_nullable FROM information_schema.columns
      WHERE table_name = 'otp_codes' AND column_name IN ('phone_hmac', 'email_hmac')
    `);
    expect(otpCols.rows).toHaveLength(2);
    expect(otpCols.rows.every((r) => r.is_nullable === 'YES')).toBe(true);
  });
});
```

- [ ] **Step 4: Run the test to verify it fails before migration exists (sanity), then passes**

Run: `npm test -w server -- schema.test.ts`
Expected: PASS (the migration file from Step 1 is picked up automatically by `setupTestDb()`'s call to `runMigrations`).

If it fails with "column does not exist", re-check Step 1's SQL was saved to the exact path `server/migrations/0002_email_auth.sql` (migrations apply in filename-sorted order, `0002` must sort after `0001`).

- [ ] **Step 5: Commit**

```bash
git add server/migrations/0002_email_auth.sql server/src/db/schema.ts server/test/integration/schema.test.ts
git commit -m "feat(server): add email columns to users and otp_codes"
```

---

### Task 2: Rename identity HMAC key, add emailBlindIndex

**Files:**
- Modify: `server/src/lib/crypto.ts:36-39,61-65`
- Test: `server/test/unit/crypto.test.ts` (new, or extend if one exists)

**Interfaces:**
- Consumes: `loadConfig()` from `../config.js` (Task 3 renames the field it reads).
- Produces: `emailBlindIndex(email: string): string`, `phoneBlindIndex` (unchanged signature), `hashOtp(code: string, identityHmac: string): string` (param renamed, same behavior).

- [ ] **Step 1: Check for an existing crypto unit test**

Run: `find server/test -iname "*crypto*"`

If none exists, the failing-test step below creates one. If one exists, add the new test case to it instead of creating a duplicate file.

- [ ] **Step 2: Write the failing test**

Create (or append to) `server/test/unit/crypto.test.ts`:

```ts
import '../env.js';
import { describe, expect, it } from 'vitest';
import { emailBlindIndex, phoneBlindIndex } from '../../src/lib/crypto.js';

describe('emailBlindIndex', () => {
  it('is deterministic for the same email and differs for different emails', () => {
    const a = emailBlindIndex('person@example.com');
    const b = emailBlindIndex('person@example.com');
    const c = emailBlindIndex('other@example.com');
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it('produces a different index space than phoneBlindIndex', () => {
    // Same underlying key, different input — just confirms no accidental collision helper.
    expect(emailBlindIndex('a@b.com')).not.toBe(phoneBlindIndex('a@b.com'));
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -w server -- crypto.test.ts`
Expected: FAIL with "emailBlindIndex is not a function" (or module has no exported member).

- [ ] **Step 4: Implement**

In `server/src/lib/crypto.ts`, replace lines 36-39:

```ts
export function phoneBlindIndex(phoneE164: string): string {
  const key = Buffer.from(loadConfig().PHONE_HMAC_KEY, 'hex');
  return createHmac('sha256', key).update(phoneE164).digest('hex');
}
```

with:

```ts
export function phoneBlindIndex(phoneE164: string): string {
  const key = Buffer.from(loadConfig().IDENTITY_HMAC_KEY, 'hex');
  return createHmac('sha256', key).update(phoneE164).digest('hex');
}

export function emailBlindIndex(email: string): string {
  const key = Buffer.from(loadConfig().IDENTITY_HMAC_KEY, 'hex');
  return createHmac('sha256', key).update(email.trim().toLowerCase()).digest('hex');
}
```

Then replace `hashOtp` (lines 61-65):

```ts
export function hashOtp(code: string, phoneHmac: string): string {
  // Peppered with the HMAC key; scoped to the phone so codes can't be replayed across numbers.
  const key = Buffer.from(loadConfig().PHONE_HMAC_KEY, 'hex');
  return createHmac('sha256', key).update(`${phoneHmac}:${code}`).digest('hex');
}
```

with:

```ts
export function hashOtp(code: string, identityHmac: string): string {
  // Peppered with the HMAC key; scoped to the identity so codes can't be replayed across accounts.
  const key = Buffer.from(loadConfig().IDENTITY_HMAC_KEY, 'hex');
  return createHmac('sha256', key).update(`${identityHmac}:${code}`).digest('hex');
}
```

Also update the file's top comment (lines 1-6) — replace "Phone numbers are the only direct identifier we hold" with "Phone numbers and email addresses are the only direct identifiers we hold" (both still described as encrypted + blind-indexed the same way).

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -w server -- crypto.test.ts`
Expected: PASS. (This will fail to even load until Task 3 renames `PHONE_HMAC_KEY` → `IDENTITY_HMAC_KEY` in `config.ts` and `server/test/env.ts` — do Task 3 immediately after this one, or run both tasks' steps together if working sequentially.)

- [ ] **Step 6: Commit**

```bash
git add server/src/lib/crypto.ts server/test/unit/crypto.test.ts
git commit -m "feat(server): rename identity HMAC key, add emailBlindIndex"
```

---

### Task 3: Rename env vars, remove SMS provider config, add email provider config

**Files:**
- Modify: `server/src/config.ts:1-26`
- Modify: `.env.example`
- Modify: `docker-compose.prod.yml:39-45`
- Modify: `server/test/env.ts`
- Modify: `apps/web/e2e/env.ts:31-45`

**Interfaces:**
- Produces: `Config.IDENTITY_HMAC_KEY: string`, `Config.EMAIL_PROVIDER: 'console' | 'resend'`, `Config.RESEND_API_KEY?: string`, `Config.RESEND_FROM?: string`. Removes: `Config.PHONE_HMAC_KEY`, `Config.SMS_PROVIDER`, `Config.TWILIO_*`, `Config.MSG91_*`.

- [ ] **Step 1: Update `server/src/config.ts`**

Replace lines 9-16:

```ts
  PII_ENCRYPTION_KEY: z.string().regex(/^[0-9a-f]{64}$/, 'must be 32 bytes hex'),
  PHONE_HMAC_KEY: z.string().regex(/^[0-9a-f]{64}$/, 'must be 32 bytes hex'),
  SMS_PROVIDER: z.enum(['console', 'twilio', 'msg91']).default('console'),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_FROM: z.string().optional(),
  MSG91_AUTH_KEY: z.string().optional(),
  MSG91_SENDER_ID: z.string().optional(),
```

with:

```ts
  PII_ENCRYPTION_KEY: z.string().regex(/^[0-9a-f]{64}$/, 'must be 32 bytes hex'),
  IDENTITY_HMAC_KEY: z.string().regex(/^[0-9a-f]{64}$/, 'must be 32 bytes hex'),
  EMAIL_PROVIDER: z.enum(['console', 'resend']).default('console'),
  RESEND_API_KEY: z.string().optional(),
  RESEND_FROM: z.string().optional(),
```

Update the production guard (lines 44-52) — replace `PHONE_HMAC_KEY` with `IDENTITY_HMAC_KEY`:

```ts
    const exampleKeys = ['0'.repeat(64), '1'.repeat(64)];
    const { PII_ENCRYPTION_KEY, IDENTITY_HMAC_KEY } = parsed.data;
    if (
      exampleKeys.includes(PII_ENCRYPTION_KEY) ||
      exampleKeys.includes(IDENTITY_HMAC_KEY) ||
      PII_ENCRYPTION_KEY === IDENTITY_HMAC_KEY
    ) {
      throw new Error('Refusing to start in production with example or reused crypto keys');
    }
```

- [ ] **Step 2: Update `.env.example`**

Replace:

```
# 32-byte hex keys. Generate with: openssl rand -hex 32
# PII_ENCRYPTION_KEY encrypts phone numbers at rest (AES-256-GCM).
PII_ENCRYPTION_KEY=0000000000000000000000000000000000000000000000000000000000000000
# PHONE_HMAC_KEY builds the blind index used to look up accounts by phone.
PHONE_HMAC_KEY=1111111111111111111111111111111111111111111111111111111111111111

# SMS provider: "console" logs OTP codes to stdout (dev), "twilio" | "msg91" for production.
SMS_PROVIDER=console
# TWILIO_ACCOUNT_SID=
# TWILIO_AUTH_TOKEN=
# TWILIO_FROM=
# MSG91_AUTH_KEY=
# MSG91_SENDER_ID=
```

with:

```
# 32-byte hex keys. Generate with: openssl rand -hex 32
# PII_ENCRYPTION_KEY encrypts email addresses at rest (AES-256-GCM).
PII_ENCRYPTION_KEY=0000000000000000000000000000000000000000000000000000000000000000
# IDENTITY_HMAC_KEY builds the blind index used to look up accounts by email.
IDENTITY_HMAC_KEY=1111111111111111111111111111111111111111111111111111111111111111

# Email provider: "console" logs OTP codes to stdout (dev), "resend" for production.
EMAIL_PROVIDER=console
# RESEND_API_KEY=
# RESEND_FROM=noreply@example.org
```

- [ ] **Step 3: Update `docker-compose.prod.yml`**

Replace lines 39-45:

```yaml
      PHONE_HMAC_KEY: ${PHONE_HMAC_KEY:?}
      SMS_PROVIDER: ${SMS_PROVIDER:-console}
      TWILIO_ACCOUNT_SID: ${TWILIO_ACCOUNT_SID:-}
      TWILIO_AUTH_TOKEN: ${TWILIO_AUTH_TOKEN:-}
      TWILIO_FROM: ${TWILIO_FROM:-}
      MSG91_AUTH_KEY: ${MSG91_AUTH_KEY:-}
      MSG91_SENDER_ID: ${MSG91_SENDER_ID:-}
```

with:

```yaml
      IDENTITY_HMAC_KEY: ${IDENTITY_HMAC_KEY:?}
      EMAIL_PROVIDER: ${EMAIL_PROVIDER:-console}
      RESEND_API_KEY: ${RESEND_API_KEY:-}
      RESEND_FROM: ${RESEND_FROM:-}
```

- [ ] **Step 4: Update `server/test/env.ts`**

Replace:

```ts
process.env.PII_ENCRYPTION_KEY = 'a'.repeat(64);
process.env.PHONE_HMAC_KEY = 'b'.repeat(64);
process.env.SMS_PROVIDER = 'console';
```

with:

```ts
process.env.PII_ENCRYPTION_KEY = 'a'.repeat(64);
process.env.IDENTITY_HMAC_KEY = 'b'.repeat(64);
process.env.EMAIL_PROVIDER = 'console';
```

- [ ] **Step 5: Update `apps/web/e2e/env.ts`**

Replace lines 38-40:

```ts
  PII_ENCRYPTION_KEY: '0'.repeat(64),
  PHONE_HMAC_KEY: '1'.repeat(64),
  SMS_PROVIDER: 'console',
```

with:

```ts
  PII_ENCRYPTION_KEY: '0'.repeat(64),
  IDENTITY_HMAC_KEY: '1'.repeat(64),
  EMAIL_PROVIDER: 'console',
```

Also update the file's header comment (line 9) — replace "console SMS/push providers" with "console email/push providers".

- [ ] **Step 6: Run the server test suite to confirm config loads**

Run: `npm test -w server -- crypto.test.ts config`
Expected: PASS — this unblocks Task 2's test, which depends on this rename.

- [ ] **Step 7: Commit**

```bash
git add server/src/config.ts .env.example docker-compose.prod.yml server/test/env.ts apps/web/e2e/env.ts
git commit -m "feat(server): rename PHONE_HMAC_KEY to IDENTITY_HMAC_KEY, replace SMS config with email provider config"
```

---

### Task 4: Email OTP provider (Resend), replacing SMS provider

**Files:**
- Create: `server/src/lib/email.ts`
- Delete: `server/src/lib/sms.ts`
- Create: `server/test/unit/email.test.ts`
- Delete: `server/test/unit/sms.test.ts`

**Interfaces:**
- Consumes: `loadConfig()` (Task 3's `EMAIL_PROVIDER`/`RESEND_API_KEY`/`RESEND_FROM`).
- Produces: `OtpProvider` interface with `send(email: string, code: string, locale: 'en' | 'hi'): Promise<void>`, `getOtpProvider(): OtpProvider`, `maskEmail(email: string): string`.

- [ ] **Step 1: Write the failing test**

Create `server/test/unit/email.test.ts`:

```ts
import '../env.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resetConfigForTests } from '../../src/config.js';
import { ConsoleEmailProvider, getOtpProvider, maskEmail, ResendEmailProvider } from '../../src/lib/email.js';

afterEach(() => {
  vi.restoreAllMocks();
  process.env.EMAIL_PROVIDER = 'console';
  resetConfigForTests();
});

describe('maskEmail', () => {
  it('keeps only the first character and the domain', () => {
    expect(maskEmail('person@example.com')).toBe('p***@example.com');
    expect(maskEmail('a@b.co')).toBe('a***@b.co');
  });
});

describe('ConsoleEmailProvider', () => {
  it('never logs the full email address', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await new ConsoleEmailProvider().send('person@example.com', '123456', 'en');
    expect(spy).toHaveBeenCalledTimes(1);
    const logged = spy.mock.calls[0]!.join(' ');
    expect(logged).not.toContain('person@example.com');
    expect(logged).toContain('p***@example.com');
    expect(logged).toContain('123456');
  });
});

describe('getOtpProvider', () => {
  it('selects the provider from config', () => {
    process.env.EMAIL_PROVIDER = 'console';
    resetConfigForTests();
    expect(getOtpProvider()).toBeInstanceOf(ConsoleEmailProvider);
    process.env.EMAIL_PROVIDER = 'resend';
    resetConfigForTests();
    expect(getOtpProvider()).toBeInstanceOf(ResendEmailProvider);
  });
});

describe('ResendEmailProvider', () => {
  it('posts to the Resend API with the code in the body and throws on non-2xx', async () => {
    process.env.EMAIL_PROVIDER = 'resend';
    process.env.RESEND_API_KEY = 'test-key';
    process.env.RESEND_FROM = 'noreply@example.org';
    resetConfigForTests();

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(null, { status: 200 }),
    );
    await new ResendEmailProvider().send('person@example.com', '123456', 'en');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.resend.com/emails',
      expect.objectContaining({ method: 'POST' }),
    );
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.to).toBe('person@example.com');
    expect(body.html).toContain('123456');

    fetchMock.mockResolvedValueOnce(new Response(null, { status: 500 }));
    await expect(new ResendEmailProvider().send('person@example.com', '123456', 'en')).rejects.toThrow(
      'resend send failed',
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w server -- email.test.ts`
Expected: FAIL with "Cannot find module '../../src/lib/email.js'".

- [ ] **Step 3: Delete the old SMS provider and its test**

```bash
rm server/src/lib/sms.ts server/test/unit/sms.test.ts
```

- [ ] **Step 4: Implement `server/src/lib/email.ts`**

```ts
/**
 * Email OTP delivery abstraction. Providers receive the full email address to
 * deliver the message, but NOTHING here (or anywhere else) may ever log a full
 * email address — use maskEmail() for any diagnostics.
 */
import { loadConfig } from '../config.js';
import { t } from '@sahay/shared';

export interface OtpProvider {
  send(email: string, code: string, locale: 'en' | 'hi'): Promise<void>;
}

/** "person@example.com" → "p***@example.com" — safe for logs. */
export function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  return `${local?.[0] ?? ''}***@${domain ?? ''}`;
}

/** Development provider: prints the code with a masked address. */
export class ConsoleEmailProvider implements OtpProvider {
  async send(email: string, code: string, _locale: 'en' | 'hi'): Promise<void> {
    // eslint-disable-next-line no-console
    console.log(`[email] OTP for ${maskEmail(email)}: ${code}`);
  }
}

export class ResendEmailProvider implements OtpProvider {
  async send(email: string, code: string, locale: 'en' | 'hi'): Promise<void> {
    const config = loadConfig();
    const apiKey = config.RESEND_API_KEY;
    const from = config.RESEND_FROM;
    if (!apiKey || !from) throw new Error('resend provider not configured');
    const subject = `${t(locale, 'common.appName')} — ${code}`;
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: email,
        subject,
        html: `<p>Your ${t(locale, 'common.appName')} sign-in code is <strong>${code}</strong>.</p>`,
        text: `Your ${t(locale, 'common.appName')} sign-in code is ${code}.`,
      }),
    });
    if (!res.ok) {
      // Never include the email address (masked or not) alongside provider error bodies.
      throw new Error(`resend send failed: status ${res.status}`);
    }
  }
}

export function getOtpProvider(): OtpProvider {
  switch (loadConfig().EMAIL_PROVIDER) {
    case 'resend':
      return new ResendEmailProvider();
    default:
      return new ConsoleEmailProvider();
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -w server -- email.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/src/lib/email.ts server/test/unit/email.test.ts
git rm server/src/lib/sms.ts server/test/unit/sms.test.ts
git commit -m "feat(server): replace SMS provider with Resend email OTP provider"
```

---

### Task 5: Shared schemas — email fields replace phone fields

**Files:**
- Modify: `packages/shared/src/schemas.ts:61-93,96-104,478-487`

**Interfaces:**
- Produces: `zOtpStart` with `email` field, `zOtpVerify` with `email` field, `zMe.emailVerified`, `zPeerProfile.emailVerifiedLabel`, `zAdminUserView.emailVerified`. Removes: `zPhone`'s use in these schemas (the `zPhone` export itself is left in place — unused, matches the "keep phone plumbing" decision — but no longer referenced by auth schemas).

- [ ] **Step 1: Write the failing test**

Create `packages/shared/test/schemas.test.ts` (or find/extend an existing shared test dir — run `find packages/shared -iname "*.test.ts"` first to check):

```ts
import { describe, expect, it } from 'vitest';
import { zOtpStart, zOtpVerify, zMe } from '../src/schemas.js';

describe('email auth schemas', () => {
  it('zOtpStart requires a valid email, rejects phone-shaped strings', () => {
    expect(zOtpStart.safeParse({ email: 'person@example.com', locale: 'en' }).success).toBe(true);
    expect(zOtpStart.safeParse({ email: '+919876543210', locale: 'en' }).success).toBe(false);
  });

  it('zOtpVerify requires email + 6-digit code', () => {
    const result = zOtpVerify.safeParse({
      email: 'person@example.com',
      code: '123456',
      device: { platform: 'web' },
    });
    expect(result.success).toBe(true);
  });

  it('zMe exposes emailVerified, not phoneVerified', () => {
    expect(zMe.shape).toHaveProperty('emailVerified');
    expect(zMe.shape).not.toHaveProperty('phoneVerified');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w packages/shared -- schemas.test.ts`
Expected: FAIL (email field doesn't exist yet on `zOtpStart`; `zMe.shape.phoneVerified` still present).

- [ ] **Step 3: Implement — replace the auth-related schema fields**

In `packages/shared/src/schemas.ts`, replace lines 61-72:

```ts
export const zOtpStart = z.object({
  phone: zPhone,
  locale: zLocale.default('en'),
});
export const zOtpVerify = z.object({
  phone: zPhone,
  code: z.string().length(LIMITS.otpLength).regex(/^\d+$/),
  device: z.object({
    platform: z.enum(['ios', 'android', 'web']),
    name: z.string().max(60).optional(),
  }),
});
```

with:

```ts
export const zOtpStart = z.object({
  email: z.string().email(),
  locale: zLocale.default('en'),
});
export const zOtpVerify = z.object({
  email: z.string().email(),
  code: z.string().length(LIMITS.otpLength).regex(/^\d+$/),
  device: z.object({
    platform: z.enum(['ios', 'android', 'web']),
    name: z.string().max(60).optional(),
  }),
});
```

Replace line 90 (`phoneVerified: z.boolean(),` inside `zMe`) with:

```ts
  emailVerified: z.boolean(),
```

Replace line 102 (`phoneVerifiedLabel: z.boolean(), // "Phone verified" — states exactly what was verified` inside `zPeerProfile`) with:

```ts
  emailVerifiedLabel: z.boolean(), // "Email verified" — states exactly what was verified
```

Replace line 484 (`phoneVerified: z.boolean(), // NOT the phone number — admins never see it` inside `zAdminUserView`) with:

```ts
  emailVerified: z.boolean(), // NOT the email address — admins never see it
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w packages/shared -- schemas.test.ts`
Expected: PASS.

- [ ] **Step 5: Rebuild the shared package so consumers pick up the new types**

Run: `npm run build -w packages/shared`
Expected: exits 0.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/schemas.ts packages/shared/test/schemas.test.ts
git commit -m "feat(shared): replace phone fields with email in auth schemas"
```

---

### Task 6: Shared i18n — auth and reliability strings

**Files:**
- Modify: `packages/shared/src/i18n/en.ts:27-38,186`
- Modify: `packages/shared/src/i18n/hi.ts:29-40,188`

**Interfaces:**
- Produces: `auth.emailLabel`, `auth.emailWhy`, `reliability.emailVerified` (renamed from `auth.phoneLabel`, `auth.phoneWhy`, `reliability.phoneVerified`) in both locale files. All other `auth.*` keys (`sendCode`, `codeLabel`, `verify`, `resend`, `invalidCode`, `tooManyAttempts`, `welcome`, `logout`) are unchanged.

- [ ] **Step 1: Update `packages/shared/src/i18n/en.ts`**

Replace lines 28-29:

```ts
    phoneLabel: 'Phone number',
    phoneWhy: 'Your number is used only to verify your account. It is stored encrypted and is never shown to anyone.',
```

with:

```ts
    emailLabel: 'Email address',
    emailWhy: 'Your email is used only to verify your account. It is stored encrypted and is never shown to anyone.',
```

Replace line 186 (inside the `reliability` block — run `grep -n "phoneVerified" packages/shared/src/i18n/en.ts` to confirm the exact line before editing, in case earlier edits shifted it):

```ts
    phoneVerified: 'Phone verified',
```

with:

```ts
    emailVerified: 'Email verified',
```

- [ ] **Step 2: Update `packages/shared/src/i18n/hi.ts`**

Replace lines 30-31:

```ts
    phoneLabel: 'फ़ोन नंबर',
    phoneWhy: 'आपका नंबर केवल खाता सत्यापित करने के लिए है। यह एन्क्रिप्ट करके रखा जाता है और किसी को नहीं दिखाया जाता।',
```

with:

```ts
    emailLabel: 'ईमेल पता',
    emailWhy: 'आपका ईमेल केवल खाता सत्यापित करने के लिए है। यह एन्क्रिप्ट करके रखा जाता है और किसी को नहीं दिखाया जाता।',
```

Replace line 188 (confirm exact line via `grep -n "phoneVerified" packages/shared/src/i18n/hi.ts` first):

```ts
    phoneVerified: 'फ़ोन सत्यापित',
```

with:

```ts
    emailVerified: 'ईमेल सत्यापित',
```

- [ ] **Step 3: Write a test asserting key parity between locales**

Check first whether such a parity test already exists: `grep -rln "Object.keys" packages/shared/test 2>/dev/null`. If none exists, create `packages/shared/test/i18n.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import en from '../src/i18n/en.js';
import hi from '../src/i18n/hi.js';

function flatten(obj: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    typeof v === 'object' && v !== null ? flatten(v as Record<string, unknown>, `${prefix}${k}.`) : [`${prefix}${k}`],
  );
}

describe('i18n key parity', () => {
  it('en and hi expose exactly the same keys', () => {
    const enKeys = flatten(en as Record<string, unknown>).sort();
    const hiKeys = flatten(hi as Record<string, unknown>).sort();
    expect(hiKeys).toEqual(enKeys);
  });

  it('has no leftover phone-labelled auth/reliability keys', () => {
    const enKeys = flatten(en as Record<string, unknown>);
    expect(enKeys).toContain('auth.emailLabel');
    expect(enKeys).toContain('auth.emailWhy');
    expect(enKeys).toContain('reliability.emailVerified');
    expect(enKeys).not.toContain('auth.phoneLabel');
    expect(enKeys).not.toContain('reliability.phoneVerified');
  });
});
```

- [ ] **Step 4: Run the test**

Run: `npm test -w packages/shared -- i18n.test.ts`
Expected: PASS. If it fails on key parity, check for a typo in one of the two locale files' key names — a mismatched key is the most common cause.

- [ ] **Step 5: Rebuild shared**

Run: `npm run build -w packages/shared`

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/i18n/en.ts packages/shared/src/i18n/hi.ts packages/shared/test/i18n.test.ts
git commit -m "feat(shared): rename phone i18n keys to email in en/hi"
```

---

### Task 7: Server auth service and routes — email OTP flow

**Files:**
- Modify: `server/src/modules/auth/service.ts` (full rewrite of `toMe`, `startOtp`, `verifyOtp`)
- Modify: `server/src/modules/auth/routes.ts:8-16`

**Interfaces:**
- Consumes: `emailBlindIndex` (Task 2), `getOtpProvider` (Task 4), `zOtpStart`/`zOtpVerify` with `email` field (Task 5), `schema.users.emailEnc/emailHmac/emailVerifiedAt`, `schema.otpCodes.emailHmac` (Task 1).
- Produces: `startOtp(email: string, locale: Locale, ip: string)`, `verifyOtp(email: string, code: string, device): Promise<AuthSession>` (same return shape as before, `toMe` now sets `emailVerified`).

- [ ] **Step 1: Write the failing test (extends Task 9's integration test — write it here first since it drives this task)**

This task's correctness is verified by `server/test/integration/auth.test.ts`, which Task 9 rewrites. To keep this task self-contained, write a minimal smoke test now:

Create `server/test/unit/auth-service.test.ts`:

```ts
import '../env.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeDb } from '../../src/db/index.js';
import { closeRedis } from '../../src/lib/redis.js';
import { setupTestDb, truncateAll } from '../helpers.js';
import { startOtp, verifyOtp } from '../../src/modules/auth/service.js';

beforeAll(async () => {
  await setupTestDb();
});
afterAll(async () => {
  await closeDb();
  await closeRedis();
});
beforeEach(async () => {
  await truncateAll();
  vi.restoreAllMocks();
});

function captureOtp(): string {
  const spy = vi.spyOn(console, 'log');
  const calls = spy.mock.calls.map((c) => c.join(' '));
  const line = calls.find((l) => /OTP for .*: \d{6}/.test(l));
  const match = line?.match(/: (\d{6})$/);
  if (!match) throw new Error('no OTP logged');
  return match[1]!;
}

describe('email OTP service', () => {
  it('signs up a new account with an email and marks it emailVerified', async () => {
    const spy = vi.spyOn(console, 'log');
    await startOtp('newperson@example.com', 'en', '127.0.0.1');
    const code = (() => {
      const line = spy.mock.calls.map((c) => c.join(' ')).find((l) => /OTP for .*: \d{6}/.test(l));
      return line!.match(/: (\d{6})$/)![1]!;
    })();
    const session = await verifyOtp('newperson@example.com', code, { platform: 'web' });
    expect(session.isNewAccount).toBe(true);
    expect(session.user.emailVerified).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w server -- auth-service.test.ts`
Expected: FAIL (`startOtp` still expects a phone shape / `toMe` still returns `phoneVerified`).

- [ ] **Step 3: Implement — rewrite `server/src/modules/auth/service.ts`**

Replace the full file contents with:

```ts
/**
 * OTP authentication. Email addresses exist here only in transit: they are
 * turned into a blind index (HMAC) for lookup and AES-GCM ciphertext for
 * storage. Neither the email nor the OTP code is ever logged.
 */
import { randomInt } from 'node:crypto';
import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import { LIMITS, pseudonymFromIndexes, t, type AuthSession, type Locale, type Me } from '@sahay/shared';
import { loadConfig } from '../../config.js';
import { getDb, schema, type Db, type Tx } from '../../db/index.js';
import {
  emailBlindIndex,
  encryptPii,
  hashOtp,
  newOtpCode,
  newSessionToken,
  safeEqualHex,
} from '../../lib/crypto.js';
import { errors } from '../../lib/errors.js';
import { rateLimit } from '../../lib/redis.js';
import { getOtpProvider } from '../../lib/email.js';

const OTP_RETRY_AFTER_SECONDS = 60;

export function randomPseudonym(): string {
  return pseudonymFromIndexes(randomInt(1024), randomInt(1024));
}

export function toMe(user: typeof schema.users.$inferSelect): Me {
  return {
    id: user.id,
    pseudonym: user.pseudonym,
    avatarSeed: user.avatarSeed,
    locale: user.locale === 'hi' ? 'hi' : 'en',
    role: user.role as Me['role'],
    status: user.status as Me['status'],
    emailVerified: user.emailVerifiedAt != null,
    createdAt: user.createdAt.toISOString(),
  };
}

/**
 * Always resolves to the same "sent" response regardless of whether the email
 * has an account or the rate limit tripped — no enumeration, no oracle.
 */
export async function startOtp(
  email: string,
  locale: Locale,
  ip: string,
): Promise<{ ok: true; retryAfterSeconds: number }> {
  const emailHmac = emailBlindIndex(email);
  // Fail CLOSED: any Redis error counts as "denied".
  const emailOk = await rateLimit('otp:email', emailHmac, 3, 600).catch(() => false);
  const ipOk = await rateLimit('otp:ip', ip, 10, 3600).catch(() => false);
  if (!emailOk || !ipOk) return { ok: true, retryAfterSeconds: OTP_RETRY_AFTER_SECONDS };

  const db = getDb();
  // TEST_FIXED_OTP (non-production only, see config.ts) pins the code for e2e/load
  // tests; hashing, storage, and verification are identical either way.
  const code = loadConfig().TEST_FIXED_OTP ?? newOtpCode(LIMITS.otpLength);
  await db.transaction(async (tx) => {
    await tx
      .update(schema.otpCodes)
      .set({ consumedAt: new Date() })
      .where(and(eq(schema.otpCodes.emailHmac, emailHmac), isNull(schema.otpCodes.consumedAt)));
    await tx.insert(schema.otpCodes).values({
      emailHmac,
      codeHash: hashOtp(code, emailHmac),
      expiresAt: new Date(Date.now() + LIMITS.otpTtlMinutes * 60_000),
    });
  });

  try {
    await getOtpProvider().send(email, code, locale);
  } catch {
    // Swallow provider failures: the response must not reveal delivery state.
  }
  return { ok: true, retryAfterSeconds: OTP_RETRY_AFTER_SECONDS };
}

async function isSignupOpen(db: Db | Tx): Promise<boolean> {
  const [flag] = await db
    .select({ enabled: schema.featureFlags.enabled })
    .from(schema.featureFlags)
    .where(eq(schema.featureFlags.key, 'signup_open'))
    .limit(1);
  return flag ? flag.enabled : true; // missing flag = open (migration seeds it enabled)
}

export async function verifyOtp(
  email: string,
  code: string,
  device: { platform: 'ios' | 'android' | 'web'; name?: string },
): Promise<AuthSession> {
  const db = getDb();
  const emailHmac = emailBlindIndex(email);

  const [otp] = await db
    .select()
    .from(schema.otpCodes)
    .where(
      and(
        eq(schema.otpCodes.emailHmac, emailHmac),
        isNull(schema.otpCodes.consumedAt),
        gt(schema.otpCodes.expiresAt, sql`now()`),
      ),
    )
    .orderBy(desc(schema.otpCodes.createdAt))
    .limit(1);
  if (!otp) throw errors.unauthorized();

  const [bumped] = await db
    .update(schema.otpCodes)
    .set({ attempts: sql`${schema.otpCodes.attempts} + 1` })
    .where(eq(schema.otpCodes.id, otp.id))
    .returning({ attempts: schema.otpCodes.attempts });
  const attempts = bumped?.attempts ?? otp.attempts + 1;

  if (!safeEqualHex(hashOtp(code, emailHmac), otp.codeHash)) {
    if (attempts >= LIMITS.otpMaxAttempts) {
      await db
        .update(schema.otpCodes)
        .set({ consumedAt: new Date() })
        .where(eq(schema.otpCodes.id, otp.id));
      throw errors.rateLimited();
    }
    throw errors.unauthorized();
  }
  if (attempts > LIMITS.otpMaxAttempts) throw errors.rateLimited();

  const { user, isNewAccount } = await db.transaction(async (tx) => {
    await tx
      .update(schema.otpCodes)
      .set({ consumedAt: new Date() })
      .where(eq(schema.otpCodes.id, otp.id));

    const [existing] = await tx
      .select()
      .from(schema.users)
      .where(eq(schema.users.emailHmac, emailHmac))
      .limit(1);

    if (existing && existing.status !== 'deleted' && !existing.deletedAt) {
      return { user: existing, isNewAccount: false };
    }
    if (existing) {
      // Deleted account: detach the email so a fresh account can claim it.
      await tx
        .update(schema.users)
        .set({ emailHmac: null, emailEnc: null })
        .where(eq(schema.users.id, existing.id));
    }

    if (!(await isSignupOpen(tx))) throw errors.forbidden();

    const pseudonym = randomPseudonym();
    const [created] = await tx
      .insert(schema.users)
      .values({
        pseudonym,
        avatarSeed: pseudonym,
        emailEnc: encryptPii(email),
        emailHmac,
        emailVerifiedAt: new Date(),
      })
      .returning();
    if (!created) throw new Error('user insert returned no row');
    await tx.insert(schema.reliabilityStats).values({ userId: created.id }).onConflictDoNothing();
    return { user: created, isNewAccount: true };
  });

  const { token, tokenHash } = newSessionToken();
  const expiresAt = new Date(Date.now() + LIMITS.sessionTtlDays * 24 * 3600_000);
  await db.insert(schema.sessions).values({
    userId: user.id,
    tokenHash,
    platform: device.platform,
    deviceName: device.name ?? null,
    expiresAt,
  });

  return { token, expiresAt: expiresAt.toISOString(), user: toMe(user), isNewAccount };
}

export async function revokeSession(userId: string, sessionId: string): Promise<boolean> {
  const db = getDb();
  const rows = await db
    .update(schema.sessions)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(schema.sessions.id, sessionId),
        eq(schema.sessions.userId, userId),
        isNull(schema.sessions.revokedAt),
      ),
    )
    .returning({ id: schema.sessions.id });
  return rows.length > 0;
}

export async function listSessions(userId: string, currentSessionId: string) {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.sessions)
    .where(
      and(
        eq(schema.sessions.userId, userId),
        isNull(schema.sessions.revokedAt),
        gt(schema.sessions.expiresAt, sql`now()`),
      ),
    )
    .orderBy(desc(schema.sessions.lastSeenAt));
  return rows.map((s) => ({
    id: s.id,
    current: s.id === currentSessionId,
    platform: s.platform,
    deviceName: s.deviceName,
    createdAt: s.createdAt.toISOString(),
    lastSeenAt: s.lastSeenAt.toISOString(),
  }));
}
```

Note: `t` is still imported from `@sahay/shared` above but is now unused in this file (it moved into `email.ts`) — remove it from the import line if your editor/linter flags it as unused: the import list should read `LIMITS, pseudonymFromIndexes, type AuthSession, type Locale, type Me`.

- [ ] **Step 4: Update `server/src/modules/auth/routes.ts`**

Replace lines 9-16:

```ts
  app.post('/auth/otp/start', async (req) => {
    const body = zOtpStart.parse(req.body);
    return startOtp(body.phone, body.locale, req.ip);
  });

  app.post('/auth/otp/verify', async (req) => {
    const body = zOtpVerify.parse(req.body);
    return verifyOtp(body.phone, body.code, body.device);
  });
```

with:

```ts
  app.post('/auth/otp/start', async (req) => {
    const body = zOtpStart.parse(req.body);
    return startOtp(body.email, body.locale, req.ip);
  });

  app.post('/auth/otp/verify', async (req) => {
    const body = zOtpVerify.parse(req.body);
    return verifyOtp(body.email, body.code, body.device);
  });
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -w server -- auth-service.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/src/modules/auth/service.ts server/src/modules/auth/routes.ts server/test/unit/auth-service.test.ts
git commit -m "feat(server): switch auth service and routes to email OTP"
```

---

### Task 8: Rename phoneVerified(Label) in matches, admin, and data-export

**Files:**
- Modify: `server/src/modules/matches/service.ts:145`
- Modify: `server/src/modules/admin/service.ts:413`
- Modify: `server/src/workers/data-request.ts:104`

**Interfaces:**
- Consumes: `zPeerProfile.emailVerifiedLabel`, `zAdminUserView.emailVerified` (Task 5), `schema.users.emailVerifiedAt` (Task 1).

- [ ] **Step 1: Write the failing test**

Check for existing tests covering these three call sites: `grep -rl "phoneVerified\|matches/service\|admin/service\|data-request" server/test/integration/*.test.ts`. If tests already exist for matches/admin/data-export flows, add an assertion to each for the renamed field instead of writing new files. If none exist, create `server/test/unit/rename-smoke.test.ts`:

```ts
import '../env.js';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('phoneVerified rename is complete', () => {
  it('no server module still emits phoneVerified/phoneVerifiedLabel', () => {
    const files = [
      'src/modules/matches/service.ts',
      'src/modules/admin/service.ts',
      'src/workers/data-request.ts',
    ];
    for (const f of files) {
      const content = readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8');
      expect(content).not.toMatch(/phoneVerified(Label)?:/);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w server -- rename-smoke.test.ts`
Expected: FAIL (all three files still contain `phoneVerified`/`phoneVerifiedLabel`).

- [ ] **Step 3: Implement the three renames**

In `server/src/modules/matches/service.ts`, replace line 145:

```ts
      phoneVerifiedLabel: peerUser.phoneVerifiedAt != null,
```

with:

```ts
      emailVerifiedLabel: peerUser.emailVerifiedAt != null,
```

In `server/src/modules/admin/service.ts`, replace line 413:

```ts
    phoneVerified: r.user.phoneVerifiedAt != null, // never the number
```

with:

```ts
    emailVerified: r.user.emailVerifiedAt != null, // never the address
```

In `server/src/workers/data-request.ts`, replace line 104:

```ts
      phoneVerified: user.phoneVerifiedAt != null, // never the number itself
```

with:

```ts
      emailVerified: user.emailVerifiedAt != null, // never the address itself
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w server -- rename-smoke.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/modules/matches/service.ts server/src/modules/admin/service.ts server/src/workers/data-request.ts server/test/unit/rename-smoke.test.ts
git commit -m "feat(server): rename phoneVerified(Label) to emailVerified(Label)"
```

---

### Task 9: Server test helpers and integration auth test — email fixtures

**Files:**
- Modify: `server/test/helpers.ts:40-60,74-83`
- Modify: `server/test/integration/auth.test.ts` (full rewrite)

**Interfaces:**
- Produces: `randomEmail(): string` (replaces `randomPhone`), `makeUser(overrides)` now defaults `emailHmac`/`emailVerifiedAt` instead of `phoneHmac`/`phoneVerifiedAt`.

- [ ] **Step 1: Update `server/test/helpers.ts`**

Replace lines 40-42:

```ts
export function randomPhone(): string {
  return `+9198${String(10000000 + Math.floor(Math.random() * 89999999))}`;
}
```

with:

```ts
export function randomEmail(): string {
  return `test-${randomBytes(6).toString('hex')}@example.com`;
}
```

Replace lines 44-60 (`makeUser`):

```ts
export async function makeUser(
  overrides: Partial<typeof schema.users.$inferInsert> = {},
): Promise<typeof schema.users.$inferSelect> {
  const db = getDb();
  const [user] = await db
    .insert(schema.users)
    .values({
      pseudonym: 'Blue Sparrow',
      avatarSeed: 'Blue Sparrow',
      phoneHmac: overrides.phoneHmac ?? phoneBlindIndex(randomPhone()),
      phoneVerifiedAt: new Date(),
      ...overrides,
    })
    .returning();
  await db.insert(schema.reliabilityStats).values({ userId: user!.id }).onConflictDoNothing();
  return user!;
}
```

with:

```ts
export async function makeUser(
  overrides: Partial<typeof schema.users.$inferInsert> = {},
): Promise<typeof schema.users.$inferSelect> {
  const db = getDb();
  const [user] = await db
    .insert(schema.users)
    .values({
      pseudonym: 'Blue Sparrow',
      avatarSeed: 'Blue Sparrow',
      emailHmac: overrides.emailHmac ?? emailBlindIndex(randomEmail()),
      emailVerifiedAt: new Date(),
      ...overrides,
    })
    .returning();
  await db.insert(schema.reliabilityStats).values({ userId: user!.id }).onConflictDoNothing();
  return user!;
}
```

Update the import on line 13 — replace:

```ts
import { newSessionToken, phoneBlindIndex, shortCode } from '../src/lib/crypto.js';
```

with:

```ts
import { emailBlindIndex, newSessionToken, shortCode } from '../src/lib/crypto.js';
```

(`shortCode` is used elsewhere in this file for event invite codes — keep it. If `shortCode` turns out to be unused after this edit, run `grep -n shortCode server/test/helpers.ts` to confirm before removing it; do not remove it speculatively.)

- [ ] **Step 2: Rewrite `server/test/integration/auth.test.ts`**

Replace the full file contents with:

```ts
import '../env.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { closeDb } from '../../src/db/index.js';
import { closeRedis } from '../../src/lib/redis.js';
import { closeQueues } from '../../src/queues.js';
import { authHeaders, randomEmail, setupTestDb, truncateAll } from '../helpers.js';

let app: FastifyInstance;

beforeAll(async () => {
  await setupTestDb();
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  if (app) await app.close();
  await closeQueues();
  await closeRedis();
  await closeDb();
});

beforeEach(async () => {
  await truncateAll();
  vi.restoreAllMocks();
});

/** The console email provider logs the OTP; steal it from there like a dev would. */
function captureOtp(): { code: () => string } {
  const spy = vi.spyOn(console, 'log');
  return {
    code: () => {
      const lines = spy.mock.calls.map((c) => c.join(' ')).filter((l) => /OTP for .*: \d{6}/.test(l));
      const line = lines[lines.length - 1];
      const match = line?.match(/: (\d{6})$/);
      if (!match) throw new Error('no OTP logged');
      return match[1]!;
    },
  };
}

async function signup(email: string) {
  const otp = captureOtp();
  const start = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/otp/start',
    payload: { email, locale: 'en' },
  });
  expect(start.statusCode).toBe(200);
  const verify = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/otp/verify',
    payload: { email, code: otp.code(), device: { platform: 'web', name: 'test' } },
  });
  return verify;
}

describe('OTP auth flow', () => {
  it('signs up a new account end to end', async () => {
    const email = randomEmail();
    const res = await signup(email);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.isNewAccount).toBe(true);
    expect(body.token).toBeTruthy();
    expect(body.user.pseudonym).toMatch(/^\w+ \w+$/);
    expect(body.user.emailVerified).toBe(true);
    // The email address must never appear in any response.
    expect(res.body).not.toContain(email);

    const me = await app.inject({ url: '/api/v1/me', headers: authHeaders(body.token) });
    expect(me.statusCode).toBe(200);
    expect(me.json().id).toBe(body.user.id);
  });

  it('start responds identically whether or not the account exists', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/otp/start',
      payload: { email: randomEmail(), locale: 'en' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, retryAfterSeconds: 60 });
  });

  it('signs an existing user back in (isNewAccount=false, same user)', async () => {
    const email = randomEmail();
    const first = await signup(email);
    const second = await signup(email);
    expect(second.statusCode).toBe(200);
    expect(second.json().isNewAccount).toBe(false);
    expect(second.json().user.id).toBe(first.json().user.id);
  });

  it('rejects wrong codes and rate-limits after 5 attempts, consuming the code', async () => {
    const email = randomEmail();
    const otp = captureOtp();
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/otp/start',
      payload: { email, locale: 'en' },
    });
    const realCode = otp.code();
    const wrongCode = realCode === '000000' ? '000001' : '000000';
    const attempt = (code: string) =>
      app.inject({
        method: 'POST',
        url: '/api/v1/auth/otp/verify',
        payload: { email, code, device: { platform: 'web' } },
      });

    for (let i = 0; i < 4; i++) {
      const res = await attempt(wrongCode);
      expect(res.statusCode).toBe(401);
    }
    const fifth = await attempt(wrongCode);
    expect(fifth.statusCode).toBe(429);
    expect(fifth.json().error.code).toBe('rate_limited');

    // Code was consumed by the lockout — even the real code no longer works.
    const real = await attempt(realCode);
    expect(real.statusCode).toBe(401);
  });

  it('lists and revokes sessions', async () => {
    const email = randomEmail();
    const s1 = (await signup(email)).json();
    const s2 = (await signup(email)).json();

    const list = await app.inject({ url: '/api/v1/auth/sessions', headers: authHeaders(s2.token) });
    expect(list.statusCode).toBe(200);
    const sessions = list.json();
    expect(sessions).toHaveLength(2);
    expect(sessions.filter((s: { current: boolean }) => s.current)).toHaveLength(1);

    const otherId = sessions.find((s: { current: boolean }) => !s.current).id;
    const del = await app.inject({
      method: 'DELETE',
      url: `/api/v1/auth/sessions/${otherId}`,
      headers: authHeaders(s2.token),
    });
    expect(del.statusCode).toBe(200);

    // The revoked session's token no longer authenticates.
    const me = await app.inject({ url: '/api/v1/me', headers: authHeaders(s1.token) });
    expect(me.statusCode).toBe(401);
  });

  it('logout revokes the current session', async () => {
    const s = (await signup(randomEmail())).json();
    const out = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: authHeaders(s.token),
    });
    expect(out.statusCode).toBe(200);
    const me = await app.inject({ url: '/api/v1/me', headers: authHeaders(s.token) });
    expect(me.statusCode).toBe(401);
  });
});
```

- [ ] **Step 3: Run the full server test suite**

Run: `npm test -w server`
Expected: PASS across all server test files, including `auth.test.ts`, `crypto.test.ts`, `email.test.ts`, `schema.test.ts`, `auth-service.test.ts`, `rename-smoke.test.ts`. Any other integration test that calls `makeUser`/`makeAuthedUser`/`randomPhone` will fail to compile — grep for remaining `randomPhone` usages across `server/test/` and update each call site to `randomEmail()` before re-running.

Run: `grep -rn "randomPhone" server/test/`
Expected after fixes: no output.

- [ ] **Step 4: Commit**

```bash
git add server/test/helpers.ts server/test/integration/auth.test.ts
git commit -m "test(server): switch auth fixtures and integration tests to email"
```

---

### Task 10: Demo seed data — emails instead of phones

**Files:**
- Modify: `server/src/db/seed-demo.ts:1-52,130-155` (exact line numbers for the demo-user list may differ; use `grep -n "phone:" server/src/db/seed-demo.ts` to find every literal to update)

**Interfaces:**
- Consumes: `emailBlindIndex` (Task 2).

- [ ] **Step 1: Update the header comment and imports**

Replace lines 4-7:

```
 * Everything is inserted directly (no API calls); phone numbers come from the
 * reserved-looking +9155xxxxxxxx fake range and are stored exactly like real
 * ones (AES-GCM ciphertext + blind index) so the OTP login flow works against
 * them with the console SMS provider.
```

with:

```
 * Everything is inserted directly (no API calls); email addresses come from a
 * reserved-looking @demo.sahay.local range and are stored exactly like real
 * ones (AES-GCM ciphertext + blind index) so the OTP login flow works against
 * them with the console email provider.
```

Replace line 9-10:

```
 *   npm run db:seed:demo   (then: POST /auth/otp/start — the OTP prints to the
 *   server console; any listed demo number logs into that account.)
```

with:

```
 *   npm run db:seed:demo   (then: POST /auth/otp/start — the OTP prints to the
 *   server console; any listed demo email logs into that account.)
```

Replace line 21:

```ts
import { encryptPii, phoneBlindIndex, shortCode } from '../lib/crypto.js';
```

with:

```ts
import { emailBlindIndex, encryptPii, shortCode } from '../lib/crypto.js';
```

- [ ] **Step 2: Update the `makeUser` helper (lines 28-52)**

Replace:

```ts
async function makeUser(
  db: Db,
  opts: {
    pseudonym: string;
    phone: string;
    role?: string;
    createdDaysAgo?: number;
    stats?: Partial<typeof schema.reliabilityStats.$inferInsert>;
  },
) {
  const [user] = await db
    .insert(schema.users)
    .values({
      pseudonym: opts.pseudonym,
      avatarSeed: opts.pseudonym,
      role: opts.role ?? 'user',
      phoneEnc: encryptPii(opts.phone),
      phoneHmac: phoneBlindIndex(opts.phone),
      phoneVerifiedAt: new Date(),
      createdAt: new Date(Date.now() - (opts.createdDaysAgo ?? 1) * DAY),
    })
    .returning();
  await db.insert(schema.reliabilityStats).values({ userId: user!.id, ...(opts.stats ?? {}) });
  return user!;
}
```

with:

```ts
async function makeUser(
  db: Db,
  opts: {
    pseudonym: string;
    email: string;
    role?: string;
    createdDaysAgo?: number;
    stats?: Partial<typeof schema.reliabilityStats.$inferInsert>;
  },
) {
  const [user] = await db
    .insert(schema.users)
    .values({
      pseudonym: opts.pseudonym,
      avatarSeed: opts.pseudonym,
      role: opts.role ?? 'user',
      emailEnc: encryptPii(opts.email),
      emailHmac: emailBlindIndex(opts.email),
      emailVerifiedAt: new Date(),
      createdAt: new Date(Date.now() - (opts.createdDaysAgo ?? 1) * DAY),
    })
    .returning();
  await db.insert(schema.reliabilityStats).values({ userId: user!.id, ...(opts.stats ?? {}) });
  return user!;
}
```

- [ ] **Step 3: Update every call site passing `phone:`**

Run: `grep -n "phone:" server/src/db/seed-demo.ts`

For each match (the report gathered during planning shows at least three: `'Demo Admin'`/`+915500000001`, `'Demo Lantern'`/`+915500000002`, and a loop generating `+91550000${1000 + i}`), replace the `phone:` key with `email:` and change the fake value to an `@demo.sahay.local` address, e.g.:

```ts
{ pseudonym: 'Demo Admin', email: 'demo-admin@demo.sahay.local', role: 'admin', createdDaysAgo: 90 },
{ pseudonym: 'Demo Lantern', email: 'demo-lantern@demo.sahay.local', role: 'moderator', createdDaysAgo: 60 },
```

and for the loop-generated one:

```ts
        email: `demo-user-${i}@demo.sahay.local`,
```

- [ ] **Step 4: Manually verify the seed runs**

Run: `npm run db:seed:demo -w server` (against a local/dev database)
Expected: exits 0, logs demo account creation without errors. This script has no automated test in the plan (it's a manual dev tool) — running it once is the verification step.

- [ ] **Step 5: Commit**

```bash
git add server/src/db/seed-demo.ts
git commit -m "feat(server): switch demo seed data from phone to email identities"
```

---

### Task 11: Web app — Auth page, hooks, profile, admin, reliability chips

**Files:**
- Modify: `apps/web/src/pages/Auth.tsx`
- Modify: `apps/web/src/api/hooks.ts:57-69`
- Modify: `apps/web/src/pages/Profile.tsx:33`
- Modify: `apps/web/src/pages/admin/AdminPage.tsx:163`
- Modify: `apps/web/src/components/ReliabilityChips.tsx:19-27`

**Interfaces:**
- Consumes: `zOtpStart`/`zOtpVerify` with `email` (Task 5), `Me.emailVerified`, `PeerProfile.emailVerifiedLabel` (Task 5), `t('auth.emailLabel')`/`t('auth.emailWhy')`/`t('reliability.emailVerified')` (Task 6).

- [ ] **Step 1: Update `apps/web/src/api/hooks.ts`**

Replace lines 57-69:

```ts
export function useOtpStart() {
  return useMutation({
    mutationFn: (body: { phone: string; locale: 'en' | 'hi' }) =>
      api<{ ok: boolean; retryAfterSeconds: number }>('/auth/otp/start', { body }),
  });
}

export function useOtpVerify() {
  return useMutation({
    mutationFn: (body: { phone: string; code: string; device: { platform: 'web'; name?: string } }) =>
      api<AuthSession>('/auth/otp/verify', { body }),
  });
}
```

with:

```ts
export function useOtpStart() {
  return useMutation({
    mutationFn: (body: { email: string; locale: 'en' | 'hi' }) =>
      api<{ ok: boolean; retryAfterSeconds: number }>('/auth/otp/start', { body }),
  });
}

export function useOtpVerify() {
  return useMutation({
    mutationFn: (body: { email: string; code: string; device: { platform: 'web'; name?: string } }) =>
      api<AuthSession>('/auth/otp/verify', { body }),
  });
}
```

- [ ] **Step 2: Update `apps/web/src/pages/Auth.tsx`**

Replace the `phone` state and its default (lines 21-22 area — search for `useState('+91')`):

```ts
  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [phone, setPhone] = useState('+91');
```

with:

```ts
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
```

Replace the normalization line:

```ts
  const normalizedPhone = phone.replace(/[\s-]/g, '');
```

with:

```ts
  const normalizedEmail = email.trim().toLowerCase();
```

Update `sendCode`'s mutate call:

```ts
    start.mutate(
      { phone: normalizedPhone, locale },
```

to:

```ts
    start.mutate(
      { email: normalizedEmail, locale },
```

Update `submitCode`'s mutate call:

```ts
    verify.mutate(
      { phone: normalizedPhone, code, device: { platform: 'web', name: navigator.userAgent.slice(0, 60) } },
```

to:

```ts
    verify.mutate(
      { email: normalizedEmail, code, device: { platform: 'web', name: navigator.userAgent.slice(0, 60) } },
```

Update every `step === 'phone'` / `setStep('phone')` occurrence to `'email'` (there are two: the conditional render check and the "back" button's `onClick`).

Update the input field itself:

```tsx
            <Input
              label={t('auth.phoneLabel')}
              type="tel"
              autoComplete="tel"
              inputMode="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              hint={t('auth.phoneWhy')}
              error={error}
              required
            />
```

to:

```tsx
            <Input
              label={t('auth.emailLabel')}
              type="email"
              autoComplete="email"
              inputMode="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              hint={t('auth.emailWhy')}
              error={error}
              required
            />
```

- [ ] **Step 3: Update `apps/web/src/pages/Profile.tsx:33`**

Replace:

```tsx
          {me.data?.phoneVerified ? <Badge tone="ok">{t('reliability.phoneVerified')}</Badge> : null}
```

with:

```tsx
          {me.data?.emailVerified ? <Badge tone="ok">{t('reliability.emailVerified')}</Badge> : null}
```

- [ ] **Step 4: Update `apps/web/src/pages/admin/AdminPage.tsx:163`**

Replace:

```tsx
                {u.phoneVerified ? ` · ${t('reliability.phoneVerified')}` : ''}
```

with:

```tsx
                {u.emailVerified ? ` · ${t('reliability.emailVerified')}` : ''}
```

- [ ] **Step 5: Update `apps/web/src/components/ReliabilityChips.tsx`**

Replace line 8's comment:

```ts
/** Honest peer-trust chips: label, completed assists, member-since, phone-verified (with meaning). */
```

with:

```ts
/** Honest peer-trust chips: label, completed assists, member-since, email-verified (with meaning). */
```

Replace lines 19-27:

```tsx
        {peer.phoneVerifiedLabel ? (
          <button
            type="button"
            className="chip"
            style={{ minHeight: 28, padding: '2px 10px', fontSize: 'var(--fs-xs)' }}
            aria-expanded={showMeaning}
            onClick={() => setShowMeaning((v) => !v)}
          >
            <Icon name="check" size={14} /> {t('reliability.phoneVerified')}
          </button>
```

with:

```tsx
        {peer.emailVerifiedLabel ? (
          <button
            type="button"
            className="chip"
            style={{ minHeight: 28, padding: '2px 10px', fontSize: 'var(--fs-xs)' }}
            aria-expanded={showMeaning}
            onClick={() => setShowMeaning((v) => !v)}
          >
            <Icon name="check" size={14} /> {t('reliability.emailVerified')}
          </button>
```

- [ ] **Step 6: Type-check the web app**

Run: `npm run typecheck -w apps/web`
Expected: exits 0. If it fails, the error message will point at any remaining `phone`/`phoneVerified` reference this task missed — grep for `phone` again (`grep -rin "phone" apps/web/src`) and confirm every remaining hit is either the `zPhone`-unrelated word "phone" in unrelated copy or something out of this task's scope (there should be none left in auth/profile/admin/reliability code after Steps 1-5).

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/pages/Auth.tsx apps/web/src/api/hooks.ts apps/web/src/pages/Profile.tsx apps/web/src/pages/admin/AdminPage.tsx apps/web/src/components/ReliabilityChips.tsx
git commit -m "feat(web): switch auth page and phone-verified UI to email"
```

---

### Task 12: Mobile app — auth screen, profile, match room, settings copy

**Files:**
- Modify: `apps/mobile/app/auth.tsx`
- Modify: `apps/mobile/app/(tabs)/profile.tsx:62-63`
- Modify: `apps/mobile/app/match/[id].tsx:263-264`
- Modify: `apps/mobile/app/settings/privacy.tsx:26-27`
- Modify: `apps/mobile/app/settings/legal.tsx:19`

**Interfaces:**
- Consumes: same shared types/i18n keys as Task 11.

- [ ] **Step 1: Update `apps/mobile/app/auth.tsx`**

Replace the step type and initial state:

```ts
type Step = 'phone' | 'code' | 'push';
```

to:

```ts
type Step = 'email' | 'code' | 'push';
```

```ts
  const [step, setStep] = useState<Step>('phone');
  const [phone, setPhone] = useState('+91');
```

to:

```ts
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
```

Replace the normalization line:

```ts
  const normalizedPhone = phone.replace(/[\s-]/g, '');
```

with:

```ts
  const normalizedEmail = email.trim().toLowerCase();
```

Update `startOtp`'s body:

```ts
        body: { phone: normalizedPhone, locale },
```

to:

```ts
        body: { email: normalizedEmail, locale },
```

Update `verify`'s body:

```ts
        body: {
          phone: normalizedPhone,
          code,
```

to:

```ts
        body: {
          email: normalizedEmail,
          code,
```

Update the render condition and input (replace the whole `step === 'phone'` block):

```tsx
        {step === 'phone' ? (
          <View style={{ gap: spacing.lg }}>
            <Body color={th.colors.muted}>{t('auth.phoneWhy')}</Body>
            <Field
              label={t('auth.phoneLabel')}
              value={phone}
              onChangeText={setPhone}
              keyboardType="phone-pad"
              autoComplete="tel"
              textContentType="telephoneNumber"
            />
            {error ? <Body color={th.colors.danger}>{error}</Body> : null}
            <Button
              title={t('auth.sendCode')}
              onPress={() => void startOtp()}
              loading={busy}
              disabled={!/^\+[1-9]\d{6,14}$/.test(normalizedPhone)}
            />
          </View>
        ) : null}
```

with:

```tsx
        {step === 'email' ? (
          <View style={{ gap: spacing.lg }}>
            <Body color={th.colors.muted}>{t('auth.emailWhy')}</Body>
            <Field
              label={t('auth.emailLabel')}
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoComplete="email"
              textContentType="emailAddress"
              autoCapitalize="none"
            />
            {error ? <Body color={th.colors.danger}>{error}</Body> : null}
            <Button
              title={t('auth.sendCode')}
              onPress={() => void startOtp()}
              loading={busy}
              disabled={!/^\S+@\S+\.\S+$/.test(normalizedEmail)}
            />
          </View>
        ) : null}
```

Update the code step's "back" button:

```tsx
            <Button title={t('common.back')} variant="ghost" onPress={() => setStep('phone')} />
```

to:

```tsx
            <Button title={t('common.back')} variant="ghost" onPress={() => setStep('email')} />
```

- [ ] **Step 2: Update `apps/mobile/app/(tabs)/profile.tsx:62-63`**

Replace:

```tsx
          {me?.phoneVerified ? (
            <Badge label={t('reliability.phoneVerified')} tone="success" />
```

with:

```tsx
          {me?.emailVerified ? (
            <Badge label={t('reliability.emailVerified')} tone="success" />
```

- [ ] **Step 3: Update `apps/mobile/app/match/[id].tsx:263-264`**

Replace:

```tsx
                  {m.peer.phoneVerifiedLabel ? (
                    <Badge label={t('reliability.phoneVerified')} tone="success" />
```

with:

```tsx
                  {m.peer.emailVerifiedLabel ? (
                    <Badge label={t('reliability.emailVerified')} tone="success" />
```

- [ ] **Step 4: Update `apps/mobile/app/settings/privacy.tsx:24-28`**

Replace:

```tsx
      {/* Phone */}
      <Card>
        <BodyBold>{t('auth.phoneLabel')}</BodyBold>
        <Body>{t('auth.phoneWhy')}</Body>
      </Card>
```

with:

```tsx
      {/* Email */}
      <Card>
        <BodyBold>{t('auth.emailLabel')}</BodyBold>
        <Body>{t('auth.emailWhy')}</Body>
      </Card>
```

- [ ] **Step 5: Update `apps/mobile/app/settings/legal.tsx:19`**

Replace:

```tsx
        <Body>{t('auth.phoneWhy')}</Body>
```

with:

```tsx
        <Body>{t('auth.emailWhy')}</Body>
```

- [ ] **Step 6: Type-check the mobile app**

Run: `npm run typecheck -w apps/mobile` (or, if mobile isn't an npm workspace per the root `package.json`, run `cd apps/mobile && npx tsc --noEmit`)
Expected: exits 0.

- [ ] **Step 7: Commit**

```bash
git add apps/mobile/app/auth.tsx "apps/mobile/app/(tabs)/profile.tsx" "apps/mobile/app/match/[id].tsx" apps/mobile/app/settings/privacy.tsx apps/mobile/app/settings/legal.tsx
git commit -m "feat(mobile): switch auth screen and phone-verified UI to email"
```

---

### Task 13: E2E — env config, auth helpers, and every spec's login identifier

**Files:**
- Modify: `apps/web/e2e/helpers.ts:112-130,235-249`
- Modify: `apps/web/e2e/00-setup.spec.ts`, `01-core-loop.spec.ts`, `02-decline-timeout.spec.ts`, `03-partial-and-continue.spec.ts`, `04-cancel-renew-expire.spec.ts`, `05-safety.spec.ts`, `06-admin.spec.ts`, `07-settings-privacy.spec.ts`, `08-offline.spec.ts`

**Interfaces:**
- Consumes: `EMAIL_PROVIDER`/`IDENTITY_HMAC_KEY` (Task 3), `email` field on `/auth/otp/start`/`/auth/otp/verify` (Task 7).
- Produces: `loginViaApi(request, email)`, `loginViaUi(page, email)`, `seedHelper(request, email, ...)` (renamed parameter, same positions).

- [ ] **Step 1: Update `apps/web/e2e/helpers.ts`**

Replace lines 112-118 (`loginViaApi`):

```ts
export async function loginViaApi(request: APIRequestContext, phone: string): Promise<Session> {
  await clearOtpRateLimits();
  await apiRaw(request, '/auth/otp/start', { body: { phone, locale: 'en' } });
  const session = await apiRaw<{ token: string; user: Session['user'] }>(request, '/auth/otp/verify', {
    body: { phone, code: FIXED_OTP, device: { platform: 'web', name: 'e2e' } },
  });
  return { token: session.token, user: session.user };
}
```

with:

```ts
export async function loginViaApi(request: APIRequestContext, email: string): Promise<Session> {
  await clearOtpRateLimits();
  await apiRaw(request, '/auth/otp/start', { body: { email, locale: 'en' } });
  const session = await apiRaw<{ token: string; user: Session['user'] }>(request, '/auth/otp/verify', {
    body: { email, code: FIXED_OTP, device: { platform: 'web', name: 'e2e' } },
  });
  return { token: session.token, user: session.user };
}
```

Replace lines 121-130 (`loginViaUi`):

```ts
/** Full UI login: /auth → phone → fixed OTP → lands on /home. */
export async function loginViaUi(page: Page, phone: string): Promise<void> {
  await clearOtpRateLimits();
  await page.goto('/auth');
  await page.getByLabel('Phone number').fill(phone);
  await page.getByRole('button', { name: 'Send code' }).click();
  await page.getByLabel('Enter the 6-digit code').fill(FIXED_OTP);
  await page.getByRole('button', { name: 'Verify' }).click();
  await page.waitForURL('**/home');
}
```

with:

```ts
/** Full UI login: /auth → email → fixed OTP → lands on /home. */
export async function loginViaUi(page: Page, email: string): Promise<void> {
  await clearOtpRateLimits();
  await page.goto('/auth');
  await page.getByLabel('Email address').fill(email);
  await page.getByRole('button', { name: 'Send code' }).click();
  await page.getByLabel('Enter the 6-digit code').fill(FIXED_OTP);
  await page.getByRole('button', { name: 'Verify' }).click();
  await page.waitForURL('**/home');
}
```

Replace `seedHelper`'s signature (lines 235-249) — rename the `phone` parameter to `email`:

```ts
export async function seedHelper(
  request: APIRequestContext,
  phone: string,
  eventId: string,
  category: CategoryRef,
  qty: number,
  latOffset = 0.001,
): Promise<Session> {
  const session = await loginViaApi(request, phone);
```

to:

```ts
export async function seedHelper(
  request: APIRequestContext,
  email: string,
  eventId: string,
  category: CategoryRef,
  qty: number,
  latOffset = 0.001,
): Promise<Session> {
  const session = await loginViaApi(request, email);
```

Also update the comment block above `Session`/`loginViaApi` (around line 31, referenced during planning as "OTP starts are rate-limited per phone") — replace "per phone" with "per email".

- [ ] **Step 2: Find every phone-shaped literal passed to these helpers**

Run: `grep -n "loginViaApi\|loginViaUi\|seedHelper\|PHONE\s*=" apps/web/e2e/*.spec.ts`

This lists every call site and every `const PHONE = '+91...'`-style constant. For each spec file, rename the constant (e.g. `PHONE` → `EMAIL`) and change its value from a `+91...` phone literal to an email literal following the pattern `e2e-<short-slug>@example.com` (each spec already uses distinct fake numbers to avoid cross-test collisions — keep that same distinctness, just as emails, e.g. `+915520000031` → `e2e-settings-privacy@example.com`).

- [ ] **Step 3: Update each of the 9 spec files**

For each file listed in Step 2's output, replace:
- Any `const PHONE = '+91...';` (or inline literal) with the corresponding email constant.
- Any call `loginViaApi(request, PHONE)` / `loginViaUi(page, PHONE)` / `seedHelper(request, PHONE, ...)` — these keep working unchanged once the constant itself is renamed and re-typed to an email string (the call sites don't need edits beyond the constant's new name, if you keep the identifier name `PHONE`... but rename it to `EMAIL` for clarity, then update every reference to that constant in the same file).
- `07-settings-privacy.spec.ts` additionally needs its assertions updated: replace `expect(body).not.toContain(PHONE)` and `expect(body).not.toContain(PHONE.replace('+', ''))` with `expect(body).not.toContain(EMAIL)` (drop the second assertion — it was specifically stripping the `+` prefix from a phone number, which has no email equivalent). Also update the file's header comment (lines 4-8) replacing "NO phone number" with "NO email address" and "logging in again with the same phone" with "logging in again with the same email".

- [ ] **Step 4: Run the full e2e suite**

Run: `npm run test:e2e -w apps/web`
Expected: all specs PASS. This is the end-to-end verification for Tasks 3, 5, 6, 7, 11 working together through a real browser — treat any failure here as a signal to re-check those tasks' changes, not just this task's.

- [ ] **Step 5: Commit**

```bash
git add apps/web/e2e/helpers.ts apps/web/e2e/*.spec.ts
git commit -m "test(e2e): switch fixtures and login flows from phone to email"
```

---

### Task 14: ADR-0011 — email OTP auth

**Files:**
- Create: `docs/adr/0011-email-otp-auth.md`

- [ ] **Step 1: Write the ADR**

```markdown
# 0011. Email OTP authentication (supersedes 0006)

Status: Accepted (2026-07)

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
```

- [ ] **Step 2: Commit**

```bash
git add docs/adr/0011-email-otp-auth.md
git commit -m "docs: add ADR-0011 for email OTP auth, superseding ADR-0006"
```

---

## Final verification

- [ ] Run the full test matrix once all tasks are complete:

```bash
npm run typecheck -w server
npm run typecheck -w packages/shared
npm run typecheck -w apps/web
npm test -w server
npm test -w packages/shared
npm run test:e2e -w apps/web
cd apps/mobile && npx tsc --noEmit
```

Expected: all green. If any command doesn't exist under those exact names, run `cat package.json` at the relevant workspace root first to confirm the actual script name before assuming failure.

- [ ] Grep for anything left behind:

```bash
grep -rn "PHONE_HMAC_KEY\|SMS_PROVIDER\|TwilioSmsProvider\|Msg91SmsProvider\|getSmsProvider" --include="*.ts" --include="*.yml" --include="*.example" .
```

Expected: no output (everything renamed or removed in Tasks 3-4).
