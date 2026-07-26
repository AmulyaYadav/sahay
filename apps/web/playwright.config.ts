/**
 * Playwright e2e configuration for the Sahay web app.
 *
 * Three processes make up the stack:
 *  - API   (webServer[0]) — `tsx src/main.ts` with an isolated env (DB sahay_e2e,
 *    redis db 14, TEST_FIXED_OTP=424242). NOT `npm run dev -w server`, which would
 *    load server/.env via --env-file and override the isolated settings.
 *  - Web   (webServer[1]) — Vite dev server on :5173 pointed at the API.
 *  - Worker — has no HTTP port, so it is spawned from globalSetup instead
 *    (killed by the teardown function globalSetup returns).
 *
 * Flows are stateful and share one database, so the suite runs on a single
 * worker with fullyParallel disabled; spec files execute in filename order
 * (00-setup first — it creates the shared event and writes e2e/.state.json).
 */
import { defineConfig, devices } from '@playwright/test';
import { API_URL, SERVER_DIR, SERVER_ENV, WEB_URL } from './e2e/env';

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  globalSetup: './e2e/global-setup.ts',
  use: {
    ...devices['Desktop Chrome'],
    baseURL: WEB_URL,
    permissions: ['geolocation'],
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'npx tsx src/main.ts',
      cwd: SERVER_DIR,
      url: `${API_URL}/healthz`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: SERVER_ENV,
    },
    {
      command: 'npx vite --port 5173 --strictPort',
      url: WEB_URL,
      reuseExistingServer: false,
      timeout: 60_000,
      env: { VITE_API_URL: API_URL },
    },
  ],
});
