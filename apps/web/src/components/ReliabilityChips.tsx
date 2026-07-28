import type { PeerProfile } from '@sahay/shared';
import { useState } from 'react';
import { useLocale } from '../i18n/LocaleContext';
import { formatMonth } from '../lib/format';
import { Badge } from '../ui/components';
import { Icon } from '../ui/icons';

/** Honest peer-trust chips: label, completed assists, member-since, email-verified (with meaning). */
export function ReliabilityChips({ peer }: { peer: PeerProfile }) {
  const { t, locale } = useLocale();
  const [showMeaning, setShowMeaning] = useState(false);

  return (
    <div className="stack-sm">
      <div className="row-wrap">
        <Badge tone="accent">{t(`reliability.${peer.reliabilityLabel}`)}</Badge>
        <Badge>{t('reliability.completedAssists', { count: peer.completedAssists })}</Badge>
        <Badge>{t('reliability.memberSince', { month: formatMonth(peer.memberSince, locale) })}</Badge>
        {peer.emailVerifiedLabel ? (
          <button
            type="button"
            className="chip"
            style={{ minHeight: 28, padding: '2px 10px', fontSize: 'var(--fs-xs)' }}
            aria-expanded={showMeaning}
            onClick={() => setShowMeaning((v) => !v)}
          >
            <Icon name="check" size={14} /> {t('reliability.emailVerified')}
          </button>
        ) : (
          <Badge>{t('reliability.notVerified')}</Badge>
        )}
      </div>
      {showMeaning ? (
        <p className="text-xs text-soft" role="note">
          {t('reliability.verifiedMeaning')}
        </p>
      ) : null}
    </div>
  );
}
