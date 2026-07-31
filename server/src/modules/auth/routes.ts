import type { FastifyInstance } from 'fastify';
import {
  zChangePassword,
  zForgotUsername,
  zOtpStart,
  zOtpVerify,
  zPasswordLogin,
  zResetPassword,
  zSetCredentials,
  zUuid,
} from '@sahay/shared';
import { errors } from '../../lib/errors.js';
import { publishToUser } from '../../realtime/hub.js';
import {
  changeOwnPassword,
  resetPasswordWithOtp,
  sendUsernameReminder,
  setOwnCredentials,
  listSessions,
  loginWithPassword,
  revokeSession,
  startOtp,
  verifyOtp,
} from './service.js';

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

  // First-time credential setup, right after the account was created by verifying
  // an emailed code. Authenticated: the session from that verification is the
  // proof that this address belongs to the caller.
  app.post('/auth/credentials', { preHandler: [app.authenticate] }, async (req) => {
    const body = zSetCredentials.parse(req.body);
    return setOwnCredentials(req.auth!.userId, body.username, body.password);
  });

  // Both recovery routes are *public* and answer identically whether or not the
  // address has an account — they must not become a way to test which addresses
  // are registered.
  app.post('/auth/forgot-username', async (req) => {
    const body = zForgotUsername.parse(req.body);
    return sendUsernameReminder(body.email, body.locale);
  });

  app.post('/auth/password/reset', async (req) => {
    const body = zResetPassword.parse(req.body);
    return resetPasswordWithOtp(body.email, body.code, body.newPassword);
  });

  // Reachable while must_change_password is set — see PASSWORD_CHANGE_EXEMPT.
  app.post('/auth/password', { preHandler: [app.authenticate] }, async (req) => {
    const body = zChangePassword.parse(req.body);
    const auth = req.auth!;
    return changeOwnPassword(auth.userId, auth.sessionId, body.currentPassword, body.newPassword);
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
