/**
 * Bearer-token authentication. Adds `request.auth` with the session's user.
 * Route usage: `app.get('/x', { preHandler: [app.authenticate] }, handler)` and
 * `app.requireRole('moderator')` for admin surfaces.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { and, eq, isNull, gt, sql } from 'drizzle-orm';
import { getDb, schema } from '../db/index.js';
import { hashToken } from '../lib/crypto.js';
import { errors } from '../lib/errors.js';

export interface AuthContext {
  userId: string;
  sessionId: string;
  role: string;
  status: string;
  locale: 'en' | 'hi';
  pseudonym: string;
  canRequest: boolean;
  canHelp: boolean;
  mustChangePassword: boolean;
}

declare module 'fastify' {
  interface FastifyRequest {
    auth: AuthContext | null;
  }
  interface FastifyInstance {
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireRole: (role: 'moderator' | 'admin') => (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

export async function resolveAuth(token: string): Promise<AuthContext | null> {
  const db = getDb();
  const rows = await db
    .select({
      userId: schema.users.id,
      sessionId: schema.sessions.id,
      role: schema.users.role,
      status: schema.users.status,
      locale: schema.users.locale,
      pseudonym: schema.users.pseudonym,
      canRequest: schema.users.canRequest,
      canHelp: schema.users.canHelp,
      mustChangePassword: schema.users.mustChangePassword,
      suspendedUntil: schema.users.suspendedUntil,
    })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.sessions.userId, schema.users.id))
    .where(
      and(
        eq(schema.sessions.tokenHash, hashToken(token)),
        isNull(schema.sessions.revokedAt),
        gt(schema.sessions.expiresAt, sql`now()`),
        isNull(schema.users.deletedAt),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  // Auto-lift expired suspensions.
  const suspended =
    row.status === 'suspended' && (!row.suspendedUntil || row.suspendedUntil > new Date());
  return {
    userId: row.userId,
    sessionId: row.sessionId,
    role: row.role,
    status: suspended ? 'suspended' : row.status === 'suspended' ? 'active' : row.status,
    locale: row.locale === 'hi' ? 'hi' : 'en',
    pseudonym: row.pseudonym,
    canRequest: row.canRequest,
    canHelp: row.canHelp,
    mustChangePassword: row.mustChangePassword,
  };
}

/**
 * Routes still reachable while a staff account owes us a password change.
 * Everything needed to complete the change and nothing else: read who you are,
 * set the new password, or leave. Enforced server-side rather than only in the
 * console, so skipping the screen in the client does not skip the requirement —
 * the whole point is that the password WE generated stops working.
 */
const PASSWORD_CHANGE_EXEMPT: ReadonlySet<string> = new Set([
  '/api/v1/auth/password',
  '/api/v1/auth/logout',
  '/api/v1/me',
]);

export function registerAuth(app: FastifyInstance): void {
  app.decorateRequest('auth', null);

  app.decorate('authenticate', async (req: FastifyRequest) => {
    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) throw errors.unauthorized();
    const auth = await resolveAuth(token);
    if (!auth) throw errors.unauthorized();
    if (auth.status === 'suspended') throw errors.accountRestricted();
    if (auth.mustChangePassword && !PASSWORD_CHANGE_EXEMPT.has(req.routeOptions.url ?? '')) {
      throw errors.passwordChangeRequired();
    }
    req.auth = auth;
    // Touch last_seen at most once a minute per session (fire and forget).
    void getDb()
      .update(schema.sessions)
      .set({ lastSeenAt: new Date() })
      .where(
        and(
          eq(schema.sessions.id, auth.sessionId),
          sql`last_seen_at < now() - interval '60 seconds'`,
        ),
      )
      .catch(() => {});
  });

  app.decorate('requireRole', (role: 'moderator' | 'admin') => {
    return async (req: FastifyRequest) => {
      const r = req.auth?.role;
      const ok = role === 'moderator' ? r === 'moderator' || r === 'admin' : r === 'admin';
      if (!ok) throw errors.forbidden();
    };
  });
}
