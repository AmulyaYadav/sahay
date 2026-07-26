/** Small localStorage helpers for client-side-only state. All keys namespaced `sahay.`. */

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

/* ---------------------------------------------------- active event context */

export interface JoinedEventRef {
  id: string;
  code: string;
  title: string;
}

const JOINED_KEY = 'sahay.joinedEvents';
const ACTIVE_KEY = 'sahay.activeEvent';

export function getJoinedEvents(): JoinedEventRef[] {
  return read<JoinedEventRef[]>(JOINED_KEY, []);
}

export function rememberJoinedEvent(ev: JoinedEventRef): void {
  const list = getJoinedEvents().filter((x) => x.id !== ev.id);
  list.unshift(ev);
  write(JOINED_KEY, list.slice(0, 10));
  write(ACTIVE_KEY, ev.id);
}

export function forgetJoinedEvent(id: string): void {
  write(JOINED_KEY, getJoinedEvents().filter((x) => x.id !== id));
  if (getActiveEventId() === id) {
    const rest = getJoinedEvents();
    write(ACTIVE_KEY, rest[0]?.id ?? null);
  }
}

export function getActiveEventId(): string | null {
  const id = read<string | null>(ACTIVE_KEY, null);
  if (id && getJoinedEvents().some((x) => x.id === id)) return id;
  return getJoinedEvents()[0]?.id ?? null;
}

export function setActiveEventId(id: string): void {
  write(ACTIVE_KEY, id);
}

/* --------------------------------------------- bring-suggestion dismissals */

type BringState = Record<string, { hidden?: boolean; dontHave?: boolean; laterUntil?: number }>;

function bringKey(eventId: string): string {
  return `sahay.bring.${eventId}`;
}

export function getBringState(eventId: string): BringState {
  return read<BringState>(bringKey(eventId), {});
}

export function setBringFlag(
  eventId: string,
  categoryId: string,
  flag: 'hidden' | 'dontHave' | 'later',
): void {
  const state = getBringState(eventId);
  const cur = state[categoryId] ?? {};
  if (flag === 'hidden') cur.hidden = true;
  else if (flag === 'dontHave') cur.dontHave = true;
  else cur.laterUntil = Date.now() + 2 * 60 * 60 * 1000; // remind again in 2h
  state[categoryId] = cur;
  write(bringKey(eventId), state);
}

export function isBringDismissed(eventId: string, categoryId: string): boolean {
  const s = getBringState(eventId)[categoryId];
  if (!s) return false;
  if (s.hidden || s.dontHave) return true;
  return typeof s.laterUntil === 'number' && s.laterUntil > Date.now();
}

/* ------------------------------------------------ one-time location consent */

const LOC_CONSENT_KEY = 'sahay.locationConsent';

export function hasLocationConsent(): boolean {
  return read<boolean>(LOC_CONSENT_KEY, false);
}

export function setLocationConsent(v: boolean): void {
  write(LOC_CONSENT_KEY, v);
}
