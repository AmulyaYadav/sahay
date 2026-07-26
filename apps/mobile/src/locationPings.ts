import { useCallback, useEffect, useRef } from 'react';
import { AppState, Platform } from 'react-native';
import * as Location from 'expo-location';
import { coarsen, LIMITS } from '@sahay/shared';
import { api } from './api';
import { useAuth } from './auth';

/** Ask for foreground ("while using") location permission. */
export async function ensureLocationPermission(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  try {
    const current = await Location.getForegroundPermissionsAsync();
    if (current.status === 'granted') return true;
    const asked = await Location.requestForegroundPermissionsAsync();
    return asked.status === 'granted';
  } catch {
    return false;
  }
}

/** One coarse position, low accuracy — coarsened before it leaves the device. */
export async function getCoarseCoords(): Promise<{ lat: number; lng: number } | null> {
  try {
    const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low });
    return coarsen(pos.coords.latitude, pos.coords.longitude);
  } catch {
    return null;
  }
}

/**
 * Throttled ping loop while Helping Now is ON: one coarse ping per minute to
 * PUT /events/:id/location. Stops when the toggle goes off, and turns
 * availability off entirely if the app stays backgrounded longer than the
 * location TTL (15 min).
 */
export function useLocationPings(
  eventId: string | null | undefined,
  active: boolean,
  onAutoOff: () => void,
): void {
  const { token } = useAuth();
  const onAutoOffRef = useRef(onAutoOff);
  onAutoOffRef.current = onAutoOff;

  const sendPing = useCallback(async () => {
    if (!token || !eventId) return;
    const coords = await getCoarseCoords();
    if (!coords) return;
    try {
      await api(`/events/${eventId}/location`, { method: 'PUT', token, body: { coords } });
    } catch {
      // Transient failure — the next minute's ping retries naturally.
    }
  }, [token, eventId]);

  useEffect(() => {
    if (!active || !eventId || !token || Platform.OS === 'web') return;

    let interval: ReturnType<typeof setInterval> | null = null;
    let backgroundedAt: number | null = null;

    const start = () => {
      void sendPing();
      if (!interval) interval = setInterval(() => void sendPing(), 60_000);
    };
    const stop = () => {
      if (interval) {
        clearInterval(interval);
        interval = null;
      }
    };

    start();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        const awayMs = backgroundedAt ? Date.now() - backgroundedAt : 0;
        backgroundedAt = null;
        if (awayMs > LIMITS.locationTtlMinutes * 60_000) {
          stop();
          onAutoOffRef.current(); // beyond TTL: honest auto-off
        } else {
          start();
        }
      } else {
        backgroundedAt = Date.now();
        stop();
      }
    });

    return () => {
      stop();
      sub.remove();
    };
  }, [active, eventId, token, sendPing]);
}
