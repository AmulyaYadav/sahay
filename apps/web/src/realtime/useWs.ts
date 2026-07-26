/**
 * WebSocket connection to /ws?token=… with exponential backoff (1s → 30s).
 * Frames are hints only — on every event we invalidate the matching react-query caches
 * and let REST be the source of truth. On reconnect the core caches are refreshed.
 */
import { useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { getToken, redirectToAuth, wsUrl } from '../api/client';

export const WsContext = createContext<{ connected: boolean }>({ connected: false });

export function useWsConnected(): boolean {
  return useContext(WsContext).connected;
}

const RECONNECT_INVALIDATE: string[][] = [
  ['offers'],
  ['matches'],
  ['requests'],
  ['notifications'],
  ['conversation'],
];

export function useWsConnection(enabled: boolean): { connected: boolean } {
  const qc = useQueryClient();
  const [connected, setConnected] = useState(false);
  const backoffRef = useRef(1000);
  const hadConnectionRef = useRef(false);

  useEffect(() => {
    if (!enabled || !getToken()) return;
    let ws: WebSocket | null = null;
    let closed = false;
    let reconnectTimer: number | undefined;
    let pingTimer: number | undefined;

    const invalidate = (key: string[]) => void qc.invalidateQueries({ queryKey: key });

    const connect = () => {
      if (closed) return;
      try {
        ws = new WebSocket(wsUrl());
      } catch {
        scheduleReconnect();
        return;
      }

      ws.onopen = () => {
        setConnected(true);
        backoffRef.current = 1000;
        if (hadConnectionRef.current) {
          // Reconnect: REST is truth — refresh everything that may have moved.
          for (const key of RECONNECT_INVALIDATE) invalidate(key);
        }
        hadConnectionRef.current = true;
        pingTimer = window.setInterval(() => {
          if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ping' }));
        }, 25_000);
      };

      ws.onmessage = (evt) => {
        let frame: { event?: string; data?: unknown };
        try {
          frame = JSON.parse(String(evt.data)) as { event?: string; data?: unknown };
        } catch {
          return;
        }
        switch (frame.event) {
          case 'offer.new':
          case 'offer.expired':
            invalidate(['offers']);
            break;
          case 'message.new': {
            const data = frame.data as { conversationId?: string } | undefined;
            if (data?.conversationId) invalidate(['conversation', data.conversationId, 'messages']);
            else invalidate(['conversation']);
            break;
          }
          case 'conversation.update':
            invalidate(['conversation']);
            break;
          case 'match.update':
            invalidate(['matches']);
            invalidate(['match']);
            break;
          case 'request.update':
            invalidate(['requests']);
            invalidate(['request']);
            break;
          case 'inventory.update':
            invalidate(['inventory']);
            break;
          case 'event.update':
            invalidate(['event']);
            invalidate(['events']);
            invalidate(['dashboard']);
            break;
          case 'notification.new':
            invalidate(['notifications']);
            break;
          case 'session.revoked':
            closed = true;
            redirectToAuth();
            break;
          default:
            break;
        }
      };

      ws.onclose = (evt) => {
        setConnected(false);
        if (pingTimer !== undefined) window.clearInterval(pingTimer);
        if (closed) return;
        if (evt.code === 4401 || evt.code === 4403) {
          redirectToAuth();
          return;
        }
        scheduleReconnect();
      };

      ws.onerror = () => {
        ws?.close();
      };
    };

    const scheduleReconnect = () => {
      if (closed) return;
      const delay = backoffRef.current;
      backoffRef.current = Math.min(backoffRef.current * 2, 30_000);
      reconnectTimer = window.setTimeout(connect, delay);
    };

    connect();

    return () => {
      closed = true;
      if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer);
      if (pingTimer !== undefined) window.clearInterval(pingTimer);
      ws?.close();
      setConnected(false);
    };
  }, [enabled, qc]);

  return { connected };
}
