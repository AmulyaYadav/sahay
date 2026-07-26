/**
 * Privacy endpoints: export lifecycle (request → poll → download), account
 * deletion, and the consent ledger. The download endpoint is an addition over
 * the original api-surface table — documented in docs/api-surface.md Notes.
 */
import type { FastifyInstance } from 'fastify';
import { zDeleteAccount } from '@sahay/shared';
import {
  getExportPayload,
  getLatestExport,
  listConsents,
  requestAccountDeletion,
  requestExport,
} from './service.js';

export function registerPrivacyRoutes(app: FastifyInstance): void {
  app.post('/me/export', { preHandler: [app.authenticate] }, async (req) =>
    requestExport(req.auth!.userId),
  );

  app.get('/me/export', { preHandler: [app.authenticate] }, async (req) =>
    getLatestExport(req.auth!.userId),
  );

  app.get('/me/export/download', { preHandler: [app.authenticate] }, async (req, reply) => {
    const payload = await getExportPayload(req.auth!.userId);
    reply
      .header('content-disposition', 'attachment; filename="sahay-export.json"')
      .type('application/json');
    return payload;
  });

  app.post('/me/delete', { preHandler: [app.authenticate] }, async (req) => {
    const body = zDeleteAccount.parse(req.body);
    await requestAccountDeletion(req.auth!.userId, body.confirmPseudonym);
    return { ok: true };
  });

  app.get('/me/consents', { preHandler: [app.authenticate] }, async (req) => ({
    items: await listConsents(req.auth!.userId),
  }));
}
