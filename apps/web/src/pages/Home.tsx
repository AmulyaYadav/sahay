/**
 * Home: active event context, the big Helping Now toggle (with duration picker and
 * one-time location consent → coarse ping loop), notices, top shortages, inventory
 * summary, active request status, and active matches.
 */
import { AVAILABILITY_DURATIONS_MIN } from '@sahay/shared';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  useActiveMatches,
  useAvailability,
  useEvent,
  useInventory,
  useMyRequests,
  useSetAvailability,
} from '../api/hooks';
import { Avatar } from '../components/Avatar';
import { DashboardPanel } from '../components/DashboardPanel';
import { RequestStatusCard } from '../components/RequestStatusCard';
import { useLocale } from '../i18n/LocaleContext';
import { categoryName, unitLabel } from '../lib/format';
import { getActiveEventId, getJoinedEvents, hasLocationConsent, setActiveEventId, setLocationConsent } from '../lib/storage';
import { useLocationPing } from '../realtime/useLocationPing';
import { useCatalogue } from '../api/hooks';
import { Badge, Banner, Button, Card, EmptyState, Select, Toggle } from '../ui/components';
import { Dialog } from '../ui/Dialog';
import { Icon } from '../ui/icons';

type Duration = (typeof AVAILABILITY_DURATIONS_MIN)[number];

export function HomePage() {
  const { t, locale } = useLocale();
  const navigate = useNavigate();
  const [eventId, setEventId] = useState<string | null>(getActiveEventId());
  const joined = getJoinedEvents();

  const eventQuery = useEvent(eventId ?? undefined);
  const availability = useAvailability(eventId ?? undefined);
  const setAvailability = useSetAvailability(eventId ?? '');
  const inventory = useInventory(eventId ?? undefined, !!eventId);
  const requests = useMyRequests(eventId ?? undefined);
  const matches = useActiveMatches();
  const catalogue = useCatalogue();

  const [duration, setDuration] = useState<Duration>(60);
  const [consentOpen, setConsentOpen] = useState(false);

  const helping = availability.data?.on ?? false;
  useLocationPing(eventId ?? undefined, helping && hasLocationConsent());

  const activeRequests = useMemo(
    () =>
      (requests.data?.items ?? []).filter((r) =>
        ['searching', 'offering', 'matched', 'partially_fulfilled', 'no_match', 'expired'].includes(r.status),
      ),
    [requests.data],
  );

  const turnOn = () => {
    setAvailability.mutate({ on: true, durationMinutes: duration });
  };

  const handleToggle = (on: boolean) => {
    if (!eventId) return;
    if (!on) {
      setAvailability.mutate({ on: false });
      return;
    }
    if (!hasLocationConsent()) setConsentOpen(true);
    else turnOn();
  };

  if (!eventId) {
    return (
      <EmptyState
        title={t('home.noEventTitle')}
        body={t('home.noEventBody')}
        action={
          <Link to="/events" className="btn btn-primary">
            {t('events.discover')}
          </Link>
        }
      />
    );
  }

  const event = eventQuery.data;

  return (
    <div className="stack">
      <div className="row">
        <div style={{ flex: 1 }}>
          <span className="text-xs text-soft">{t('home.currentEvent')}</span>
          <h1 style={{ margin: 0, fontSize: 'var(--fs-xl)' }}>
            {event ? <Link to={`/events/${event.code}`}>{event.title}</Link> : t('common.loading')}
          </h1>
        </div>
        {joined.length > 1 ? (
          <div style={{ minWidth: 140 }}>
            <Select
              label={t('home.switchEvent')}
              value={eventId}
              onChange={(e) => {
                setActiveEventId(e.target.value);
                setEventId(e.target.value);
              }}
            >
              {joined.map((j) => (
                <option key={j.id} value={j.id}>
                  {j.title}
                </option>
              ))}
            </Select>
          </div>
        ) : null}
      </div>

      {event?.matchingPaused || event?.status === 'paused' ? (
        <Banner tone="warn" icon="warning" role="status">
          {t('events.paused')}
        </Banner>
      ) : null}

      {(event?.notices ?? []).slice(0, 2).map((n) => (
        <Banner key={n.id} tone="info" icon="info" role="status">
          {n.body}
        </Banner>
      ))}

      {/* Helping Now */}
      <Card>
        <div className="stack-sm">
          <div className="row">
            <Icon name="heart" size={26} />
            <strong style={{ flex: 1, fontSize: 'var(--fs-lg)' }}>{t('availability.helpingNow')}</strong>
            <Toggle
              checked={helping}
              onChange={handleToggle}
              label={t('availability.helpingNow')}
              disabled={setAvailability.isPending || availability.isLoading}
            />
          </div>
          <p className="text-sm" style={{ margin: 0 }} aria-live="polite">
            {helping ? t('availability.on') : t('availability.off')}
          </p>
          {!helping ? (
            <div className="row-wrap" role="radiogroup" aria-label={t('availability.helpingNow')}>
              {AVAILABILITY_DURATIONS_MIN.map((m) => (
                <button key={m} type="button" role="radio" aria-checked={duration === m} className="chip" onClick={() => setDuration(m)}>
                  {t(`availability.for${m}`)}
                </button>
              ))}
            </div>
          ) : (
            <>
              {hasLocationConsent() ? (
                <p className="text-xs text-soft" style={{ margin: 0 }}>
                  <Icon name="location" size={14} /> {t('home.locationSharing')}
                </p>
              ) : null}
              <Button variant="secondary" onClick={() => handleToggle(false)} loading={setAvailability.isPending}>
                {t('availability.stopNow')}
              </Button>
            </>
          )}
        </div>
      </Card>

      {/* Primary actions */}
      <section aria-label={t('home.quickActions')} className="row-wrap">
        <Link to={`/events/${eventId}/request`} className="btn btn-primary btn-lg" style={{ flex: 1 }}>
          {t('home.requestHelp')}
        </Link>
        <Link to={`/events/${event?.code ?? eventId}?tab=supplies`} className="btn btn-secondary btn-lg" style={{ flex: 1 }}>
          {t('home.addSupplies')}
        </Link>
        <Link to={`/events/${event?.code ?? eventId}?tab=bring`} className="btn btn-secondary btn-lg" style={{ flex: 1 }}>
          {t('bring.title')}
        </Link>
      </section>

      {/* Active request(s) */}
      {activeRequests.length > 0 ? (
        <section aria-label={t('home.myRequest')} className="stack-sm">
          <h2 style={{ margin: 0, fontSize: 'var(--fs-lg)' }}>{t('home.myRequest')}</h2>
          {activeRequests.map((r) => (
            <RequestStatusCard key={r.id} request={r} />
          ))}
        </section>
      ) : null}

      {/* Active matches */}
      {(matches.data?.items ?? []).length > 0 ? (
        <section aria-label={t('home.myMatches')} className="stack-sm">
          <h2 style={{ margin: 0, fontSize: 'var(--fs-lg)' }}>{t('home.myMatches')}</h2>
          {matches.data?.items.map((m) => {
            const cat = catalogue.data?.categories.find((c) => c.slug === m.categorySlug);
            return (
              <Card key={m.id}>
                <div className="row">
                  <Avatar seed={m.peer.avatarSeed} name={m.peer.alias} />
                  <div style={{ flex: 1 }}>
                    <strong>{m.peer.alias}</strong>
                    <span className="text-xs text-soft" style={{ display: 'block' }}>
                      {categoryName(cat, locale) || m.categorySlug} — {m.qtyReserved} {unitLabel(t, m.unit)} ·{' '}
                      {t(`proximity.${m.proximity}`)}
                    </span>
                  </div>
                  <Button onClick={() => navigate(`/matches/${m.id}`)}>
                    <Icon name="chat" /> {t('events.open')}
                  </Button>
                </div>
              </Card>
            );
          })}
        </section>
      ) : null}

      {/* Top needs */}
      <section aria-label={t('home.topNeeds')}>
        <Card>
          <h2 style={{ fontSize: 'var(--fs-lg)' }}>{t('home.topNeeds')}</h2>
          <DashboardPanel eventId={eventId} limit={3} />
        </Card>
      </section>

      {/* Inventory summary */}
      <Card>
        <div className="row">
          <Icon name="box" size={22} />
          <span style={{ flex: 1 }}>{t('home.inventorySummary', { count: inventory.data?.items.length ?? 0 })}</span>
          <Badge>{t('inventory.title')}</Badge>
        </div>
      </Card>

      {/* One-time location consent */}
      <Dialog open={consentOpen} onClose={() => setConsentOpen(false)} title={t('home.locationConsentTitle')}>
        <div className="stack">
          <p className="text-sm">{t('request.locationWhy')}</p>
          <p className="text-sm text-soft">{t('settings.locationExplain')}</p>
          <Button
            block
            onClick={() => {
              setLocationConsent(true);
              setConsentOpen(false);
              turnOn();
            }}
          >
            {t('home.locationAllow')}
          </Button>
          <Button
            variant="secondary"
            block
            onClick={() => {
              setConsentOpen(false);
              turnOn();
            }}
          >
            {t('home.locationDeny')}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
