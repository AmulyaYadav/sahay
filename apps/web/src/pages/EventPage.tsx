/** Event detail: notices, safety info, join/leave (invite code when required), and member tabs. */
import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ApiClientError, getToken } from '../api/client';
import { useEvent, useJoinEvent, useLeaveEvent } from '../api/hooks';
import { BringPanel } from '../components/BringPanel';
import { DashboardPanel } from '../components/DashboardPanel';
import { InventoryPanel, type AddPrefill } from '../components/InventoryPanel';
import { ReportDialog } from '../components/ReportDialog';
import { useLocale } from '../i18n/LocaleContext';
import { formatDateTime } from '../lib/format';
import { forgetJoinedEvent, rememberJoinedEvent } from '../lib/storage';
import { Badge, Banner, Button, Card, Input, SkeletonCard, Tabs } from '../ui/components';
import { Dialog } from '../ui/Dialog';
import { Icon } from '../ui/icons';
import { useToast } from '../ui/Toast';

type TabKey = 'overview' | 'bring' | 'supplies' | 'request';

export function EventPage() {
  const { idOrCode } = useParams<{ idOrCode: string }>();
  const { t, locale } = useLocale();
  const navigate = useNavigate();
  const { toast } = useToast();
  const eventQuery = useEvent(idOrCode);
  const event = eventQuery.data;

  const [search] = useSearchParams();
  const initialTab = search.get('tab');
  const [tab, setTab] = useState<TabKey>(
    initialTab === 'bring' || initialTab === 'supplies' || initialTab === 'request' ? initialTab : 'overview',
  );
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteCode, setInviteCode] = useState('');
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [prefill, setPrefill] = useState<AddPrefill | undefined>();

  const join = useJoinEvent(event?.id ?? '');
  const leave = useLeaveEvent(event?.id ?? '');

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
        <Link className="btn btn-secondary" to="/events">
          {t('events.discover')}
        </Link>
      </div>
    );
  }

  const isMember = !!event.membership;

  const doJoin = (code?: string) => {
    if (!getToken()) {
      navigate(`/auth?next=${encodeURIComponent(`/events/${event.code}`)}`);
      return;
    }
    join.mutate(
      { inviteCode: code },
      {
        onSuccess: (detail) => {
          rememberJoinedEvent({ id: detail.id, code: detail.code, title: detail.title });
          setInviteOpen(false);
          setInviteError(null);
          toast(t('events.joined'));
        },
        onError: (e) => {
          if (e instanceof ApiClientError && (e.status === 403 || e.status === 400)) {
            if (event.requiresInvite && !code) setInviteOpen(true);
            else setInviteError(e.message);
          } else {
            toast(e instanceof Error ? e.message : t('common.error'), 'error');
          }
        },
      },
    );
  };

  const openAdd = (categoryId: string, qty: number) => {
    setPrefill({ categoryId, qty });
    setTab('supplies');
    setAddOpen(true);
  };

  return (
    <div className="stack">
      <div className="stack-sm">
        <div className="row">
          <h1 style={{ margin: 0, flex: 1 }}>{event.title}</h1>
          {event.status === 'active' ? <Badge tone="ok">{t('events.active')}</Badge> : null}
          {event.status === 'paused' || event.matchingPaused ? <Badge tone="warn">{t('events.paused')}</Badge> : null}
          {event.status === 'scheduled' ? <Badge tone="accent">{t('events.scheduled')}</Badge> : null}
          {['completed', 'archived', 'disabled'].includes(event.status) ? <Badge>{t('events.ended')}</Badge> : null}
        </div>
        <div className="row-wrap text-sm text-soft">
          <span>
            <Icon name="calendar" size={16} /> {t(`eventTypes.${event.type}`)}
          </span>
          <span>
            <Icon name="location" size={16} /> {event.areaLabel}
          </span>
          <span>
            {t('eventPage.starts')}: {formatDateTime(event.startsAt, locale)}
          </span>
          <span>
            {t('eventPage.ends')}: {formatDateTime(event.endsAt, locale)}
          </span>
        </div>
        <div className="row-wrap">
          {!isMember ? (
            <Button loading={join.isPending} onClick={() => (event.requiresInvite ? setInviteOpen(true) : doJoin())}>
              {t('events.join')}
            </Button>
          ) : (
            <>
              <Badge tone="ok">{t('events.joined')}</Badge>
              <Button
                variant="ghost"
                loading={leave.isPending}
                onClick={() =>
                  leave.mutate(undefined, {
                    onSuccess: () => forgetJoinedEvent(event.id),
                  })
                }
              >
                {t('events.leave')}
              </Button>
            </>
          )}
          <Button variant="ghost" onClick={() => setReportOpen(true)}>
            <Icon name="flag" size={16} /> {t('events.reportEvent')}
          </Button>
        </div>
      </div>

      {event.notices.length > 0 ? (
        <section aria-label={t('home.notices')} className="stack-sm">
          {event.notices.map((n) => (
            <Banner key={n.id} tone="info" icon="info" role="status">
              {n.body}
            </Banner>
          ))}
        </section>
      ) : null}

      <Tabs<TabKey>
        tabs={[
          { key: 'overview', label: t('eventPage.overviewTab') },
          { key: 'bring', label: t('bring.title') },
          { key: 'supplies', label: t('inventory.title') },
          { key: 'request', label: t('eventPage.requestTab') },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === 'overview' ? (
        <div className="stack">
          <Card>
            <h2>{t('eventPage.aboutTitle')}</h2>
            <p className="text-soft" style={{ marginBottom: 0 }}>
              {event.description}
            </p>
            <p className="text-xs text-soft" style={{ marginTop: 'var(--sp-3)', marginBottom: 0 }}>
              {t('events.participantsHidden')}
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
            <h2>{t('events.needsTitle')}</h2>
            <DashboardPanel eventId={event.id} />
          </Card>
        </div>
      ) : null}

      {tab === 'bring' ? <BringPanel eventId={event.id} isMember={isMember} onAdd={openAdd} /> : null}

      {tab === 'supplies' ? (
        <InventoryPanel eventId={event.id} isMember={isMember} addOpen={addOpen} setAddOpen={setAddOpen} prefill={prefill} />
      ) : null}

      {tab === 'request' ? (
        isMember ? (
          <div className="stack">
            <p className="text-sm text-soft">{t('request.locationWhy')}</p>
            <Link to={`/events/${event.id}/request`} className="btn btn-primary btn-lg">
              {t('home.requestHelp')}
            </Link>
            <p className="text-xs text-soft">{t('safety.notEmergency')}</p>
          </div>
        ) : (
          <div className="empty-state">
            <p>{t('eventPage.memberOnly')}</p>
            <Button loading={join.isPending} onClick={() => (event.requiresInvite ? setInviteOpen(true) : doJoin())}>
              {t('events.join')}
            </Button>
          </div>
        )
      ) : null}

      <Dialog open={inviteOpen} onClose={() => setInviteOpen(false)} title={t('events.inviteCode')}>
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            doJoin(inviteCode.trim());
          }}
        >
          <Input
            label={t('events.inviteCode')}
            value={inviteCode}
            onChange={(e) => setInviteCode(e.target.value)}
            error={inviteError}
            autoCapitalize="characters"
            required
          />
          <Button type="submit" block loading={join.isPending}>
            {t('events.join')}
          </Button>
        </form>
      </Dialog>

      <ReportDialog open={reportOpen} onClose={() => setReportOpen(false)} eventId={event.id} />
    </div>
  );
}
