/**
 * Worker bootstrap: one BullMQ Worker per queue plus repeatable retention
 * schedules (every 60 s, one job per retention task). Processors live in
 * sibling files so later slices can replace them independently.
 */
import { Worker } from 'bullmq';
import { getRedis } from '../lib/redis.js';
import { KEEP_COMPLETED, KEEP_FAILED, retentionQueue, type RetentionJob } from '../queues.js';
import { processDataRequest } from './data-request.js';
import { processMatch, processOfferTimeout } from './matching.js';
import { processNotify } from './notify.js';
import { processRetention } from './retention.js';

const RETENTION_TASKS: RetentionJob['task'][] = [
  'purge_locations',
  'expire_requests',
  'expire_offers',
  'expire_availability',
  'expire_conversations',
  'purge_messages',
  'purge_otps_sessions',
  'anonymize_closed',
  'purge_notifications',
  'event_lifecycle',
  'attendance_reminders',
];

const RETENTION_EVERY_MS = 60_000;

export async function startWorkers(): Promise<() => Promise<void>> {
  const connection = getRedis();
  // The worker does the trimming, so these must match the queue's defaults —
  // a job whose own options say otherwise (repeatable templates, jobs enqueued
  // by an older build) is still cleaned up on completion here.
  const opts = {
    connection,
    removeOnComplete: KEEP_COMPLETED,
    removeOnFail: KEEP_FAILED,
  };
  const workers = [
    new Worker('match', processMatch, opts),
    new Worker('offer-timeout', processOfferTimeout, opts),
    new Worker('notify', processNotify, opts),
    new Worker('retention', processRetention, opts),
    new Worker('data-request', processDataRequest, opts),
  ];
  for (const w of workers) {
    w.on('failed', (job, err) => {
      console.error(`[worker:${w.name}] job ${job?.id ?? '?'} failed: ${err.message}`);
    });
  }

  const retention = retentionQueue();
  for (const task of RETENTION_TASKS) {
    // bullmq ≥5.16 has job schedulers; fall back to repeatable jobs otherwise.
    const maybeScheduler = retention as unknown as {
      upsertJobScheduler?: (
        id: string,
        repeat: { every: number },
        template: { name: string; data: RetentionJob },
      ) => Promise<unknown>;
    };
    if (typeof maybeScheduler.upsertJobScheduler === 'function') {
      await maybeScheduler.upsertJobScheduler(
        `retention:${task}`,
        { every: RETENTION_EVERY_MS },
        { name: task, data: { task } },
      );
    } else {
      await retention.add(
        task,
        { task },
        { repeat: { every: RETENTION_EVERY_MS }, jobId: `retention:${task}` },
      );
    }
  }

  return async () => {
    await Promise.all(workers.map((w) => w.close()));
  };
}
