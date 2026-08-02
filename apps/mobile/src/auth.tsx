import AsyncStorage from '@react-native-async-storage/async-storage';
import { clearAccountScopedState, K } from './storage';
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import type { AuthSession, Me } from '@sahay/shared';
import { api } from './api';
import { clearToken, getToken, setToken } from './tokenStore';

interface AuthContextValue {
  token: string | null;
  me: Me | null;
  /** True until the stored token has been read from SecureStore. */
  ready: boolean;
  signIn: (session: AuthSession) => Promise<void>;
  signOut: (opts?: { revokeServerSession?: boolean }) => Promise<void>;
  refreshMe: () => Promise<void>;
  setMe: (me: Me) => void;
}

const AuthContext = createContext<AuthContextValue>({
  token: null,
  me: null,
  ready: false,
  signIn: async () => {},
  signOut: async () => {},
  refreshMe: async () => {},
  setMe: () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setTokenState] = useState<string | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      const stored = await getToken();
      if (!alive) return;
      setTokenState(stored);
      setReady(true);
      if (stored) {
        try {
          const fetched = await api<Me>('/me', { token: stored });
          if (alive) setMe(fetched);
        } catch (err) {
          // 401 → stored session is dead; anything else (offline) keeps token.
          if (
            alive &&
            err instanceof Error &&
            'status' in err &&
            (err as { status: number }).status === 401
          ) {
            await clearToken();
            setTokenState(null);
          }
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const signIn = useCallback(async (session: AuthSession) => {
    // A different account on the same device must not inherit the previous
    // one's joined events, cached data or push registration.
    const previous = await AsyncStorage.getItem(K.lastUserId).catch(() => null);
    if (previous && previous !== session.user.id) await clearAccountScopedState();
    await AsyncStorage.setItem(K.lastUserId, session.user.id).catch(() => {});

    await setToken(session.token);
    setTokenState(session.token);
    setMe(session.user);
  }, []);

  const signOut = useCallback(
    async (opts?: { revokeServerSession?: boolean }) => {
      if (opts?.revokeServerSession !== false && token) {
        try {
          await api('/auth/logout', { method: 'POST', token });
        } catch {
          /* best effort */
        }
      }
      await clearToken();
      // Leaving the device clean is the point: the next person to sign in here
      // should see nothing of this account.
      await clearAccountScopedState();
      setTokenState(null);
      setMe(null);
    },
    [token],
  );

  const refreshMe = useCallback(async () => {
    if (!token) return;
    try {
      setMe(await api<Me>('/me', { token }));
    } catch {
      /* keep the stale copy */
    }
  }, [token]);

  const value = useMemo(
    () => ({ token, me, ready, signIn, signOut, refreshMe, setMe }),
    [token, me, ready, signIn, signOut, refreshMe],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}
