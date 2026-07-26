import { useEffect, useState } from 'react';
import { NET_EVENT } from '../api/client';
import { useT } from '../i18n/LocaleContext';

/** Global offline banner: navigator.onLine plus a failed-fetch heuristic. */
export function OfflineBanner() {
  const t = useT();
  const [offline, setOffline] = useState(!navigator.onLine);

  useEffect(() => {
    const onOnline = () => setOffline(false);
    const onOffline = () => setOffline(true);
    const onNet = (e: Event) => {
      const ok = (e as CustomEvent<{ ok: boolean }>).detail?.ok;
      if (ok === false) setOffline(true);
      else if (ok === true && navigator.onLine) setOffline(false);
    };
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    window.addEventListener(NET_EVENT, onNet);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener(NET_EVENT, onNet);
    };
  }, []);

  if (!offline) return null;
  return (
    <div className="offline-banner" role="status">
      {t('common.offline')}
    </div>
  );
}
