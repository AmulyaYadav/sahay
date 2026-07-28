import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { zCreateEvent, zEventSearch, zJoinEvent, zUuid } from '@sahay/shared';
import { resolveAuth, type AuthContext } from '../../plugins/auth.js';
import { errors } from '../../lib/errors.js';
import { getBringSuggestions } from './bring.js';
import {
  buildEventDetail,
  createEvent,
  getEventForViewer,
  joinEvent,
  leaveEvent,
  muteEvent,
  searchEvents,
} from './service.js';

const zMute = z.object({ muted: z.boolean() });

/** Public routes still personalize (joined/membership) when a valid token is present. */
async function optionalAuth(req: FastifyRequest): Promise<AuthContext | null> {
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return null;
  return resolveAuth(token).catch(() => null);
}

/** `near` arrives as a JSON string in the querystring; decode before schema.parse. */
function parseSearchQuery(raw: unknown) {
  const query = { ...(raw as Record<string, unknown>) };
  if (typeof query.near === 'string') {
    try {
      query.near = JSON.parse(query.near);
    } catch {
      throw errors.validation({ field: 'near' });
    }
  }
  return zEventSearch.parse(query);
}

export function registerEventRoutes(app: FastifyInstance): void {
  app.get('/events', async (req) => {
    const query = parseSearchQuery(req.query ?? {});
    const auth = await optionalAuth(req);
    return searchEvents(query, auth?.userId ?? null);
  });

  // NOTE (documented in docs/api-surface.md Notes): responds
  // `{event: zEventDetail, inviteCode?}` — the invite code is issued exactly once,
  // at creation time, and zEventDetail intentionally never carries it.
  app.post('/events', { preHandler: [app.authenticate, app.requireRole('moderator')] }, async (req) => {
    const auth = req.auth!;
    if (auth.status !== 'active') throw errors.accountRestricted();
    const body = zCreateEvent.parse(req.body);
    return createEvent(auth.userId, body);
  });

  app.get<{ Params: { idOrCode: string } }>('/events/:idOrCode', async (req) => {
    const auth = await optionalAuth(req);
    const event = await getEventForViewer(
      req.params.idOrCode,
      auth ? { userId: auth.userId, role: auth.role } : null,
    );
    return buildEventDetail(event, auth?.userId ?? null);
  });

  app.post<{ Params: { id: string } }>(
    '/events/:id/join',
    { preHandler: [app.authenticate] },
    async (req) => {
      const body = zJoinEvent.parse(req.body ?? {});
      return joinEvent(req.auth!.userId, zUuid.parse(req.params.id), body.inviteCode);
    },
  );

  app.post<{ Params: { id: string } }>(
    '/events/:id/leave',
    { preHandler: [app.authenticate] },
    async (req) => {
      await leaveEvent(req.auth!.userId, zUuid.parse(req.params.id));
      return { ok: true };
    },
  );

  app.post<{ Params: { id: string } }>(
    '/events/:id/mute',
    { preHandler: [app.authenticate] },
    async (req) => {
      const body = zMute.parse(req.body);
      await muteEvent(req.auth!.userId, zUuid.parse(req.params.id), body.muted);
      return { ok: true };
    },
  );

  app.get<{ Params: { id: string } }>(
    '/events/:id/bring',
    { preHandler: [app.authenticate] },
    async (req) => ({
      suggestions: await getBringSuggestions(zUuid.parse(req.params.id), req.auth!.userId),
    }),
  );
}
