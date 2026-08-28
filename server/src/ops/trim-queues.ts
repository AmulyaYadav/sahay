/**
 * One-off: delete finished BullMQ jobs that predate the retention limits in
 * queues.ts.
 *
 * Those limits only trim as new jobs complete, which is no help once Redis is
 * already at maxmemory: every write is refused with "OOM command not allowed",
 * so the worker cannot run the very jobs whose completion would do the
 * trimming. Deletes are still permitted under OOM, and that is all this does.
 *
 * Safe to run against a live deployment. It touches only completed and failed
 * jobs — never waiting, delayed or active ones — so nothing pending is lost.
 * Idempotent; run it again if the first pass does not free enough.
 *
 *   node dist/ops/trim-queues.js
 */
import { Queue } from 'bullmq';
import { closeRedis, getRedis } from '../lib/redis.js';

const QUEUE_NAMES = ['match', 'offer-timeout', 'notify', 'retention', 'data-request'];
const FINISHED = ['completed', 'failed'] as const;

/** clean() caps each call, so loop until a pass removes nothing. */
const BATCH = 5_000;

async function usedMemory(): Promise<string> {
  const info = await getRedis().info('memory');
  return /used_memory_human:(\S+)/.exec(info)?.[1] ?? 'unknown';
}

async function main(): Promise<void> {
  console.log(`redis used_memory before: ${await usedMemory()}`);

  let total = 0;
  for (const name of QUEUE_NAMES) {
    const queue = new Queue(name, { connection: getRedis() });
    for (const state of FINISHED) {
      let removed = 0;
      for (;;) {
        // grace 0 — every job of this state is eligible regardless of age.
        const ids = await queue.clean(0, BATCH, state);
        removed += ids.length;
        if (ids.length < BATCH) break;
      }
      if (removed > 0) console.log(`  ${name}: removed ${removed} ${state}`);
      total += removed;
    }
    await queue.close();
  }

  console.log(`removed ${total} finished jobs`);
  console.log(`redis used_memory after:  ${await usedMemory()}`);
  await closeRedis();
}

await main();
