import { useLocale } from '../i18n/LocaleContext';
import { useMe, useUpdateMe } from '../api/hooks';
import { getToken } from '../api/client';
import { Icon } from '../ui/icons';

/** en/hi toggle persisted to localStorage; also syncs to the server profile when signed in. */
export function LanguageToggle() {
  const { locale, setLocale, t } = useLocale();
  const me = useMe(!!getToken());
  const update = useUpdateMe();
  const next = locale === 'en' ? 'hi' : 'en';

  return (
    <button
      type="button"
      className="btn btn-ghost"
      lang={next}
      aria-label={`${t('settings.language')}: ${next === 'hi' ? 'हिन्दी' : 'English'}`}
      onClick={() => {
        setLocale(next);
        if (me.data) update.mutate({ locale: next });
      }}
    >
      <Icon name="globe" />
      {next === 'hi' ? 'हिन्दी' : 'English'}
    </button>
  );
}
