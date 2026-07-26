/** Profile: my pseudonym/avatar, an honest reliability explanation, private request history, appeals placeholder. */
import { useMe, useMyRequests } from '../api/hooks';
import { Avatar } from '../components/Avatar';
import { RequestStatusCard } from '../components/RequestStatusCard';
import { useLocale } from '../i18n/LocaleContext';
import { formatDateTime, formatMonth } from '../lib/format';
import { Badge, Card, EmptyState, SkeletonCard } from '../ui/components';

export function ProfilePage() {
  const { t, locale } = useLocale();
  const me = useMe();
  const requests = useMyRequests();

  if (me.isLoading) return <SkeletonCard lines={4} />;

  return (
    <div className="stack" style={{ maxWidth: 640, margin: '0 auto' }}>
      <h1>{t('profilePage.title')}</h1>

      <Card>
        <div className="row">
          <Avatar seed={me.data?.avatarSeed ?? ''} name={me.data?.pseudonym} size={56} />
          <div style={{ flex: 1 }}>
            <strong style={{ fontSize: 'var(--fs-lg)' }}>{me.data?.pseudonym}</strong>
            <span className="text-xs text-soft" style={{ display: 'block' }}>
              {me.data
                ? t('reliability.memberSince', { month: formatMonth(me.data.createdAt, locale) })
                : ''}
            </span>
          </div>
          {me.data?.phoneVerified ? <Badge tone="ok">{t('reliability.phoneVerified')}</Badge> : null}
        </div>
      </Card>

      <Card>
        <h2 style={{ fontSize: 'var(--fs-lg)' }}>{t('profilePage.reliabilityTitle')}</h2>
        <h3 style={{ fontSize: 'var(--fs-sm)' }}>{t('profilePage.howTitle')}</h3>
        <p className="text-sm text-soft" style={{ marginBottom: 0 }}>
          {t('profilePage.howBody')}
        </p>
      </Card>

      <section aria-label={t('profilePage.historyTitle')} className="stack-sm">
        <h2 style={{ margin: 0, fontSize: 'var(--fs-lg)' }}>{t('profilePage.historyTitle')}</h2>
        {requests.isLoading ? (
          <SkeletonCard lines={2} />
        ) : (requests.data?.items.length ?? 0) === 0 ? (
          <EmptyState title={t('profilePage.historyEmpty')} />
        ) : (
          requests.data?.items.map((r) => (
            <div key={r.id} className="stack-sm">
              <RequestStatusCard request={r} />
              <span className="text-xs text-soft">{formatDateTime(r.createdAt, locale)}</span>
            </div>
          ))
        )}
      </section>

      <Card>
        <h2 style={{ fontSize: 'var(--fs-lg)' }}>{t('profilePage.appealsTitle')}</h2>
        <p className="text-sm text-soft" style={{ marginBottom: 0 }}>
          {t('profilePage.appealsNone')}
        </p>
      </Card>
    </div>
  );
}
