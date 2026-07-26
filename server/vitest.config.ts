import { defineConfig } from 'vitest/config';

/**
 * Base config. The two projects ('unit', 'integration') are defined in
 * vitest.workspace.ts — vitest 2.1 does not support inline `test.projects`.
 * Run with `vitest run --project unit` / `--project integration`.
 */
export default defineConfig({
  test: {
    environment: 'node',
  },
});
