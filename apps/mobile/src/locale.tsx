import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { t as sharedT, type Locale } from '@sahay/shared';
import { K } from './storage';

interface LocaleContextValue {
  locale: Locale;
  ready: boolean;
  setLocale: (l: Locale) => void;
}

const LocaleContext = createContext<LocaleContextValue>({
  locale: 'en',
  ready: false,
  setLocale: () => {},
});

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>('en');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    AsyncStorage.getItem(K.locale)
      .then((v) => {
        if (alive && (v === 'en' || v === 'hi')) setLocaleState(v);
      })
      .finally(() => {
        if (alive) setReady(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    AsyncStorage.setItem(K.locale, l).catch(() => {});
  }, []);

  const value = useMemo(() => ({ locale, ready, setLocale }), [locale, ready, setLocale]);
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale(): LocaleContextValue {
  return useContext(LocaleContext);
}

/** Translation hook: every visible string goes through this. */
export function useT(): (key: string, params?: Record<string, string | number>) => string {
  const { locale } = useContext(LocaleContext);
  return useCallback((key, params) => sharedT(locale, key, params), [locale]);
}
