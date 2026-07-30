import { categoryDisplayName, type PublicWant } from '@sahay/shared';
import { useCatalogue } from '../api/hooks';
import { useLocale } from '../i18n/LocaleContext';
import { Badge, SkeletonCard } from '../ui/components';
import { Icon } from '../ui/icons';
import { CategoryChip } from '../ui/patterns';

export function PublicWants({ wants }: { wants: PublicWant[] }) {
  const { t, locale } = useLocale();
  const catalogue = useCatalogue();

  if (catalogue.isLoading) return <SkeletonCard lines={2} />;
  if (wants.length === 0) return <p className="text-sm text-soft">{t('eventPage.wantsEmpty')}</p>;

  const bySlug = new Map((catalogue.data?.categories ?? []).map((c) => [c.slug, c]));

  return (
    <div className="row-wrap">
      {wants.map((w) => {
        const cat = bySlug.get(w.categorySlug);
        if (!cat) return null;
        // Both sources can carry a number now: aggregated demand for 'user',
        // the organiser's declared target for 'admin'.
        const hasQty = typeof w.requestedQty === 'number' && w.requestedQty > 0;
        const qty = hasQty ? Math.round(w.requestedQty as number) : null;
        // "40 torches needed", but "1 torch needed".
        const catName = categoryDisplayName(cat, locale, qty);
        const label = hasQty ? t('eventPage.wantQtyNeeded', { qty: qty as number, category: catName }) : catName;
        return (
          <span key={w.categorySlug} className="chip" style={{ alignItems: 'center', gap: 'var(--sp-1)' }}>
            <CategoryChip group={cat.group} icon={cat.icon} size="sm" />
            <span>{label}</span>
            {w.source === 'admin' ? (
              <Badge tone="ok">
                <Icon name="check" size={12} label={t('eventPage.wantAdminBadge')} />
              </Badge>
            ) : null}
          </span>
        );
      })}
    </div>
  );
}
