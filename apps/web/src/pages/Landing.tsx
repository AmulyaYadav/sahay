/** Public landing: intro/marketing content + a live list of currently-active public events
 * and their top wants, followed by a volunteer-app callout.
 */
import { Link } from 'react-router-dom';
import { getToken } from '../api/client';
import { useEvents } from '../api/hooks';
import { PublicWants } from '../components/PublicWants';
import { VolunteerCta } from '../components/VolunteerCta';
import { useLocale } from '../i18n/LocaleContext';
import { formatDateTime } from '../lib/format';
import { Banner, Card, EmptyState, SkeletonCard } from '../ui/components';
import { Icon } from '../ui/icons';
import { IllustrationVignette } from '../ui/patterns';

export function LandingPage() {
  const { t, locale } = useLocale();
  const authed = !!getToken();
  const events = useEvents({});

  return (
    <div>
      <section className="landing-hero">
        <IllustrationVignette name="box" size={96} />
        <h1>{t('landing.heroTitle')}</h1>
        <p>{t('landing.heroBody')}</p>
        {!authed ? (
          <div className="row" style={{ justifyContent: 'center', flexWrap: 'wrap' }}>
            <Link to="/auth" className="btn btn-secondary btn-lg">
              {t('landing.signInCta')}
            </Link>
          </div>
        ) : null}
      </section>

      <section aria-labelledby="what-title">
        <Card>
          <h2 id="what-title">{t('landing.whatTitle')}</h2>
          <p className="text-soft">{t('landing.whatBody')}</p>
        </Card>
      </section>

      <section aria-labelledby="events-title" className="stack" style={{ marginTop: 'var(--sp-6)' }}>
        <h2 id="events-title">{t('nav.events')}</h2>
        {events.isLoading ? (
          <div className="stack">
            <SkeletonCard lines={3} />
            <SkeletonCard lines={3} />
          </div>
        ) : (events.data?.items.length ?? 0) === 0 ? (
          <EmptyState title={t('landing.noActiveEvents')} />
        ) : (
          <div className="stack">
            {events.data!.items.map((ev) => (
              <Link key={ev.id} to={`/events/${ev.code}`} style={{ textDecoration: 'none', color: 'inherit' }}>
                <Card>
                  <div className="stack-sm">
                    <strong style={{ fontSize: 'var(--fs-lg)' }}>{ev.title}</strong>
                    <p className="text-xs text-soft" style={{ margin: 0 }}>
                      {ev.areaLabel} · {formatDateTime(ev.startsAt, locale)}
                    </p>
                    <PublicWants wants={ev.wants} />
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        )}
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

      <section style={{ marginTop: 'var(--sp-6)' }}>
        <VolunteerCta />
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
