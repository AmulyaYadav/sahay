import type { FastifyInstance } from 'fastify';
import { zNotificationPrefs, zPagination, zRegisterPush, zUpdateMe, zUuid } from '@sahay/shared';
import {
  getMe,
  getNotificationPrefs,
  listBlocks,
  listNotifications,
  markNotificationRead,
  putNotificationPrefs,
  registerPushToken,
  updateMe,
} from './service.js';

export function registerUserRoutes(app: FastifyInstance): void {
  app.get('/me', { preHandler: [app.authenticate] }, async (req) => getMe(req.auth!.userId));

  app.patch('/me', { preHandler: [app.authenticate] }, async (req) => {
    const body = zUpdateMe.parse(req.body);
    return updateMe(req.auth!.userId, body);
  });

  app.get('/me/blocks', { preHandler: [app.authenticate] }, async (req) => ({
    blocks: await listBlocks(req.auth!.userId),
  }));

  app.post('/me/push-tokens', { preHandler: [app.authenticate] }, async (req) => {
    const body = zRegisterPush.parse(req.body);
    await registerPushToken(req.auth!.userId, body.provider, body.token);
    return { ok: true };
  });

  app.get('/me/notification-prefs', { preHandler: [app.authenticate] }, async (req) =>
    getNotificationPrefs(req.auth!.userId),
  );

  app.put('/me/notification-prefs', { preHandler: [app.authenticate] }, async (req) => {
    const body = zNotificationPrefs.parse(req.body);
    return putNotificationPrefs(req.auth!.userId, body);
  });

  app.get('/me/notifications', { preHandler: [app.authenticate] }, async (req) => {
    const query = zPagination.parse(req.query ?? {});
    return listNotifications(req.auth!.userId, query.limit, query.cursor);
  });

  app.post<{ Params: { id: string } }>(
    '/me/notifications/:id/read',
    { preHandler: [app.authenticate] },
    async (req) => {
      await markNotificationRead(req.auth!.userId, zUuid.parse(req.params.id));
      return { ok: true };
    },
  );
}
