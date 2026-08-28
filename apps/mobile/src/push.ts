import { useEffect } from 'react';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from './api';
import { K } from './storage';

// Foreground notifications: show a banner; content is server-composed and
// vague by default — the client just displays it.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    // shouldShowAlert was split into banner + notification-centre list in SDK 53.
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

/**
 * Contextual, skippable push registration. Returns true if registered.
 * Never blocks sign-in on the permission outcome.
 */
/**
 * Asks the OS for notification permission WITHOUT needing a session.
 *
 * Split out from registerForPush so the first-launch sheet can request the
 * permission before an account exists; the device is registered later, silently,
 * once a session appears and permission is already granted.
 */
export async function requestPushPermission(): Promise<boolean> {
  if (Platform.OS === 'web' || !Device.isDevice) return false;
  try {
    const existing = await Notifications.getPermissionsAsync();
    if (existing.status === 'granted') return true;
    return (await Notifications.requestPermissionsAsync()).status === 'granted';
  } catch {
    return false;
  }
}

/** True when permission is already granted, so registering will not prompt. */
export async function hasPushPermission(): Promise<boolean> {
  if (Platform.OS === 'web' || !Device.isDevice) return false;
  try {
    return (await Notifications.getPermissionsAsync()).status === 'granted';
  } catch {
    return false;
  }
}

export async function registerForPush(token: string): Promise<boolean> {
  if (Platform.OS === 'web' || !Device.isDevice) return false;
  try {
    const existing = await Notifications.getPermissionsAsync();
    let status = existing.status;
    if (status !== 'granted') {
      status = (await Notifications.requestPermissionsAsync()).status;
    }
    if (status !== 'granted') return false;

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Sahay',
        importance: Notifications.AndroidImportance.HIGH,
      });
    }

    const projectId: string | undefined =
      (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas
        ?.projectId ?? Constants.easConfig?.projectId ?? undefined;
    const expoToken = (await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : {}))
      .data;
    await api('/me/push-tokens', {
      method: 'POST',
      token,
      body: { provider: 'expo', token: expoToken },
    });
    await AsyncStorage.setItem(K.pushRegistered, '1');
    return true;
  } catch {
    return false;
  }
}

/**
 * Deep-link routing from notification taps. The server puts an app route in
 * `data.deepLink` (e.g. "/offers/<id>", "/matches/<id>").
 */
export function useNotificationDeepLinks(enabled: boolean): void {
  const router = useRouter();
  useEffect(() => {
    if (!enabled || Platform.OS === 'web') return;

    const route = (deepLink: unknown) => {
      if (typeof deepLink !== 'string' || !deepLink.startsWith('/')) return;
      // Server routes use plural segments; app routes are singular.
      const normalized = deepLink
        .replace(/^\/offers\//, '/offer/')
        .replace(/^\/matches\//, '/match/')
        .replace(/^\/requests\//, '/request/');
      router.push(normalized as never);
    };

    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      route(response.notification.request.content.data?.deepLink);
    });
    // Cold start from a notification tap.
    void Notifications.getLastNotificationResponseAsync().then((response) => {
      if (response) route(response.notification.request.content.data?.deepLink);
    });
    return () => sub.remove();
  }, [enabled, router]);
}

/**
 * Registers this device once a session exists and permission has already been
 * granted. Never prompts: the asking happens at first launch, and this is only
 * the follow-up that could not run then because there was no account yet.
 */
export function useAutoRegisterPush(token: string | null | undefined): void {
  useEffect(() => {
    if (!token) return;
    let alive = true;
    void (async () => {
      if (await AsyncStorage.getItem(K.pushRegistered)) return;
      if (!(await hasPushPermission())) return;
      if (alive) await registerForPush(token);
    })();
    return () => {
      alive = false;
    };
  }, [token]);
}
