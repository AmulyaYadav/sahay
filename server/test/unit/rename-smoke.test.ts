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
