/**
 * Admin console: event creation/editing/moderation, and per-event wants
 * management. Trimmed to exactly this scope by design (see ADR-0012) — the
 * server still exposes reports/users/categories/flags/appeals/audit/stats
 * endpoints, but this web app no longer surfaces UI for them.
 * Client-side gated by role; the server enforces 403s regardless.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { AdminCreated } from '@sahay/shared';
import { ApiClientError } from '../../api/client';
import { useAdminEvents, useAdminNotice, useAdminSetWants, useCatalogue, useCreateAdmin, useMe } from '../../api/hooks';
import { useLocale } from '../../i18n/LocaleContext';
import { formatDateTime } from '../../lib/format';
import { Badge, Banner, Button, Card, EmptyState, Input, Select, SkeletonCard, Toggle } from '../../ui/components';
import { Dialog } from '../../ui/Dialog';
import { useToast } from '../../ui/Toast';
import { ModerateDialog, type ModerateTarget } from './ModerateDialog';

function EventsSection({ isAdmin }: { isAdmin: boolean }) {
  const { t, locale } = useLocale();
  const { toast } = useToast();
  const [pendingOnly, setPendingOnly] = useState(false);
  const events = useAdminEvents(pendingOnly ? { pendingApproval: true } : {});
  const [target, setTarget] = useState<ModerateTarget | null>(null);
  const [noticeFor, setNoticeFor] = useState<string | null>(null);
  const [noticeBody, setNoticeBody] = useState('');
  const [noticeUrgent, setNoticeUrgent] = useState(false);
  const notice = useAdminNotice();
  const [wantsFor, setWantsFor] = useState<{ id: string; current: string[] } | null>(null);

  return (
    <div className="stack">
      <Link to="/admin/events/new" className="btn btn-primary">
        {t('admin.createEvent')}
      </Link>

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
                {isAdmin ? (
                  <Button
                    variant="secondary"
                    onClick={() => setWantsFor({ id: ev.id, current: ev.adminWantSlugs ?? [] })}
                  >
                    {t('admin.manageWants')}
                  </Button>
                ) : null}
                <Button
                  variant="destructive"
                  onClick={() =>
                    setTarget({
                      action: 'event_disable',
                      targetEventId: ev.id,
                      label: t('admin.deleteEvent'),
                      warning: t('admin.deleteEventConfirm'),
                    })
                  }
                >
                  {t('admin.deleteEvent')}
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

      <WantsDialog target={wantsFor} onClose={() => setWantsFor(null)} />
      <ModerateDialog target={target} onClose={() => setTarget(null)} />
    </div>
  );
}

function WantsDialog({
  target,
  onClose,
}: {
  target: { id: string; current: string[] } | null;
  onClose: () => void;
}) {
  const { t } = useLocale();
  if (!target) return null;
  // Keyed by event id so state (selection) resets fresh every time the dialog
  // is opened — including reopening after a cancel-without-save.
  return <WantsDialogInner key={target.id} target={target} onClose={onClose} title={t('admin.manageWants')} />;
}

function WantsDialogInner({
  target,
  onClose,
  title,
}: {
  target: { id: string; current: string[] };
  onClose: () => void;
  title: string;
}) {
  const { t, locale } = useLocale();
  const { toast } = useToast();
  const catalogue = useCatalogue();
  const setWants = useAdminSetWants(target.id);
  const [selected, setSelected] = useState<string[]>(target.current);

  const toggle = (slug: string) => {
    setSelected((prev) => (prev.includes(slug) ? prev.filter((s) => s !== slug) : [...prev, slug]));
  };

  return (
    <Dialog open onClose={onClose} title={title}>
      <div className="stack">
        <p className="text-sm text-soft">{t('admin.wantsHint')}</p>
        {catalogue.isLoading ? (
          <SkeletonCard lines={2} />
        ) : catalogue.isError ? (
          <Banner tone="danger" icon="warning">
            {t('common.error')}
          </Banner>
        ) : (
          <div className="row-wrap">
            {(catalogue.data?.categories ?? []).map((c) => (
              <button
                key={c.slug}
                type="button"
                role="checkbox"
                aria-checked={selected.includes(c.slug)}
                className="chip"
                onClick={() => toggle(c.slug)}
              >
                {c.name[locale] ?? c.name.en ?? c.slug}
              </button>
            ))}
          </div>
        )}
        <Button
          block
          loading={setWants.isPending}
          onClick={() =>
            setWants.mutate(selected, {
              onSuccess: () => {
                toast(t('sync.submitted'));
                onClose();
              },
              onError: () => toast(t('common.error'), 'error'),
            })
          }
        >
          {t('common.ok')}
        </Button>
      </div>
    </Dialog>
  );
}

/**
 * Creates staff accounts. The generated password is displayed once, here, and
 * never again — it exists only in this response, so it has to be copied out
 * before the panel is dismissed.
 */
function StaffSection() {
  const { t } = useLocale();
  const { toast } = useToast();
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'moderator' | 'admin'>('moderator');
  const [issued, setIssued] = useState<AdminCreated | null>(null);
  const create = useCreateAdmin();

  const canSubmit = username.trim().length >= 3 && email.trim() !== '';

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    create.mutate(
      { username: username.trim().toLowerCase(), email: email.trim(), role },
      {
        onSuccess: (created) => {
          setIssued(created);
          setUsername('');
          setEmail('');
        },
        onError: (err) => {
          const conflict = err instanceof ApiClientError && err.code === 'request_conflict';
          toast(conflict ? t('admin.staffTaken') : t('common.error'), 'error');
        },
      },
    );
  };

  return (
    <Card className="card-lg">
      <h2 style={{ marginTop: 0, fontSize: 'var(--fs-h3)' }}>{t('admin.staffTitle')}</h2>
      <p className="text-sm text-soft">{t('admin.staffBody')}</p>

      {issued ? (
        <div className="stack">
          <Banner tone="warn" icon="warning" role="alert">
            {t('admin.staffPasswordOnce')}
          </Banner>
          <Card>
            <div className="stack-sm">
              <span className="field-label">{t('auth.usernameLabel')}</span>
              <strong style={{ fontSize: 'var(--fs-h3)' }}>{issued.username}</strong>
              <span className="field-label">{t('auth.passwordLabel')}</span>
              <strong style={{ fontSize: 'var(--fs-h3)', letterSpacing: '0.04em', fontFamily: 'monospace' }}>
                {issued.password}
              </strong>
            </div>
          </Card>
          <div className="row-wrap">
            <Button
              variant="secondary"
              onClick={() => {
                void navigator.clipboard
                  .writeText(`Username: ${issued.username}\nPassword: ${issued.password}`)
                  .then(() => toast(t('createEvent.copied')))
                  .catch(() => toast(t('common.error'), 'error'));
              }}
            >
              {t('admin.staffCopy')}
            </Button>
            <Button variant="ghost" onClick={() => setIssued(null)}>
              {t('common.done')}
            </Button>
          </div>
        </div>
      ) : (
        <form className="stack" onSubmit={submit}>
          <Input
            label={t('auth.usernameLabel')}
            hint={t('admin.staffUsernameHint')}
            autoCapitalize="none"
            spellCheck={false}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />
          <Input
            label={t('auth.emailLabel')}
            type="email"
            hint={t('admin.staffEmailHint')}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <Select label={t('admin.staffRole')} value={role} onChange={(e) => setRole(e.target.value as 'moderator' | 'admin')}>
            <option value="moderator">{t('admin.staffRoleModerator')}</option>
            <option value="admin">{t('admin.staffRoleAdmin')}</option>
          </Select>
          <Button type="submit" loading={create.isPending} disabled={!canSubmit}>
            {t('admin.staffCreate')}
          </Button>
        </form>
      )}
    </Card>
  );
}

export function AdminPage() {
  const { t } = useLocale();
  const me = useMe();
  const isAdmin = me.data?.role === 'admin';

  // The console is scoped to event CRUD + wants, plus staff accounts for
  // admins, so there's no tab navigation to render — a single-item nav bar
  // would just be clutter.
  return (
    <div className="stack">
      <h1>{t('admin.title')}</h1>
      <Banner tone="warn" icon="warning">
        {t('admin.reauthNote')}
      </Banner>
      <EventsSection isAdmin={isAdmin} />
      {isAdmin ? <StaffSection /> : null}
    </div>
  );
}
