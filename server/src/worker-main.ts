/**
 * Worker process entrypoint: BullMQ workers (matching, offer timeouts,
 * notifications, retention, data requests) + repeatable schedules.
 * Runs separately from the API so job load never starves request handling.
 */
import { startWorkers } from './workers/index.js';
import { closeDb } from './db/index.js';
import { closeRedis } from './lib/redis.js';
import { closeQueues } from './queues.js';

const stop = await startWorkers();
console.log('sahay worker started');

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    await stop();
    await closeQueues();
    await closeRedis();
    await closeDb();
    process.exit(0);
  });
}
