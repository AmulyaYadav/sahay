import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  forgetJoinedEvent,
  getJoinedEvents,
  rememberJoinedEvent,
  type JoinedEvent,
  K,
} from './storage';

/**
 * The server intentionally has no "my events" endpoint (participant lists are
 * never exposed), so the client remembers which events this device joined and
 * which one is currently active.
 */
interface ActiveEventContextValue {
  joined: JoinedEvent[];
  activeEventId: string | null;
  setActiveEventId: (id: string | null) => void;
  addJoined: (ev: JoinedEvent) => Promise<void>;
  removeJoined: (id: string) => Promise<void>;
}

const Ctx = createContext<ActiveEventContextValue>({
  joined: [],
  activeEventId: null,
  setActiveEventId: () => {},
  addJoined: async () => {},
  removeJoined: async () => {},
});

export function ActiveEventProvider({ children }: { children: React.ReactNode }) {
  const [joined, setJoined] = useState<JoinedEvent[]>([]);
  const [activeEventId, setActiveState] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const [list, last] = await Promise.all([
        getJoinedEvents(),
        AsyncStorage.getItem(K.lastEventId),
      ]);
      setJoined(list);
      const first = list[0];
      if (last && list.some((e) => e.id === last)) setActiveState(last);
      else if (first) setActiveState(first.id);
    })();
  }, []);

  const setActiveEventId = useCallback((id: string | null) => {
    setActiveState(id);
    if (id) AsyncStorage.setItem(K.lastEventId, id).catch(() => {});
    else AsyncStorage.removeItem(K.lastEventId).catch(() => {});
  }, []);

  const addJoined = useCallback(
    async (ev: JoinedEvent) => {
      await rememberJoinedEvent(ev);
      setJoined(await getJoinedEvents());
      setActiveEventId(ev.id);
    },
    [setActiveEventId],
  );

  const removeJoined = useCallback(
    async (id: string) => {
      await forgetJoinedEvent(id);
      const list = await getJoinedEvents();
      setJoined(list);
      if (activeEventId === id) setActiveEventId(list[0]?.id ?? null);
    },
    [activeEventId, setActiveEventId],
  );

  const value = useMemo(
    () => ({ joined, activeEventId, setActiveEventId, addJoined, removeJoined }),
    [joined, activeEventId, setActiveEventId, addJoined, removeJoined],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useActiveEvent(): ActiveEventContextValue {
  return useContext(Ctx);
}
