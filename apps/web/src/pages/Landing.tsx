/** Public landing: intro/marketing content + a live list of currently-active public events
 * and their top wants, followed by a volunteer-app callout.
 */
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useCatalogue, useEvents } from '../api/hooks';
import { PublicWants } from '../components/PublicWants';
import { useLocale } from '../i18n/LocaleContext';
import { formatDateTime } from '../lib/format';
import { Card, EmptyState, SkeletonCard } from '../ui/components';
import { Icon } from '../ui/icons';
import { CategoryChip, HeroScene, IllustrationVignette, PhoneMockup } from '../ui/patterns';

const HOW_STEPS = [
  { icon: 'calendar', title: 'landing.how1t', body: 'landing.how1b', link: 'landing.exploreEventsCta', href: '#events' },
  { icon: 'box', title: 'landing.how2t', body: 'landing.how2b', link: 'landing.learnMoreCta', href: '#what-title' },
  { icon: 'hand', title: 'landing.how3t', body: 'landing.how3b', link: 'landing.safetyTipsCta', href: '#safety' },
] as const;

/** Simple, disclosed magnitude tiers over real summed quantities — not a fabricated claim. */
function tierFor(qty: number): 'high' | 'moderate' | 'low' {
  if (qty >= 15) return 'high';
  if (qty >= 5) return 'moderate';
  return 'low';
}

const TIER_LABEL_KEY = {
  high: 'landing.tierHigh',
  moderate: 'landing.tierModerate',
  low: 'landing.tierLow',
} as const;

export function LandingPage() {
  const { t, locale } = useLocale();
  const events = useEvents({});
  const catalogue = useCatalogue();

  // Client-side aggregate across the events already fetched for this page —
  // no new backend endpoint. Admin-declared wants (no real quantity) are
  // excluded; only real summed demand is shown, capped to the top 4.
  const topNeeds = useMemo(() => {
    const byCategory = new Map<string, number>();
    for (const ev of events.data?.items ?? []) {
      for (const w of ev.wants) {
        if (w.source !== 'user' || !w.requestedQty) continue;
        byCategory.set(w.categorySlug, (byCategory.get(w.categorySlug) ?? 0) + w.requestedQty);
      }
    }
    return [...byCategory.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
  }, [events.data]);

  const categoryBySlug = new Map((catalogue.data?.categories ?? []).map((c) => [c.slug, c]));

  return (
    <div className="landing-page">
      <section className="landing-hero">
        <div className="landing-hero-copy">
          <span className="landing-eyebrow">
            <Icon name="heart" size={14} /> {t('landing.eyebrow')}
          </span>
          <h1>
            {t('landing.heroTitleLine1')}
            <br />
            <span className="accent">{t('landing.heroTitleLine2')}</span>
          </h1>
          <p>{t('landing.heroBody')}</p>
          <div className="landing-cta-row">
            <span className="btn btn-primary" aria-disabled="true">
              {t('landing.downloadCta')}
            </span>
            <a href="#how-it-works" className="btn btn-secondary">
              {t('landing.howItWorksCta')} <Icon name="chevronDown" size={16} />
            </a>
          </div>
          <div className="landing-trust-row">
            <div className="trust-item">
              <span className="trust-item-icon" style={{ background: 'var(--c-success-tint)', color: 'var(--c-success-text)' }}>
                <Icon name="shield" size={16} />
              </span>
              <div>
                <strong>{t('landing.trust1t')}</strong>
                <span>{t('landing.trust1b')}</span>
              </div>
            </div>
            <div className="trust-item">
              <span className="trust-item-icon" style={{ background: 'var(--c-warning-tint)', color: 'var(--c-warning-text)' }}>
                <Icon name="lock" size={16} />
              </span>
              <div>
                <strong>{t('landing.trust2t')}</strong>
                <span>{t('landing.trust2b')}</span>
              </div>
            </div>
            <div className="trust-item">
              <span className="trust-item-icon" style={{ background: 'var(--cat-shelter-bg)', color: 'var(--cat-shelter-fg)' }}>
                <Icon name="user" size={16} />
              </span>
              <div>
                <strong>{t('landing.trust3t')}</strong>
                <span>{t('landing.trust3b')}</span>
              </div>
            </div>
          </div>
        </div>
        <div className="hero-visual">
          <HeroScene />
          <PhoneMockup
            eventTitle={t('landing.phoneMockSample')}
            areaLabel={t('landing.phoneMockArea')}
            schedule={t('landing.phoneMockSchedule')}
            activeLabel={t('events.active')}
            helpingNowLabel={t('availability.helpingNow')}
            helpingNowHint={t('landing.phoneMockMayReceive')}
            locationHint={t('landing.phoneMockLocation')}
            expiryHint={t('landing.phoneMockExpiry')}
            stopLabel={t('availability.stopNow')}
            quickActionsLabel={t('home.quickActions')}
            requestLabel={t('home.requestHelp')}
            requestHint={t('home.requestHelpHint')}
            supplyLabel={t('home.addSupplies')}
            supplyHint={t('home.addSuppliesHint')}
          />
        </div>
      </section>

      <section id="how-it-works" aria-labelledby="how-title" className="landing-section">
        <h2 id="how-title" style={{ textAlign: 'center' }}>
          {t('landing.howTitle')}
        </h2>
        <div className="how-steps">
          {HOW_STEPS.map((step, i) => (
            <Card key={step.title} className="card-lg step-card">
              <div className="step-card-head">
                <span className="step-icon">
                  <Icon name={step.icon} size={20} />
                </span>
                <span className="step-num">{i + 1}</span>
              </div>
              <h3>{t(step.title)}</h3>
              <p>{t(step.body)}</p>
              <a href={step.href} className="step-link">
                {t(step.link)} <Icon name="arrowRight" size={14} />
              </a>
            </Card>
          ))}
        </div>
      </section>

      <section aria-labelledby="what-title" className="landing-section" style={{ marginTop: 'var(--sp-6)' }}>
        <Card className="card-lg">
          <h2 id="what-title">{t('landing.whatTitle')}</h2>
          <p className="text-soft" style={{ marginBottom: 0 }}>
            {t('landing.whatBody')}
          </p>
        </Card>
      </section>

      <section id="events" aria-labelledby="events-title" className="landing-section" style={{ marginTop: 'var(--sp-6)' }}>
        <div className="needs-events-grid">
          <Card className="card-lg">
            <div className="row" style={{ marginBottom: 'var(--sp-3)' }}>
              <h2 style={{ margin: 0, flex: 1, fontSize: 'var(--fs-h3)' }}>{t('landing.needsTitle')}</h2>
              <span className="tier-pill tier-low">{t('landing.needsLive')}</span>
            </div>
            <p className="text-xs text-soft" style={{ marginTop: 0, marginBottom: 'var(--sp-3)' }}>
              {t('landing.needsSubtitle')}
            </p>
            {events.isLoading || catalogue.isLoading ? (
              <SkeletonCard lines={3} />
            ) : topNeeds.length === 0 ? (
              <p className="text-sm text-soft">{t('landing.needsEmpty')}</p>
            ) : (
              <div>
                {topNeeds.map(([slug, qty]) => {
                  const cat = categoryBySlug.get(slug);
                  if (!cat) return null;
                  const tier = tierFor(qty);
                  return (
                    <div key={slug} className="needs-live-row">
                      <CategoryChip group={cat.group} icon={cat.icon} size="sm" />
                      <div className="needs-live-row-body">
                        <strong>{cat.name[locale] ?? cat.name.en}</strong>
                        <span className={`tier-pill tier-${tier}`}>{t(TIER_LABEL_KEY[tier])}</span>
                      </div>
                      <span className="needs-live-qty">{Math.round(qty)}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>

          <Card className="card-lg">
            <h2 id="events-title" style={{ marginTop: 0, fontSize: 'var(--fs-h3)' }}>
              {t('nav.events')}
            </h2>
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
                        <div className="row">
                          <strong style={{ flex: 1, fontSize: 'var(--fs-h3)' }}>{ev.title}</strong>
                          {ev.status === 'active' ? <span className="tier-pill tier-low">{t('events.active')}</span> : null}
                          {ev.status === 'scheduled' ? (
                            <span className="tier-pill tier-moderate">{t('events.scheduled')}</span>
                          ) : null}
                        </div>
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
          </Card>
        </div>
      </section>

      <section className="landing-section" style={{ marginTop: 'var(--sp-6)' }}>
        <div className="info-banner info-banner-tint-primary">
          <span className="info-banner-icon">
            <Icon name="shield" size={20} />
          </span>
          <div className="info-banner-body">
            <h2>{t('landing.privacyTitle')}</h2>
            <p>{t('landing.privacyBody')}</p>
          </div>
        </div>
      </section>

      <section id="safety" aria-labelledby="safety-title" className="landing-section" style={{ marginTop: 'var(--sp-6)' }}>
        <h2 id="safety-title">{t('onboarding.safetyTitle')}</h2>
        <Card>
          <ul className="plain stack-sm">
            {(['meetPublic', 'noContactShare', 'inspectSealed', 'canCancel', 'notVerifiedPlatform', 'notEmergency'] as const).map(
              (k) => (
                <li key={k} className="row" style={{ alignItems: 'flex-start' }}>
                  <span style={{ color: 'var(--c-success)' }} aria-hidden="true">
                    <Icon name="check" size={18} />
                  </span>
                  <span className="text-sm text-soft">{t(`safety.${k}`)}</span>
                </li>
              ),
            )}
          </ul>
        </Card>
      </section>

      <section className="landing-section" style={{ marginTop: 'var(--sp-6)' }}>
        <div className="info-banner" style={{ background: 'var(--c-success-tint)' }}>
          <span className="info-banner-icon" style={{ background: 'var(--c-surface)', color: 'var(--c-success-text)' }}>
            <IllustrationVignette name="box" size={40} />
          </span>
          <div className="info-banner-body">
            <h2>{t('landing.installTitle')}</h2>
            <p>{t('landing.installBody')}</p>
          </div>
          <div className="info-banner-actions">
            <span className="store-badge" aria-disabled="true">
              {t('landing.playStoreBadge')}
            </span>
            <span className="store-badge" aria-disabled="true">
              {t('landing.appStoreBadge')}
            </span>
          </div>
        </div>
      </section>

      <footer className="app-footer" style={{ marginTop: 'var(--sp-7)' }}>
        <div className="app-footer-inner">
          <div className="footer-brand">
            <div className="app-logo" style={{ pointerEvents: 'none' }}>
              <Icon name="heart" size={22} />
              <span>
                {t('common.appName')} <span lang="hi">सहाय</span>
              </span>
            </div>
            <p>{t('landing.footerBrandBody')}</p>
          </div>
          <div className="footer-col">
            <h4>{t('landing.footerPlatform')}</h4>
            <a href="#how-it-works">{t('landing.howTitle')}</a>
            <a href="#safety">{t('onboarding.safetyTitle')}</a>
          </div>
          <div className="footer-col">
            <h4>{t('landing.footerResources')}</h4>
            <Link to="/guidelines">{t('pages.guidelines.title')}</Link>
            <Link to="/privacy">{t('pages.privacy.title')}</Link>
            <Link to="/terms">{t('pages.terms.title')}</Link>
            <Link to="/support">{t('pages.support.title')}</Link>
          </div>
        </div>
        <p className="footer-bottom">
          © {new Date().getFullYear()} {t('landing.copyright')}
        </p>
      </footer>
    </div>
  );
}
