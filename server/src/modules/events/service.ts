/**
 * Events: creation, discovery, join/leave. Coordinates are coarsened on entry
 * and never leave the database — responses carry only the human areaLabel.
 */
import { and, asc, desc, eq, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import { nextDailyStart } from '../../workers/attendance.js';
import type { z } from 'zod';
import {
  coarsen,
  zCreateEvent,
  zEventSearch,
  type Category,
  type EventDetail,
  type EventSummary,
  type PublicWant,
} from '@sahay/shared';

export type CreateEventInput = z.infer<typeof zCreateEvent>;
export type EventSearchInput = z.infer<typeof zEventSearch>;
import { getDb, schema } from '../../db/index.js';
import { AppError, errors } from '../../lib/errors.js';
import { shortCode } from '../../lib/crypto.js';
import { rateLimit } from '../../lib/redis.js';
import { mapCategory } from '../catalogue/service.js';
import { computePublicWants } from './wants.js';

type EventRow = typeof schema.events.$inferSelect;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function ewkt(lat: number, lng: number): string {
  return `SRID=4326;POINT(${lng} ${lat})`;
}

function toSummary(event: EventRow, wants: PublicWant[] = [], joined?: boolean): EventSummary {
  return {
    id: event.id,
    code: event.code,
    title: event.title,
    type: event.type as EventSummary['type'],
    status: event.status as EventSummary['status'],
    visibility: event.visibility as EventSummary['visibility'],
    areaLabel: event.areaLabel,
    startsAt: event.startsAt.toISOString(),
    endsAt: event.endsAt.toISOString(),
    timezone: event.timezone,
    wants,
    ...(joined === undefined ? {} : { joined }),
  };
}

/** Effective categories for an event: overrides when present, else all active globals. */
export async function effectiveEventCategories(
  eventId: string,
): Promise<{ category: typeof schema.categories.$inferSelect; maxRequestQty: number; maxOfferQty: number }[]> {
  const db = getDb();
  const overridden = await db
    .select({
      category: schema.categories,
      ovRequest: schema.eventCategories.maxRequestQty,
      ovOffer: schema.eventCategories.maxOfferQty,
      enabled: schema.eventCategories.enabled,
    })
    .from(schema.eventCategories)
    .innerJoin(schema.categories, eq(schema.eventCategories.categoryId, schema.categories.id))
    .where(eq(schema.eventCategories.eventId, eventId))
    .orderBy(asc(schema.categories.sortOrder));
  if (overridden.length > 0) {
    return overridden
      .filter((r) => r.enabled && r.category.active)
      .map((r) => ({
        category: r.category,
        maxRequestQty: Number(r.ovRequest ?? r.category.maxRequestQty),
        maxOfferQty: Number(r.ovOffer ?? r.category.maxOfferQty),
      }));
  }
  const all = await db
    .select()
    .from(schema.categories)
    .where(eq(schema.categories.active, true))
    .orderBy(asc(schema.categories.sortOrder));
  return all.map((category) => ({
    category,
    maxRequestQty: Number(category.maxRequestQty),
    maxOfferQty: Number(category.maxOfferQty),
  }));
}

export async function getMembership(eventId: string, userId: string) {
  const db = getDb();
  const [m] = await db
    .select()
    .from(schema.memberships)
    .where(
      and(
        eq(schema.memberships.eventId, eventId),
        eq(schema.memberships.userId, userId),
        isNull(schema.memberships.leftAt),
      ),
    )
    .limit(1);
  return m ?? null;
}

export async function buildEventDetail(event: EventRow, userId: string | null): Promise<EventDetail> {
  const db = getDb();
  const membership = userId ? await getMembership(event.id, userId) : null;
  // Real (non-k-anonymized) demand signal is only computed for the public
  // landing page's own events — small private events are exactly where a
  // single-requester signal is most identifying, so unlisted/invite_only
  // events never get real wants, matching the dashboard's public-access rule.
  const openToAnyone =
    event.visibility === 'public' &&
    event.publicApproved &&
    event.status !== 'draft' &&
    event.status !== 'disabled';
  const wants = openToAnyone ? (await computePublicWants([event.id])).get(event.id) ?? [] : [];
  const notices = await db
    .select()
    .from(schema.eventNotices)
    .where(eq(schema.eventNotices.eventId, event.id))
    .orderBy(desc(schema.eventNotices.createdAt))
    .limit(20);
  const cats = await effectiveEventCategories(event.id);
  const categories: Category[] = cats.map((c) =>
    mapCategory(c.category, { maxRequestQty: c.maxRequestQty, maxOfferQty: c.maxOfferQty }),
  );
  return {
    ...toSummary(event, wants, userId ? membership != null : undefined),
    description: event.description,
    safetyInfo: event.safetyInfo,
    medicalInfo: event.medicalInfo,
    notices: notices.map((n) => ({ id: n.id, body: n.body, createdAt: n.createdAt.toISOString() })),
    requiresInvite: event.visibility === 'invite_only',
    matchingPaused: event.matchingPaused,
    categories,
    membership: membership
      ? {
          joinedAt: membership.joinedAt.toISOString(),
          muted: membership.muted,
          role: membership.role === 'event_admin' ? 'event_admin' : 'member',
        }
      : null,
  };
}

export async function resolveEvent(idOrCode: string): Promise<EventRow | null> {
  const db = getDb();
  const where = UUID_RE.test(idOrCode)
    ? eq(schema.events.id, idOrCode)
    : eq(schema.events.code, idOrCode.toUpperCase());
  const [event] = await db.select().from(schema.events).where(where).limit(1);
  return event ?? null;
}

/** draft/disabled events exist only for members and site moderators. */
export async function getEventForViewer(
  idOrCode: string,
  viewer: { userId: string; role: string } | null,
): Promise<EventRow> {
  const event = await resolveEvent(idOrCode);
  if (!event) throw errors.notFound();
  if (event.status === 'draft' || event.status === 'disabled') {
    const privileged = viewer && (viewer.role === 'moderator' || viewer.role === 'admin');
    const member = viewer ? await getMembership(event.id, viewer.userId) : null;
    if (!privileged && !member) throw errors.notFound();
  }
  return event;
}

export async function createEvent(
  userId: string,
  input: CreateEventInput,
): Promise<{ event: EventDetail; inviteCode?: string }> {
  const db = getDb();
  const startsAt = new Date(input.startsAt);
  const endsAt = new Date(input.endsAt);
  if (endsAt <= startsAt) throw errors.validation({ field: 'endsAt' });

  const allowed = await rateLimit('event:create', userId, 5, 86_400).catch(() => false);
  if (!allowed) throw errors.rateLimited();

  const center = coarsen(input.center.lat, input.center.lng);

  // Duplicate heuristic: same title (case-insensitive), within 5 km, overlapping window.
  const dupe = await db
    .select({ code: schema.events.code })
    .from(schema.events)
    .where(
      and(
        sql`lower(${schema.events.title}) = lower(${input.title})`,
        sql`${schema.events.status} <> 'archived'`,
        sql`ST_DWithin(${schema.events.center}, ST_SetSRID(ST_MakePoint(${center.lng}, ${center.lat}), 4326)::geography, 5000)`,
        sql`${schema.events.startsAt} < ${endsAt}`,
        sql`${schema.events.endsAt} > ${startsAt}`,
      ),
    )
    .limit(1);
  if (dupe[0]) throw new AppError('request_conflict', { duplicateEventCode: dupe[0].code });

  const now = new Date();
  const status = startsAt <= now && now < endsAt ? 'active' : 'scheduled';
  const inviteCode = input.visibility === 'invite_only' ? shortCode() : null;

  const event = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(schema.events)
      .values({
        code: shortCode(),
        title: input.title,
        description: input.description,
        type: input.type,
        status,
        visibility: input.visibility,
        publicApproved: false, // public listing always pends moderation
        inviteCode,
        areaLabel: input.areaLabel,
        center: ewkt(center.lat, center.lng),
        radiusM: input.radiusM,
        startsAt,
        endsAt,
        timezone: input.timezone,
        safetyInfo: input.safetyInfo ?? null,
        medicalInfo: input.medicalInfo ?? null,
        createdBy: userId,
      })
      .returning();
    if (!created) throw new Error('event insert returned no row');

    if (input.categorySlugs && input.categorySlugs.length > 0) {
      const cats = await tx
        .select({ id: schema.categories.id })
        .from(schema.categories)
        .where(
          and(inArray(schema.categories.slug, input.categorySlugs), eq(schema.categories.active, true)),
        );
      if (cats.length === 0) throw errors.validation({ field: 'categorySlugs' });
      await tx
        .insert(schema.eventCategories)
        .values(cats.map((c) => ({ eventId: created.id, categoryId: c.id })));
    }

    await tx
      .insert(schema.memberships)
      .values({ userId, eventId: created.id, role: 'event_admin' });
    return created;
  });

  const detail = await buildEventDetail(event, userId);
  return inviteCode ? { event: detail, inviteCode } : { event: detail };
}

export async function searchEvents(
  input: EventSearchInput,
  userId: string | null,
): Promise<{ items: EventSummary[]; nextCursor: string | null }> {
  const db = getDb();
  const conditions: SQL[] = [
    inArray(schema.events.status, ['scheduled', 'active']),
    eq(schema.events.visibility, 'public'),
    eq(schema.events.publicApproved, true),
  ];
  if (input.q) {
    const like = `%${input.q.replaceAll('%', '\\%').replaceAll('_', '\\_')}%`;
    conditions.push(
      or(sql`${schema.events.title} ILIKE ${like}`, sql`${schema.events.areaLabel} ILIKE ${like}`)!,
    );
  }
  if (input.type) conditions.push(eq(schema.events.type, input.type));

  const near = input.near ? coarsen(input.near.lat, input.near.lng) : null;
  if (near) {
    conditions.push(
      sql`ST_DWithin(${schema.events.center}, ST_SetSRID(ST_MakePoint(${near.lng}, ${near.lat}), 4326)::geography, 50000)`,
    );
  }

  // Keyset (starts_at, id) applies to the time-ordered listing; the "nearby"
  // listing is distance-ordered and returns a single page.
  if (!near && input.cursor) {
    const idx = input.cursor.indexOf('|');
    const ts = idx > 0 ? new Date(input.cursor.slice(0, idx)) : new Date(NaN);
    const id = idx > 0 ? input.cursor.slice(idx + 1) : '';
    if (Number.isNaN(ts.getTime()) || !UUID_RE.test(id)) throw errors.validation({ field: 'cursor' });
    conditions.push(sql`(${schema.events.startsAt}, ${schema.events.id}) > (${ts}, ${id}::uuid)`);
  }

  const order = near
    ? [sql`ST_Distance(${schema.events.center}, ST_SetSRID(ST_MakePoint(${near.lng}, ${near.lat}), 4326)::geography)`]
    : [asc(schema.events.startsAt), asc(schema.events.id)];

  const rows = await db
    .select()
    .from(schema.events)
    .where(and(...conditions))
    .orderBy(...order)
    .limit(input.limit);

  let joinedIds = new Set<string>();
  if (userId && rows.length > 0) {
    const ms = await db
      .select({ eventId: schema.memberships.eventId })
      .from(schema.memberships)
      .where(
        and(
          eq(schema.memberships.userId, userId),
          inArray(schema.memberships.eventId, rows.map((r) => r.id)),
          isNull(schema.memberships.leftAt),
        ),
      );
    joinedIds = new Set(ms.map((m) => m.eventId));
  }

  const wantsByEvent = await computePublicWants(rows.map((r) => r.id));
  const items = rows.map((r) =>
    toSummary(r, (wantsByEvent.get(r.id) ?? []).slice(0, 3), userId ? joinedIds.has(r.id) : undefined),
  );
  const last = rows[rows.length - 1];
  const nextCursor =
    !near && rows.length === input.limit && last ? `${last.startsAt.toISOString()}|${last.id}` : null;
  return { items, nextCursor };
}

export async function joinEvent(
  userId: string,
  eventId: string,
  inviteCode: string | undefined,
): Promise<EventDetail> {
  const event = await resolveEvent(eventId);
  if (!event) throw errors.notFound();
  if (event.status !== 'active' && event.status !== 'scheduled') throw errors.eventNotActive();
  if (event.visibility === 'invite_only' && (!inviteCode || inviteCode !== event.inviteCode)) {
    throw errors.forbidden();
  }

  const db = getDb();
  const [existing] = await db
    .select()
    .from(schema.memberships)
    .where(and(eq(schema.memberships.eventId, event.id), eq(schema.memberships.userId, userId)))
    .limit(1);
  if (existing?.banned) throw errors.forbidden();
  if (existing) {
    if (existing.leftAt) {
      await db
        .update(schema.memberships)
        .set({ leftAt: null })
        .where(eq(schema.memberships.id, existing.id));
    }
  } else {
    await db
      .insert(schema.memberships)
      .values({ userId, eventId: event.id })
      .onConflictDoUpdate({
        target: [schema.memberships.userId, schema.memberships.eventId],
        set: { leftAt: null },
      });
  }
  return buildEventDetail(event, userId);
}

export async function leaveEvent(userId: string, eventId: string): Promise<void> {
  const db = getDb();
  await db.transaction(async (tx) => {
    await tx
      .update(schema.memberships)
      .set({ leftAt: new Date() })
      .where(
        and(
          eq(schema.memberships.eventId, eventId),
          eq(schema.memberships.userId, userId),
          isNull(schema.memberships.leftAt),
        ),
      );
    await tx
      .update(schema.availability)
      .set({ isOn: false, until: null, updatedAt: new Date() })
      .where(and(eq(schema.availability.eventId, eventId), eq(schema.availability.userId, userId)));
    await tx
      .delete(schema.memberLocations)
      .where(
        and(eq(schema.memberLocations.eventId, eventId), eq(schema.memberLocations.userId, userId)),
      );
  });
}

export async function muteEvent(userId: string, eventId: string, muted: boolean): Promise<void> {
  const db = getDb();
  const rows = await db
    .update(schema.memberships)
    .set({ muted })
    .where(
      and(
        eq(schema.memberships.eventId, eventId),
        eq(schema.memberships.userId, userId),
        isNull(schema.memberships.leftAt),
      ),
    )
    .returning({ id: schema.memberships.id });
  if (rows.length === 0) throw errors.notFound();
}

/**
 * Records an answer to the "24 hours to go" reminder.
 *
 * Declining on a day that has a successor is just a decline: the next day's
 * reminder still fires. Declining when no further day exists ends the membership,
 * because staying joined would keep the person counted as attending an event they
 * have said they are not coming to.
 */
export async function answerAttendance(
  userId: string,
  eventId: string,
  attending: boolean,
): Promise<{ ok: true; leftEvent: boolean; nextOccurrence: string | null }> {
  const db = getDb();
  const [event] = await db.select().from(schema.events).where(eq(schema.events.id, eventId)).limit(1);
  if (!event) throw errors.notFound();

  const next = nextDailyStart(event.startsAt, event.endsAt, new Date(Date.now() + 60_000));
  const nextOccurrence = next ? next.toISOString() : null;

  if (attending || nextOccurrence) {
    return { ok: true, leftEvent: false, nextOccurrence };
  }

  await leaveEvent(userId, eventId);
  return { ok: true, leftEvent: true, nextOccurrence: null };
}
