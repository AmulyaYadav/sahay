import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { t as sharedT, type Locale } from '@sahay/shared';

const KEY = 'sahay.locale';

export type TFunc = (key: string, params?: Record<string, string | number>) => string;

interface LocaleCtx {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: TFunc;
}

const Ctx = createContext<LocaleCtx | null>(null);

function initialLocale(): Locale {
  try {
    const stored = localStorage.getItem(KEY);
    if (stored === 'hi' || stored === 'en') return stored;
  } catch {
    /* private mode */
  }
  return navigator.language.toLowerCase().startsWith('hi') ? 'hi' : 'en';
}

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    try {
      localStorage.setItem(KEY, l);
    } catch {
      /* ignore */
    }
  }, []);

  const t = useCallback<TFunc>((key, params) => sharedT(locale, key, params), [locale]);

  const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useLocale(): LocaleCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('LocaleProvider missing');
  return ctx;
}

export function useT(): TFunc {
  return useLocale().t;
}
