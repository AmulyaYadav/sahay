/**
 * Aggregate dashboard endpoint. Public for approved public events; otherwise
 * members (and site moderators) only — outsiders get 404, consistent with how
 * the events module hides unlisted/invite-only resources.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { errors } from '../../lib/errors.js';
import { resolveAuth, type AuthContext } from '../../plugins/auth.js';
import { getMembership, resolveEvent } from '../events/service.js';
import { getEventDashboard } from './service.js';

async function optionalAuth(req: FastifyRequest): Promise<AuthContext | null> {
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return null;
  return resolveAuth(token).catch(() => null);
}

export function registerDashboardRoutes(app: FastifyInstance): void {
  app.get<{ Params: { id: string } }>('/events/:id/dashboard', async (req) => {
    const event = await resolveEvent(req.params.id);
    if (!event) throw errors.notFound();

    const openToAnyone =
      event.visibility === 'public' &&
      event.publicApproved &&
      event.status !== 'draft' &&
      event.status !== 'disabled';
    if (!openToAnyone) {
      const auth = await optionalAuth(req);
      const privileged = auth && (auth.role === 'moderator' || auth.role === 'admin');
      const member = auth ? await getMembership(event.id, auth.userId) : null;
      if (!privileged && !member) throw errors.notFound(); // existence is not leaked
    }

    return getEventDashboard(event.id);
  });
}
