import type { FastifyInstance } from 'fastify';
import { zOfferRespond, zUuid } from '@sahay/shared';
import { listPendingOffers, respondToOffer } from './service.js';

export function registerOfferRoutes(app: FastifyInstance): void {
  app.get('/offers/pending', { preHandler: [app.authenticate] }, async (req) => ({
    items: await listPendingOffers(req.auth!.userId),
  }));

  app.post<{ Params: { id: string } }>(
    '/offers/:id/respond',
    { preHandler: [app.authenticate] },
    async (req) => {
      const body = zOfferRespond.parse(req.body);
      return respondToOffer(req.auth!, zUuid.parse(req.params.id), body);
    },
  );
}
