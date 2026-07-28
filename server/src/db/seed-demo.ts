/**
 * Demo seed: realistic, entirely FICTIONAL data for local demos and screenshots.
 * Idempotent: refuses to run twice (aborts when 'Demo Admin' already exists).
 * Everything is inserted directly (no API calls); email addresses come from a
 * reserved-looking @demo.sahay.local range and are stored exactly like real
 * ones (AES-GCM ciphertext + blind index) so the OTP login flow works against
 * them with the console email provider.
 *
 *   npm run db:seed:demo   (then: POST /auth/otp/start — the OTP prints to the
 *   server console; any listed demo email logs into that account.)
 */
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { randomInt } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { pseudonymFromIndexes } from '@sahay/shared';
import { loadConfig } from '../config.js';
import { closeDb, getDb, schema } from './index.js';
import { runMigrations } from './migrate.js';
import { seedCatalogue } from './seed.js';
import { emailBlindIndex, encryptPii, shortCode } from '../lib/crypto.js';

const HOUR = 3600_000;
const DAY = 24 * HOUR;

type Db = ReturnType<typeof getDb>;

async function makeUser(
  db: Db,
  opts: {
    pseudonym: string;
    email: string;
    role?: string;
    createdDaysAgo?: number;
    stats?: Partial<typeof schema.reliabilityStats.$inferInsert>;
  },
) {
  const [user] = await db
    .insert(schema.users)
    .values({
      pseudonym: opts.pseudonym,
      avatarSeed: opts.pseudonym,
      role: opts.role ?? 'user',
      emailEnc: encryptPii(opts.email),
      emailHmac: emailBlindIndex(opts.email),
      emailVerifiedAt: new Date(),
      createdAt: new Date(Date.now() - (opts.createdDaysAgo ?? 1) * DAY),
    })
    .returning();
  await db.insert(schema.reliabilityStats).values({ userId: user!.id, ...(opts.stats ?? {}) });
  return user!;
}

async function makeEvent(db: Db, values: Partial<typeof schema.events.$inferInsert> & {
  title: string; type: string; lat: number; lng: number;
}) {
  const { lat, lng, ...rest } = values;
  const [event] = await db
    .insert(schema.events)
    .values({
      code: shortCode(),
      description: 'Demo data — everything here is fictional.',
      areaLabel: rest.areaLabel ?? 'Near City Park, Pune',
      center: `SRID=4326;POINT(${lng} ${lat})`,
      startsAt: rest.startsAt ?? new Date(Date.now() - 2 * HOUR),
      endsAt: rest.endsAt ?? new Date(Date.now() + 10 * HOUR),
      ...rest,
    })
    .returning();
  return event!;
}

async function join(db: Db, userId: string, eventId: string, role = 'member') {
  await db.insert(schema.memberships).values({ userId, eventId, role }).onConflictDoNothing();
}

async function addItem(
  db: Db,
  userId: string,
  eventId: string,
  categoryId: string,
  qty: number,
  unit: string,
  details: Record<string, unknown> = {},
) {
  const [item] = await db
    .insert(schema.inventoryItems)
    .values({ userId, eventId, categoryId, qtyOnHand: String(qty), unit, details })
    .returning();
  return item!;
}

async function helpingNow(db: Db, userId: string, eventId: string, lat: number, lng: number) {
  await db.insert(schema.availability).values({
    userId,
    eventId,
    isOn: true,
    until: new Date(Date.now() + 2 * HOUR),
  });
  await db.execute(sql`
    INSERT INTO member_locations (user_id, event_id, geog, updated_at, expires_at)
    VALUES (${userId}, ${eventId}, ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography,
            now(), ${new Date(Date.now() + 15 * 60_000)})
  `);
}

export async function seedDemo(): Promise<void> {
  const db = getDb();

  const [existing] = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.pseudonym, 'Demo Admin'))
    .limit(1);
  if (existing) {
    console.log('demo seed: "Demo Admin" already exists — nothing to do (idempotent abort)');
    return;
  }

  const cat = async (slug: string) => {
    const [row] = await db.select().from(schema.categories).where(eq(schema.categories.slug, slug)).limit(1);
    if (!row) throw new Error(`category ${slug} missing — run db:seed first`);
    return row;
  };
  const water = await cat('water-bottle');
  const blanket = await cat('blanket');
  const pads = await cat('sanitary-pads');
  const powerBank = await cat('power-bank');
  const bandages = await cat('bandages');

  /* --------------------------------------------------------------- users */

  const admin = await makeUser(db, {
    pseudonym: 'Demo Admin', email: 'demo-admin@demo.sahay.local', role: 'admin', createdDaysAgo: 90,
  });
  const moderator = await makeUser(db, {
    pseudonym: 'Demo Lantern', email: 'demo-lantern@demo.sahay.local', role: 'moderator', createdDaysAgo: 60,
  });

  const participants: (typeof schema.users.$inferSelect)[] = [];
  const seen = new Set<string>(['Demo Admin', 'Demo Lantern']);
  for (let i = 0; i < 12; i++) {
    let pseudonym = pseudonymFromIndexes(randomInt(1024), randomInt(1024));
    while (seen.has(pseudonym)) pseudonym = pseudonymFromIndexes(randomInt(1024), randomInt(1024));
    seen.add(pseudonym);
    const veteran = i === 0; // one highly reliable helper
    participants.push(
      await makeUser(db, {
        pseudonym,
        email: `demo-user-${i}@demo.sahay.local`,
        createdDaysAgo: veteran ? 200 : [45, 30, 14, 7, 3, 1, 1, 0, 0, 0, 5][i - 1] ?? 1,
        stats: veteran
          ? { accepted: 27, completed: 25, requesterConfirmed: 24, offersReceived30d: 12, offersResponded30d: 11, label: 'highly_reliable_helper' }
          : i < 4
            ? { accepted: 5 + i, completed: 4 + i, requesterConfirmed: 3 + i, label: 'active_helper' }
            : {},
      }),
    );
  }
  const [vet, p1, p2, p3, p4, p5, p6, p7, p8, p9, p10, p11] = participants as [
    typeof admin, typeof admin, typeof admin, typeof admin, typeof admin, typeof admin,
    typeof admin, typeof admin, typeof admin, typeof admin, typeof admin, typeof admin,
  ];

  /* -------------------------------------------------------------- events */

  const kitchenLat = 18.5204;
  const kitchenLng = 73.8567;
  const kitchen = await makeEvent(db, {
    title: 'Pune Riverside Community Kitchen',
    type: 'community_kitchen',
    status: 'active',
    visibility: 'public',
    publicApproved: true,
    areaLabel: 'Riverside Ghat, Pune',
    lat: kitchenLat,
    lng: kitchenLng,
    radiusM: 3000,
    startsAt: new Date(Date.now() - 2 * HOUR),
    endsAt: new Date(Date.now() + 10 * HOUR),
    createdBy: admin.id,
  });
  const camp = await makeEvent(db, {
    title: 'Sector 12 Relief Camp',
    type: 'relief_operation',
    status: 'active',
    visibility: 'unlisted',
    areaLabel: 'Sector 12 Community Ground',
    lat: 18.55,
    lng: 73.9,
    startsAt: new Date(Date.now() - 6 * HOUR),
    endsAt: new Date(Date.now() + 48 * HOUR),
    createdBy: moderator.id,
  });
  const winterDrive = await makeEvent(db, {
    title: 'University Winter Drive',
    type: 'campus_event',
    status: 'scheduled',
    visibility: 'public',
    publicApproved: true,
    areaLabel: 'University Main Quad',
    lat: 18.46,
    lng: 73.83,
    startsAt: new Date(Date.now() + 2 * DAY),
    endsAt: new Date(Date.now() + 3 * DAY),
    createdBy: p1.id,
  });

  await join(db, admin.id, kitchen.id, 'event_admin');
  await join(db, moderator.id, kitchen.id);
  await join(db, moderator.id, camp.id, 'event_admin');
  await join(db, p1.id, winterDrive.id, 'event_admin');
  for (const u of [vet, p1, p2, p3, p4, p5, p6, p7, p8]) await join(db, u.id, kitchen.id);
  for (const u of [vet, p9, p10, p11]) await join(db, u.id, camp.id);
  for (const u of [p2, p3, p9]) await join(db, u.id, winterDrive.id);

  /* ---------------------------------------------- inventory + availability */

  const expiry = new Date(Date.now() + 90 * DAY).toISOString().slice(0, 10);
  const vetWater = await addItem(db, vet.id, kitchen.id, water.id, 24, 'bottle', { sealed: true, expiryDate: expiry, packageSize: '1 litre' });
  await addItem(db, p1.id, kitchen.id, water.id, 12, 'bottle', { sealed: true, expiryDate: expiry });
  const p2Water = await addItem(db, p2.id, kitchen.id, water.id, 6, 'bottle', { sealed: true });
  await addItem(db, p3.id, kitchen.id, water.id, 10, 'bottle', { sealed: true, expiryDate: expiry });
  const p4Blankets = await addItem(db, p4.id, kitchen.id, blanket.id, 5, 'blanket', { condition: 'good' });
  await addItem(db, p1.id, kitchen.id, pads.id, 4, 'packet', { sealed: true });
  await addItem(db, p5.id, kitchen.id, powerBank.id, 2, 'piece', { chargePercent: 85 });
  await addItem(db, p9.id, camp.id, bandages.id, 40, 'piece', { sealed: true, expiryDate: expiry });
  await addItem(db, p10.id, camp.id, blanket.id, 8, 'blanket', { condition: 'new' });
  await addItem(db, vet.id, camp.id, water.id, 18, 'bottle', { sealed: true });

  await helpingNow(db, vet.id, kitchen.id, kitchenLat + 0.001, kitchenLng);
  await helpingNow(db, p1.id, kitchen.id, kitchenLat - 0.001, kitchenLng + 0.001);
  await helpingNow(db, p2.id, kitchen.id, kitchenLat + 0.002, kitchenLng - 0.001);
  await helpingNow(db, p3.id, kitchen.id, kitchenLat, kitchenLng + 0.002);
  await helpingNow(db, p9.id, camp.id, 18.551, 73.901);

  /* ------------------------------------------------------------- requests */

  const mkRequest = async (values: Omit<Partial<typeof schema.requests.$inferInsert>, 'qty'> & {
    eventId: string; requesterId: string; categoryId: string; qty: number; unit: string;
  }) => {
    const [row] = await db
      .insert(schema.requests)
      .values({
        urgency: 'standard',
        expiresAt: new Date(Date.now() + 30 * 60_000),
        idempotencyKey: `demo-${shortCode()}`,
        ...values,
        qty: String(values.qty),
      } as typeof schema.requests.$inferInsert)
      .returning();
    await db.insert(schema.requestTransitions).values({
      requestId: row!.id, fromStatus: 'none', toStatus: 'searching', actor: 'requester', reason: 'demo seed',
    });
    return row!;
  };

  // Two live searching requests (water + sanitary pads).
  await mkRequest({ eventId: kitchen.id, requesterId: p6.id, categoryId: water.id, qty: 2, unit: 'bottle', status: 'searching', note: 'near the food counter, green kurta' });
  await mkRequest({ eventId: kitchen.id, requesterId: p7.id, categoryId: pads.id, qty: 1, unit: 'packet', status: 'searching', urgency: 'soon' });

  // A second + third distinct water requester so aggregate demand clears k=3.
  await mkRequest({ eventId: kitchen.id, requesterId: p8.id, categoryId: water.id, qty: 3, unit: 'bottle', status: 'searching', areaHint: 'north gate' });
  await mkRequest({ eventId: kitchen.id, requesterId: p5.id, categoryId: water.id, qty: 1, unit: 'bottle', status: 'searching' });

  // One request that found nobody.
  await mkRequest({
    eventId: kitchen.id, requesterId: p8.id, categoryId: powerBank.id, qty: 1, unit: 'piece',
    status: 'no_match', expiresAt: new Date(Date.now() - HOUR), closedAt: new Date(Date.now() - HOUR),
  });

  /** Full match fixture: offer + match + conversation. */
  const mkMatch = async (opts: {
    request: typeof schema.requests.$inferSelect;
    helperId: string;
    itemId: string;
    qty: number;
    status: string;
    requesterAlias: string;
    helperAlias: string;
    requesterConfirmedQty?: number | null;
    helperConfirmedQty?: number | null;
    closedAgoMin?: number;
    closeReason?: string;
    conversationStatus?: string;
  }) => {
    const [offer] = await db
      .insert(schema.matchOffers)
      .values({
        requestId: opts.request.id,
        helperId: opts.helperId,
        inventoryItemId: opts.itemId,
        qty: String(opts.qty),
        proximity: 'nearby',
        status: 'accepted',
        respondBy: new Date(Date.now() - 30 * 60_000),
        respondedAt: new Date(Date.now() - 30 * 60_000),
      })
      .returning();
    const closed = opts.closedAgoMin != null;
    const [match] = await db
      .insert(schema.matches)
      .values({
        requestId: opts.request.id,
        offerId: offer!.id,
        eventId: opts.request.eventId,
        requesterId: opts.request.requesterId,
        helperId: opts.helperId,
        inventoryItemId: opts.itemId,
        qtyReserved: String(opts.qty),
        proximity: 'nearby',
        status: opts.status,
        requesterAlias: opts.requesterAlias,
        helperAlias: opts.helperAlias,
        requesterMeetingState: closed ? 'done' : 'deciding',
        helperMeetingState: closed ? 'done' : 'deciding',
        requesterConfirmedQty: opts.requesterConfirmedQty == null ? null : String(opts.requesterConfirmedQty),
        helperConfirmedQty: opts.helperConfirmedQty == null ? null : String(opts.helperConfirmedQty),
        inventoryApplied: closed,
        reliabilityApplied: closed,
        createdAt: new Date(Date.now() - ((opts.closedAgoMin ?? 0) + 25) * 60_000),
        closedAt: closed ? new Date(Date.now() - opts.closedAgoMin! * 60_000) : null,
        closeReason: opts.closeReason ?? null,
      })
      .returning();
    const [conversation] = await db
      .insert(schema.conversations)
      .values({
        matchId: match!.id,
        status: opts.conversationStatus ?? 'open',
        expiresAt: closed ? new Date(Date.now() + HOUR) : null,
      })
      .returning();
    return { offer: offer!, match: match!, conversation: conversation! };
  };

  // 1. Fulfilled water request with a completed match, chat, and reliability.
  const fulfilled = await mkRequest({
    eventId: kitchen.id, requesterId: p7.id, categoryId: water.id, qty: 2, unit: 'bottle',
    status: 'fulfilled', qtyFulfilled: '2',
    createdAt: new Date(Date.now() - 90 * 60_000),
    expiresAt: new Date(Date.now() - 45 * 60_000),
    closedAt: new Date(Date.now() - 40 * 60_000),
  });
  const done = await mkMatch({
    request: fulfilled, helperId: vet.id, itemId: vetWater.id, qty: 2,
    status: 'completed', requesterAlias: 'Amber Kite', helperAlias: 'Quiet Heron',
    requesterConfirmedQty: 2, helperConfirmedQty: 2, closedAgoMin: 40, closeReason: 'confirmed',
    conversationStatus: 'readonly',
  });
  // Deduct the handed-over stock exactly like settlement would have.
  await db
    .update(schema.inventoryItems)
    .set({ qtyOnHand: String(24 - 2) })
    .where(eq(schema.inventoryItems.id, vetWater.id));
  const chat: [string, string, string][] = [
    [p7.id, 'quick', 'where_meet'],
    [vet.id, 'quick', 'near_main_entrance'],
    [p7.id, 'text', 'On my way, two minutes. I am wearing a green scarf.'],
    [vet.id, 'text', 'Standing by the tea stall with a blue backpack.'],
    [p7.id, 'quick', 'arrived'],
    [vet.id, 'text', 'Got you — handing over two bottles now.'],
  ];
  for (const [i, [senderId, kind, body]] of chat.entries()) {
    await db.insert(schema.messages).values({
      conversationId: done.conversation.id, senderId, kind, body,
      createdAt: new Date(Date.now() - (70 - i * 4) * 60_000),
      deliveredAt: new Date(Date.now() - (69 - i * 4) * 60_000),
      readAt: new Date(Date.now() - (68 - i * 4) * 60_000),
    });
  }

  // 2. Partially fulfilled blanket request (3 wanted, 2 handed over so far).
  const partial = await mkRequest({
    eventId: kitchen.id, requesterId: p6.id, categoryId: blanket.id, qty: 3, unit: 'blanket',
    status: 'partially_fulfilled', qtyFulfilled: '2',
    createdAt: new Date(Date.now() - 2 * HOUR),
    expiresAt: new Date(Date.now() - 80 * 60_000),
  });
  await mkMatch({
    request: partial, helperId: p4.id, itemId: p4Blankets.id, qty: 2,
    status: 'partially_completed', requesterAlias: 'Misty Reed', helperAlias: 'Copper Wren',
    requesterConfirmedQty: 2, helperConfirmedQty: 2, closedAgoMin: 30, closeReason: 'confirmed',
  });
  await db
    .update(schema.inventoryItems)
    .set({ qtyOnHand: String(5 - 2) })
    .where(eq(schema.inventoryItems.id, p4Blankets.id));

  // 3. A disputed match — the two reports did not agree.
  const disputedReq = await mkRequest({
    eventId: kitchen.id, requesterId: p8.id, categoryId: water.id, qty: 2, unit: 'bottle',
    status: 'searching',
    createdAt: new Date(Date.now() - 70 * 60_000),
    expiresAt: new Date(Date.now() + 20 * 60_000),
  });
  const disputed = await mkMatch({
    request: disputedReq, helperId: p2.id, itemId: p2Water.id, qty: 2,
    status: 'disputed', requesterAlias: 'Sandy Lotus', helperAlias: 'Indigo Fern',
    requesterConfirmedQty: 0, helperConfirmedQty: 2, closedAgoMin: 15, closeReason: 'disputed_quantities',
    conversationStatus: 'readonly',
  });

  /* ------------------------------------------------------ safety & audit */

  // Open report: suspected false request (no evidence chat shared).
  await db.insert(schema.reports).values({
    reporterId: p2.id,
    subjectUserId: p8.id,
    subjectEventId: kitchen.id,
    matchId: disputed.match.id,
    category: 'false_request',
    note: 'Requester confirmed zero after taking both bottles.',
  });

  // Resolved report: a no-show, reviewed and closed by the moderator.
  const [resolvedReport] = await db
    .insert(schema.reports)
    .values({
      reporterId: p6.id,
      subjectUserId: p5.id,
      subjectEventId: kitchen.id,
      category: 'no_show',
      note: 'Waited 20 minutes at the agreed spot.',
      status: 'resolved',
      resolution: 'Warned the helper; first occurrence.',
      resolvedBy: moderator.id,
      createdAt: new Date(Date.now() - 5 * HOUR),
      resolvedAt: new Date(Date.now() - 4 * HOUR),
    })
    .returning();
  const [warnAction] = await db
    .insert(schema.moderationActions)
    .values({
      actorId: moderator.id,
      action: 'warn',
      targetUserId: p5.id,
      reportId: resolvedReport!.id,
      reason: 'Confirmed no-show after accepting a match.',
    })
    .returning();
  await db.insert(schema.auditLog).values([
    { actorId: moderator.id, action: 'warn', target: `user:${p5.id}`, reason: 'Confirmed no-show after accepting a match.' },
    { actorId: moderator.id, action: 'report_resolve', target: `report:${resolvedReport!.id}`, reason: 'Warned the helper; first occurrence.' },
  ]);

  // One block pair (requester blocked the disputed helper).
  await db.insert(schema.blocks).values({ blockerId: p8.id, blockedId: p2.id });

  /* -------------------------------------------------------- notifications */

  await db.insert(schema.notifications).values([
    { userId: p7.id, type: 'match_accepted', titleKey: 'match.matched', bodyKey: 'notifications.vaguePreview', params: {}, deepLink: `/match/${done.match.id}` },
    { userId: vet.id, type: 'match_offer', titleKey: 'offer.title', bodyKey: 'notifications.vaguePreview', params: {}, dedupeKey: `offer:${done.offer.id}` },
    { userId: p5.id, type: 'moderation_outcome', titleKey: 'notifications.moderation_outcome', bodyKey: 'moderation.outcomeBody', params: { action: 'warn' }, dedupeKey: `mod:${warnAction!.id}` },
    { userId: p8.id, type: 'no_helper_found', titleKey: 'notifications.no_helper_found', bodyKey: 'request.noMatch', params: {} },
    { userId: p6.id, type: 'event_notice', titleKey: 'notifications.event_notice', bodyKey: 'moderation.noticeBody', params: { body: 'Hot meals are being served at the riverside counter until 9 pm.' } },
  ]);
  await db.insert(schema.eventNotices).values({
    eventId: kitchen.id,
    body: 'Hot meals are being served at the riverside counter until 9 pm.',
    createdBy: admin.id,
  });

  /* ------------------------------------------------------------- summary */

  console.log(`
demo seed complete — all data is fictional.

events
  ${kitchen.title}  (public, active)      code ${kitchen.code}
  ${camp.title}     (unlisted, active)    code ${camp.code}
  ${winterDrive.title} (public, scheduled) code ${winterDrive.code}

log in (console email provider prints the OTP to the server console):
  demo-admin@demo.sahay.local  Demo Admin      (admin)
  demo-lantern@demo.sahay.local  Demo Lantern    (moderator)
  participants (demo-user-0 … demo-user-11):
${participants.map((p, i) => `    demo-user-${i}@demo.sahay.local  ${p.pseudonym}`).join('\n')}

the "${kitchen.title}" dashboard has k≥3 distinct users on water —
GET /api/v1/events/${kitchen.id}/dashboard shows live numbers.
`);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const config = loadConfig();
  await runMigrations(config.DATABASE_URL);
  await seedCatalogue();
  await seedDemo();
  await closeDb();
}
