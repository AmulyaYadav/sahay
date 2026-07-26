/**
 * Domain enums and constants shared by server, web, and mobile.
 * These are the vocabulary of the whole system — change with care and a migration.
 */

export const EVENT_STATUSES = [
  'draft',
  'scheduled',
  'active',
  'paused',
  'completed',
  'archived',
  'disabled',
] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];

export const EVENT_VISIBILITIES = ['public', 'unlisted', 'invite_only'] as const;
export type EventVisibility = (typeof EVENT_VISIBILITIES)[number];

export const EVENT_TYPES = [
  'community_event',
  'relief_operation',
  'campus_event',
  'community_kitchen',
  'neighborhood_aid',
  'public_gathering',
  'festival',
  'other',
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

/**
 * Request lifecycle. The server is the only writer of this state.
 *
 * searching  — created/queued/actively looking for a helper (incl. between offers)
 * offering   — one candidate currently holds an open offer
 * matched    — a helper accepted; conversation open; meeting sub-state lives on the match
 * fulfilled / partially_fulfilled / cancelled / expired / no_match / disputed — terminal-ish
 * (partially_fulfilled may transition back to searching if the requester continues.)
 */
export const REQUEST_STATUSES = [
  'searching',
  'offering',
  'matched',
  'fulfilled',
  'partially_fulfilled',
  'cancelled',
  'expired',
  'no_match',
  'disputed',
  'moderated',
] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export const REQUEST_URGENCIES = ['standard', 'soon', 'urgent'] as const;
export type RequestUrgency = (typeof REQUEST_URGENCIES)[number];

export const OFFER_STATUSES = ['offered', 'accepted', 'declined', 'expired', 'superseded'] as const;
export type OfferStatus = (typeof OFFER_STATUSES)[number];

export const MATCH_STATUSES = [
  'active',
  'completed',
  'partially_completed',
  'cancelled_by_requester',
  'cancelled_by_helper',
  'cancelled_unsafe',
  'cancelled_moderation',
  'disputed',
] as const;
export type MatchStatus = (typeof MATCH_STATUSES)[number];

/** Per-participant meeting state within an active match. */
export const MEETING_STATES = [
  'deciding',
  'on_my_way',
  'arrived',
  'cannot_find',
  'exchanging',
  'done',
] as const;
export type MeetingState = (typeof MEETING_STATES)[number];

export const CONVERSATION_STATUSES = ['open', 'readonly', 'expired'] as const;
export type ConversationStatus = (typeof CONVERSATION_STATUSES)[number];

export const MESSAGE_KINDS = ['text', 'quick', 'system'] as const;
export type MessageKind = (typeof MESSAGE_KINDS)[number];

/** Keys into the localized quick-reply catalog (i18n `quick.*`). */
export const QUICK_REPLIES = [
  'where_meet',
  'near_main_entrance',
  'i_can_come_to_you',
  'suggest_landmark',
  'wearing_blue_jacket',
  'arrived',
  'cannot_find_you',
  'need_to_cancel',
  'stay_public_area',
  'not_comfortable',
] as const;
export type QuickReplyKey = (typeof QUICK_REPLIES)[number];

/** Coarse proximity buckets. Exact distances are never exposed. */
export const PROXIMITY_BUCKETS = ['very_nearby', 'nearby', 'short_walk', 'farther', 'unknown'] as const;
export type ProximityBucket = (typeof PROXIMITY_BUCKETS)[number];

/** Bucket upper bounds in meters (server-side only input; bucket is what ships). */
export const PROXIMITY_THRESHOLDS_M: Record<Exclude<ProximityBucket, 'unknown'>, number> = {
  very_nearby: 150,
  nearby: 400,
  short_walk: 1000,
  farther: Infinity,
};

export const RELIABILITY_LABELS = [
  'new_helper',
  'active_helper',
  'reliable_helper',
  'highly_reliable_helper',
] as const;
export type ReliabilityLabel = (typeof RELIABILITY_LABELS)[number];

export const USER_ROLES = ['user', 'moderator', 'admin'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const USER_STATUSES = ['active', 'restricted', 'suspended', 'deleted'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const REPORT_CATEGORIES = [
  'harassment',
  'unsafe_meeting',
  'prohibited_item',
  'false_request',
  'spam',
  'fraud',
  'impersonation',
  'hate_speech',
  'threat',
  'no_show',
  'suspicious_event',
  'other',
] as const;
export type ReportCategory = (typeof REPORT_CATEGORIES)[number];

export const REPORT_STATUSES = ['open', 'reviewing', 'resolved', 'dismissed'] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

export const MODERATION_ACTIONS = [
  'warn',
  'restrict_requests',
  'restrict_helping',
  'suspend',
  'unsuspend',
  'event_pause',
  'event_unpause',
  'event_disable',
  'event_approve_public',
  'event_reject_public',
  'match_cancel',
  'report_resolve',
  'report_dismiss',
] as const;
export type ModerationActionKind = (typeof MODERATION_ACTIONS)[number];

export const NOTIFICATION_TYPES = [
  'match_offer',
  'match_accepted',
  'match_cancelled',
  'new_message',
  'request_expiring',
  'no_helper_found',
  'inventory_low',
  'event_starting',
  'event_ending',
  'event_paused',
  'event_notice',
  'moderation_outcome',
  'account_security',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const UNITS = [
  'item',
  'piece',
  'bottle',
  'litre',
  'packet',
  'box',
  'meal',
  'blanket',
  'pair',
  'roll',
  'kit',
  'battery',
  'hour',
] as const;
export type Unit = (typeof UNITS)[number];

/** Shortage levels for the "what should I bring" / dashboard experience. */
export const SHORTAGE_LEVELS = [
  'critical_shortage',
  'high_need',
  'moderate_need',
  'adequate',
  'possible_surplus',
  'unknown',
] as const;
export type ShortageLevel = (typeof SHORTAGE_LEVELS)[number];

export const CATEGORY_GROUPS = [
  'hydration',
  'food',
  'shelter',
  'hygiene',
  'power',
  'clothing',
  'first_aid',
  'misc',
] as const;
export type CategoryGroup = (typeof CATEGORY_GROUPS)[number];

export const AVAILABILITY_DURATIONS_MIN = [30, 60, 120] as const;

export const LIMITS = {
  /** Response window for a single match offer (seconds); event-overridable. */
  offerResponseSeconds: 45,
  /** Request expiry options (minutes). */
  requestExpiryOptionsMin: [10, 15, 30, 60],
  maxActiveRequestsPerUser: 3,
  maxActiveMatchesPerHelper: 2,
  maxInventoryItemsPerEvent: 30,
  maxNoteLength: 200,
  maxMessageLength: 500,
  maxReportNoteLength: 1000,
  /** Coarse location TTL (minutes). */
  locationTtlMinutes: 15,
  /** Coordinates rounded to this many decimals (~110 m). */
  locationPrecisionDecimals: 3,
  /** Aggregate dashboard k-anonymity threshold: min distinct users behind a stat. */
  kAnonymityThreshold: 3,
  /** Grace period after match close before conversation goes readonly (minutes). */
  conversationGraceMinutes: 60,
  otpLength: 6,
  otpTtlMinutes: 10,
  otpMaxAttempts: 5,
  sessionTtlDays: 60,
  maxSearchRadiusM: 5000,
  initialSearchRadiusM: 400,
  radiusExpansionFactor: 2,
} as const;

/** WebSocket server→client event names. Payloads defined in schemas.ts. */
export const WS_EVENTS = [
  'offer.new',
  'offer.expired',
  'request.update',
  'match.update',
  'message.new',
  'conversation.update',
  'event.update',
  'inventory.update',
  'notification.new',
  'session.revoked',
] as const;
export type WsEventName = (typeof WS_EVENTS)[number];
