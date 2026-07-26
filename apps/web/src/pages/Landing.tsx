import { Link } from 'react-router-dom';
import { getToken } from '../api/client';
import { useT } from '../i18n/LocaleContext';
import { Banner, Card } from '../ui/components';
import { Icon } from '../ui/icons';

export function LandingPage() {
  const t = useT();
  const authed = !!getToken();

  return (
    <div>
      <section className="landing-hero">
        <h1>{t('landing.heroTitle')}</h1>
        <p>{t('landing.heroBody')}</p>
        <div className="row" style={{ justifyContent: 'center', flexWrap: 'wrap' }}>
          <Link to="/events" className="btn btn-primary btn-lg">
            {t('landing.discoverCta')}
          </Link>
          {!authed ? (
            <Link to="/auth" className="btn btn-secondary btn-lg">
              {t('landing.signInCta')}
            </Link>
          ) : null}
        </div>
      </section>

      <section aria-labelledby="what-title">
        <Card>
          <h2 id="what-title">{t('landing.whatTitle')}</h2>
          <p className="text-soft">{t('landing.whatBody')}</p>
        </Card>
      </section>

      <section aria-labelledby="how-title">
        <h2 id="how-title" style={{ marginTop: 'var(--sp-6)' }}>
          {t('landing.howTitle')}
        </h2>
        <div className="landing-grid">
          {(
            [
              ['calendar', 'landing.how1t', 'landing.how1b'],
              ['box', 'landing.how2t', 'landing.how2b'],
              ['heart', 'landing.how3t', 'landing.how3b'],
            ] as const
          ).map(([icon, title, body]) => (
            <Card key={title}>
              <Icon name={icon} size={28} />
              <h3 style={{ marginTop: 'var(--sp-2)' }}>{t(title)}</h3>
              <p className="text-sm text-soft" style={{ marginBottom: 0 }}>
                {t(body)}
              </p>
            </Card>
          ))}
        </div>
      </section>

      <section aria-labelledby="limits-title" className="stack" style={{ marginTop: 'var(--sp-5)' }}>
        <Banner tone="warn" icon="warning">
          <h2 id="limits-title" style={{ fontSize: 'var(--fs-lg)' }}>
            {t('landing.limitsTitle')}
          </h2>
          <p style={{ marginBottom: 0 }}>{t('landing.limitsBody')}</p>
        </Banner>
        <Banner tone="info" icon="shield">
          <h2 style={{ fontSize: 'var(--fs-lg)' }}>{t('landing.privacyTitle')}</h2>
          <p style={{ marginBottom: 0 }}>{t('landing.privacyBody')}</p>
        </Banner>
      </section>

      <section aria-labelledby="safety-title" style={{ marginTop: 'var(--sp-6)' }}>
        <h2 id="safety-title">{t('onboarding.safetyTitle')}</h2>
        <ul className="bullets text-soft">
          {(['meetPublic', 'noContactShare', 'inspectSealed', 'canCancel', 'notVerifiedPlatform', 'notEmergency'] as const).map(
            (k) => (
              <li key={k}>{t(`safety.${k}`)}</li>
            ),
          )}
        </ul>
      </section>

      <section style={{ marginTop: 'var(--sp-6)' }}>
        <Card>
          <h2>{t('landing.installTitle')}</h2>
          <p className="text-soft" style={{ marginBottom: 0 }}>
            {t('landing.installBody')}
          </p>
        </Card>
      </section>

      <footer className="app-footer" style={{ marginTop: 'var(--sp-7)', marginLeft: 'calc(-1 * var(--sp-4))', marginRight: 'calc(-1 * var(--sp-4))' }}>
        <div className="app-footer-inner">
          <Link to="/guidelines">{t('pages.guidelines.title')}</Link>
          <Link to="/privacy">{t('pages.privacy.title')}</Link>
          <Link to="/terms">{t('pages.terms.title')}</Link>
          <Link to="/support">{t('pages.support.title')}</Link>
        </div>
      </footer>
    </div>
  );
}
