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
} as const;

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
