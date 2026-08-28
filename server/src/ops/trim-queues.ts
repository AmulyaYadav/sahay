/**
 * One-off: delete finished BullMQ jobs that predate the retention limits in
 * queues.ts.
 *
 * Those limits only trim as new jobs complete, which is no help once Redis is
 * already at maxmemory: every write is refused with "OOM command not allowed",
 * so the worker cannot run the very jobs whose completion would do the
 * trimming. This breaks the deadlock from outside.
 *
 * It deliberately does NOT use queue.clean(). That runs a Lua script which,
 * after deleting, XADDs a "cleaned" event to bull:<queue>:events — and XADD is
 * denyoom, so the whole script is rejected on a full Redis. Only commands that
 * can never grow memory are used here: ZRANGE to read, UNLINK and ZREM to
 * delete, XTRIM to shorten the event stream.
 *
 * Safe to run against a live deployment. It touches only the completed and
 * failed sets — never waiting, delayed or active jobs — so nothing pending is
 * lost. Idempotent; run it again if one pass does not free enough.
 *
 *   node dist/ops/trim-queues.js
 */
import { closeRedis, getRedis } from '../lib/redis.js';

const QUEUE_NAMES = ['match', 'offer-timeout', 'notify', 'retention', 'data-request'];
const FINISHED = ['completed', 'failed'] as const;

/** Job ids read per pass. Also bounds the UNLINK/ZREM argument lists. */
const BATCH = 1_000;

/** Per finished job, BullMQ may hold these alongside the job hash itself. */
function jobKeys(queue: string, id: string): string[] {
  const base = `bull:${queue}:${id}`;
  return [base, `${base}:logs`, `${base}:dependencies`, `${base}:processed`];
}

async function usedMemory(): Promise<string> {
  const info = await getRedis().info('memory');
  return /used_memory_human:(\S+)/.exec(info)?.[1] ?? 'unknown';
}

async function main(): Promise<void> {
  const redis = getRedis();
  console.log(`redis used_memory before: ${await usedMemory()}`);

  let total = 0;
  for (const queue of QUEUE_NAMES) {
    for (const state of FINISHED) {
      const setKey = `bull:${queue}:${state}`;
      let removed = 0;
      for (;;) {
        const ids = await redis.zrange(setKey, 0, BATCH - 1);
        if (ids.length === 0) break;
        // UNLINK reclaims in a background thread, so a large sweep does not
        // block the server the API is waiting on.
        await redis.unlink(...ids.flatMap((id) => jobKeys(queue, id)));
        await redis.zrem(setKey, ...ids);
        removed += ids.length;
        if (removed % 25_000 === 0) console.log(`  ${queue}/${state}: ${removed}…`);
      }
      if (removed > 0) console.log(`  ${queue}: removed ${removed} ${state}`);
      total += removed;
    }
    // The event stream is capped on write, but only approximately, and its
    // entries are dead weight once the jobs are gone.
    await redis.xtrim(`bull:${queue}:events`, 'MAXLEN', 1000);
  }

  console.log(`removed ${total} finished jobs`);
  console.log(`redis used_memory after:  ${await usedMemory()}`);
  await closeRedis();
}

await main();
