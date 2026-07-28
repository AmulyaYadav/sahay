/**
 * Admin console: reports queue, users, events, categories, feature flags, appeals,
 * audit log, stats. Client-side gated by role; the server enforces 403s regardless.
 */
import { REPORT_STATUSES } from '@sahay/shared';
import { useState } from 'react';
import { NavLink, useParams } from 'react-router-dom';
import { useAdminEvents, useAdminNotice, useAdminReports, useAdminUsers, useMe } from '../../api/hooks';
import { useLocale } from '../../i18n/LocaleContext';
import { formatDateTime } from '../../lib/format';
import { Badge, Banner, Button, Card, EmptyState, Input, SkeletonCard, Toggle } from '../../ui/components';
import { Dialog } from '../../ui/Dialog';
import { useToast } from '../../ui/Toast';
import { AdminSystemSection } from './AdminSystem';
import { ModerateDialog, type ModerateTarget } from './ModerateDialog';

const SECTIONS = ['reports', 'users', 'events', 'categories', 'flags', 'appeals', 'audit', 'stats'] as const;
type Section = (typeof SECTIONS)[number];

function ReportsSection() {
  const { t, locale } = useLocale();
  const [status, setStatus] = useState<string>('open');
  const reports = useAdminReports(status);
  const [target, setTarget] = useState<ModerateTarget | null>(null);
  const [evidenceOf, setEvidenceOf] = useState<string | null>(null);

  const evidence = reports.data?.items.find((r) => r.id === evidenceOf);

  return (
    <div className="stack">
      <div className="row-wrap" role="radiogroup" aria-label={t('admin.reports')}>
        {REPORT_STATUSES.map((s) => (
          <button key={s} type="button" role="radio" aria-checked={status === s} className="chip" onClick={() => setStatus(s)}>
            {s}
          </button>
        ))}
      </div>
      {reports.isLoading ? (
        <SkeletonCard lines={3} />
      ) : (reports.data?.items.length ?? 0) === 0 ? (
        <EmptyState title={t('admin.empty')} />
      ) : (
        reports.data?.items.map((r) => (
          <Card key={r.id}>
            <div className="stack-sm">
              <div className="row">
                <Badge tone="warn">{t(`reports.${r.category}`)}</Badge>
                <Badge>{r.status}</Badge>
                <span className="spacer" />
                <span className="text-xs text-soft">{formatDateTime(r.createdAt, locale)}</span>
              </div>
              <p className="text-sm" style={{ margin: 0 }}>
                {t('admin.reporter')}: {r.reporterPseudonym}
                {r.subjectPseudonym ? ` · ${t('admin.subject')}: ${r.subjectPseudonym}` : ''}
                {r.eventTitle ? ` · ${t('admin.event')}: ${r.eventTitle}` : ''}
              </p>
              {r.note ? <p className="text-sm text-soft" style={{ margin: 0 }}>“{r.note}”</p> : null}
              <div className="row-wrap">
                <Button variant="secondary" onClick={() => setEvidenceOf(r.id)}>
                  {t('admin.evidence')}
                </Button>
                <Button
                  onClick={() => setTarget({ action: 'report_resolve', reportId: r.id, label: t('admin.resolve') })}
                >
                  {t('admin.resolve')}
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => setTarget({ action: 'report_dismiss', reportId: r.id, label: t('admin.dismiss') })}
                >
                  {t('admin.dismiss')}
                </Button>
                {r.subjectUserId ? (
                  <>
                    <Button
                      variant="secondary"
                      onClick={() => setTarget({ action: 'warn', targetUserId: r.subjectUserId ?? undefined, label: t('admin.warn') })}
                    >
                      {t('admin.warn')}
                    </Button>
                    <Button
                      variant="destructive"
                      onClick={() =>
                        setTarget({
                          action: 'suspend',
                          targetUserId: r.subjectUserId ?? undefined,
                          label: t('admin.suspend'),
                          withDuration: true,
                        })
                      }
                    >
                      {t('admin.suspend')}
                    </Button>
                  </>
                ) : null}
              </div>
            </div>
          </Card>
        ))
      )}

      <Dialog open={!!evidenceOf} onClose={() => setEvidenceOf(null)} title={t('admin.evidence')}>
        {evidence?.conversationExcerpt && evidence.conversationExcerpt.length > 0 ? (
          <div className="chat-list">
            {evidence.conversationExcerpt.map((m, i) => (
              <div key={i} className="msg msg-theirs">
                <strong className="text-xs">{m.senderAlias}</strong>
                <div>{m.body}</div>
                <span className="msg-meta">{formatDateTime(m.createdAt, locale)}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-soft">{t('admin.noEvidence')}</p>
        )}
      </Dialog>

      <ModerateDialog target={target} onClose={() => setTarget(null)} />
    </div>
  );
}

function UsersSection() {
  const { t, locale } = useLocale();
  const [q, setQ] = useState('');
  const [submitted, setSubmitted] = useState('');
  const users = useAdminUsers(submitted);
  const [target, setTarget] = useState<ModerateTarget | null>(null);

  return (
    <div className="stack">
      <form
        className="row"
        style={{ alignItems: 'flex-end' }}
        onSubmit={(e) => {
          e.preventDefault();
          setSubmitted(q.trim());
        }}
      >
        <div style={{ flex: 1 }}>
          <Input label={t('admin.searchUsers')} type="search" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Button type="submit" variant="secondary">
          {t('common.search')}
        </Button>
      </form>

      {users.isLoading ? (
        <SkeletonCard lines={2} />
      ) : (users.data?.items.length ?? 0) === 0 ? (
        <EmptyState title={t('admin.empty')} />
      ) : (
        users.data?.items.map((u) => (
          <Card key={u.id}>
            <div className="stack-sm">
              <div className="row">
                <strong style={{ flex: 1 }}>{u.pseudonym}</strong>
                <Badge tone={u.status === 'active' ? 'ok' : u.status === 'suspended' ? 'danger' : 'warn'}>{u.status}</Badge>
                <Badge>{u.role}</Badge>
              </div>
              <p className="text-xs text-soft" style={{ margin: 0 }}>
                {formatDateTime(u.createdAt, locale)} · {t('admin.reportCount', { count: u.reportCount })}
                {u.emailVerified ? ` · ${t('reliability.emailVerified')}` : ''}
              </p>
              {u.riskFlags.length > 0 ? (
                <p className="text-xs" style={{ margin: 0 }}>
                  {t('admin.riskFlags')}: {u.riskFlags.join(', ')}
                </p>
              ) : null}
              <div className="row-wrap">
                <Button variant="secondary" onClick={() => setTarget({ action: 'warn', targetUserId: u.id, label: t('admin.warn') })}>
                  {t('admin.warn')}
                </Button>
                <Button
                  variant="secondary"
                  onClick={() =>
                    setTarget({ action: 'restrict_requests', targetUserId: u.id, label: t('admin.restrictRequests'), withDuration: true })
                  }
                >
                  {t('admin.restrictRequests')}
                </Button>
                <Button
                  variant="secondary"
                  onClick={() =>
                    setTarget({ action: 'restrict_helping', targetUserId: u.id, label: t('admin.restrictHelping'), withDuration: true })
                  }
                >
                  {t('admin.restrictHelping')}
                </Button>
                {u.status !== 'suspended' ? (
                  <Button
                    variant="destructive"
                    onClick={() => setTarget({ action: 'suspend', targetUserId: u.id, label: t('admin.suspend'), withDuration: true })}
                  >
                    {t('admin.suspend')}
                  </Button>
                ) : (
                  <Button onClick={() => setTarget({ action: 'unsuspend', targetUserId: u.id, label: t('admin.unsuspend') })}>
                    {t('admin.unsuspend')}
                  </Button>
                )}
              </div>
            </div>
          </Card>
        ))
      )}
      <ModerateDialog target={target} onClose={() => setTarget(null)} />
    </div>
  );
}

function EventsSection() {
  const { t, locale } = useLocale();
  const { toast } = useToast();
  const [pendingOnly, setPendingOnly] = useState(true);
  const events = useAdminEvents(pendingOnly ? { pendingApproval: true } : {});
  const [target, setTarget] = useState<ModerateTarget | null>(null);
  const [noticeFor, setNoticeFor] = useState<string | null>(null);
  const [noticeBody, setNoticeBody] = useState('');
  const [noticeUrgent, setNoticeUrgent] = useState(false);
  const notice = useAdminNotice();

  return (
    <div className="stack">
      <div className="row">
        <span className="field-label" style={{ flex: 1 }}>
          {t('admin.pendingApproval')}
        </span>
        <Toggle checked={pendingOnly} onChange={setPendingOnly} label={t('admin.pendingApproval')} />
      </div>

      {events.isLoading ? (
        <SkeletonCard lines={2} />
      ) : (events.data?.items.length ?? 0) === 0 ? (
        <EmptyState title={t('admin.empty')} />
      ) : (
        events.data?.items.map((ev) => {
          // The server sends publicApproved; "pending" = a public listing not yet approved.
          const pendingApproval = ev.visibility === 'public' && ev.publicApproved === false;
          return (
          <Card key={ev.id}>
            <div className="stack-sm">
              <div className="row">
                <strong style={{ flex: 1 }}>{ev.title}</strong>
                <Badge>{ev.status}</Badge>
                <Badge>{ev.visibility}</Badge>
                {ev.matchingPaused ? <Badge tone="warn">{t('admin.pause')}</Badge> : null}
              </div>
              <p className="text-xs text-soft" style={{ margin: 0 }}>
                {ev.code} · {ev.areaLabel} · {formatDateTime(ev.startsAt, locale)}
              </p>
              <div className="row-wrap">
                {pendingApproval ? (
                  <>
                    <Button onClick={() => setTarget({ action: 'event_approve_public', targetEventId: ev.id, label: t('admin.approve') })}>
                      {t('admin.approve')}
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() => setTarget({ action: 'event_reject_public', targetEventId: ev.id, label: t('admin.reject') })}
                    >
                      {t('admin.reject')}
                    </Button>
                  </>
                ) : null}
                {ev.matchingPaused ? (
                  <Button onClick={() => setTarget({ action: 'event_unpause', targetEventId: ev.id, label: t('admin.unpause') })}>
                    {t('admin.unpause')}
                  </Button>
                ) : (
                  <Button
                    variant="secondary"
                    onClick={() => setTarget({ action: 'event_pause', targetEventId: ev.id, label: t('admin.pause') })}
                  >
                    {t('admin.pause')}
                  </Button>
                )}
                <Button variant="secondary" onClick={() => setNoticeFor(ev.id)}>
                  {t('admin.publishNotice')}
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => setTarget({ action: 'event_disable', targetEventId: ev.id, label: t('admin.emergency') })}
                >
                  {t('admin.emergency')}
                </Button>
              </div>
            </div>
          </Card>
          );
        })
      )}

      <Dialog open={!!noticeFor} onClose={() => setNoticeFor(null)} title={t('admin.publishNotice')}>
        <div className="stack">
          <Input label={t('admin.noticeText')} value={noticeBody} onChange={(e) => setNoticeBody(e.target.value)} required />
          <div className="row">
            <span className="field-label" style={{ flex: 1 }}>
              {t('admin.urgent')}
            </span>
            <Toggle checked={noticeUrgent} onChange={setNoticeUrgent} label={t('admin.urgent')} />
          </div>
          <Button
            block
            loading={notice.isPending}
            disabled={!noticeBody.trim()}
            onClick={() =>
              noticeFor &&
              notice.mutate(
                { eventId: noticeFor, body: noticeBody.trim(), urgent: noticeUrgent },
                {
                  onSuccess: () => {
                    toast(t('sync.submitted'));
                    setNoticeFor(null);
                    setNoticeBody('');
                  },
                  onError: (e) => toast(e instanceof Error ? e.message : t('common.error'), 'error'),
                },
              )
            }
          >
            {t('admin.publishNotice')}
          </Button>
        </div>
      </Dialog>

      <ModerateDialog target={target} onClose={() => setTarget(null)} />
    </div>
  );
}

export function AdminPage() {
  const { t } = useLocale();
  const { section: sectionParam } = useParams<{ section: string }>();
  const me = useMe();
  const isAdmin = me.data?.role === 'admin';
  const section: Section = (SECTIONS as readonly string[]).includes(sectionParam ?? '')
    ? (sectionParam as Section)
    : 'reports';

  const visibleSections = SECTIONS.filter((s) =>
    isAdmin ? true : !['categories', 'flags', 'appeals', 'audit'].includes(s),
  );

  return (
    <div className="stack">
      <h1>{t('admin.title')}</h1>
      <Banner tone="warn" icon="warning">
        {t('admin.reauthNote')}
      </Banner>
      <div className="admin-layout">
        <nav className="admin-nav" aria-label={t('admin.title')}>
          {visibleSections.map((s) => (
            <NavLink key={s} to={`/admin/${s}`} end>
              {t(`admin.${s}`)}
            </NavLink>
          ))}
        </nav>
        <div>
          {section === 'reports' ? <ReportsSection /> : null}
          {section === 'users' ? <UsersSection /> : null}
          {section === 'events' ? <EventsSection /> : null}
          {['categories', 'flags', 'appeals', 'audit', 'stats'].includes(section) ? (
            <AdminSystemSection section={section} isAdmin={isAdmin} />
          ) : null}
        </div>
      </div>
    </div>
  );
}
