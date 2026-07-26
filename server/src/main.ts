import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { closeDb } from './db/index.js';
import { closeRedis } from './lib/redis.js';
import { closeQueues } from './queues.js';

const config = loadConfig();
const app = await buildApp();

await app.listen({ port: config.PORT, host: config.HOST });

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    app.log.info({ signal }, 'shutting down');
    await app.close();
    await closeQueues();
    await closeRedis();
    await closeDb();
    process.exit(0);
  });
}
