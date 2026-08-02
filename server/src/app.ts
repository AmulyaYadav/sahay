/**
 * Fastify app assembly. Each domain module exports `registerXRoutes(app)` from
 * src/modules/<name>/routes.ts and is wired here. Business logic lives in the
 * modules' service files, never in route handlers.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { loadConfig } from './config.js';
import { registerAuth } from './plugins/auth.js';
import { registerErrorHandler } from './plugins/error-handler.js';
import { registerAuthRoutes } from './modules/auth/routes.js';
import { registerUserRoutes } from './modules/users/routes.js';
import { registerEventRoutes } from './modules/events/routes.js';
import { registerCatalogueRoutes } from './modules/catalogue/routes.js';
import { registerInventoryRoutes } from './modules/inventory/routes.js';
import { registerAvailabilityRoutes } from './modules/availability/routes.js';
import { registerRequestRoutes } from './modules/requests/routes.js';
import { registerOfferRoutes } from './modules/offers/routes.js';
import { registerMatchRoutes } from './modules/matches/routes.js';
import { registerChatRoutes } from './modules/chat/routes.js';
import { registerDashboardRoutes } from './modules/dashboard/routes.js';
import { registerNotificationRoutes } from './modules/notifications/routes.js';
import { registerSafetyRoutes } from './modules/safety/routes.js';
import { registerPrivacyRoutes } from './modules/privacy/routes.js';
import { registerAdminRoutes } from './modules/admin/routes.js';
import { registerHealthRoutes } from './modules/health/routes.js';
import { parseJsonBody } from './lib/json-body.js';
import { registerWebsocket } from './realtime/gateway.js';

export async function buildApp(): Promise<FastifyInstance> {
  const config = loadConfig();
  const app = Fastify({
    logger: {
      level: config.NODE_ENV === 'test' ? 'warn' : 'info',
      // Privacy: never log auth headers, bodies (may contain phone numbers), or queries.
      redact: {
        paths: ['req.headers.authorization', 'req.headers.cookie'],
        censor: '[redacted]',
      },
      serializers: {
        req: (req) => ({ method: req.method, url: req.url.split('?')[0], id: req.id }),
      },
    },
    genReqId: () => crypto.randomUUID(),
    trustProxy: true,
    bodyLimit: 64 * 1024,
  });

  /*
    Accept a JSON content type with no body. Fastify's default parser rejects
    that combination outright, before routing, which turned every no-body POST
    into an opaque 400. See lib/json-body.ts.
  */
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'string' },
    (_req, body, done) => {
      try {
        done(null, parseJsonBody(body as string));
      } catch (err) {
        done(err as Error, undefined);
      }
    },
  );

  await app.register(cors, {
    origin: config.NODE_ENV === 'production' ? [config.WEB_ORIGIN] : true,
    credentials: false,
  });

  app.addHook('onSend', async (_req, reply) => {
    reply.header('x-content-type-options', 'nosniff');
    reply.header('referrer-policy', 'no-referrer');
    reply.header('x-frame-options', 'DENY');
  });

  registerAuth(app);
  registerErrorHandler(app);

  await app.register(
    async (v1) => {
      registerAuthRoutes(v1);
      registerUserRoutes(v1);
      registerEventRoutes(v1);
      registerCatalogueRoutes(v1);
      registerInventoryRoutes(v1);
      registerAvailabilityRoutes(v1);
      registerRequestRoutes(v1);
      registerOfferRoutes(v1);
      registerMatchRoutes(v1);
      registerChatRoutes(v1);
      registerDashboardRoutes(v1);
      registerNotificationRoutes(v1);
      registerSafetyRoutes(v1);
      registerPrivacyRoutes(v1);
      registerAdminRoutes(v1);
    },
    { prefix: '/api/v1' },
  );

  registerHealthRoutes(app);
  await registerWebsocket(app);

  return app;
}
