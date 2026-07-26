import type { FastifyInstance } from 'fastify';
import { zPagination, zSendMessage, zUuid } from '@sahay/shared';
import { getConversationView, listMessages, markRead, sendMessage } from './service.js';

export function registerChatRoutes(app: FastifyInstance): void {
  app.get<{ Params: { id: string } }>(
    '/conversations/:id',
    { preHandler: [app.authenticate] },
    async (req) => getConversationView(zUuid.parse(req.params.id), req.auth!.userId),
  );

  app.get<{ Params: { id: string } }>(
    '/conversations/:id/messages',
    { preHandler: [app.authenticate] },
    async (req) => {
      const query = zPagination.parse(req.query ?? {});
      return listMessages(zUuid.parse(req.params.id), req.auth!.userId, query);
    },
  );

  app.post<{ Params: { id: string } }>(
    '/conversations/:id/messages',
    { preHandler: [app.authenticate] },
    async (req) => {
      const body = zSendMessage.parse(req.body);
      return sendMessage(zUuid.parse(req.params.id), req.auth!.userId, body);
    },
  );

  app.post<{ Params: { id: string } }>(
    '/conversations/:id/read',
    { preHandler: [app.authenticate] },
    async (req) => {
      await markRead(zUuid.parse(req.params.id), req.auth!.userId);
      return { ok: true };
    },
  );
}
