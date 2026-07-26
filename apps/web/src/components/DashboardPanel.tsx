/** Event dashboard: k-anonymized needs with shortage labels. The "approximate" disclaimer is always visible. */
import type { ShortageLevel } from '@sahay/shared';
import { useCatalogue, useEventDashboard } from '../api/hooks';
import { useLocale } from '../i18n/LocaleContext';
import { categoryName, formatTime, unitLabel } from '../lib/format';
import { Badge, Banner, EmptyState, Skeleton } from '../ui/components';
import { Icon } from '../ui/icons';

const LEVEL_TONE: Record<ShortageLevel, 'danger' | 'warn' | 'accent' | 'ok' | 'neutral'> = {
  critical_shortage: 'danger',
  high_need: 'warn',
  moderate_need: 'accent',
  adequate: 'ok',
  possible_surplus: 'neutral',
  unknown: 'neutral',
};

export function DashboardPanel({ eventId, limit }: { eventId: string; limit?: number }) {
  const { t, locale } = useLocale();
  const dashboard = useEventDashboard(eventId);
  const catalogue = useCatalogue();

  return (
    <div className="stack">
      <Banner tone="info" icon="info" role="status">
        {t('common.approximate')}
      </Banner>

      {dashboard.isLoading ? (
        <div className="stack-sm">
          <Skeleton height={40} />
          <Skeleton height={40} />
          <Skeleton height={40} />
        </div>
      ) : !dashboard.data || dashboard.data.needs.length === 0 ? (
        <EmptyState title={t('misc.emptyTitle')} body={t('eventPage.dashboardEmpty')} />
      ) : (
        <>
          <ul className="plain">
            {(limit ? dashboard.data.needs.slice(0, limit) : dashboard.data.needs).map((need) => {
              const cat = catalogue.data?.categories.find((c) => c.id === need.categoryId);
              return (
                <li key={need.categoryId} className="need-row">
                  <Icon name={cat?.icon ?? 'box'} />
                  <span style={{ flex: 1 }}>
                    <strong>{categoryName(cat, locale) || need.categorySlug}</strong>
                    <span className="text-xs text-soft" style={{ display: 'block' }}>
                      {need.requestedQty !== null
                        ? `${t('eventPage.needRequested')}: ${need.requestedQty} ${unitLabel(t, need.unit)}`
                        : t('eventPage.belowK')}
                      {need.offeredQty !== null ? ` · ${t('eventPage.needOffered')}: ${need.offeredQty}` : ''}
                      {need.reservedQty !== null ? ` · ${t('eventPage.needReserved')}: ${need.reservedQty}` : ''}
                    </span>
                  </span>
                  <Badge tone={LEVEL_TONE[need.level]}>{t(`shortage.${need.level}`)}</Badge>
                </li>
              );
            })}
          </ul>
          <p className="text-xs text-soft">
            {t('eventPage.recentFulfilments', { count: dashboard.data.recentFulfilments })} ·{' '}
            {t('eventPage.updated', { time: formatTime(dashboard.data.generatedAt, locale) })}
          </p>
        </>
      )}
    </div>
  );
}
