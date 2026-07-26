/** Admin system sections: categories, feature flags, appeals, audit log, stats, emergency shutdown. */
import { useState } from 'react';
import {
  useAdminAudit,
  useAdminCategories,
  useAdminFlags,
  useAdminPatchCategory,
  useAdminPatchFlag,
  useAdminAppeals,
  useAdminResolveAppeal,
  useAdminStats,
  useEmergencyShutdown,
} from '../../api/hooks';
import { useLocale } from '../../i18n/LocaleContext';
import { categoryName, formatDateTime } from '../../lib/format';
import { Badge, Banner, Button, Card, EmptyState, Input, SkeletonCard, Textarea, Toggle } from '../../ui/components';
import { Dialog } from '../../ui/Dialog';
import { Icon } from '../../ui/icons';
import { useToast } from '../../ui/Toast';

function CategoriesSection() {
  const { t, locale } = useLocale();
  const categories = useAdminCategories();
  const patch = useAdminPatchCategory();

  if (categories.isLoading) return <SkeletonCard lines={4} />;
  const items = categories.data ?? [];
  if (items.length === 0) return <EmptyState title={t('admin.empty')} />;

  return (
    <div className="table-wrap">
      <table className="data">
        <thead>
          <tr>
            <th scope="col">{t('inventory.category')}</th>
            <th scope="col">{t('admin.active')}</th>
            <th scope="col">{t('admin.restricted')}</th>
            <th scope="col">{t('admin.maxReq')}</th>
            <th scope="col">{t('admin.maxOffer')}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((cat) => (
            <tr key={cat.id}>
              <td>
                <Icon name={cat.icon} size={16} /> {categoryName(cat, locale)}
              </td>
              <td>
                <Toggle
                  checked={cat.active}
                  onChange={(v) => patch.mutate({ id: cat.id, active: v })}
                  label={`${categoryName(cat, locale)} — ${t('admin.active')}`}
                  disabled={patch.isPending}
                />
              </td>
              <td>
                <Toggle
                  checked={cat.restricted}
                  onChange={(v) => patch.mutate({ id: cat.id, restricted: v })}
                  label={`${categoryName(cat, locale)} — ${t('admin.restricted')}`}
                  disabled={patch.isPending}
                />
              </td>
              <td>
                <input
                  className="input"
                  style={{ width: 90 }}
                  type="number"
                  min={1}
                  defaultValue={cat.maxRequestQty}
                  aria-label={`${categoryName(cat, locale)} — ${t('admin.maxReq')}`}
                  onBlur={(e) => {
                    const v = Number(e.target.value);
                    if (Number.isFinite(v) && v > 0 && v !== cat.maxRequestQty) patch.mutate({ id: cat.id, maxRequestQty: v });
                  }}
                />
              </td>
              <td>
                <input
                  className="input"
                  style={{ width: 90 }}
                  type="number"
                  min={1}
                  defaultValue={cat.maxOfferQty}
                  aria-label={`${categoryName(cat, locale)} — ${t('admin.maxOffer')}`}
                  onBlur={(e) => {
                    const v = Number(e.target.value);
                    if (Number.isFinite(v) && v > 0 && v !== cat.maxOfferQty) patch.mutate({ id: cat.id, maxOfferQty: v });
                  }}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FlagsSection() {
  const { t } = useLocale();
  const flags = useAdminFlags();
  const patch = useAdminPatchFlag();

  if (flags.isLoading) return <SkeletonCard lines={3} />;
  const items = flags.data ?? [];
  if (items.length === 0) return <EmptyState title={t('admin.empty')} />;

  return (
    <div className="stack-sm">
      {items.map((flag) => (
        <Card key={flag.key}>
          <div className="row">
            <div style={{ flex: 1 }}>
              <strong>{flag.key}</strong>
              <span className="text-xs text-soft" style={{ display: 'block' }}>
                {flag.description}
              </span>
            </div>
            <Toggle
              checked={flag.enabled}
              onChange={(v) => patch.mutate({ key: flag.key, enabled: v })}
              label={flag.key}
              disabled={patch.isPending}
            />
          </div>
        </Card>
      ))}
    </div>
  );
}

function AppealsSection() {
  const { t, locale } = useLocale();
  const { toast } = useToast();
  const appeals = useAdminAppeals();
  const resolve = useAdminResolveAppeal();
  const [resolving, setResolving] = useState<{ id: string; uphold: boolean } | null>(null);
  const [reason, setReason] = useState('');

  if (appeals.isLoading) return <SkeletonCard lines={3} />;
  const items = appeals.data ?? [];

  return (
    <div className="stack">
      {items.length === 0 ? (
        <EmptyState title={t('admin.empty')} />
      ) : (
        items.map((a) => (
          <Card key={a.id}>
            <div className="stack-sm">
              <div className="row">
                <strong style={{ flex: 1 }}>{a.userPseudonym ?? a.id}</strong>
                {a.status ? <Badge>{a.status}</Badge> : null}
                {a.createdAt ? <span className="text-xs text-soft">{formatDateTime(a.createdAt, locale)}</span> : null}
              </div>
              {a.body ? <p className="text-sm text-soft" style={{ margin: 0 }}>{a.body}</p> : null}
              <div className="row-wrap">
                <Button variant="secondary" onClick={() => setResolving({ id: a.id, uphold: true })}>
                  {t('admin.resolveAppeal')}
                </Button>
                <Button variant="ghost" onClick={() => setResolving({ id: a.id, uphold: false })}>
                  {t('admin.dismiss')}
                </Button>
              </div>
            </div>
          </Card>
        ))
      )}

      <Dialog open={!!resolving} onClose={() => setResolving(null)} title={t('admin.resolveAppeal')}>
        <div className="stack">
          <Textarea label={t('admin.reason')} value={reason} rows={3} onChange={(e) => setReason(e.target.value)} required />
          <Button
            block
            loading={resolve.isPending}
            disabled={reason.trim().length < 5}
            onClick={() =>
              resolving &&
              resolve.mutate(
                { id: resolving.id, reason: reason.trim(), uphold: resolving.uphold },
                {
                  onSuccess: () => {
                    toast(t('sync.submitted'));
                    setResolving(null);
                    setReason('');
                  },
                  onError: (e) => toast(e instanceof Error ? e.message : t('common.error'), 'error'),
                },
              )
            }
          >
            {t('common.confirm')}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}

function AuditSection() {
  const { t, locale } = useLocale();
  const audit = useAdminAudit();

  if (audit.isLoading) return <SkeletonCard lines={4} />;
  const items = audit.data ?? [];
  if (items.length === 0) return <EmptyState title={t('admin.empty')} />;

  return (
    <div className="table-wrap">
      <table className="data">
        <thead>
          <tr>
            <th scope="col">{t('admin.actionLabel')}</th>
            <th scope="col">{t('admin.reporter')}</th>
            <th scope="col">{t('admin.reason')}</th>
            <th scope="col">{t('eventPage.starts')}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((e) => (
            <tr key={e.id}>
              <td>{e.action ?? '—'}</td>
              <td>{e.actorPseudonym ?? '—'}</td>
              <td>{e.reason ?? '—'}</td>
              <td>{e.createdAt ? formatDateTime(e.createdAt, locale) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StatsSection({ isAdmin }: { isAdmin: boolean }) {
  const { t } = useLocale();
  const { toast } = useToast();
  const stats = useAdminStats();
  const shutdown = useEmergencyShutdown();
  const [shutdownOpen, setShutdownOpen] = useState(false);
  const [reason, setReason] = useState('');

  return (
    <div className="stack">
      <p className="text-sm text-soft">{t('admin.statsNote')}</p>
      {stats.isLoading ? (
        <SkeletonCard lines={4} />
      ) : (
        <div className="table-wrap">
          <table className="data">
            <tbody>
              {Object.entries(stats.data ?? {}).map(([key, value]) => (
                <tr key={key}>
                  <th scope="row">{key}</th>
                  <td>{typeof value === 'object' ? JSON.stringify(value) : String(value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {isAdmin ? (
        <Card>
          <div className="stack-sm">
            <Banner tone="danger" icon="warning">
              {t('admin.emergencyWarning')}
            </Banner>
            <Button variant="destructive" onClick={() => setShutdownOpen(true)}>
              {t('admin.emergency')}
            </Button>
          </div>
        </Card>
      ) : null}

      <Dialog open={shutdownOpen} onClose={() => setShutdownOpen(false)} title={t('admin.emergency')}>
        <div className="stack">
          <Banner tone="danger" icon="warning">
            {t('admin.emergencyWarning')}
          </Banner>
          <Input label={t('admin.reason')} value={reason} onChange={(e) => setReason(e.target.value)} required />
          <Button
            variant="destructive"
            block
            loading={shutdown.isPending}
            disabled={reason.trim().length < 5}
            onClick={() =>
              shutdown.mutate(
                { reason: reason.trim() },
                {
                  onSuccess: () => {
                    toast(t('sync.submitted'));
                    setShutdownOpen(false);
                    setReason('');
                  },
                  onError: (e) => toast(e instanceof Error ? e.message : t('common.error'), 'error'),
                },
              )
            }
          >
            {t('common.confirm')}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}

export function AdminSystemSection({ section, isAdmin }: { section: string; isAdmin: boolean }) {
  const { t } = useLocale();
  if (!isAdmin && section !== 'stats') {
    return (
      <EmptyState title={t('errors.forbidden')} />
    );
  }
  if (section === 'categories') return <CategoriesSection />;
  if (section === 'flags') return <FlagsSection />;
  if (section === 'appeals') return <AppealsSection />;
  if (section === 'audit') return <AuditSection />;
  if (section === 'stats') return <StatsSection isAdmin={isAdmin} />;
  return null;
}
