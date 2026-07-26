import type { FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';
import { getDb } from '../../db/index.js';
import { getRedis } from '../../lib/redis.js';

/** Registered at the server root (not under /api/v1) — see app.ts. */
export function registerHealthRoutes(app: FastifyInstance): void {
  app.get('/healthz', async () => ({ ok: true }));

  app.get('/readyz', async (_req, reply) => {
    try {
      await getDb().execute(sql`SELECT 1`);
      await getRedis().ping();
      return { ok: true };
    } catch {
      return reply.status(503).send({ ok: false });
    }
  });
}
