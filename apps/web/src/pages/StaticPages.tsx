/** Static content pages: guidelines, privacy, terms, support. All content lives in the shared i18n catalog. */
import { useT } from '../i18n/LocaleContext';
import { Banner } from '../ui/components';

function Prose({ children }: { children: React.ReactNode }) {
  return <article style={{ maxWidth: '68ch', margin: '0 auto' }}>{children}</article>;
}

export function GuidelinesPage() {
  const t = useT();
  return (
    <Prose>
      <h1>{t('pages.guidelines.title')}</h1>
      <p className="text-soft">{t('pages.guidelines.intro')}</p>

      <h2>{t('pages.guidelines.purposeTitle')}</h2>
      <p>{t('pages.guidelines.purpose1')}</p>
      <p>{t('pages.guidelines.purpose2')}</p>

      <h2>{t('pages.guidelines.conductTitle')}</h2>
      <ul className="bullets">
        {(['conduct1', 'conduct2', 'conduct3', 'conduct4', 'conduct5'] as const).map((k) => (
          <li key={k}>{t(`pages.guidelines.${k}`)}</li>
        ))}
      </ul>

      <h2>{t('pages.guidelines.prohibitedTitle')}</h2>
      <p>{t('pages.guidelines.prohibitedIntro')}</p>
      <ul className="bullets">
        {(['prohibited1', 'prohibited2', 'prohibited3', 'prohibited4', 'prohibited5', 'prohibited6'] as const).map((k) => (
          <li key={k}>{t(`pages.guidelines.${k}`)}</li>
        ))}
      </ul>

      <h2>{t('pages.guidelines.enforcementTitle')}</h2>
      <p>{t('pages.guidelines.enforcement1')}</p>
      <p>{t('pages.guidelines.enforcement2')}</p>
    </Prose>
  );
}

export function PrivacyPage() {
  const t = useT();
  return (
    <Prose>
      <h1>{t('pages.privacy.title')}</h1>
      <p className="text-soft">{t('pages.privacy.intro')}</p>

      <h2>{t('pages.privacy.collectTitle')}</h2>
      <ul className="bullets">
        {(['collect1', 'collect2', 'collect3', 'collect4'] as const).map((k) => (
          <li key={k}>{t(`pages.privacy.${k}`)}</li>
        ))}
      </ul>

      <h2>{t('pages.privacy.locationTitle')}</h2>
      <p>{t('pages.privacy.location1')}</p>
      <p>{t('pages.privacy.location2')}</p>

      <h2>{t('pages.privacy.visibilityTitle')}</h2>
      <p>{t('pages.privacy.visibility1')}</p>
      <p>{t('pages.privacy.visibility2')}</p>

      <h2>{t('pages.privacy.retentionTitle')}</h2>
      <p>{t('pages.privacy.retention1')}</p>
      <p>{t('pages.privacy.retention2')}</p>
      <p>{t('pages.privacy.retention3')}</p>

      <h2>{t('pages.privacy.rightsTitle')}</h2>
      <p>{t('pages.privacy.rights1')}</p>
      <p>{t('pages.privacy.rights2')}</p>
      <p className="text-soft">{t('pages.privacy.contact')}</p>
    </Prose>
  );
}

export function TermsPage() {
  const t = useT();
  return (
    <Prose>
      <h1>{t('pages.terms.title')}</h1>
      <p className="text-soft">{t('pages.terms.intro')}</p>
      {(['s1', 's2', 's3', 's4', 's5', 's6', 's7'] as const).map((s) => (
        <section key={s}>
          <h2>{t(`pages.terms.${s}t`)}</h2>
          <p>{t(`pages.terms.${s}b`)}</p>
        </section>
      ))}
    </Prose>
  );
}

export function SupportPage() {
  const t = useT();
  return (
    <Prose>
      <h1>{t('pages.support.title')}</h1>
      <p className="text-soft">{t('pages.support.intro')}</p>

      {(['faq1', 'faq2', 'faq3', 'faq4'] as const).map((f) => (
        <section key={f}>
          <h2 style={{ fontSize: 'var(--fs-lg)' }}>{t(`pages.support.${f}q`)}</h2>
          <p>{t(`pages.support.${f}a`)}</p>
        </section>
      ))}

      <h2>{t('pages.support.contactTitle')}</h2>
      <p>{t('pages.support.contactBody')}</p>
      <Banner tone="danger" icon="warning">
        {t('pages.support.emergencyNote')}
      </Banner>
    </Prose>
  );
}
