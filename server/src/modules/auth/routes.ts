import type { FastifyInstance } from 'fastify';
import { zOtpStart, zOtpVerify, zPasswordLogin, zUuid } from '@sahay/shared';
import { errors } from '../../lib/errors.js';
import { publishToUser } from '../../realtime/hub.js';
import { listSessions, loginWithPassword, revokeSession, startOtp, verifyOtp } from './service.js';

export function registerAuthRoutes(app: FastifyInstance): void {
  app.post('/auth/otp/start', async (req) => {
    const body = zOtpStart.parse(req.body);
    return startOtp(body.email, body.locale, req.ip);
  });

  app.post('/auth/otp/verify', async (req) => {
    const body = zOtpVerify.parse(req.body);
    return verifyOtp(body.email, body.code, body.device);
  });

  // Staff sign-in (admin console). Volunteers use the OTP routes above.
  app.post('/auth/login', async (req) => {
    const body = zPasswordLogin.parse(req.body);
    return loginWithPassword(body.username, body.password, body.device, req.ip);
  });

  app.post('/auth/logout', { preHandler: [app.authenticate] }, async (req) => {
    const auth = req.auth!;
    await revokeSession(auth.userId, auth.sessionId);
    return { ok: true };
  });

  app.get('/auth/sessions', { preHandler: [app.authenticate] }, async (req) => {
    const auth = req.auth!;
    return listSessions(auth.userId, auth.sessionId);
  });

  app.delete<{ Params: { id: string } }>(
    '/auth/sessions/:id',
    { preHandler: [app.authenticate] },
    async (req) => {
      const auth = req.auth!;
      const id = zUuid.parse(req.params.id);
      const revoked = await revokeSession(auth.userId, id);
      if (!revoked) throw errors.notFound();
      // Hint connected clients of that user; the revoked session's next request fails anyway.
      void publishToUser(auth.userId, 'session.revoked', { sessionId: id }).catch(() => {});
      return { ok: true };
    },
  );
}
