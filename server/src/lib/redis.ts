import { Redis } from 'ioredis';
import { loadConfig } from '../config.js';

let client: Redis | null = null;
let subscriber: Redis | null = null;

export function getRedis(): Redis {
  if (!client) client = new Redis(loadConfig().REDIS_URL, { maxRetriesPerRequest: null });
  return client;
}

/** Dedicated connection for pub/sub subscribe mode. */
export function getRedisSubscriber(): Redis {
  if (!subscriber) subscriber = new Redis(loadConfig().REDIS_URL, { maxRetriesPerRequest: null });
  return subscriber;
}

export async function closeRedis(): Promise<void> {
  await client?.quit();
  await subscriber?.quit();
  client = null;
  subscriber = null;
}

/**
 * Fixed-window rate limiter. Returns true when the action is allowed.
 * Fails CLOSED for auth-critical scopes: callers should treat errors as denial.
 */
export async function rateLimit(scope: string, id: string, max: number, windowSec: number): Promise<boolean> {
  const key = `rl:${scope}:${id}:${Math.floor(Date.now() / (windowSec * 1000))}`;
  const redis = getRedis();
  const n = await redis.incr(key);
  if (n === 1) await redis.expire(key, windowSec);
  return n <= max;
}
