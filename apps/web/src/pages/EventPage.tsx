/** Public event detail: description, safety/medical info, notices, current wants, volunteer CTA. */
import { Link, useParams } from 'react-router-dom';
import { useEvent } from '../api/hooks';
import { PublicWants } from '../components/PublicWants';
import { VolunteerCta } from '../components/VolunteerCta';
import { useLocale } from '../i18n/LocaleContext';
import { formatDateTime } from '../lib/format';
import { Badge, Banner, Card, SkeletonCard } from '../ui/components';
import { Icon } from '../ui/icons';

export function EventPage() {
  const { idOrCode } = useParams<{ idOrCode: string }>();
  const { t, locale } = useLocale();
  const eventQuery = useEvent(idOrCode);
  const event = eventQuery.data;

  if (eventQuery.isLoading) {
    return (
      <div className="stack">
        <SkeletonCard lines={4} />
        <SkeletonCard lines={3} />
      </div>
    );
  }
  if (!event) {
    return (
      <div className="empty-state">
        <h1>{t('errors.not_found')}</h1>
        <Link className="btn btn-secondary" to="/">
          {t('nav.events')}
        </Link>
      </div>
    );
  }

  return (
    <div className="stack">
      <div className="stack-sm">
        <div className="row">
          <h1 style={{ margin: 0, flex: 1 }}>{event.title}</h1>
          {event.status === 'active' ? <Badge tone="ok">{t('events.active')}</Badge> : null}
          {event.status === 'scheduled' ? <Badge tone="accent">{t('events.scheduled')}</Badge> : null}
          {['completed', 'archived', 'disabled'].includes(event.status) ? <Badge>{t('events.ended')}</Badge> : null}
        </div>
        <div className="stack-sm">
          <p className="helping-meta">
            <Icon name="calendar" size={16} /> {t(`eventTypes.${event.type}`)} · {t('eventPage.starts')}:{' '}
            {formatDateTime(event.startsAt, locale)} · {t('eventPage.ends')}: {formatDateTime(event.endsAt, locale)}
          </p>
          <p className="helping-meta">
            <Icon name="location" size={16} /> {event.areaLabel}
          </p>
        </div>
      </div>

      {event.notices.length > 0 ? (
        <section aria-label={t('home.notices')} className="stack-sm">
          {event.notices.map((n) => (
            <Banner key={n.id} tone="warn" icon="info" role="status">
              <p style={{ margin: 0 }}>{n.body}</p>
              <span className="text-xs text-soft">{formatDateTime(n.createdAt, locale)}</span>
            </Banner>
          ))}
        </section>
      ) : null}

      <Card>
        <h2>{t('eventPage.aboutTitle')}</h2>
        <p className="text-soft" style={{ marginBottom: 0 }}>
          {event.description}
        </p>
      </Card>

      {event.safetyInfo ? (
        <Card>
          <h2>{t('eventPage.safetyTitle')}</h2>
          <p className="text-soft" style={{ marginBottom: 0 }}>
            {event.safetyInfo}
          </p>
        </Card>
      ) : null}

      {event.medicalInfo ? (
        <Banner tone="danger" icon="warning">
          <strong>{t('eventPage.medicalTitle')}</strong>
          <p style={{ marginBottom: 0 }}>{event.medicalInfo}</p>
        </Banner>
      ) : null}

      <Card>
        <h2>{t('eventPage.wantsTitle')}</h2>
        <PublicWants wants={event.wants} />
      </Card>

      <VolunteerCta />
    </div>
  );
}
