/**
 * Location ping loop while Helping Now is on (or a request is searching).
 * watchPosition throttled to at most one ping per minute; coordinates are
 * coarsened (~110 m) on-device BEFORE they are sent. Stops and deletes the
 * server-side location on toggle-off/unmount.
 */
import { coarsen } from '@sahay/shared';
import { useEffect, useRef } from 'react';
import { deleteLocation, pingLocation } from '../api/hooks';

const MIN_INTERVAL_MS = 60_000;

export function useLocationPing(eventId: string | undefined, active: boolean): void {
  const lastSent = useRef(0);

  useEffect(() => {
    if (!eventId || !active || !('geolocation' in navigator)) return;
    let stopped = false;

    const send = (pos: GeolocationPosition) => {
      const now = Date.now();
      if (stopped || now - lastSent.current < MIN_INTERVAL_MS) return;
      lastSent.current = now;
      const coords = coarsen(pos.coords.latitude, pos.coords.longitude);
      pingLocation(eventId, coords).catch(() => {
        /* transient network failure; the next ping retries */
      });
    };

    // Send one ping immediately, then rely on the throttled watch.
    lastSent.current = 0;
    navigator.geolocation.getCurrentPosition(send, () => undefined, { maximumAge: 30_000 });
    const watchId = navigator.geolocation.watchPosition(send, () => undefined, {
      maximumAge: 30_000,
      enableHighAccuracy: false,
    });

    return () => {
      stopped = true;
      navigator.geolocation.clearWatch(watchId);
      deleteLocation(eventId).catch(() => undefined);
    };
  }, [eventId, active]);
}
