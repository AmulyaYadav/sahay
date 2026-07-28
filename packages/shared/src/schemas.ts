import { z } from 'zod';
import {
  AVAILABILITY_DURATIONS_MIN,
  CATEGORY_GROUPS,
  CONVERSATION_STATUSES,
  EVENT_STATUSES,
  EVENT_TYPES,
  EVENT_VISIBILITIES,
  LIMITS,
  MATCH_STATUSES,
  MEETING_STATES,
  MESSAGE_KINDS,
  NOTIFICATION_TYPES,
  OFFER_STATUSES,
  PROXIMITY_BUCKETS,
  QUICK_REPLIES,
  RELIABILITY_LABELS,
  REPORT_CATEGORIES,
  REPORT_STATUSES,
  REQUEST_STATUSES,
  REQUEST_URGENCIES,
  SHORTAGE_LEVELS,
  UNITS,
  USER_ROLES,
  USER_STATUSES,
} from './constants.js';

/* ------------------------------------------------------------------ common */

export const zUuid = z.string().uuid();
export const zIsoDate = z.string().datetime({ offset: true });
export const zLocale = z.enum(['en', 'hi']);
/** E.164, but we only accept Indian + generic international at launch. */
export const zPhone = z.string().regex(/^\+[1-9]\d{6,14}$/, 'invalid_phone');
export const zQty = z.number().positive().max(10000);
export const zIdempotencyKey = z.string().min(8).max(64);

export const zCoords = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

export const zPagination = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

/** Uniform error envelope for every non-2xx response. */
export const zApiError = z.object({
  error: z.object({
    code: z.string(), // machine-readable, e.g. "insufficient_inventory"
    message: z.string(), // localized, safe to display
    requestId: z.string().optional(),
    details: z.record(z.unknown()).optional(),
  }),
});
export type ApiError = z.infer<typeof zApiError>;

/* -------------------------------------------------------------------- auth */

export const zOtpStart = z.object({
  email: z.string().email(),
  locale: zLocale.default('en'),
});
export const zOtpVerify = z.object({
  email: z.string().email(),
  code: z.string().length(LIMITS.otpLength).regex(/^\d+$/),
  device: z.object({
    platform: z.enum(['ios', 'android', 'web']),
    name: z.string().max(60).optional(),
  }),
});
export const zAuthSession = z.object({
  token: z.string(), // opaque bearer; store securely, never log
  expiresAt: zIsoDate,
  user: z.lazy(() => zMe),
  isNewAccount: z.boolean(),
});
export type AuthSession = z.infer<typeof zAuthSession>;

/* -------------------------------------------------------------------- user */

export const zMe = z.object({
  id: zUuid, // internal id — exposed only to the account owner, never to peers
  pseudonym: z.string(),
  avatarSeed: z.string(),
  locale: zLocale,
  role: z.enum(USER_ROLES),
  status: z.enum(USER_STATUSES),
  emailVerified: z.boolean(),
  createdAt: zIsoDate,
});
export type Me = z.infer<typeof zMe>;

/** What one participant may see about another. Nothing else ever crosses. */
export const zPeerProfile = z.object({
  alias: z.string(), // match-specific pseudonym, e.g. "Blue Sparrow"
  avatarSeed: z.string(),
  reliabilityLabel: z.enum(RELIABILITY_LABELS),
  completedAssists: z.number().int(),
  memberSince: z.string(), // "March 2026" — month granularity only
  emailVerifiedLabel: z.boolean(), // "Email verified" — states exactly what was verified
});
export type PeerProfile = z.infer<typeof zPeerProfile>;

export const zUpdateMe = z.object({
  locale: zLocale.optional(),
  regeneratePseudonym: z.boolean().optional(), // rate-limited server-side
});

export const zSessionInfo = z.object({
  id: zUuid,
  current: z.boolean(),
  platform: z.string(),
  deviceName: z.string().nullable(),
  createdAt: zIsoDate,
  lastSeenAt: zIsoDate,
});

/* ------------------------------------------------------------------ events */

export const zPublicWant = z.object({
  categorySlug: z.string(),
  source: z.enum(['admin', 'user']),
  requestedQty: z.number().nullable(), // null when source is 'admin' and no real demand exists yet
  requesterCount: z.number().int().nullable(), // null when source is 'admin'
});
export type PublicWant = z.infer<typeof zPublicWant>;

export const zEventSummary = z.object({
  id: zUuid,
  code: z.string(), // short public identifier, e.g. "MELA-7K2F"
  title: z.string(),
  type: z.enum(EVENT_TYPES),
  status: z.enum(EVENT_STATUSES),
  visibility: z.enum(EVENT_VISIBILITIES),
  areaLabel: z.string(), // "Near City Park, Pune" — never precise
  startsAt: zIsoDate,
  endsAt: zIsoDate,
  timezone: z.string(),
  joined: z.boolean().optional(),
  wants: z.array(zPublicWant), // top-3 merged wants on list views, full list on detail
});
export type EventSummary = z.infer<typeof zEventSummary>;

export const zEventDetail = zEventSummary.extend({
  description: z.string(),
  safetyInfo: z.string().nullable(),
  medicalInfo: z.string().nullable(), // event-configured emergency guidance
  notices: z.array(z.object({ id: zUuid, body: z.string(), createdAt: zIsoDate })),
  requiresInvite: z.boolean(),
  matchingPaused: z.boolean(),
  categories: z.array(z.lazy(() => zCategory)),
  membership: z
    .object({ joinedAt: zIsoDate, muted: z.boolean(), role: z.enum(['member', 'event_admin']) })
    .nullable(),
});
export type EventDetail = z.infer<typeof zEventDetail>;

export const zCreateEvent = z.object({
  title: z.string().min(3).max(120),
  description: z.string().max(2000),
  type: z.enum(EVENT_TYPES),
  visibility: z.enum(EVENT_VISIBILITIES), // 'public' requires moderator approval to be listed
  areaLabel: z.string().min(3).max(120),
  center: zCoords, // coarsened server-side; only used for discovery + matching radius
  radiusM: z.number().int().min(100).max(20000).default(2000),
  startsAt: zIsoDate,
  endsAt: zIsoDate,
  timezone: z.string().default('Asia/Kolkata'),
  safetyInfo: z.string().max(2000).optional(),
  medicalInfo: z.string().max(2000).optional(),
  categorySlugs: z.array(z.string()).optional(), // default: all active defaults
});

export const zJoinEvent = z.object({
  inviteCode: z.string().max(40).optional(),
});

export const zEventSearch = zPagination.extend({
  q: z.string().max(100).optional(),
  near: zCoords.optional(), // client sends coarse coords voluntarily for "nearby"
  type: z.enum(EVENT_TYPES).optional(),
});

export const zAdminEventWants = z.object({
  categorySlugs: z.array(z.string()).max(50),
});
export type AdminEventWantsInput = z.infer<typeof zAdminEventWants>;

/* --------------------------------------------------------------- catalogue */

export const zCategory = z.object({
  id: zUuid,
  slug: z.string(),
  group: z.enum(CATEGORY_GROUPS),
  name: z.record(zLocale, z.string()), // localized names
  description: z.record(zLocale, z.string()).optional(),
  icon: z.string(), // icon key in the design system
  unit: z.enum(UNITS),
  altUnits: z.array(z.enum(UNITS)).default([]),
  fractional: z.boolean(),
  sealedRequired: z.boolean(),
  expiryRelevant: z.boolean(),
  restricted: z.boolean(),
  warningKey: z.string().nullable(), // i18n key for category-specific warning
  maxRequestQty: z.number(),
  maxOfferQty: z.number(),
  sortOrder: z.number().int(),
  active: z.boolean(),
});
export type Category = z.infer<typeof zCategory>;

/* --------------------------------------------------------------- inventory */

export const zItemDetails = z.object({
  condition: z.enum(['new', 'good', 'usable']).optional(),
  sealed: z.boolean().optional(),
  expiryDate: z.string().date().optional(),
  packageSize: z.string().max(40).optional(), // "1 litre", "pack of 10"
  chargePercent: z.number().int().min(0).max(100).optional(),
  sizeLabel: z.string().max(20).optional(), // clothing size
});

export const zInventoryItem = z.object({
  id: zUuid,
  eventId: zUuid,
  categoryId: zUuid,
  categorySlug: z.string(),
  qtyTotal: zQty,
  qtyAvailable: z.number().min(0),
  qtyReserved: z.number().min(0),
  unit: z.enum(UNITS),
  details: zItemDetails,
  active: z.boolean(),
  updatedAt: zIsoDate,
});
export type InventoryItem = z.infer<typeof zInventoryItem>;

export const zAddInventory = z.object({
  categoryId: zUuid,
  qty: zQty,
  unit: z.enum(UNITS),
  details: zItemDetails.default({}),
  idempotencyKey: zIdempotencyKey.optional(),
});
export const zUpdateInventory = z.object({
  qtyTotal: zQty.optional(), // available adjusts by the same delta; server clamps at reserved
  details: zItemDetails.optional(),
  active: z.boolean().optional(),
});

/* ------------------------------------------------------------- availability */

export const zSetAvailability = z.object({
  on: z.boolean(),
  durationMinutes: z
    .union([z.literal(AVAILABILITY_DURATIONS_MIN[0]), z.literal(AVAILABILITY_DURATIONS_MIN[1]), z.literal(AVAILABILITY_DURATIONS_MIN[2])])
    .optional(),
  untilEventEnd: z.boolean().optional(),
});
export const zAvailability = z.object({
  on: z.boolean(),
  until: zIsoDate.nullable(),
});

/** Coarse location ping — only while requesting or Helping Now. */
export const zLocationPing = z.object({
  coords: zCoords, // client coarsens first; server coarsens again defensively
});

/* ---------------------------------------------------------------- requests */

export const zCreateRequest = z.object({
  eventId: zUuid,
  categoryId: zUuid,
  qty: zQty,
  unit: z.enum(UNITS),
  urgency: z.enum(REQUEST_URGENCIES).default('standard'),
  note: z.string().max(LIMITS.maxNoteLength).optional(),
  expiresInMinutes: z.number().int().min(5).max(120).default(15),
  coords: zCoords.optional(), // temporary; expires with LIMITS.locationTtlMinutes
  areaHint: z.string().max(80).optional(), // fallback landmark, e.g. "north gate"
  safetyAcknowledged: z.literal(true),
  idempotencyKey: zIdempotencyKey,
});

export const zRequestView = z.object({
  id: zUuid,
  eventId: zUuid,
  categoryId: zUuid,
  categorySlug: z.string(),
  qty: zQty,
  qtyFulfilled: z.number().min(0),
  unit: z.enum(UNITS),
  urgency: z.enum(REQUEST_URGENCIES),
  note: z.string().nullable(),
  status: z.enum(REQUEST_STATUSES),
  expiresAt: zIsoDate,
  createdAt: zIsoDate,
  attemptCount: z.number().int(),
  activeMatchId: zUuid.nullable(),
});
export type RequestView = z.infer<typeof zRequestView>;

export const zRenewRequest = z.object({ expiresInMinutes: z.number().int().min(5).max(120).default(15) });

/* ------------------------------------------------------------------ offers */

export const zOfferView = z.object({
  id: zUuid,
  requestId: zUuid,
  eventId: zUuid,
  categorySlug: z.string(),
  qtyRequested: zQty,
  qtyYouHave: z.number(),
  unit: z.enum(UNITS),
  urgency: z.enum(REQUEST_URGENCIES),
  proximity: z.enum(PROXIMITY_BUCKETS),
  note: z.string().nullable(), // requester note, safety-filtered
  respondBy: zIsoDate,
  status: z.enum(OFFER_STATUSES),
});
export type OfferView = z.infer<typeof zOfferView>;

export const zOfferRespond = z.object({
  accept: z.boolean(),
  alsoStopReceiving: z.boolean().default(false), // "temporarily stop receiving requests"
});

/* ----------------------------------------------------------------- matches */

export const zMatchView = z.object({
  id: zUuid,
  requestId: zUuid,
  eventId: zUuid,
  role: z.enum(['requester', 'helper']),
  categorySlug: z.string(),
  qtyReserved: zQty,
  unit: z.enum(UNITS),
  status: z.enum(MATCH_STATUSES),
  myMeetingState: z.enum(MEETING_STATES),
  peerMeetingState: z.enum(MEETING_STATES),
  peer: zPeerProfile,
  myAlias: z.string(),
  conversationId: zUuid,
  proximity: z.enum(PROXIMITY_BUCKETS),
  createdAt: zIsoDate,
  myConfirmedQty: z.number().nullable(),
  peerConfirmed: z.boolean(),
});
export type MatchView = z.infer<typeof zMatchView>;

export const zMeetingUpdate = z.object({ state: z.enum(MEETING_STATES) });

export const zCancelMatch = z.object({
  reason: z.enum(['changed_mind', 'cannot_find', 'no_longer_needed', 'unsafe', 'other']),
  note: z.string().max(200).optional(),
});

export const zConfirmCompletion = z.object({
  // Actual quantity exchanged; may be less than reserved. 0 = "nothing was
  // exchanged", which lets one-sided disputes surface honestly.
  qty: z.number().min(0).max(10000),
  idempotencyKey: zIdempotencyKey,
});

export const zContinueRequest = z.object({
  continueSearching: z.boolean(), // after partial fulfilment
});

/* -------------------------------------------------------------------- chat */

export const zMessage = z.object({
  id: zUuid,
  conversationId: zUuid,
  senderAlias: z.string(), // never a user id
  mine: z.boolean(),
  kind: z.enum(MESSAGE_KINDS),
  body: z.string(), // for kind=quick this is the QuickReplyKey; clients localize
  createdAt: zIsoDate,
  deliveredAt: zIsoDate.nullable(),
  readAt: zIsoDate.nullable(),
});
export type Message = z.infer<typeof zMessage>;

export const zSendMessage = z.object({
  kind: z.enum(['text', 'quick']),
  body: z.string().min(1).max(LIMITS.maxMessageLength),
  clientMsgId: zIdempotencyKey, // dedupes retries on flaky networks
});

export const zConversationView = z.object({
  id: zUuid,
  matchId: zUuid,
  status: z.enum(CONVERSATION_STATUSES),
  expiresAt: zIsoDate.nullable(),
  quickReplies: z.array(z.enum(QUICK_REPLIES)),
});

/* ------------------------------------------------------- dashboard / needs */

export const zCategoryNeed = z.object({
  categoryId: zUuid,
  categorySlug: z.string(),
  level: z.enum(SHORTAGE_LEVELS),
  requestedQty: z.number().nullable(), // null when below k-anonymity threshold
  offeredQty: z.number().nullable(),
  reservedQty: z.number().nullable(),
  fulfilledRecentQty: z.number().nullable(),
  unit: z.enum(UNITS),
});
export type CategoryNeed = z.infer<typeof zCategoryNeed>;

export const zEventDashboard = z.object({
  eventId: zUuid,
  generatedAt: zIsoDate,
  approximate: z.literal(true), // reminder in the payload itself: community-reported
  needs: z.array(zCategoryNeed),
  recentFulfilments: z.number().int(), // count over trailing hour, k-anonymized
});
export type EventDashboard = z.infer<typeof zEventDashboard>;

export const zBringSuggestion = z.object({
  categoryId: zUuid,
  categorySlug: z.string(),
  level: z.enum(SHORTAGE_LEVELS),
  suggestedQty: z.number(),
  unit: z.enum(UNITS),
  reasonKey: z.string(), // i18n key explaining why it's suggested
});

/* ------------------------------------------------------ reports and blocks */

export const zCreateReport = z.object({
  category: z.enum(REPORT_CATEGORIES),
  note: z.string().max(LIMITS.maxReportNoteLength).optional(),
  subjectUserAlias: z.string().optional(), // resolved server-side via the match
  matchId: zUuid.optional(),
  eventId: zUuid.optional(),
  preserveConversation: z.boolean().default(true),
});

export const zReportView = z.object({
  id: zUuid,
  category: z.enum(REPORT_CATEGORIES),
  status: z.enum(REPORT_STATUSES),
  createdAt: zIsoDate,
  resolutionKey: z.string().nullable(), // i18n key; details stay private
});

export const zBlockUser = z.object({ matchId: zUuid }); // block via a match — you never know peer ids

/* ----------------------------------------------------------- notifications */

export const zNotification = z.object({
  id: zUuid,
  type: z.enum(NOTIFICATION_TYPES),
  titleKey: z.string(),
  bodyKey: z.string(),
  params: z.record(z.string()),
  createdAt: zIsoDate,
  readAt: zIsoDate.nullable(),
  deepLink: z.string().nullable(), // app route, e.g. "/offers/<id>"
});
export type Notification = z.infer<typeof zNotification>;

export const zNotificationPrefs = z.object({
  detailedPreviews: z.boolean().default(false), // lock-screen previews stay vague by default
  perType: z.record(z.enum(NOTIFICATION_TYPES), z.boolean()).default({}),
});

export const zRegisterPush = z.object({
  provider: z.enum(['expo', 'webpush']),
  token: z.string().max(2000), // expo token or serialized webpush subscription
});

/* ------------------------------------------------------- privacy & account */

export const zDataExport = z.object({
  status: z.enum(['pending', 'ready']),
  requestedAt: zIsoDate,
  downloadUrl: z.string().nullable(),
});

export const zDeleteAccount = z.object({
  confirmPseudonym: z.string(), // user retypes their pseudonym to confirm
});

/* ------------------------------------------------------------------- admin */

export const zAdminUserView = z.object({
  id: zUuid,
  pseudonym: z.string(),
  role: z.enum(USER_ROLES),
  status: z.enum(USER_STATUSES),
  createdAt: zIsoDate,
  emailVerified: z.boolean(), // NOT the email address — admins never see it
  reportCount: z.number().int(),
  riskFlags: z.array(z.string()),
});

export const zAdminModerate = z.object({
  action: z.string(), // ModerationActionKind, validated server-side against role
  targetUserId: zUuid.optional(),
  targetEventId: zUuid.optional(),
  targetMatchId: zUuid.optional(),
  reportId: zUuid.optional(),
  reason: z.string().min(5).max(1000), // written reason is mandatory
  durationHours: z.number().int().min(1).max(24 * 90).optional(),
});

export const zAdminReportView = z.object({
  id: zUuid,
  category: z.enum(REPORT_CATEGORIES),
  status: z.enum(REPORT_STATUSES),
  note: z.string().nullable(),
  reporterPseudonym: z.string(),
  subjectPseudonym: z.string().nullable(),
  subjectUserId: zUuid.nullable(),
  eventTitle: z.string().nullable(),
  conversationExcerpt: z
    .array(z.object({ senderAlias: z.string(), body: z.string(), createdAt: zIsoDate }))
    .nullable(), // only when reporter chose to preserve evidence
  createdAt: zIsoDate,
});

export const zFeatureFlag = z.object({
  key: z.string(),
  enabled: z.boolean(),
  description: z.string(),
});

/* --------------------------------------------------------------- ws frames */

export const zWsFrame = z.object({
  event: z.string(),
  /** Payloads are the corresponding REST view models; clients should refetch on doubt. */
  data: z.unknown(),
  ts: zIsoDate,
});
export type WsFrame = z.infer<typeof zWsFrame>;
