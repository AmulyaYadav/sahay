/**
 * Admin/moderation surface (role-guarded via app.requireRole) plus the two
 * user-facing appeal endpoints (POST /appeals, GET /appeals/mine — documented
 * as additions in docs/api-surface.md Notes). Every mutation writes an audit
 * row; phone data never appears anywhere on this surface.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { EVENT_STATUSES, EVENT_VISIBILITIES, REPORT_STATUSES, zAdminModerate, zCreateAdmin, zSetAdminWants, zUuid } from '@sahay/shared';
import { asc, eq } from 'drizzle-orm';
import { getDb, schema } from '../../db/index.js';
import { errors } from '../../lib/errors.js';
import { resolveAuth } from '../../plugins/auth.js';
import { mapCategory } from '../catalogue/service.js';
import { setAdminWants } from '../events/wants.js';
import {
  createAdminAccount,
  resetAdminPassword,
  adminPatchCategory,
  adminPatchEvent,
  adminStats,
  createAppeal,
  emergencyShutdown,
  listAdminEvents,
  listAppeals,
  listAudit,
  listMyAppeals,
  listReports,
  listUsers,
  moderate,
  publishEventNotice,
  resolveAppeal,
} from './service.js';

const zReportsQuery = z.object({ status: z.enum(REPORT_STATUSES).default('open') });
const zUsersQuery = z.object({ q: z.string().max(100).optional() });
const zEventsQuery = z.object({
  status: z.enum(EVENT_STATUSES).optional(),
  pendingApproval: z.coerce.boolean().optional(),
});
const zNotice = z.object({ body: z.string().min(3).max(1000), urgent: z.boolean().default(false) });
const zEventPatch = z
  .object({
    title: z.string().min(3).max(120).optional(),
    description: z.string().max(2000).optional(),
    status: z.enum(EVENT_STATUSES).optional(),
    visibility: z.enum(EVENT_VISIBILITIES).optional(),
    matchingPaused: z.boolean().optional(),
    retentionDays: z.number().int().min(1).max(365).optional(),
    safetyInfo: z.string().max(2000).nullable().optional(),
    medicalInfo: z.string().max(2000).nullable().optional(),
    startsAt: z.string().datetime({ offset: true }).optional(),
    endsAt: z.string().datetime({ offset: true }).optional(),
  })
  .strict();
const zCategoryPatch = z
  .object({
    active: z.boolean().optional(),
    restricted: z.boolean().optional(),
    maxRequestQty: z.number().positive().max(10000).optional(),
    maxOfferQty: z.number().positive().max(10000).optional(),
    warningKey: z.string().max(100).nullable().optional(),
  })
  .strict();
const zFlagPatch = z.object({ enabled: z.boolean() });
const zCreateAppeal = z.object({ moderationActionId: zUuid, body: z.string().min(5).max(2000) });
const zAppealsQuery = z.object({ status: z.enum(['open', 'upheld', 'overturned']).default('open') });
const zResolveAppeal = z.object({
  outcome: z.enum(['upheld', 'overturned']),
  reason: z.string().min(5).max(1000),
});
const zAuditQuery = z.object({ cursor: z.string().optional() });
const zShutdown = z.object({ reason: z.string().min(5).max(1000) });

export function registerAdminRoutes(app: FastifyInstance): void {
  const mod = { preHandler: [app.authenticate, app.requireRole('moderator')] };
  const admin = { preHandler: [app.authenticate, app.requireRole('admin')] };

  /* ------------------------------------------------------------ moderator */

  app.get('/admin/reports', mod, async (req) => {
    const query = zReportsQuery.parse(req.query ?? {});
    return { items: await listReports(query.status) };
  });

  app.post('/admin/moderate', mod, async (req) => {
    const body = zAdminModerate.parse(req.body);
    return moderate({ userId: req.auth!.userId, role: req.auth!.role }, body);
  });

  app.get('/admin/users', mod, async (req) => {
    const query = zUsersQuery.parse(req.query ?? {});
    return { items: await listUsers(query.q) };
  });

  app.get('/admin/events', mod, async (req) => {
    const query = zEventsQuery.parse(req.query ?? {});
    return {
      items: await listAdminEvents({
        ...(query.status ? { status: query.status } : {}),
        ...(query.pendingApproval ? { pendingApproval: true } : {}),
      }),
    };
  });

  app.post<{ Params: { id: string } }>('/admin/events/:id/notice', mod, async (req) => {
    const body = zNotice.parse(req.body);
    return publishEventNotice(req.auth!.userId, zUuid.parse(req.params.id), body.body, body.urgent);
  });

  app.get('/admin/stats', mod, async () => adminStats());

  /* ---------------------------------------------------------------- admin */

  app.patch<{ Params: { id: string } }>('/admin/events/:id', admin, async (req) => {
    const patch = zEventPatch.parse(req.body);
    const event = await adminPatchEvent(req.auth!.userId, zUuid.parse(req.params.id), patch);
    return { ok: true, id: event.id, status: event.status };
  });

  app.patch<{ Params: { id: string } }>('/admin/events/:id/wants', admin, async (req) => {
    const body = zSetAdminWants.parse(req.body);
    await setAdminWants(zUuid.parse(req.params.id), body.wants);
    return { ok: true };
  });

  // Staff accounts. Admin-tier only: these grant console access.
  app.post('/admin/admins', admin, async (req) => {
    const body = zCreateAdmin.parse(req.body);
    return createAdminAccount(req.auth!.userId, body);
  });

  app.post<{ Params: { id: string } }>('/admin/admins/:id/reset-password', admin, async (req) =>
    resetAdminPassword(req.auth!.userId, zUuid.parse(req.params.id)),
  );

  app.get('/admin/categories', admin, async () => {
    const rows = await getDb().select().from(schema.categories).orderBy(asc(schema.categories.sortOrder));
    return { categories: rows.map((r) => mapCategory(r)) };
  });

  app.patch<{ Params: { id: string } }>('/admin/categories/:id', admin, async (req) => {
    const patch = zCategoryPatch.parse(req.body);
    const updated = await adminPatchCategory(req.auth!.userId, zUuid.parse(req.params.id), patch);
    return mapCategory(updated);
  });

  app.get('/admin/flags', admin, async () => {
    const flags = await getDb().select().from(schema.featureFlags).orderBy(asc(schema.featureFlags.key));
    return { flags };
  });

  app.patch<{ Params: { key: string } }>('/admin/flags/:key', admin, async (req) => {
    const body = zFlagPatch.parse(req.body);
    const db = getDb();
    const [updated] = await db
      .update(schema.featureFlags)
      .set({ enabled: body.enabled })
      .where(eq(schema.featureFlags.key, req.params.key))
      .returning();
    if (!updated) throw errors.notFound();
    await db.insert(schema.auditLog).values({
      actorId: req.auth!.userId,
      action: 'flag_update',
      target: `flag:${req.params.key}`,
      reason: `enabled=${body.enabled}`,
    });
    return updated;
  });

  app.get('/admin/appeals', admin, async (req) => {
    const query = zAppealsQuery.parse(req.query ?? {});
    return { items: await listAppeals(query.status) };
  });

  app.post<{ Params: { id: string } }>('/admin/appeals/:id/resolve', admin, async (req) => {
    const body = zResolveAppeal.parse(req.body);
    return resolveAppeal(
      { userId: req.auth!.userId, role: req.auth!.role },
      zUuid.parse(req.params.id),
      body.outcome,
      body.reason,
    );
  });

  app.get('/admin/audit', admin, async (req) => {
    const query = zAuditQuery.parse(req.query ?? {});
    return listAudit(query.cursor);
  });

  app.post('/admin/emergency-shutdown', admin, async (req) => {
    const body = zShutdown.parse(req.body);
    return emergencyShutdown(req.auth!.userId, body.reason);
  });

  /* -------------------------------------------- user-facing appeal routes */

  // Appeals are the remedy channel for moderation, so — unlike every other
  // authenticated route — a SUSPENDED account may still use them (a fresh
  // session via OTP works even while suspended). Deleted accounts cannot.
  const authenticateAllowSuspended = async (req: FastifyRequest) => {
    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) throw errors.unauthorized();
    const auth = await resolveAuth(token);
    if (!auth) throw errors.unauthorized();
    req.auth = auth;
  };

  app.post('/appeals', { preHandler: [authenticateAllowSuspended] }, async (req) => {
    const body = zCreateAppeal.parse(req.body);
    return createAppeal(req.auth!.userId, body.moderationActionId, body.body);
  });

  app.get('/appeals/mine', { preHandler: [authenticateAllowSuspended] }, async (req) => ({
    items: await listMyAppeals(req.auth!.userId),
  }));
}
