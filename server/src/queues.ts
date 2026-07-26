/**
 * Background job definitions. One BullMQ queue per concern; workers live in
 * src/workers/. All jobs are idempotent: they re-check DB state before acting.
 */
import { Queue } from 'bullmq';
import { getRedis } from './lib/redis.js';

export interface MatchRunJob {
  requestId: string;
}
/** Second job kind on the 'match' queue (job name 'finalize'): auto-finalize a
 * match 60 min after the first (single-sided) completion confirmation. */
export interface MatchFinalizeJob {
  matchId: string;
}
export type MatchJob = MatchRunJob | MatchFinalizeJob;
export interface OfferTimeoutJob {
  offerId: string;
}
export interface NotifyJob {
  userId: string;
  type: string;
  titleKey: string;
  bodyKey: string;
  params: Record<string, string>;
  deepLink?: string;
  dedupeKey?: string;
}
export interface RetentionJob {
  task:
    | 'purge_locations'
    | 'expire_requests'
    | 'expire_offers'
    | 'expire_availability'
    | 'expire_conversations'
    | 'purge_messages'
    | 'purge_otps_sessions'
    | 'anonymize_closed'
    | 'purge_notifications'
    | 'event_lifecycle';
}
export interface DataRequestJob {
  dataRequestId: string;
}

const queues = new Map<string, Queue>();

function queue<T>(name: string): Queue<T> {
  let q = queues.get(name);
  if (!q) {
    q = new Queue(name, { connection: getRedis() });
    queues.set(name, q);
  }
  return q as Queue<T>;
}

export const matchQueue = () => queue<MatchJob>('match');
export const offerTimeoutQueue = () => queue<OfferTimeoutJob>('offer-timeout');
export const notifyQueue = () => queue<NotifyJob>('notify');
export const retentionQueue = () => queue<RetentionJob>('retention');
export const dataRequestQueue = () => queue<DataRequestJob>('data-request');

export async function closeQueues(): Promise<void> {
  await Promise.all([...queues.values()].map((q) => q.close()));
  queues.clear();
}
