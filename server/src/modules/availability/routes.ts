import type { FastifyInstance } from 'fastify';
import { zLocationPing, zSetAvailability, zUuid } from '@sahay/shared';
import { deleteLocation, getAvailability, putLocation, setAvailability } from './service.js';

export function registerAvailabilityRoutes(app: FastifyInstance): void {
  app.get<{ Params: { id: string } }>(
    '/events/:id/availability',
    { preHandler: [app.authenticate] },
    async (req) => getAvailability(req.auth!.userId, zUuid.parse(req.params.id)),
  );

  app.put<{ Params: { id: string } }>(
    '/events/:id/availability',
    { preHandler: [app.authenticate] },
    async (req) => {
      const body = zSetAvailability.parse(req.body);
      return setAvailability(req.auth!, zUuid.parse(req.params.id), body);
    },
  );

  app.put<{ Params: { id: string } }>(
    '/events/:id/location',
    { preHandler: [app.authenticate] },
    async (req) => {
      const body = zLocationPing.parse(req.body);
      return putLocation(req.auth!.userId, zUuid.parse(req.params.id), body.coords);
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/events/:id/location',
    { preHandler: [app.authenticate] },
    async (req) => {
      await deleteLocation(req.auth!.userId, zUuid.parse(req.params.id));
      return { ok: true };
    },
  );
}
