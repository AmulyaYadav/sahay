/** Live status card for a request: searching state, attempts, cancel/renew, partial-fulfilment choices. */
import type { RequestView } from '@sahay/shared';
import { Link } from 'react-router-dom';
import { useCancelRequest, useCatalogue, useContinueRequest, useRenewRequest } from '../api/hooks';
import { useLocale } from '../i18n/LocaleContext';
import { categoryName, minutesUntil, unitLabel } from '../lib/format';
import { Badge, Button, Card } from '../ui/components';
import { Icon } from '../ui/icons';

export function RequestStatusCard({ request }: { request: RequestView }) {
  const { t, locale } = useLocale();
  const catalogue = useCatalogue();
  const cancel = useCancelRequest();
  const renew = useRenewRequest();
  const cont = useContinueRequest();

  const cat = catalogue.data?.categories.find((c) => c.id === request.categoryId);
  const unit = unitLabel(t, request.unit);
  const remaining = Math.max(0, request.qty - request.qtyFulfilled);
  const searchingLike = request.status === 'searching' || request.status === 'offering';

  return (
    <Card>
      <div className="stack-sm">
        <div className="row">
          <Icon name={cat?.icon ?? 'box'} size={22} />
          <strong style={{ flex: 1 }}>
            {categoryName(cat, locale) || request.categorySlug} — {request.qty} {unit}
          </strong>
          <Badge tone={request.urgency === 'urgent' ? 'danger' : request.urgency === 'soon' ? 'warn' : 'neutral'}>
            {t(`request.${request.urgency === 'standard' ? 'std' : request.urgency}`)}
          </Badge>
        </div>

        <div aria-live="polite" className="stack-sm">
          {searchingLike ? (
            <>
              <div className="row text-sm">
                <span className="spinner" aria-hidden="true" />
                <span>{t('request.searching')}</span>
              </div>
              <span className="text-xs text-soft">
                {t('request.attempt', { count: request.attemptCount })} ·{' '}
                {t('misc.minutes', { count: minutesUntil(request.expiresAt) })}
              </span>
            </>
          ) : null}
          {request.status === 'matched' && request.activeMatchId ? (
            <Link className="btn btn-primary" to={`/matches/${request.activeMatchId}`}>
              {t('match.matched')} <Icon name="chevronRight" />
            </Link>
          ) : null}
          {request.status === 'no_match' ? <p className="text-sm">{t('request.noMatch')}</p> : null}
          {request.status === 'expired' ? <p className="text-sm">{t('request.expired')}</p> : null}
          {request.status === 'fulfilled' ? (
            <p className="text-sm">
              <Icon name="check" size={16} /> {t('request.fulfilled')}
            </p>
          ) : null}
          {request.status === 'partially_fulfilled' ? (
            <p className="text-sm">{t('request.partial', { remaining: `${remaining} ${unit}` })}</p>
          ) : null}
          {request.status === 'cancelled' ? <p className="text-sm text-soft">{t('sync.expired')}</p> : null}
        </div>

        <div className="row-wrap">
          {searchingLike ? (
            <Button
              variant="secondary"
              loading={cancel.isPending}
              onClick={() => cancel.mutate({ id: request.id })}
            >
              {t('request.cancelReq')}
            </Button>
          ) : null}
          {(request.status === 'no_match' || request.status === 'expired') && (
            <Button loading={renew.isPending} onClick={() => renew.mutate({ id: request.id, body: { expiresInMinutes: 15 } })}>
              {t('request.renew')}
            </Button>
          )}
          {request.status === 'partially_fulfilled' && (
            <>
              <Button
                loading={cont.isPending}
                onClick={() => cont.mutate({ id: request.id, body: { continueSearching: true } })}
              >
                {t('request.continueSearch')}
              </Button>
              <Button
                variant="secondary"
                loading={cont.isPending}
                onClick={() => cont.mutate({ id: request.id, body: { continueSearching: false } })}
              >
                {t('request.closeRequest')}
              </Button>
            </>
          )}
        </div>
      </div>
    </Card>
  );
}
