import { useLocale } from '../i18n/LocaleContext';
import { IllustrationVignette } from '../ui/patterns';

export function VolunteerCta() {
  const { t } = useLocale();
  return (
    <section className="card stack" style={{ alignItems: 'center', textAlign: 'center' }}>
      <IllustrationVignette name="hand" size={96} />
      <h2 style={{ margin: 0 }}>{t('landing.volunteerTitle')}</h2>
      <p className="text-soft" style={{ maxWidth: '44ch', margin: 0 }}>
        {t('landing.volunteerBody')}
      </p>
      <div className="row-wrap" style={{ justifyContent: 'center' }}>
        <span className="btn btn-secondary" aria-disabled="true">
          {t('landing.appStoreBadge')}
        </span>
        <span className="btn btn-secondary" aria-disabled="true">
          {t('landing.playStoreBadge')}
        </span>
      </div>
    </section>
  );
}
