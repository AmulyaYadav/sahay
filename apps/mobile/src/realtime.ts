import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import type { WsFrame } from '@sahay/shared';
import { wsUrl } from './api';

export interface RealtimeHandlers {
  onFrame: (frame: WsFrame) => void;
  /** Fired after every successful (re)connect — refetch REST state. */
  onReconnect: () => void;
  onSessionRevoked: () => void;
}

/**
 * WebSocket client with exponential backoff. Frames are hints only; handlers
 * should invalidate react-query caches rather than trusting payloads blindly.
 */
export function useRealtime(token: string | null, handlers: RealtimeHandlers): void {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    if (!token) return;

    let ws: WebSocket | null = null;
    let closed = false;
    let attempts = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let pingTimer: ReturnType<typeof setInterval> | null = null;
    let everConnected = false;

    const cleanupSocket = () => {
      if (pingTimer) {
        clearInterval(pingTimer);
        pingTimer = null;
      }
      if (ws) {
        ws.onopen = null;
        ws.onmessage = null;
        ws.onclose = null;
        ws.onerror = null;
        try {
          ws.close();
        } catch {
          /* noop */
        }
        ws = null;
      }
    };

    const scheduleReconnect = () => {
      if (closed || reconnectTimer) return;
      const delay = Math.min(30_000, 1000 * 2 ** Math.min(attempts, 5));
      attempts += 1;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, delay);
    };

    const connect = () => {
      if (closed) return;
      cleanupSocket();
      let socket: WebSocket;
      try {
        socket = new WebSocket(wsUrl(token));
      } catch {
        scheduleReconnect();
        return;
      }
      ws = socket;

      socket.onopen = () => {
        attempts = 0;
        if (everConnected) handlersRef.current.onReconnect();
        everConnected = true;
        pingTimer = setInterval(() => {
          try {
            socket.send(JSON.stringify({ type: 'ping' }));
          } catch {
            /* noop */
          }
        }, 25_000);
      };

      socket.onmessage = (evt) => {
        try {
          const frame = JSON.parse(String(evt.data)) as WsFrame;
          if (frame.event === 'session.revoked') {
            closed = true;
            cleanupSocket();
            handlersRef.current.onSessionRevoked();
            return;
          }
          handlersRef.current.onFrame(frame);
        } catch {
          /* ignore malformed frames */
        }
      };

      socket.onclose = (evt) => {
        cleanupSocket();
        if (evt.code === 4401 || evt.code === 4403) {
          closed = true;
          handlersRef.current.onSessionRevoked();
          return;
        }
        scheduleReconnect();
      };

      socket.onerror = () => {
        // onclose follows; nothing to do here.
      };
    };

    connect();

    // Reconnect promptly when the app returns to the foreground.
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active' && !closed && (!ws || ws.readyState === WebSocket.CLOSED)) {
        attempts = 0;
        connect();
      }
    });

    return () => {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      cleanupSocket();
      sub.remove();
    };
  }, [token]);
}
