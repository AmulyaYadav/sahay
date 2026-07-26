/**
 * Drizzle table definitions mirroring migrations/*.sql (the DDL is authoritative).
 * Geography columns are declared via customType and always read/written through
 * PostGIS SQL expressions.
 */
import {
  bigint,
  boolean,
  customType,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const geography = customType<{ data: string; driverData: string }>({
  dataType: () => 'geography(Point,4326)',
});

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  pseudonym: text('pseudonym').notNull(),
  avatarSeed: text('avatar_seed').notNull(),
  locale: text('locale').notNull().default('en'),
  role: text('role').notNull().default('user'),
  status: text('status').notNull().default('active'),
  phoneEnc: text('phone_enc'),
  phoneHmac: text('phone_hmac').unique(),
  phoneVerifiedAt: ts('phone_verified_at'),
  canRequest: boolean('can_request').notNull().default(true),
  canHelp: boolean('can_help').notNull().default(true),
  suspendedUntil: ts('suspended_until'),
  riskFlags: text('risk_flags').array().notNull().default([]),
  pseudonymChangedAt: ts('pseudonym_changed_at'),
  createdAt: ts('created_at').notNull().defaultNow(),
  deletedAt: ts('deleted_at'),
});

export const otpCodes = pgTable('otp_codes', {
  id: uuid('id').primaryKey().defaultRandom(),
  phoneHmac: text('phone_hmac').notNull(),
  codeHash: text('code_hash').notNull(),
  attempts: integer('attempts').notNull().default(0),
  expiresAt: ts('expires_at').notNull(),
  consumedAt: ts('consumed_at'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull().unique(),
  platform: text('platform').notNull(),
  deviceName: text('device_name'),
  createdAt: ts('created_at').notNull().defaultNow(),
  lastSeenAt: ts('last_seen_at').notNull().defaultNow(),
  expiresAt: ts('expires_at').notNull(),
  revokedAt: ts('revoked_at'),
});

export const pushTokens = pgTable('push_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  provider: text('provider').notNull(),
  token: text('token').notNull(),
  disabled: boolean('disabled').notNull().default(false),
  createdAt: ts('created_at').notNull().defaultNow(),
  lastUsedAt: ts('last_used_at'),
});

export const events = pgTable('events', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: text('code').notNull().unique(),
  title: text('title').notNull(),
  description: text('description').notNull().default(''),
  type: text('type').notNull(),
  status: text('status').notNull().default('scheduled'),
  visibility: text('visibility').notNull().default('unlisted'),
  publicApproved: boolean('public_approved').notNull().default(false),
  inviteCode: text('invite_code'),
  areaLabel: text('area_label').notNull(),
  center: geography('center').notNull(),
  radiusM: integer('radius_m').notNull().default(2000),
  maxMatchRadiusM: integer('max_match_radius_m').notNull().default(5000),
  offerResponseSeconds: integer('offer_response_seconds').notNull().default(45),
  startsAt: ts('starts_at').notNull(),
  endsAt: ts('ends_at').notNull(),
  timezone: text('timezone').notNull().default('Asia/Kolkata'),
  safetyInfo: text('safety_info'),
  medicalInfo: text('medical_info'),
  matchingPaused: boolean('matching_paused').notNull().default(false),
  retentionDays: integer('retention_days').notNull().default(7),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const eventNotices = pgTable('event_notices', {
  id: uuid('id').primaryKey().defaultRandom(),
  eventId: uuid('event_id').notNull().references(() => events.id, { onDelete: 'cascade' }),
  body: text('body').notNull(),
  urgent: boolean('urgent').notNull().default(false),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const memberships = pgTable(
  'memberships',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    eventId: uuid('event_id').notNull().references(() => events.id, { onDelete: 'cascade' }),
    role: text('role').notNull().default('member'),
    muted: boolean('muted').notNull().default(false),
    banned: boolean('banned').notNull().default(false),
    joinedAt: ts('joined_at').notNull().defaultNow(),
    leftAt: ts('left_at'),
  },
  (t) => [uniqueIndex('memberships_user_event_uq').on(t.userId, t.eventId)],
);

export const categories = pgTable('categories', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull().unique(),
  group: text('group').notNull(),
  name: jsonb('name').$type<Record<string, string>>().notNull(),
  description: jsonb('description').$type<Record<string, string>>(),
  icon: text('icon').notNull().default('box'),
  unit: text('unit').notNull(),
  altUnits: text('alt_units').array().notNull().default([]),
  fractional: boolean('fractional').notNull().default(false),
  sealedRequired: boolean('sealed_required').notNull().default(false),
  expiryRelevant: boolean('expiry_relevant').notNull().default(false),
  restricted: boolean('restricted').notNull().default(false),
  warningKey: text('warning_key'),
  maxRequestQty: numeric('max_request_qty').notNull().default('10'),
  maxOfferQty: numeric('max_offer_qty').notNull().default('100'),
  sortOrder: integer('sort_order').notNull().default(0),
  active: boolean('active').notNull().default(true),
});

export const eventCategories = pgTable(
  'event_categories',
  {
    eventId: uuid('event_id').notNull().references(() => events.id, { onDelete: 'cascade' }),
    categoryId: uuid('category_id').notNull().references(() => categories.id, { onDelete: 'cascade' }),
    enabled: boolean('enabled').notNull().default(true),
    maxRequestQty: numeric('max_request_qty'),
    maxOfferQty: numeric('max_offer_qty'),
  },
  (t) => [primaryKey({ columns: [t.eventId, t.categoryId] })],
);

export const inventoryItems = pgTable(
  'inventory_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    eventId: uuid('event_id').notNull().references(() => events.id, { onDelete: 'cascade' }),
    categoryId: uuid('category_id').notNull().references(() => categories.id),
    qtyOnHand: numeric('qty_on_hand').notNull(),
    qtyReserved: numeric('qty_reserved').notNull().default('0'),
    unit: text('unit').notNull(),
    details: jsonb('details').$type<Record<string, unknown>>().notNull().default({}),
    active: boolean('active').notNull().default(true),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
    expiresAt: ts('expires_at'),
    idempotencyKey: text('idempotency_key'),
  },
  (t) => [index('inventory_user_idx2').on(t.userId, t.eventId)],
);

export const availability = pgTable(
  'availability',
  {
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    eventId: uuid('event_id').notNull().references(() => events.id, { onDelete: 'cascade' }),
    isOn: boolean('is_on').notNull().default(false),
    until: ts('until'),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.eventId] })],
);

export const memberLocations = pgTable(
  'member_locations',
  {
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    eventId: uuid('event_id').notNull().references(() => events.id, { onDelete: 'cascade' }),
    geog: geography('geog').notNull(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
    expiresAt: ts('expires_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.eventId] })],
);

export const requests = pgTable('requests', {
  id: uuid('id').primaryKey().defaultRandom(),
  eventId: uuid('event_id').notNull().references(() => events.id, { onDelete: 'cascade' }),
  requesterId: uuid('requester_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  categoryId: uuid('category_id').notNull().references(() => categories.id),
  qty: numeric('qty').notNull(),
  qtyFulfilled: numeric('qty_fulfilled').notNull().default('0'),
  unit: text('unit').notNull(),
  urgency: text('urgency').notNull().default('standard'),
  note: text('note'),
  areaHint: text('area_hint'),
  status: text('status').notNull().default('searching'),
  currentRadiusM: integer('current_radius_m').notNull().default(400),
  attemptCount: integer('attempt_count').notNull().default(0),
  expiresAt: ts('expires_at').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
  closedAt: ts('closed_at'),
  idempotencyKey: text('idempotency_key').notNull(),
});

export const requestTransitions = pgTable('request_transitions', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  requestId: uuid('request_id').notNull().references(() => requests.id, { onDelete: 'cascade' }),
  fromStatus: text('from_status').notNull(),
  toStatus: text('to_status').notNull(),
  actor: text('actor').notNull(),
  reason: text('reason'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const matchOffers = pgTable(
  'match_offers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    requestId: uuid('request_id').notNull().references(() => requests.id, { onDelete: 'cascade' }),
    helperId: uuid('helper_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    inventoryItemId: uuid('inventory_item_id').notNull().references(() => inventoryItems.id, { onDelete: 'cascade' }),
    qty: numeric('qty').notNull(),
    proximity: text('proximity').notNull().default('unknown'),
    status: text('status').notNull().default('offered'),
    offeredAt: ts('offered_at').notNull().defaultNow(),
    respondBy: ts('respond_by').notNull(),
    respondedAt: ts('responded_at'),
  },
  (t) => [uniqueIndex('match_offers_req_helper_uq').on(t.requestId, t.helperId)],
);

export const matches = pgTable('matches', {
  id: uuid('id').primaryKey().defaultRandom(),
  requestId: uuid('request_id').notNull().references(() => requests.id, { onDelete: 'cascade' }),
  offerId: uuid('offer_id').notNull().references(() => matchOffers.id),
  eventId: uuid('event_id').notNull().references(() => events.id, { onDelete: 'cascade' }),
  requesterId: uuid('requester_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  helperId: uuid('helper_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  inventoryItemId: uuid('inventory_item_id').notNull().references(() => inventoryItems.id),
  qtyReserved: numeric('qty_reserved').notNull(),
  proximity: text('proximity').notNull().default('unknown'),
  status: text('status').notNull().default('active'),
  requesterAlias: text('requester_alias').notNull(),
  helperAlias: text('helper_alias').notNull(),
  requesterMeetingState: text('requester_meeting_state').notNull().default('deciding'),
  helperMeetingState: text('helper_meeting_state').notNull().default('deciding'),
  requesterConfirmedQty: numeric('requester_confirmed_qty'),
  helperConfirmedQty: numeric('helper_confirmed_qty'),
  inventoryApplied: boolean('inventory_applied').notNull().default(false),
  reliabilityApplied: boolean('reliability_applied').notNull().default(false),
  createdAt: ts('created_at').notNull().defaultNow(),
  closedAt: ts('closed_at'),
  closeReason: text('close_reason'),
});

export const conversations = pgTable('conversations', {
  id: uuid('id').primaryKey().defaultRandom(),
  matchId: uuid('match_id').notNull().unique().references(() => matches.id, { onDelete: 'cascade' }),
  status: text('status').notNull().default('open'),
  expiresAt: ts('expires_at'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const messages = pgTable('messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  conversationId: uuid('conversation_id').notNull().references(() => conversations.id, { onDelete: 'cascade' }),
  senderId: uuid('sender_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull().default('text'),
  body: text('body').notNull(),
  clientMsgId: text('client_msg_id'),
  createdAt: ts('created_at').notNull().defaultNow(),
  deliveredAt: ts('delivered_at'),
  readAt: ts('read_at'),
});

export const reliabilityStats = pgTable('reliability_stats', {
  userId: uuid('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  accepted: integer('accepted').notNull().default(0),
  completed: integer('completed').notNull().default(0),
  requesterConfirmed: integer('requester_confirmed').notNull().default(0),
  cancelledPreMeeting: integer('cancelled_pre_meeting').notNull().default(0),
  cancelledPostMeeting: integer('cancelled_post_meeting').notNull().default(0),
  timeouts: integer('timeouts').notNull().default(0),
  noShows: integer('no_shows').notNull().default(0),
  disputes: integer('disputes').notNull().default(0),
  offersReceived30d: integer('offers_received_30d').notNull().default(0),
  offersResponded30d: integer('offers_responded_30d').notNull().default(0),
  label: text('label').notNull().default('new_helper'),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const blocks = pgTable(
  'blocks',
  {
    blockerId: uuid('blocker_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    blockedId: uuid('blocked_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.blockerId, t.blockedId] })],
);

export const reports = pgTable('reports', {
  id: uuid('id').primaryKey().defaultRandom(),
  reporterId: uuid('reporter_id').references(() => users.id, { onDelete: 'set null' }),
  subjectUserId: uuid('subject_user_id').references(() => users.id, { onDelete: 'set null' }),
  subjectEventId: uuid('subject_event_id').references(() => events.id, { onDelete: 'set null' }),
  matchId: uuid('match_id').references(() => matches.id, { onDelete: 'set null' }),
  category: text('category').notNull(),
  note: text('note'),
  evidence: jsonb('evidence').$type<unknown>(),
  status: text('status').notNull().default('open'),
  resolution: text('resolution'),
  resolvedBy: uuid('resolved_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: ts('created_at').notNull().defaultNow(),
  resolvedAt: ts('resolved_at'),
});

export const moderationActions = pgTable('moderation_actions', {
  id: uuid('id').primaryKey().defaultRandom(),
  actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
  action: text('action').notNull(),
  targetUserId: uuid('target_user_id').references(() => users.id, { onDelete: 'set null' }),
  targetEventId: uuid('target_event_id').references(() => events.id, { onDelete: 'set null' }),
  targetMatchId: uuid('target_match_id').references(() => matches.id, { onDelete: 'set null' }),
  reportId: uuid('report_id').references(() => reports.id, { onDelete: 'set null' }),
  reason: text('reason').notNull(),
  expiresAt: ts('expires_at'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const appeals = pgTable('appeals', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  moderationActionId: uuid('moderation_action_id').notNull().references(() => moderationActions.id, { onDelete: 'cascade' }),
  body: text('body').notNull(),
  status: text('status').notNull().default('open'),
  resolvedBy: uuid('resolved_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: ts('created_at').notNull().defaultNow(),
  resolvedAt: ts('resolved_at'),
});

export const auditLog = pgTable('audit_log', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  actorId: uuid('actor_id'),
  action: text('action').notNull(),
  target: text('target'),
  reason: text('reason'),
  meta: jsonb('meta').$type<Record<string, unknown>>(),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const notifications = pgTable('notifications', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  type: text('type').notNull(),
  titleKey: text('title_key').notNull(),
  bodyKey: text('body_key').notNull(),
  params: jsonb('params').$type<Record<string, string>>().notNull().default({}),
  deepLink: text('deep_link'),
  dedupeKey: text('dedupe_key'),
  createdAt: ts('created_at').notNull().defaultNow(),
  readAt: ts('read_at'),
});

export const notificationPrefs = pgTable('notification_prefs', {
  userId: uuid('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  detailedPreviews: boolean('detailed_previews').notNull().default(false),
  perType: jsonb('per_type').$type<Record<string, boolean>>().notNull().default({}),
});

export const consentRecords = pgTable('consent_records', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull(),
  granted: boolean('granted').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const dataRequests = pgTable('data_requests', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull(),
  status: text('status').notNull().default('pending'),
  payload: jsonb('payload').$type<unknown>(),
  createdAt: ts('created_at').notNull().defaultNow(),
  completedAt: ts('completed_at'),
});

export const featureFlags = pgTable('feature_flags', {
  key: text('key').primaryKey(),
  enabled: boolean('enabled').notNull().default(false),
  description: text('description').notNull().default(''),
});
