/**
 * Moderation & administration. Every action: (1) is checked against a per-role
 * allowlist, (2) requires a written reason, (3) writes a moderation_actions row
 * AND an append-only audit_log row in the same transaction as its effects, and
 * (4) notifies affected users via 'moderation_outcome' where applicable.
 * Admins never see phone data anywhere on this surface.
 */
import { and, desc, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { z } from 'zod';
import {
  MODERATION_ACTIONS,
  PROHIBITED_PATTERNS,
  type ModerationActionKind,
  type zAdminModerate,
  type zAdminReportView,
  type zAdminUserView,
} from '@sahay/shared';
import { getDb, schema, type Tx } from '../../db/index.js';
import { errors } from '../../lib/errors.js';
import { notifyQueue } from '../../queues.js';
import { publishToUser } from '../../realtime/hub.js';
import { cancelMatchForModeration } from '../matches/service.js';
import { transitionRequest } from '../requests/transitions.js';

export type AdminModerateInput = z.infer<typeof zAdminModerate>;
export type AdminReportView = z.infer<typeof zAdminReportView>;
export type AdminUserView = z.infer<typeof zAdminUserView>;

/* ------------------------------------------------------------ allowlisting */

export const MODERATOR_MAX_SUSPEND_HOURS = 168;

const MODERATOR_ACTIONS: ReadonlySet<string> = new Set([
  'warn',
  'restrict_requests',
  'restrict_helping',
  'suspend',
  'event_pause',
  'event_unpause',
  'event_approve_public',
  'event_reject_public',
  'match_cancel',
  'report_resolve',
  'report_dismiss',
]);

const ADMIN_ONLY_ACTIONS: ReadonlySet<string> = new Set(['unsuspend', 'event_disable']);

/**
 * Pure allowlist check (unit-tested). Moderators may suspend only with a
 * bounded duration (≤ 168h); indefinite or longer suspensions are admin-only.
 */
export function actionAllowedForRole(
  action: string,
  role: string,
  durationHours?: number,
): action is ModerationActionKind {
  if (!(MODERATION_ACTIONS as readonly string[]).includes(action)) return false;
  if (role === 'admin') return true;
  if (role !== 'moderator') return false;
  if (ADMIN_ONLY_ACTIONS.has(action)) return false;
  if (!MODERATOR_ACTIONS.has(action)) return false;
  if (action === 'suspend' && (durationHours == null || durationHours > MODERATOR_MAX_SUSPEND_HOURS)) {
    return false;
  }
  return true;
}

/** Denylist gate for the catalogue (unit-tested): slug + every localized name. */
export function violatesDenylist(slug: string, name: Record<string, string> | null | undefined): boolean {
  const texts = [slug, ...Object.values(name ?? {})];
  return texts.some((text) => PROHIBITED_PATTERNS.some((re) => re.test(text)));
}

/* ------------------------------------------------------------------ audit */

async function audit(
  tx: Tx | ReturnType<typeof getDb>,
  actorId: string | null,
  action: string,
  target: string,
  reason: string,
  meta?: Record<string, unknown>,
): Promise<void> {
  await tx.insert(schema.auditLog).values({ actorId, action, target, reason, meta: meta ?? null });
}

async function notifyModerationOutcome(userId: string, action: string, dedupeKey: string): Promise<void> {
  await notifyQueue().add('notify', {
    userId,
    type: 'moderation_outcome',
    titleKey: 'notifications.moderation_outcome',
    bodyKey: 'moderation.outcomeBody',
    params: { action },
    dedupeKey,
  });
}

/* ---------------------------------------------------------------- moderate */

interface Actor {
  userId: string;
  role: string;
}

async function requireUser(tx: Tx, userId: string | undefined) {
  if (!userId) throw errors.validation({ field: 'targetUserId' });
  const [user] = await tx.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1).for('update');
  if (!user) throw errors.notFound();
  return user;
}

async function requireEvent(tx: Tx, eventId: string | undefined) {
  if (!eventId) throw errors.validation({ field: 'targetEventId' });
  const [event] = await tx.select().from(schema.events).where(eq(schema.events.id, eventId)).limit(1).for('update');
  if (!event) throw errors.notFound();
  return event;
}

export async function moderate(actor: Actor, input: AdminModerateInput): Promise<{ ok: true }> {
  const action = input.action;
  if (!actionAllowedForRole(action, actor.role, input.durationHours)) throw errors.forbidden();

  const db = getDb();
  const afterCommit: (() => Promise<void>)[] = [];

  await db.transaction(async (tx) => {
    const insertAction = async (fields: {
      targetUserId?: string | null;
      targetEventId?: string | null;
      targetMatchId?: string | null;
      reportId?: string | null;
      expiresAt?: Date | null;
    }): Promise<string> => {
      const [row] = await tx
        .insert(schema.moderationActions)
        .values({
          actorId: actor.userId,
          action,
          targetUserId: fields.targetUserId ?? null,
          targetEventId: fields.targetEventId ?? null,
          targetMatchId: fields.targetMatchId ?? null,
          reportId: fields.reportId ?? null,
          reason: input.reason,
          expiresAt: fields.expiresAt ?? null,
        })
        .returning({ id: schema.moderationActions.id });
      return row!.id;
    };

    switch (action) {
      case 'warn': {
        const user = await requireUser(tx, input.targetUserId);
        const actionId = await insertAction({ targetUserId: user.id });
        await audit(tx, actor.userId, action, `user:${user.id}`, input.reason);
        afterCommit.push(() => notifyModerationOutcome(user.id, action, `mod:${actionId}`));
        break;
      }

      case 'restrict_requests':
      case 'restrict_helping': {
        const user = await requireUser(tx, input.targetUserId);
        await tx
          .update(schema.users)
          .set(action === 'restrict_requests' ? { canRequest: false } : { canHelp: false })
          .where(eq(schema.users.id, user.id));
        const expiresAt = input.durationHours
          ? new Date(Date.now() + input.durationHours * 3600_000)
          : null;
        const actionId = await insertAction({ targetUserId: user.id, expiresAt });
        await audit(tx, actor.userId, action, `user:${user.id}`, input.reason);
        afterCommit.push(() => notifyModerationOutcome(user.id, action, `mod:${actionId}`));
        break;
      }

      case 'suspend': {
        const user = await requireUser(tx, input.targetUserId);
        const suspendedUntil = input.durationHours
          ? new Date(Date.now() + input.durationHours * 3600_000)
          : null; // indefinite — admin only (allowlist enforces this)
        await tx
          .update(schema.users)
          .set({ status: 'suspended', suspendedUntil })
          .where(eq(schema.users.id, user.id));
        const revoked = await tx
          .update(schema.sessions)
          .set({ revokedAt: new Date() })
          .where(and(eq(schema.sessions.userId, user.id), isNull(schema.sessions.revokedAt)))
          .returning({ id: schema.sessions.id });
        await tx
          .update(schema.availability)
          .set({ isOn: false, until: null, updatedAt: new Date() })
          .where(eq(schema.availability.userId, user.id));
        const activeMatches = await tx
          .select({ id: schema.matches.id })
          .from(schema.matches)
          .where(
            and(
              eq(schema.matches.status, 'active'),
              or(eq(schema.matches.requesterId, user.id), eq(schema.matches.helperId, user.id)),
            ),
          );
        const actionId = await insertAction({ targetUserId: user.id, expiresAt: suspendedUntil });
        await audit(tx, actor.userId, action, `user:${user.id}`, input.reason, {
          durationHours: input.durationHours ?? null,
        });
        afterCommit.push(async () => {
          for (const s of revoked) {
            await publishToUser(user.id, 'session.revoked', { sessionId: s.id }).catch(() => {});
          }
          for (const m of activeMatches) {
            await cancelMatchForModeration(m.id, 'moderation_suspend');
          }
          await notifyModerationOutcome(user.id, action, `mod:${actionId}`);
        });
        break;
      }

      case 'unsuspend': {
        const user = await requireUser(tx, input.targetUserId);
        await tx
          .update(schema.users)
          .set({ status: 'active', suspendedUntil: null, canRequest: true, canHelp: true })
          .where(eq(schema.users.id, user.id));
        const actionId = await insertAction({ targetUserId: user.id });
        await audit(tx, actor.userId, action, `user:${user.id}`, input.reason);
        afterCommit.push(() => notifyModerationOutcome(user.id, action, `mod:${actionId}`));
        break;
      }

      case 'event_pause':
      case 'event_unpause': {
        const event = await requireEvent(tx, input.targetEventId);
        await tx
          .update(schema.events)
          .set({ matchingPaused: action === 'event_pause' })
          .where(eq(schema.events.id, event.id));
        await insertAction({ targetEventId: event.id });
        await audit(tx, actor.userId, action, `event:${event.id}`, input.reason);
        break;
      }

      case 'event_approve_public':
      case 'event_reject_public': {
        const event = await requireEvent(tx, input.targetEventId);
        await tx
          .update(schema.events)
          .set({ publicApproved: action === 'event_approve_public' })
          .where(eq(schema.events.id, event.id));
        const actionId = await insertAction({ targetEventId: event.id });
        await audit(tx, actor.userId, action, `event:${event.id}`, input.reason);
        if (action === 'event_reject_public' && event.createdBy) {
          const creatorId = event.createdBy;
          afterCommit.push(() => notifyModerationOutcome(creatorId, action, `mod:${actionId}`));
        }
        break;
      }

      case 'event_disable': {
        const event = await requireEvent(tx, input.targetEventId);
        await tx.update(schema.events).set({ status: 'disabled' }).where(eq(schema.events.id, event.id));
        // Open (unmatched) requests are terminated here; matched ones close via
        // the match cancels below, which route them to 'moderated' themselves.
        const open = await tx
          .select()
          .from(schema.requests)
          .where(
            and(
              eq(schema.requests.eventId, event.id),
              inArray(schema.requests.status, ['searching', 'offering']),
            ),
          )
          .for('update');
        for (const request of open) {
          await tx
            .update(schema.matchOffers)
            .set({ status: 'superseded', respondedAt: new Date() })
            .where(
              and(eq(schema.matchOffers.requestId, request.id), eq(schema.matchOffers.status, 'offered')),
            );
          await transitionRequest(tx, request, 'moderated', 'moderator', input.reason, {
            closedAt: new Date(),
          });
        }
        const activeMatches = await tx
          .select({ id: schema.matches.id })
          .from(schema.matches)
          .where(and(eq(schema.matches.eventId, event.id), eq(schema.matches.status, 'active')));
        await insertAction({ targetEventId: event.id });
        await audit(tx, actor.userId, action, `event:${event.id}`, input.reason);
        afterCommit.push(async () => {
          for (const m of activeMatches) {
            await cancelMatchForModeration(m.id, 'event_disabled');
          }
        });
        break;
      }

      case 'match_cancel': {
        if (!input.targetMatchId) throw errors.validation({ field: 'targetMatchId' });
        const [match] = await tx
          .select({ id: schema.matches.id, status: schema.matches.status })
          .from(schema.matches)
          .where(eq(schema.matches.id, input.targetMatchId))
          .limit(1);
        if (!match) throw errors.notFound();
        await insertAction({ targetMatchId: match.id });
        await audit(tx, actor.userId, action, `match:${match.id}`, input.reason);
        if (match.status === 'active') {
          afterCommit.push(() => cancelMatchForModeration(match.id, input.reason));
        }
        break;
      }

      case 'report_resolve':
      case 'report_dismiss': {
        if (!input.reportId) throw errors.validation({ field: 'reportId' });
        const [report] = await tx
          .select()
          .from(schema.reports)
          .where(eq(schema.reports.id, input.reportId))
          .limit(1)
          .for('update');
        if (!report) throw errors.notFound();
        await tx
          .update(schema.reports)
          .set({
            status: action === 'report_resolve' ? 'resolved' : 'dismissed',
            resolution: input.reason,
            resolvedBy: actor.userId,
            resolvedAt: new Date(),
          })
          .where(eq(schema.reports.id, report.id));
        const actionId = await insertAction({
          reportId: report.id,
          targetUserId: report.subjectUserId,
          targetEventId: report.subjectEventId,
        });
        await audit(tx, actor.userId, action, `report:${report.id}`, input.reason);
        if (report.reporterId) {
          const reporterId = report.reporterId;
          afterCommit.push(() => notifyModerationOutcome(reporterId, action, `mod:${actionId}`));
        }
        break;
      }

      default:
        throw errors.forbidden();
    }
  });

  for (const fn of afterCommit) await fn();
  return { ok: true };
}

/* ----------------------------------------------------------------- reports */

export async function listReports(status: string): Promise<AdminReportView[]> {
  const db = getDb();
  const reporter = alias(schema.users, 'reporter');
  const subject = alias(schema.users, 'subject');
  const rows = await db
    .select({
      report: schema.reports,
      reporterPseudonym: reporter.pseudonym,
      subjectPseudonym: subject.pseudonym,
      eventTitle: schema.events.title,
    })
    .from(schema.reports)
    .leftJoin(reporter, eq(schema.reports.reporterId, reporter.id))
    .leftJoin(subject, eq(schema.reports.subjectUserId, subject.id))
    .leftJoin(schema.events, eq(schema.reports.subjectEventId, schema.events.id))
    .where(eq(schema.reports.status, status))
    .orderBy(desc(schema.reports.createdAt))
    .limit(100);
  return rows.map((r) => ({
    id: r.report.id,
    category: r.report.category as AdminReportView['category'],
    status: r.report.status as AdminReportView['status'],
    note: r.report.note,
    reporterPseudonym: r.reporterPseudonym ?? '—',
    subjectPseudonym: r.subjectPseudonym,
    subjectUserId: r.report.subjectUserId,
    eventTitle: r.eventTitle,
    conversationExcerpt: (r.report.evidence ?? null) as AdminReportView['conversationExcerpt'],
    createdAt: r.report.createdAt.toISOString(),
  }));
}

/* ------------------------------------------------------------------- users */

export async function listUsers(q: string | undefined): Promise<AdminUserView[]> {
  const db = getDb();
  const like = q ? `%${q.replaceAll('%', '\\%').replaceAll('_', '\\_')}%` : null;
  const rows = await db
    .select({
      user: schema.users,
      reportCount: sql<number>`(
        SELECT count(*)::int FROM reports rp WHERE rp.subject_user_id = ${schema.users.id}
      )`,
    })
    .from(schema.users)
    .where(like ? sql`${schema.users.pseudonym} ILIKE ${like}` : sql`true`)
    .orderBy(desc(schema.users.createdAt))
    .limit(100);
  return rows.map((r) => ({
    id: r.user.id,
    pseudonym: r.user.pseudonym,
    role: r.user.role as AdminUserView['role'],
    status: r.user.status as AdminUserView['status'],
    createdAt: r.user.createdAt.toISOString(),
    emailVerified: r.user.emailVerifiedAt != null, // never the address
    reportCount: Number(r.reportCount),
    riskFlags: r.user.riskFlags ?? [],
  }));
}

/* ------------------------------------------------------------------ events */

export async function listAdminEvents(filters: { status?: string; pendingApproval?: boolean }) {
  const db = getDb();
  const conditions = [];
  if (filters.status) conditions.push(eq(schema.events.status, filters.status));
  if (filters.pendingApproval) {
    conditions.push(eq(schema.events.visibility, 'public'), eq(schema.events.publicApproved, false));
  }
  const rows = await db
    .select({ event: schema.events, createdByPseudonym: schema.users.pseudonym })
    .from(schema.events)
    .leftJoin(schema.users, eq(schema.events.createdBy, schema.users.id))
    .where(conditions.length ? and(...conditions) : sql`true`)
    .orderBy(desc(schema.events.createdAt))
    .limit(200);
  return rows.map((r) => ({
    id: r.event.id,
    code: r.event.code,
    title: r.event.title,
    type: r.event.type,
    status: r.event.status,
    visibility: r.event.visibility,
    publicApproved: r.event.publicApproved,
    matchingPaused: r.event.matchingPaused,
    startsAt: r.event.startsAt.toISOString(),
    endsAt: r.event.endsAt.toISOString(),
    createdBy: r.createdByPseudonym,
    createdAt: r.event.createdAt.toISOString(),
  }));
}

export async function publishEventNotice(
  actorId: string,
  eventId: string,
  body: string,
  urgent: boolean,
): Promise<{ ok: true }> {
  const db = getDb();
  const [event] = await db.select().from(schema.events).where(eq(schema.events.id, eventId)).limit(1);
  if (!event) throw errors.notFound();

  const [notice] = await db
    .insert(schema.eventNotices)
    .values({ eventId, body, urgent, createdBy: actorId })
    .returning();
  await audit(db, actorId, 'event_notice', `event:${eventId}`, body.slice(0, 200), { urgent });

  // Fan out to current, unmuted members. Dedupe key makes re-publishing safe.
  const members = await db
    .select({ userId: schema.memberships.userId })
    .from(schema.memberships)
    .where(
      and(
        eq(schema.memberships.eventId, eventId),
        isNull(schema.memberships.leftAt),
        eq(schema.memberships.banned, false),
        eq(schema.memberships.muted, false),
      ),
    );
  for (const m of members) {
    await notifyQueue().add('notify', {
      userId: m.userId,
      type: 'event_notice',
      titleKey: 'notifications.event_notice',
      bodyKey: 'moderation.noticeBody',
      params: { body },
      deepLink: `/event/${event.code}`,
      dedupeKey: `notice:${notice!.id}`,
    });
  }
  return { ok: true };
}

export interface AdminEventPatch {
  title?: string;
  description?: string;
  status?: string;
  visibility?: string;
  matchingPaused?: boolean;
  retentionDays?: number;
  safetyInfo?: string | null;
  medicalInfo?: string | null;
  startsAt?: string;
  endsAt?: string;
}

export async function adminPatchEvent(actorId: string, eventId: string, patch: AdminEventPatch) {
  const db = getDb();
  const [event] = await db.select().from(schema.events).where(eq(schema.events.id, eventId)).limit(1);
  if (!event) throw errors.notFound();

  const set: Partial<typeof schema.events.$inferInsert> = {};
  if (patch.title !== undefined) set.title = patch.title;
  if (patch.description !== undefined) set.description = patch.description;
  if (patch.status !== undefined) set.status = patch.status;
  if (patch.visibility !== undefined) set.visibility = patch.visibility;
  if (patch.matchingPaused !== undefined) set.matchingPaused = patch.matchingPaused;
  if (patch.retentionDays !== undefined) set.retentionDays = patch.retentionDays;
  if (patch.safetyInfo !== undefined) set.safetyInfo = patch.safetyInfo;
  if (patch.medicalInfo !== undefined) set.medicalInfo = patch.medicalInfo;
  if (patch.startsAt !== undefined) set.startsAt = new Date(patch.startsAt);
  if (patch.endsAt !== undefined) set.endsAt = new Date(patch.endsAt);
  if (Object.keys(set).length === 0) throw errors.validation({ reason: 'empty patch' });

  const [updated] = await db.update(schema.events).set(set).where(eq(schema.events.id, eventId)).returning();
  await audit(db, actorId, 'event_update', `event:${eventId}`, 'admin event edit', {
    fields: Object.keys(set),
  });
  return updated!;
}

/* -------------------------------------------------------------- categories */

export interface AdminCategoryPatch {
  active?: boolean;
  restricted?: boolean;
  maxRequestQty?: number;
  maxOfferQty?: number;
  warningKey?: string | null;
}

export async function adminPatchCategory(actorId: string, categoryId: string, patch: AdminCategoryPatch) {
  const db = getDb();
  const [category] = await db
    .select()
    .from(schema.categories)
    .where(eq(schema.categories.id, categoryId))
    .limit(1);
  if (!category) throw errors.notFound();

  // Enabling a category re-runs the denylist — prohibited goods can never come
  // back through an admin toggle.
  if (patch.active === true && violatesDenylist(category.slug, category.name)) {
    throw errors.prohibitedCategory();
  }

  const set: Partial<typeof schema.categories.$inferInsert> = {};
  if (patch.active !== undefined) set.active = patch.active;
  if (patch.restricted !== undefined) set.restricted = patch.restricted;
  if (patch.maxRequestQty !== undefined) set.maxRequestQty = String(patch.maxRequestQty);
  if (patch.maxOfferQty !== undefined) set.maxOfferQty = String(patch.maxOfferQty);
  if (patch.warningKey !== undefined) set.warningKey = patch.warningKey;
  if (Object.keys(set).length === 0) throw errors.validation({ reason: 'empty patch' });

  const [updated] = await db
    .update(schema.categories)
    .set(set)
    .where(eq(schema.categories.id, categoryId))
    .returning();
  await audit(db, actorId, 'category_update', `category:${category.slug}`, 'admin catalogue edit', {
    fields: Object.keys(set),
  });
  return updated!;
}

/* ----------------------------------------------------------------- appeals */

export async function createAppeal(userId: string, moderationActionId: string, body: string) {
  const db = getDb();
  const [action] = await db
    .select()
    .from(schema.moderationActions)
    .where(eq(schema.moderationActions.id, moderationActionId))
    .limit(1);
  // Only the person the action targeted may appeal it; others get a plain 404.
  if (!action || action.targetUserId !== userId) throw errors.notFound();

  const [existing] = await db
    .select({ id: schema.appeals.id })
    .from(schema.appeals)
    .where(
      and(eq(schema.appeals.moderationActionId, moderationActionId), eq(schema.appeals.status, 'open')),
    )
    .limit(1);
  if (existing) throw errors.conflict();

  const [appeal] = await db
    .insert(schema.appeals)
    .values({ userId, moderationActionId, body })
    .returning();
  return toAppealView(appeal!, action.action);
}

function toAppealView(row: typeof schema.appeals.$inferSelect, action: string | null) {
  return {
    id: row.id,
    moderationActionId: row.moderationActionId,
    action,
    body: row.body,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    resolvedAt: row.resolvedAt ? row.resolvedAt.toISOString() : null,
  };
}

export async function listMyAppeals(userId: string) {
  const db = getDb();
  const rows = await db
    .select({ appeal: schema.appeals, action: schema.moderationActions.action })
    .from(schema.appeals)
    .innerJoin(schema.moderationActions, eq(schema.appeals.moderationActionId, schema.moderationActions.id))
    .where(eq(schema.appeals.userId, userId))
    .orderBy(desc(schema.appeals.createdAt));
  return rows.map((r) => toAppealView(r.appeal, r.action));
}

export async function listAppeals(status: string) {
  const db = getDb();
  const rows = await db
    .select({
      appeal: schema.appeals,
      action: schema.moderationActions.action,
      actionReason: schema.moderationActions.reason,
      appellantPseudonym: schema.users.pseudonym,
    })
    .from(schema.appeals)
    .innerJoin(schema.moderationActions, eq(schema.appeals.moderationActionId, schema.moderationActions.id))
    .innerJoin(schema.users, eq(schema.appeals.userId, schema.users.id))
    .where(eq(schema.appeals.status, status))
    .orderBy(desc(schema.appeals.createdAt))
    .limit(100);
  return rows.map((r) => ({
    ...toAppealView(r.appeal, r.action),
    actionReason: r.actionReason,
    appellantPseudonym: r.appellantPseudonym,
  }));
}

export async function resolveAppeal(
  actor: Actor,
  appealId: string,
  outcome: 'upheld' | 'overturned',
  reason: string,
): Promise<{ ok: true }> {
  const db = getDb();
  const appellant = await db.transaction(async (tx) => {
    const [row] = await tx
      .select({ appeal: schema.appeals, action: schema.moderationActions })
      .from(schema.appeals)
      .innerJoin(
        schema.moderationActions,
        eq(schema.appeals.moderationActionId, schema.moderationActions.id),
      )
      .where(eq(schema.appeals.id, appealId))
      .limit(1)
      .for('update', { of: schema.appeals });
    if (!row) throw errors.notFound();
    if (row.appeal.status !== 'open') throw errors.conflict();

    await tx
      .update(schema.appeals)
      .set({ status: outcome, resolvedBy: actor.userId, resolvedAt: new Date() })
      .where(eq(schema.appeals.id, appealId));

    if (outcome === 'overturned' && row.action.targetUserId) {
      const targetId = row.action.targetUserId;
      if (row.action.action === 'suspend') {
        await tx
          .update(schema.users)
          .set({ status: 'active', suspendedUntil: null })
          .where(and(eq(schema.users.id, targetId), eq(schema.users.status, 'suspended')));
      } else if (row.action.action === 'restrict_requests') {
        await tx.update(schema.users).set({ canRequest: true }).where(eq(schema.users.id, targetId));
      } else if (row.action.action === 'restrict_helping') {
        await tx.update(schema.users).set({ canHelp: true }).where(eq(schema.users.id, targetId));
      }
    }

    await audit(tx, actor.userId, 'appeal_resolve', `appeal:${appealId}`, reason, {
      outcome,
      moderationActionId: row.appeal.moderationActionId,
    });
    return row.appeal.userId;
  });

  await notifyModerationOutcome(appellant, `appeal_${outcome}`, `appeal:${appealId}`);
  return { ok: true };
}

/* ------------------------------------------------------------------- audit */

export async function listAudit(cursor: string | undefined, limit = 50) {
  const db = getDb();
  const cursorId = cursor ? Number(cursor) : null;
  if (cursor && (!Number.isInteger(cursorId) || cursorId! <= 0)) {
    throw errors.validation({ field: 'cursor' });
  }
  const rows = await db
    .select({ log: schema.auditLog, actorPseudonym: schema.users.pseudonym })
    .from(schema.auditLog)
    .leftJoin(schema.users, eq(schema.auditLog.actorId, schema.users.id))
    .where(cursorId ? lt(schema.auditLog.id, cursorId) : sql`true`)
    .orderBy(desc(schema.auditLog.id))
    .limit(limit);
  const items = rows.map((r) => ({
    id: r.log.id,
    actorPseudonym: r.actorPseudonym, // null = system
    action: r.log.action,
    target: r.log.target,
    reason: r.log.reason,
    createdAt: r.log.createdAt.toISOString(),
  }));
  const last = items[items.length - 1];
  return { items, nextCursor: items.length === limit && last ? String(last.id) : null };
}

/* ------------------------------------------------------------------- stats */

/** Privacy-safe operational aggregates. No per-user rows, ever. */
export async function adminStats() {
  const db = getDb();
  const [users] = (
    await db.execute(sql`
      SELECT count(*)::int AS total,
             (SELECT count(DISTINCT user_id)::int FROM sessions
              WHERE last_seen_at > now() - interval '7 days' AND revoked_at IS NULL) AS active_7d
      FROM users WHERE deleted_at IS NULL
    `)
  ).rows as { total: number; active_7d: number }[];

  const eventsByStatus = (
    await db.execute(sql`SELECT status, count(*)::int AS n FROM events GROUP BY status`)
  ).rows as { status: string; n: number }[];

  const requestsByStatus = (
    await db.execute(sql`
      SELECT status, count(*)::int AS n FROM requests
      WHERE created_at > now() - interval '24 hours' GROUP BY status
    `)
  ).rows as { status: string; n: number }[];

  const [matches24h] = (
    await db.execute(sql`
      SELECT count(*) FILTER (WHERE m.status IN ('completed', 'partially_completed')
               AND m.closed_at > now() - interval '24 hours')::int AS completed,
             percentile_cont(0.5) WITHIN GROUP (
               ORDER BY extract(epoch FROM m.created_at - r.created_at)
             ) FILTER (WHERE m.created_at > now() - interval '24 hours') AS median_seconds
      FROM matches m JOIN requests r ON r.id = m.request_id
    `)
  ).rows as { completed: number; median_seconds: number | null }[];

  const [offers24h] = (
    await db.execute(sql`
      SELECT count(*) FILTER (WHERE status = 'accepted')::int AS accepted,
             count(*) FILTER (WHERE status <> 'offered')::int AS resolved
      FROM match_offers WHERE offered_at > now() - interval '24 hours'
    `)
  ).rows as { accepted: number; resolved: number }[];

  const [misc] = (
    await db.execute(sql`
      SELECT (SELECT count(*)::int FROM notifications
              WHERE created_at > now() - interval '24 hours') AS notifications_24h,
             (SELECT count(*)::int FROM reports WHERE status = 'open') AS reports_open
    `)
  ).rows as { notifications_24h: number; reports_open: number }[];

  return {
    users: { total: users?.total ?? 0, active7d: users?.active_7d ?? 0 },
    eventsByStatus: Object.fromEntries(eventsByStatus.map((r) => [r.status, Number(r.n)])),
    requests24hByStatus: Object.fromEntries(requestsByStatus.map((r) => [r.status, Number(r.n)])),
    matches24h: {
      completed: Number(matches24h?.completed ?? 0),
      medianTimeToMatchSeconds:
        matches24h?.median_seconds == null ? null : Number(matches24h.median_seconds),
    },
    offers24h: {
      accepted: Number(offers24h?.accepted ?? 0),
      resolved: Number(offers24h?.resolved ?? 0),
      acceptanceRate:
        Number(offers24h?.resolved ?? 0) > 0
          ? Number(offers24h!.accepted) / Number(offers24h!.resolved)
          : null,
    },
    notifications24h: Number(misc?.notifications_24h ?? 0),
    reportsOpen: Number(misc?.reports_open ?? 0),
  };
}

/* --------------------------------------------------------------- shutdown */

export async function emergencyShutdown(actorId: string, reason: string) {
  const db = getDb();
  const paused = await db.transaction(async (tx) => {
    const rows = await tx
      .update(schema.events)
      .set({ matchingPaused: true })
      .where(and(eq(schema.events.status, 'active'), eq(schema.events.matchingPaused, false)))
      .returning({ id: schema.events.id });
    await tx
      .update(schema.featureFlags)
      .set({ enabled: false })
      .where(eq(schema.featureFlags.key, 'signup_open'));
    await audit(tx, actorId, 'emergency_shutdown', 'platform', reason, { pausedEvents: rows.length });
    return rows.length;
  });
  return { ok: true as const, pausedEvents: paused };
}
