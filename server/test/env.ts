/**
 * Test environment bootstrap. MUST be imported before anything that calls
 * loadConfig(). Points at the docker-compose test services (postgres_test:5433,
 * redis db 15) and installs valid throwaway crypto keys.
 */
import { resetConfigForTests } from '../src/config.js';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL =
  process.env.DATABASE_URL_TEST ?? 'postgres://sahay:sahay_test@localhost:5433/sahay_test';
process.env.REDIS_URL = process.env.REDIS_URL_TEST ?? 'redis://localhost:6379/15';
process.env.PII_ENCRYPTION_KEY = 'a'.repeat(64);
process.env.PHONE_HMAC_KEY = 'b'.repeat(64);
process.env.SMS_PROVIDER = 'console';

resetConfigForTests();
