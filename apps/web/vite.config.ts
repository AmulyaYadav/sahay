import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * Build-time env vars (set in apps/web/.env.local or the CI environment):
 * - VITE_API_URL           API origin, default http://localhost:4000 (see src/api/client.ts).
 * - VITE_VAPID_PUBLIC_KEY  VAPID public key for Web Push — must match the server's
 *   VAPID_PUBLIC_KEY (generate the pair with `npx web-push generate-vapid-keys`).
 *   When unset, the "Push notifications on this device" toggle in Settings renders
 *   disabled with an explanatory note.
 */
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:4000', changeOrigin: true },
      '/ws': { target: 'ws://localhost:4000', ws: true },
    },
  },
  build: {
    sourcemap: false,
    target: 'es2020',
  },
});
