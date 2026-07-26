/**
 * Full-screen offer sheet for helpers. Shows whenever /offers/pending is non-empty
 * (the offer.new WS frame simply invalidates that query). Countdown is announced
 * politely; declining is explicitly a no-penalty action.
 */
import { LIMITS } from '@sahay/shared';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCatalogue, usePendingOffers, useRespondOffer } from '../api/hooks';
import { useLocale } from '../i18n/LocaleContext';
import { categoryName, unitLabel } from '../lib/format';
import { CountdownRing } from '../ui/CountdownRing';
import { Banner, Button } from '../ui/components';
import { Dialog } from '../ui/Dialog';
import { Icon } from '../ui/icons';
import { useToast } from '../ui/Toast';

export function OfferSheet() {
  const { t, locale } = useLocale();
  const navigate = useNavigate();
  const { toast } = useToast();
  const offersQuery = usePendingOffers();
  const catalogue = useCatalogue();
  const respond = useRespondOffer();
  const [dismissed, setDismissed] = useState<string[]>([]);

  const offer = useMemo(() => {
    const now = Date.now();
    return (offersQuery.data?.items ?? []).find(
      (o) => o.status === 'offered' && !dismissed.includes(o.id) && new Date(o.respondBy).getTime() > now,
    );
  }, [offersQuery.data, dismissed]);

  if (!offer) return null;

  const cat = catalogue.data?.categories.find((c) => c.slug === offer.categorySlug);
  const unit = unitLabel(t, offer.unit);

  const answer = (accept: boolean, alsoStopReceiving = false) => {
    respond.mutate(
      { id: offer.id, accept, alsoStopReceiving },
      {
        onSuccess: (res) => {
          setDismissed((d) => [...d, offer.id]);
          if (accept && res.match) navigate(`/matches/${res.match.id}`);
        },
        onError: () => {
          setDismissed((d) => [...d, offer.id]);
          toast(t('offer.tooLate'), 'error');
        },
      },
    );
  };

  return (
    <Dialog open onClose={() => setDismissed((d) => [...d, offer.id])} title={t('offer.title')} sheet dismissable={false}>
      <div className="stack" aria-live="polite">
        <div className="row">
          <CountdownRing
            deadline={offer.respondBy}
            totalSeconds={LIMITS.offerResponseSeconds}
            onExpire={() => setDismissed((d) => [...d, offer.id])}
          />
          <div className="stack-sm" style={{ flex: 1 }}>
            <strong style={{ fontSize: 'var(--fs-lg)' }}>
              <Icon name={cat?.icon ?? 'box'} size={22} />{' '}
              {t('offer.needs', {
                qty: offer.qtyRequested,
                unit,
                category: categoryName(cat, locale) || offer.categorySlug,
              })}
            </strong>
            <span className="text-sm text-soft">{t('offer.youHave', { qty: offer.qtyYouHave, unit })}</span>
            <div className="row-wrap">
              <span className="badge badge-accent">{t(`proximity.${offer.proximity}`)}</span>
              <span className={offer.urgency === 'urgent' ? 'badge badge-danger' : 'badge'}>
                {t(`request.${offer.urgency === 'standard' ? 'std' : offer.urgency}`)}
              </span>
            </div>
          </div>
        </div>

        {offer.note ? <p className="text-sm text-soft">“{offer.note}”</p> : null}

        <Banner tone="info" icon="shield">
          {t('safety.meetPublic')} {t('safety.noContactShare')}
        </Banner>

        <Button large block loading={respond.isPending} onClick={() => answer(true)}>
          {t('offer.accept')}
        </Button>
        <div className="row">
          <Button variant="secondary" block disabled={respond.isPending} onClick={() => answer(false)}>
            {t('offer.decline')}
          </Button>
          <Button variant="secondary" block disabled={respond.isPending} onClick={() => answer(false, true)}>
            {t('offer.declineAndPause')}
          </Button>
        </div>
        <p className="text-xs text-soft text-center">{t('offer.declineNote')}</p>
      </div>
    </Dialog>
  );
}
