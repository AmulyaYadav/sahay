import { z } from 'zod';

const zConfig = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url().default('redis://localhost:6379'),
  PII_ENCRYPTION_KEY: z.string().regex(/^[0-9a-f]{64}$/, 'must be 32 bytes hex'),
  IDENTITY_HMAC_KEY: z.string().regex(/^[0-9a-f]{64}$/, 'must be 32 bytes hex'),
  EMAIL_PROVIDER: z.enum(['console', 'resend']).default('console'),
  RESEND_API_KEY: z.string().optional(),
  RESEND_FROM: z.string().optional(),
  PUSH_PROVIDER: z.enum(['console', 'expo']).default('console'),
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().optional(),
  WEB_ORIGIN: z.string().default('http://localhost:5173'),
  OFFER_RESPONSE_SECONDS: z.coerce.number().default(45),
  LOCATION_TTL_MINUTES: z.coerce.number().default(15),
  /** Test-only: when set, every OTP is this code (hashed/verified normally). Refused in production. */
  TEST_FIXED_OTP: z.string().regex(/^\d{6}$/, 'must be 6 digits').optional(),
});

export type Config = z.infer<typeof zConfig>;

let cached: Config | null = null;

export function loadConfig(): Config {
  if (cached) return cached;
  const parsed = zConfig.safeParse(process.env);
  if (!parsed.success) {
    // Print field names only — never values, which may contain secrets.
    const fields = parsed.error.issues.map((i) => i.path.join('.')).join(', ');
    throw new Error(`Invalid configuration for: ${fields}`);
  }
  if (parsed.data.NODE_ENV === 'production') {
    if (parsed.data.TEST_FIXED_OTP !== undefined) {
      throw new Error('Refusing to start in production with TEST_FIXED_OTP set');
    }
    const exampleKeys = ['0'.repeat(64), '1'.repeat(64)];
    const { PII_ENCRYPTION_KEY, IDENTITY_HMAC_KEY } = parsed.data;
    if (
      exampleKeys.includes(PII_ENCRYPTION_KEY) ||
      exampleKeys.includes(IDENTITY_HMAC_KEY) ||
      PII_ENCRYPTION_KEY === IDENTITY_HMAC_KEY
    ) {
      throw new Error('Refusing to start in production with example or reused crypto keys');
    }
    if (parsed.data.EMAIL_PROVIDER === 'console') {
      throw new Error('Refusing to start in production with EMAIL_PROVIDER=console');
    }
    if (
      parsed.data.EMAIL_PROVIDER === 'resend' &&
      (!parsed.data.RESEND_API_KEY || !parsed.data.RESEND_FROM)
    ) {
      throw new Error('Refusing to start in production with EMAIL_PROVIDER=resend but RESEND_API_KEY/RESEND_FROM unset');
    }
  }
  cached = parsed.data;
  return cached;
}

/** Test-only escape hatch. */
export function resetConfigForTests(): void {
  cached = null;
}
