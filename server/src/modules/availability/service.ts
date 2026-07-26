/**
 * "Helping Now" availability and the coarse, ephemeral location ping.
 * Locations are UPSERTed (one row, no movement history), coarsened server-side
 * to ~110 m regardless of what the client sent, and expire after a short TTL.
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { coarsen, zAvailability, type AVAILABILITY_DURATIONS_MIN } from '@sahay/shared';
import { loadConfig } from '../../config.js';
import { getDb, schema } from '../../db/index.js';
import { errors } from '../../lib/errors.js';
import { getMembership, resolveEvent } from '../events/service.js';

export type Availability = z.infer<typeof zAvailability>;

export async function getAvailability(userId: string, eventId: string): Promise<Availability> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.availability)
    .where(and(eq(schema.availability.userId, userId), eq(schema.availability.eventId, eventId)))
    .limit(1);
  // Defensive: a stale `until` in the past reads as OFF even before the worker sweeps it.
  const on = !!row?.isOn && (row.until == null || row.until > new Date());
  return { on, until: on && row?.until ? row.until.toISOString() : null };
}

export async function setAvailability(
  auth: { userId: string; status: string; canHelp: boolean },
  eventId: string,
  input: {
    on: boolean;
    durationMinutes?: (typeof AVAILABILITY_DURATIONS_MIN)[number];
    untilEventEnd?: boolean;
  },
): Promise<Availability> {
  const db = getDb();

  if (!input.on) {
    await db
      .insert(schema.availability)
      .values({ userId: auth.userId, eventId, isOn: false, until: null, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: [schema.availability.userId, schema.availability.eventId],
        set: { isOn: false, until: null, updatedAt: new Date() },
      });
    return { on: false, until: null };
  }

  const event = await resolveEvent(eventId);
  if (!event) throw errors.notFound();
  const membership = await getMembership(eventId, auth.userId);
  if (!membership) throw errors.forbidden();
  if (event.status === 'paused') throw errors.eventPaused();
  if (event.status !== 'active') throw errors.eventNotActive();
  if (!auth.canHelp || auth.status !== 'active') throw errors.accountRestricted();

  const until = input.durationMinutes
    ? new Date(Date.now() + input.durationMinutes * 60_000)
    : input.untilEventEnd
      ? event.endsAt
      : null;

  await db
    .insert(schema.availability)
    .values({ userId: auth.userId, eventId, isOn: true, until, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: [schema.availability.userId, schema.availability.eventId],
      set: { isOn: true, until, updatedAt: new Date() },
    });
  return { on: true, until: until ? until.toISOString() : null };
}

/** Location pings are allowed only while helping or actively requesting. */
async function mayShareLocation(userId: string, eventId: string): Promise<boolean> {
  const db = getDb();
  const [avail] = await db
    .select()
    .from(schema.availability)
    .where(
      and(
        eq(schema.availability.userId, userId),
        eq(schema.availability.eventId, eventId),
        eq(schema.availability.isOn, true),
      ),
    )
    .limit(1);
  if (avail && (avail.until == null || avail.until > new Date())) return true;

  const [request] = await db
    .select({ id: schema.requests.id })
    .from(schema.requests)
    .where(
      and(
        eq(schema.requests.requesterId, userId),
        eq(schema.requests.eventId, eventId),
        inArray(schema.requests.status, ['searching', 'offering']),
      ),
    )
    .limit(1);
  return !!request;
}

export async function putLocation(
  userId: string,
  eventId: string,
  coords: { lat: number; lng: number },
): Promise<{ ok: true; expiresAt: string }> {
  if (!(await mayShareLocation(userId, eventId))) throw errors.forbidden();

  const db = getDb();
  const { lat, lng } = coarsen(coords.lat, coords.lng);
  const expiresAt = new Date(Date.now() + loadConfig().LOCATION_TTL_MINUTES * 60_000);

  await db.execute(sql`
    INSERT INTO member_locations (user_id, event_id, geog, updated_at, expires_at)
    VALUES (${userId}, ${eventId}, ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography, now(), ${expiresAt})
    ON CONFLICT (user_id, event_id)
    DO UPDATE SET geog = EXCLUDED.geog, updated_at = now(), expires_at = EXCLUDED.expires_at
  `);

  // Record location consent once per user (not per ping).
  const [consent] = await db
    .select({ id: schema.consentRecords.id })
    .from(schema.consentRecords)
    .where(
      and(
        eq(schema.consentRecords.userId, userId),
        eq(schema.consentRecords.kind, 'location'),
        eq(schema.consentRecords.granted, true),
      ),
    )
    .limit(1);
  if (!consent) {
    await db.insert(schema.consentRecords).values({ userId, kind: 'location', granted: true });
  }

  return { ok: true, expiresAt: expiresAt.toISOString() };
}

export async function deleteLocation(userId: string, eventId: string): Promise<void> {
  const db = getDb();
  await db
    .delete(schema.memberLocations)
    .where(
      and(eq(schema.memberLocations.userId, userId), eq(schema.memberLocations.eventId, eventId)),
    );
}
