/**
 * Web Push registration for this device.
 * - Hidden entirely when the browser lacks serviceWorker/PushManager support.
 * - Needs VITE_VAPID_PUBLIC_KEY at build time (see vite.config.ts / .env.example);
 *   without it the Settings toggle renders disabled with a note.
 * - enable(): registers /sw.js, asks notification permission, subscribes with the
 *   VAPID key, and POSTs the JSON-serialized subscription to /me/push-tokens.
 * - disable(): unsubscribes locally (the server prunes dead subscriptions on send).
 */
import { useCallback, useEffect, useState } from 'react';
import { registerPushToken } from '../api/hooks';

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;

export const pushSupported =
  typeof navigator !== 'undefined' && 'serviceWorker' in navigator && typeof window !== 'undefined' && 'PushManager' in window;
export const pushConfigured = typeof VAPID_PUBLIC_KEY === 'string' && VAPID_PUBLIC_KEY.length > 0;

/** VAPID keys are base64url; PushManager wants raw bytes (backed by a plain ArrayBuffer). */
function urlBase64ToUint8Array(base64Url: string) {
  const padding = '='.repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

export type PushEnableResult = 'ok' | 'denied' | 'error';

export function usePush() {
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!pushSupported) return;
    let cancelled = false;
    void navigator.serviceWorker
      .getRegistration('/sw.js')
      .then((reg) => reg?.pushManager.getSubscription())
      .then((sub) => {
        if (!cancelled) setSubscribed(!!sub);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const enable = useCallback(async (): Promise<PushEnableResult> => {
    if (!pushSupported || !VAPID_PUBLIC_KEY) return 'error';
    setBusy(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') return 'denied';
      const reg = await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;
      const subscription =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
        }));
      await registerPushToken(JSON.stringify(subscription));
      setSubscribed(true);
      return 'ok';
    } catch {
      return 'error';
    } finally {
      setBusy(false);
    }
  }, []);

  const disable = useCallback(async (): Promise<void> => {
    if (!pushSupported) return;
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.getRegistration('/sw.js');
      const sub = await reg?.pushManager.getSubscription();
      await sub?.unsubscribe();
      setSubscribed(false);
    } catch {
      /* leave state as-is */
    } finally {
      setBusy(false);
    }
  }, []);

  return { supported: pushSupported, configured: pushConfigured, subscribed, busy, enable, disable };
}
