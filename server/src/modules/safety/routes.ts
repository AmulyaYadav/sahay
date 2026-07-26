/**
 * Safety surface: reports and blocks. Blocking works through a match id — the
 * peer's account identity is never revealed or accepted from the client.
 */
import type { FastifyInstance } from 'fastify';
import { zBlockUser, zCreateReport } from '@sahay/shared';
import { blockViaMatch, createReport, listMyReports } from './service.js';

export function registerSafetyRoutes(app: FastifyInstance): void {
  app.post('/reports', { preHandler: [app.authenticate] }, async (req) => {
    const body = zCreateReport.parse(req.body);
    return createReport(req.auth!.userId, body);
  });

  app.get('/reports/mine', { preHandler: [app.authenticate] }, async (req) => ({
    items: await listMyReports(req.auth!.userId),
  }));

  app.post('/blocks', { preHandler: [app.authenticate] }, async (req) => {
    const body = zBlockUser.parse(req.body);
    await blockViaMatch(req.auth!.userId, body.matchId);
    return { ok: true };
  });
}
