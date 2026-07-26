/**
 * WebSocket gateway (/ws?token=...). Frames are best-effort hints published via
 * Redis pub/sub (realtime/hub.ts); clients refetch REST state on reconnect.
 * Close codes: 4401 invalid/expired token, 4403 session revoked mid-connection.
 */
import type { FastifyInstance } from 'fastify';
import { WebSocketServer, type WebSocket } from 'ws';
import { getRedisSubscriber } from '../lib/redis.js';
import { resolveAuth } from '../plugins/auth.js';
import { WS_CHANNEL, type OutboundFrame } from './hub.js';

interface TrackedSocket extends WebSocket {
  isAlive?: boolean;
  userId?: string;
}

const HEARTBEAT_MS = 30_000;

export async function registerWebsocket(app: FastifyInstance): Promise<void> {
  const wss = new WebSocketServer({ noServer: true });
  const registry = new Map<string, Set<TrackedSocket>>();

  app.server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname !== '/ws') {
      socket.destroy();
      return;
    }
    // Authenticate BEFORE completing the handshake so every handler can be
    // attached synchronously on connection — no client frame can slip past.
    void (async () => {
      const token = url.searchParams.get('token');
      const auth = token ? await resolveAuth(token).catch(() => null) : null;
      wss.handleUpgrade(req, socket, head, (ws) =>
        wss.emit('connection', ws, req, auth?.userId ?? null),
      );
    })();
  });

  wss.on('connection', (ws: TrackedSocket, _req: import('node:http').IncomingMessage, userId: string | null) => {
    if (!userId) {
      ws.close(4401, 'unauthorized');
      return;
    }

    ws.userId = userId;
    ws.isAlive = true;
    let set = registry.get(userId);
    if (!set) {
      set = new Set();
      registry.set(userId, set);
    }
    set.add(ws);

    ws.on('pong', () => {
      ws.isAlive = true;
    });
    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(String(raw)) as { type?: string };
        if (msg.type === 'ping') ws.send(JSON.stringify({ type: 'pong' }));
      } catch {
        // Ignore malformed client frames.
      }
    });
    ws.on('close', () => {
      const sockets = registry.get(userId);
      sockets?.delete(ws);
      if (sockets && sockets.size === 0) registry.delete(userId);
    });
  });

  const heartbeat = setInterval(() => {
    for (const ws of wss.clients as Set<TrackedSocket>) {
      if (ws.isAlive === false) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      ws.ping();
    }
  }, HEARTBEAT_MS);

  const subscriber = getRedisSubscriber();
  const onMessage = (channel: string, payload: string): void => {
    if (channel !== WS_CHANNEL) return;
    let frame: OutboundFrame;
    try {
      frame = JSON.parse(payload) as OutboundFrame;
    } catch {
      return;
    }
    const sockets = registry.get(frame.userId);
    if (!sockets || sockets.size === 0) return;
    const wire = JSON.stringify({ event: frame.event, data: frame.data, ts: new Date().toISOString() });
    for (const ws of sockets) {
      ws.send(wire);
      if (frame.event === 'session.revoked') ws.close(4403, 'session revoked');
    }
  };
  await subscriber.subscribe(WS_CHANNEL);
  subscriber.on('message', onMessage);

  app.addHook('onClose', async () => {
    clearInterval(heartbeat);
    subscriber.off('message', onMessage);
    await subscriber.unsubscribe(WS_CHANNEL).catch(() => {});
    for (const ws of wss.clients) ws.terminate();
    wss.close();
  });
}
