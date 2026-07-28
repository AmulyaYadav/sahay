/**
 * Single source of truth for the e2e stack configuration.
 * Shared by playwright.config.ts (webServer entries), global-setup.ts (worker
 * process + DB bootstrap) and helpers.ts (API/DB/redis access from specs).
 *
 * The stack is fully isolated from local development:
 *  - dedicated database  sahay_e2e  on the dev postgres container (:5432)
 *  - dedicated redis db  14
 *  - console email/push providers, deterministic OTP 424242
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const SERVER_DIR = path.join(REPO_ROOT, 'server');
export const WEB_DIR = path.join(REPO_ROOT, 'apps/web');
export const STATE_FILE = path.join(WEB_DIR, 'e2e/.state.json');

export const API_URL = 'http://localhost:4000';
export const WEB_URL = 'http://localhost:5173';
export const DATABASE_URL = 'postgres://sahay:sahay_dev@localhost:5432/sahay_e2e';
export const ADMIN_DATABASE_URL = 'postgres://sahay:sahay_dev@localhost:5432/postgres';
export const REDIS_URL = 'redis://localhost:6379/14';

export const FIXED_OTP = '424242';

/** Event geometry used across the suite (Pune). ~0.001 lat ≈ 111 m. */
export const EVENT_CENTER = { lat: 18.5204, lng: 73.8567 };

/** Environment for the API server AND the worker (must be identical). */
export const SERVER_ENV: Record<string, string> = {
  NODE_ENV: 'development',
  PORT: '4000',
  HOST: '0.0.0.0',
  DATABASE_URL,
  REDIS_URL,
  // .env.example development keys — never valid in production.
  PII_ENCRYPTION_KEY: '0'.repeat(64),
  IDENTITY_HMAC_KEY: '1'.repeat(64),
  EMAIL_PROVIDER: 'console',
  PUSH_PROVIDER: 'console',
  TEST_FIXED_OTP: FIXED_OTP,
  OFFER_RESPONSE_SECONDS: '45',
  WEB_ORIGIN: WEB_URL,
};
