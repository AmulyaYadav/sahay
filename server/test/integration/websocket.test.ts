import '../env.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { AddressInfo } from 'node:net';
import WebSocket from 'ws';
import { buildApp } from '../../src/app.js';
import { closeDb } from '../../src/db/index.js';
import { closeRedis } from '../../src/lib/redis.js';
import { closeQueues } from '../../src/queues.js';
import { publishToUser } from '../../src/realtime/hub.js';
import { makeSession, makeUser, setupTestDb, truncateAll } from '../helpers.js';

let app: FastifyInstance;
let port: number;

beforeAll(async () => {
  await setupTestDb();
  await truncateAll();
  app = await buildApp();
  await app.listen({ port: 0, host: '127.0.0.1' });
  port = (app.server.address() as AddressInfo).port;
});

afterAll(async () => {
  if (app) await app.close();
  await closeQueues();
  await closeRedis();
  await closeDb();
});

function connect(token: string): WebSocket {
  return new WebSocket(`ws://127.0.0.1:${port}/ws?token=${encodeURIComponent(token)}`);
}

function nextMessage(ws: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    ws.once('message', (raw) => resolve(JSON.parse(String(raw))));
  });
}

describe('websocket gateway', () => {
  it('closes 4401 for an invalid token', async () => {
    const code = await new Promise<number>((resolve) => {
      connect('not-a-real-token').on('close', (c) => resolve(c));
    });
    expect(code).toBe(4401);
  });

  it('answers pings, forwards published frames, and closes 4403 on session.revoked', async () => {
    const user = await makeUser();
    const token = await makeSession(user.id);
    const other = await makeUser();

    const ws = connect(token);
    await new Promise((resolve) => ws.on('open', resolve));

    ws.send(JSON.stringify({ type: 'ping' }));
    expect(await nextMessage(ws)).toEqual({ type: 'pong' });

    // Frames for other users never arrive here.
    await publishToUser(other.id, 'notification.new', { for: 'someone-else' });
    const framePromise = nextMessage(ws);
    await publishToUser(user.id, 'notification.new', { n: 1 });
    const frame = await framePromise;
    expect(frame.event).toBe('notification.new');
    expect(frame.data).toEqual({ n: 1 });
    expect(typeof frame.ts).toBe('string');

    const closed = new Promise<number>((resolve) => ws.on('close', (c) => resolve(c)));
    const revokedFrame = nextMessage(ws);
    await publishToUser(user.id, 'session.revoked', { sessionId: 'x' });
    expect((await revokedFrame).event).toBe('session.revoked');
    expect(await closed).toBe(4403);
  });
});
