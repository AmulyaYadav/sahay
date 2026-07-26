/** Public event discovery: search, type filter, cards, and an "enter code" input for unlisted events. */
import { EVENT_TYPES, type EventSummary } from '@sahay/shared';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useEvents } from '../api/hooks';
import { useLocale } from '../i18n/LocaleContext';
import { formatDateTime } from '../lib/format';
import { Badge, Button, Card, EmptyState, Input, Select, SkeletonCard } from '../ui/components';
import { Icon } from '../ui/icons';

function statusBadge(ev: EventSummary, t: (k: string) => string) {
  if (ev.status === 'active') return <Badge tone="ok">{t('events.active')}</Badge>;
  if (ev.status === 'paused') return <Badge tone="warn">{t('events.paused')}</Badge>;
  if (ev.status === 'scheduled') return <Badge tone="accent">{t('events.scheduled')}</Badge>;
  return <Badge>{t('events.ended')}</Badge>;
}

export function EventsPage() {
  const { t, locale } = useLocale();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [type, setType] = useState('');
  const [code, setCode] = useState('');
  const events = useEvents({ q: q || undefined, type: type || undefined });

  return (
    <div className="stack">
      <div className="row">
        <h1 style={{ flex: 1, margin: 0 }}>{t('events.discover')}</h1>
        <Link className="btn btn-secondary" to="/events/new">
          <Icon name="plus" size={16} /> {t('events.createEvent')}
        </Link>
      </div>

      <div className="grid-2">
        <Input
          label={t('common.search')}
          type="search"
          placeholder={t('events.searchPlaceholder')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <Select label={t('events.typeFilter')} value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">{t('events.all')}</option>
          {EVENT_TYPES.map((et) => (
            <option key={et} value={et}>
              {t(`eventTypes.${et}`)}
            </option>
          ))}
        </Select>
      </div>

      {events.isLoading ? (
        <div className="stack">
          <SkeletonCard />
          <SkeletonCard />
        </div>
      ) : (events.data?.items.length ?? 0) === 0 ? (
        <EmptyState title={t('misc.emptyTitle')} body={t('events.noResults')} />
      ) : (
        <ul className="plain stack">
          {events.data?.items.map((ev) => (
            <li key={ev.id}>
              <Card>
                <div className="stack-sm">
                  <div className="row">
                    <h2 style={{ margin: 0, flex: 1, fontSize: 'var(--fs-lg)' }}>
                      <Link to={`/events/${ev.code}`}>{ev.title}</Link>
                    </h2>
                    {statusBadge(ev, t)}
                  </div>
                  <div className="row-wrap text-sm text-soft">
                    <span>
                      <Icon name="calendar" size={16} /> {t(`eventTypes.${ev.type}`)}
                    </span>
                    <span>
                      <Icon name="location" size={16} /> {ev.areaLabel}
                    </span>
                    <span>
                      <Icon name="clock" size={16} /> {formatDateTime(ev.startsAt, locale)}
                    </span>
                    {ev.joined ? <Badge tone="ok">{t('events.joined')}</Badge> : null}
                  </div>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <Card>
        <form
          className="row"
          style={{ alignItems: 'flex-end' }}
          onSubmit={(e) => {
            e.preventDefault();
            if (code.trim()) navigate(`/events/${encodeURIComponent(code.trim().toUpperCase())}`);
          }}
        >
          <div style={{ flex: 1 }}>
            <Input
              label={t('events.joinByCode')}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              autoCapitalize="characters"
              autoCorrect="off"
            />
          </div>
          <Button type="submit" variant="secondary" disabled={!code.trim()}>
            {t('events.open')}
          </Button>
        </form>
        <p className="text-xs text-soft" style={{ marginTop: 'var(--sp-2)', marginBottom: 0 }}>
          {t('events.unlistedNote')}
        </p>
      </Card>
    </div>
  );
}
