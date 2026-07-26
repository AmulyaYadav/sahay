import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { zCancelMatch, zConfirmCompletion, zMeetingUpdate, zUuid } from '@sahay/shared';
import {
  cancelMatch,
  confirmCompletion,
  getMatchView,
  listActiveMatches,
  setMeetingState,
} from './service.js';

/**
 * The shared zConfirmCompletion requires qty > 0, but a participant must be
 * able to state "nothing was exchanged" (qty 0) so disagreements can surface —
 * widened server-side; see the deviation note in docs/api-surface.md.
 */
const zConfirmBody = zConfirmCompletion.extend({ qty: z.number().min(0).max(10000) });

export function registerMatchRoutes(app: FastifyInstance): void {
  app.get('/matches/active', { preHandler: [app.authenticate] }, async (req) => ({
    items: await listActiveMatches(req.auth!.userId),
  }));

  app.get<{ Params: { id: string } }>(
    '/matches/:id',
    { preHandler: [app.authenticate] },
    async (req) => getMatchView(zUuid.parse(req.params.id), req.auth!.userId),
  );

  app.post<{ Params: { id: string } }>(
    '/matches/:id/meeting',
    { preHandler: [app.authenticate] },
    async (req) => {
      const body = zMeetingUpdate.parse(req.body);
      return setMeetingState(zUuid.parse(req.params.id), req.auth!.userId, body.state);
    },
  );

  app.post<{ Params: { id: string } }>(
    '/matches/:id/cancel',
    { preHandler: [app.authenticate] },
    async (req) => {
      const body = zCancelMatch.parse(req.body);
      return cancelMatch(zUuid.parse(req.params.id), req.auth!.userId, body);
    },
  );

  app.post<{ Params: { id: string } }>(
    '/matches/:id/confirm',
    { preHandler: [app.authenticate] },
    async (req) => {
      const body = zConfirmBody.parse(req.body);
      return confirmCompletion(zUuid.parse(req.params.id), req.auth!.userId, body.qty);
    },
  );
}
