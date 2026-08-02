import AsyncStorage from '@react-native-async-storage/async-storage';

/** All AsyncStorage keys used by the app, in one place. */
export const K = {
  locale: 'sahay.locale',
  lastEventId: 'sahay.lastEventId',
  joinedEvents: 'sahay.joinedEvents',
  pendingInventory: 'sahay.pendingInventory',
  bringHidden: (eventId: string) => `sahay.bringHidden.${eventId}`,
  queryCache: 'sahay.queryCache.v1',
  pushRegistered: 'sahay.pushRegistered',
  /** Which account this device's local state belongs to. */
  lastUserId: 'sahay.lastUserId',
} as const;

/**
 * Wipes everything on this device that belongs to one account.
 *
 * Joined events, the active event, queued inventory, the cached query data and
 * the push-registration marker are all per-ACCOUNT but were stored per-DEVICE and
 * never cleared. A second person signing in on the same phone inherited the
 * first person's joined events — which is both wrong and a disclosure, in an app
 * whose premise is that participation is not visible to others.
 *
 * `locale` deliberately survives: it is a device preference, not account data,
 * and resetting someone's language on sign-out would be hostile.
 */
export async function clearAccountScopedState(): Promise<void> {
  try {
    const all = await AsyncStorage.getAllKeys();
    const doomed = all.filter(
      (k) =>
        k.startsWith('sahay.') &&
        k !== K.locale &&
        // The first-run permission sheet is about the device and its OS
        // permissions, not the account; re-asking would waste the one prompt.
        k !== 'sahay.permissionsPrompted.v1',
    );
    if (doomed.length) await AsyncStorage.multiRemove(doomed);
  } catch {
    /* best effort: a failure here must not block signing in or out */
  }
}

export async function getJson<T>(key: string): Promise<T | null> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export async function setJson(key: string, value: unknown): Promise<void> {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage is best-effort; never crash the UI over it
  }
}

/** Minimal record of an event the user joined (server has no "my events" list). */
export interface JoinedEvent {
  id: string;
  code: string;
  title: string;
}

export async function getJoinedEvents(): Promise<JoinedEvent[]> {
  return (await getJson<JoinedEvent[]>(K.joinedEvents)) ?? [];
}

export async function rememberJoinedEvent(ev: JoinedEvent): Promise<void> {
  const list = await getJoinedEvents();
  const next = [ev, ...list.filter((e) => e.id !== ev.id)];
  await setJson(K.joinedEvents, next.slice(0, 20));
}

export async function forgetJoinedEvent(id: string): Promise<void> {
  const list = await getJoinedEvents();
  await setJson(K.joinedEvents, list.filter((e) => e.id !== id));
}
