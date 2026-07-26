/**
 * Realtime hub: publishes server events to connected WebSocket clients via
 * Redis pub/sub so any API/worker process can emit to a user connected anywhere.
 * Semantics are at-most-once hints — REST is the source of truth and clients
 * refetch on reconnect, so missed frames are safe (ADR-0005).
 */
import type { WsEventName } from '@sahay/shared';
import { getRedis } from '../lib/redis.js';

const CHANNEL = 'ws:out';

export interface OutboundFrame {
  userId: string;
  event: WsEventName;
  data: unknown;
}

export async function publishToUser(userId: string, event: WsEventName, data: unknown): Promise<void> {
  const frame: OutboundFrame = { userId, event, data };
  await getRedis().publish(CHANNEL, JSON.stringify(frame));
}

export const WS_CHANNEL = CHANNEL;
