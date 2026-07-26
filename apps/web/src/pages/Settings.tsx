/**
 * Settings: language, notification prefs, privacy (location + consents), blocked users,
 * devices/sessions, data export (request → poll → download), delete account, pseudonym
 * regeneration, safety guidance, legal links, help.
 */
import { NOTIFICATION_TYPES } from '@sahay/shared';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { clearToken } from '../api/client';
import {
  useBlocks,
  useConsents,
  useDeleteAccount,
  useExportStatus,
  useLogout,
  useMe,
  useNotificationPrefs,
  useRevokeSession,
  useSessions,
  useStartExport,
  useUpdateMe,
  useUpdateNotificationPrefs,
} from '../api/hooks';
import { useLocale } from '../i18n/LocaleContext';
import { formatDateTime } from '../lib/format';
import { usePush } from '../lib/usePush';
import { Banner, Button, Card, Input, Toggle } from '../ui/components';
import { Dialog } from '../ui/Dialog';
import { Icon } from '../ui/icons';
import { useToast } from '../ui/Toast';

export function SettingsPage() {
  const { t, locale, setLocale } = useLocale();
  const navigate = useNavigate();
  const { toast } = useToast();
  const me = useMe();
  const updateMe = useUpdateMe();
  const prefs = useNotificationPrefs();
  const updatePrefs = useUpdateNotificationPrefs();
  const blocks = useBlocks();
  const sessions = useSessions();
  const revoke = useRevokeSession();
  const consents = useConsents();
  const startExport = useStartExport();
  const exportStatus = useExportStatus();
  const deleteAccount = useDeleteAccount();
  const logout = useLogout();
  const push = usePush();

  const exportData = exportStatus.data;

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [confirmName, setConfirmName] = useState('');
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const detailed = prefs.data?.detailedPreviews ?? false;
  const perType = prefs.data?.perType ?? {};

  const setPref = (patch: Partial<{ detailedPreviews: boolean; perType: Record<string, boolean> }>) => {
    updatePrefs.mutate({
      detailedPreviews: patch.detailedPreviews ?? detailed,
      perType: (patch.perType ?? perType) as Record<(typeof NOTIFICATION_TYPES)[number], boolean>,
    });
  };

  return (
    <div className="stack" style={{ maxWidth: 640, margin: '0 auto' }}>
      <h1>{t('settings.title')}</h1>

      {/* Language */}
      <Card>
        <h2 style={{ fontSize: 'var(--fs-lg)' }}>{t('settings.language')}</h2>
        <div className="row-wrap" role="radiogroup" aria-label={t('settings.language')}>
          <button type="button" role="radio" aria-checked={locale === 'en'} className="chip" onClick={() => setLocale('en')} lang="en">
            English
          </button>
          <button type="button" role="radio" aria-checked={locale === 'hi'} className="chip" onClick={() => setLocale('hi')} lang="hi">
            हिन्दी
          </button>
        </div>
      </Card>

      {/* Pseudonym */}
      <Card>
        <div className="row">
          <div style={{ flex: 1 }}>
            <h2 style={{ fontSize: 'var(--fs-lg)' }}>{me.data?.pseudonym ?? '…'}</h2>
            <p className="text-xs text-soft" style={{ margin: 0 }}>
              {t('settings.pseudonymNote')}
            </p>
          </div>
          <Button
            variant="secondary"
            loading={updateMe.isPending}
            onClick={() =>
              updateMe.mutate(
                { regeneratePseudonym: true },
                { onError: (e) => toast(e instanceof Error ? e.message : t('common.error'), 'error') },
              )
            }
          >
            {t('settings.newPseudonym')}
          </Button>
        </div>
      </Card>

      {/* Notifications */}
      <Card>
        <h2 style={{ fontSize: 'var(--fs-lg)' }}>{t('settings.notificationPrefs')}</h2>
        {push.supported ? (
          <div className="row" style={{ marginBottom: 'var(--sp-2)' }}>
            <div style={{ flex: 1 }}>
              <span className="field-label">{t('notifications.pushToggle')}</span>
              {!push.configured ? (
                <p className="text-xs text-soft" style={{ margin: 0 }}>
                  {t('notifications.pushNotConfigured')}
                </p>
              ) : null}
            </div>
            <Toggle
              checked={push.subscribed}
              onChange={(v) => {
                if (v) {
                  void push.enable().then((result) => {
                    if (result === 'ok') toast(t('notifications.pushEnabled'));
                    else if (result === 'denied') toast(t('notifications.pushDenied'), 'error');
                    else toast(t('notifications.pushError'), 'error');
                  });
                } else {
                  void push.disable().then(() => toast(t('notifications.pushDisabled')));
                }
              }}
              label={t('notifications.pushToggle')}
              disabled={!push.configured || push.busy}
            />
          </div>
        ) : null}
        <div className="row" style={{ marginBottom: 'var(--sp-2)' }}>
          <div style={{ flex: 1 }}>
            <span className="field-label">{t('notifications.detailedPreviews')}</span>
            <p className="text-xs text-soft" style={{ margin: 0 }}>
              {t('notifications.detailExplain')}
            </p>
          </div>
          <Toggle
            checked={detailed}
            onChange={(v) => setPref({ detailedPreviews: v })}
            label={t('notifications.detailedPreviews')}
            disabled={prefs.isLoading || updatePrefs.isPending}
          />
        </div>
        <ul className="plain">
          {NOTIFICATION_TYPES.map((nt) => (
            <li key={nt} className="row" style={{ minHeight: 'var(--touch)', borderTop: '1px solid var(--c-border)' }}>
              <span style={{ flex: 1 }} className="text-sm">
                {t(`notifications.${nt}`)}
              </span>
              <Toggle
                checked={perType[nt] ?? true}
                onChange={(v) => setPref({ perType: { ...perType, [nt]: v } })}
                label={t(`notifications.${nt}`)}
                disabled={prefs.isLoading || updatePrefs.isPending}
              />
            </li>
          ))}
        </ul>
      </Card>

      {/* Privacy */}
      <Card>
        <h2 style={{ fontSize: 'var(--fs-lg)' }}>{t('settings.privacy')}</h2>
        <p className="text-sm text-soft">{t('settings.locationExplain')}</p>
        <h3 style={{ fontSize: 'var(--fs-sm)' }}>{t('settings.consentsTitle')}</h3>
        {(consents.data?.items.length ?? 0) === 0 ? (
          <p className="text-xs text-soft">{t('settings.noConsents')}</p>
        ) : (
          <ul className="plain text-sm">
            {consents.data?.items.map((c, i) => (
              <li key={i} className="row" style={{ minHeight: 36 }}>
                <span style={{ flex: 1 }}>{c.kind}</span>
                <span className={c.granted ? 'badge badge-ok' : 'badge'}>
                  {c.granted ? t('common.ok') : t('common.cancel')}
                </span>
                <span className="text-xs text-soft">{formatDateTime(c.createdAt, locale)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* Blocked users */}
      <Card>
        <h2 style={{ fontSize: 'var(--fs-lg)' }}>{t('settings.blocked')}</h2>
        {(blocks.data?.blocks.length ?? 0) === 0 ? (
          <p className="text-sm text-soft">{t('settings.noBlocked')}</p>
        ) : (
          <ul className="plain text-sm">
            {blocks.data?.blocks.map((b, i) => (
              <li key={i} className="row" style={{ minHeight: 36 }}>
                <span style={{ flex: 1 }}>{b.alias}</span>
                <span className="text-xs text-soft">{formatDateTime(b.createdAt, locale)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* Sessions */}
      <Card>
        <h2 style={{ fontSize: 'var(--fs-lg)' }}>{t('settings.devices')}</h2>
        <ul className="plain">
          {(sessions.data ?? []).map((s) => (
            <li key={s.id} className="row" style={{ minHeight: 'var(--touch)' }}>
              <span style={{ flex: 1 }} className="text-sm">
                {s.deviceName ?? s.platform}
                {s.current ? <span className="badge badge-accent" style={{ marginLeft: 8 }}>{t('settings.thisDevice')}</span> : null}
                <span className="text-xs text-soft" style={{ display: 'block' }}>
                  {formatDateTime(s.lastSeenAt, locale)}
                </span>
              </span>
              {!s.current ? (
                <Button variant="secondary" loading={revoke.isPending} onClick={() => revoke.mutate(s.id)}>
                  {t('settings.revoke')}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      </Card>

      {/* Data export */}
      <Card>
        <h2 style={{ fontSize: 'var(--fs-lg)' }}>{t('settings.exportData')}</h2>
        {exportData?.status === 'pending' ? (
          <p className="text-sm" role="status">
            <span className="spinner" aria-hidden="true" /> {t('settings.exportPending')}
          </p>
        ) : exportData?.status === 'ready' && exportData.downloadUrl ? (
          <div className="stack-sm">
            <p className="text-sm" role="status">
              {t('settings.exportReady')}
            </p>
            <a className="btn btn-primary" href={exportData.downloadUrl} download="sahay-export.json">
              <Icon name="box" /> {t('settings.exportDownload')}
            </a>
          </div>
        ) : (
          <Button variant="secondary" loading={startExport.isPending} onClick={() => startExport.mutate()}>
            {t('settings.exportStart')}
          </Button>
        )}
      </Card>

      {/* Safety + legal + help */}
      <Card>
        <ul className="plain">
          <li>
            <Link to="/guidelines" className="row" style={{ minHeight: 'var(--touch)', textDecoration: 'none' }}>
              <Icon name="shield" />
              <span style={{ flex: 1 }}>{t('safety.guidance')}</span>
              <Icon name="chevronRight" />
            </Link>
          </li>
          <li>
            <Link to="/privacy" className="row" style={{ minHeight: 'var(--touch)', textDecoration: 'none' }}>
              <Icon name="eye" />
              <span style={{ flex: 1 }}>{t('settings.legal')}</span>
              <Icon name="chevronRight" />
            </Link>
          </li>
          <li>
            <Link to="/support" className="row" style={{ minHeight: 'var(--touch)', textDecoration: 'none' }}>
              <Icon name="info" />
              <span style={{ flex: 1 }}>{t('settings.help')}</span>
              <Icon name="chevronRight" />
            </Link>
          </li>
        </ul>
      </Card>

      {/* Logout + delete */}
      <div className="row-wrap">
        <Button
          variant="secondary"
          loading={logout.isPending}
          onClick={() =>
            logout.mutate(undefined, {
              onSettled: () => {
                clearToken();
                navigate('/');
              },
            })
          }
        >
          <Icon name="logout" size={16} /> {t('auth.logout')}
        </Button>
        <Button variant="destructive" onClick={() => setDeleteOpen(true)}>
          {t('settings.deleteAccount')}
        </Button>
      </div>

      <Dialog open={deleteOpen} onClose={() => setDeleteOpen(false)} title={t('settings.deleteAccount')}>
        <div className="stack">
          <Banner tone="danger" icon="warning">
            {t('settings.deleteWarning')}
          </Banner>
          <Input
            label={t('settings.deleteConfirm', { pseudonym: me.data?.pseudonym ?? '' })}
            value={confirmName}
            onChange={(e) => {
              setConfirmName(e.target.value);
              setDeleteError(null);
            }}
            error={deleteError}
          />
          <Button
            variant="destructive"
            block
            loading={deleteAccount.isPending}
            disabled={confirmName.trim() !== (me.data?.pseudonym ?? '__')}
            onClick={() => {
              if (confirmName.trim() !== me.data?.pseudonym) {
                setDeleteError(t('settings.deleteMismatch'));
                return;
              }
              deleteAccount.mutate(
                { confirmPseudonym: confirmName.trim() },
                {
                  onSuccess: () => {
                    clearToken();
                    // Full navigation, not SPA routing: it atomically drops all
                    // in-flight queries, whose 401s would otherwise race us to
                    // the /auth redirect.
                    window.location.assign('/');
                  },
                  onError: (e) => setDeleteError(e instanceof Error ? e.message : t('common.error')),
                },
              );
            }}
          >
            {t('settings.deleteAccount')}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
