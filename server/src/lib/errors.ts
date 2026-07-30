/**
 * Application errors carry a machine-readable code that maps to i18n `errors.*`
 * keys and a fixed HTTP status. The global error handler localizes the message.
 */
export type ErrorCode =
  | 'validation'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'rate_limited'
  | 'insufficient_inventory'
  | 'request_conflict'
  | 'event_paused'
  | 'event_not_active'
  | 'offer_expired'
  | 'prohibited_category'
  | 'account_restricted'
  | 'password_change_required'
  | 'idempotency_replay';

const STATUS: Record<ErrorCode, number> = {
  validation: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  rate_limited: 429,
  insufficient_inventory: 409,
  request_conflict: 409,
  event_paused: 409,
  event_not_active: 409,
  offer_expired: 410,
  prohibited_category: 422,
  account_restricted: 403,
  password_change_required: 403,
  idempotency_replay: 409,
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: Record<string, unknown>;

  constructor(code: ErrorCode, details?: Record<string, unknown>) {
    super(code);
    this.code = code;
    this.status = STATUS[code];
    this.details = details;
  }
}

export const errors = {
  validation: (details?: Record<string, unknown>) => new AppError('validation', details),
  unauthorized: () => new AppError('unauthorized'),
  forbidden: () => new AppError('forbidden'),
  notFound: () => new AppError('not_found'),
  rateLimited: () => new AppError('rate_limited'),
  insufficientInventory: () => new AppError('insufficient_inventory'),
  conflict: () => new AppError('request_conflict'),
  eventPaused: () => new AppError('event_paused'),
  eventNotActive: () => new AppError('event_not_active'),
  offerExpired: () => new AppError('offer_expired'),
  prohibitedCategory: () => new AppError('prohibited_category'),
  accountRestricted: () => new AppError('account_restricted'),
  passwordChangeRequired: () => new AppError('password_change_required'),
};
