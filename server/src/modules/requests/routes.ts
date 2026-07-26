import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { zContinueRequest, zCreateRequest, zRenewRequest, zUuid } from '@sahay/shared';
import {
  cancelRequest,
  continueRequest,
  createRequest,
  getMyRequest,
  listMyRequests,
  renewRequest,
} from './service.js';

const zMineQuery = z.object({ eventId: zUuid.optional() });

export function registerRequestRoutes(app: FastifyInstance): void {
  app.post('/requests', { preHandler: [app.authenticate] }, async (req) => {
    const body = zCreateRequest.parse(req.body);
    return createRequest(req.auth!, body);
  });

  app.get('/requests/mine', { preHandler: [app.authenticate] }, async (req) => {
    const query = zMineQuery.parse(req.query ?? {});
    return { items: await listMyRequests(req.auth!.userId, query.eventId) };
  });

  app.get<{ Params: { id: string } }>(
    '/requests/:id',
    { preHandler: [app.authenticate] },
    async (req) => getMyRequest(req.auth!.userId, zUuid.parse(req.params.id)),
  );

  app.post<{ Params: { id: string } }>(
    '/requests/:id/cancel',
    { preHandler: [app.authenticate] },
    async (req) => cancelRequest(req.auth!.userId, zUuid.parse(req.params.id)),
  );

  app.post<{ Params: { id: string } }>(
    '/requests/:id/renew',
    { preHandler: [app.authenticate] },
    async (req) => {
      const body = zRenewRequest.parse(req.body ?? {});
      return renewRequest(req.auth!.userId, zUuid.parse(req.params.id), body.expiresInMinutes);
    },
  );

  app.post<{ Params: { id: string } }>(
    '/requests/:id/continue',
    { preHandler: [app.authenticate] },
    async (req) => {
      const body = zContinueRequest.parse(req.body);
      return continueRequest(req.auth!.userId, zUuid.parse(req.params.id), body.continueSearching);
    },
  );
}
