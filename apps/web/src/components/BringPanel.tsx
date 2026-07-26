/** "What should I bring?" — member-only suggestions with the five response actions. */
import { useReducer } from 'react';
import { useBringSuggestions, useCatalogue } from '../api/hooks';
import { useLocale } from '../i18n/LocaleContext';
import { categoryName, unitLabel } from '../lib/format';
import { isBringDismissed, setBringFlag } from '../lib/storage';
import { Badge, Button, Card, EmptyState, SkeletonCard } from '../ui/components';
import { Icon } from '../ui/icons';

export function BringPanel({
  eventId,
  isMember,
  onAdd,
}: {
  eventId: string;
  isMember: boolean;
  onAdd: (categoryId: string, qty: number) => void;
}) {
  const { t, locale } = useLocale();
  const [, bump] = useReducer((x: number) => x + 1, 0);
  const suggestions = useBringSuggestions(eventId, isMember);
  const catalogue = useCatalogue();

  if (!isMember) return <EmptyState title={t('eventPage.memberOnly')} />;
  if (suggestions.isLoading) return <SkeletonCard lines={4} />;

  const visible = (suggestions.data?.suggestions ?? []).filter((s) => !isBringDismissed(eventId, s.categoryId));

  return (
    <div className="stack">
      <p className="text-sm text-soft">{t('bring.subtitle')}</p>
      {visible.length === 0 ? (
        <EmptyState title={t('misc.emptyTitle')} />
      ) : (
        visible.map((s) => {
          const cat = catalogue.data?.categories.find((c) => c.id === s.categoryId);
          return (
            <Card key={s.categoryId}>
              <div className="stack-sm">
                <div className="row">
                  <Icon name={cat?.icon ?? 'box'} size={24} />
                  <strong style={{ flex: 1 }}>
                    {categoryName(cat, locale) || s.categorySlug} — {s.suggestedQty} {unitLabel(t, s.unit)}
                  </strong>
                  <Badge tone={s.level === 'critical_shortage' ? 'danger' : s.level === 'high_need' ? 'warn' : 'accent'}>
                    {t(`shortage.${s.level}`)}
                  </Badge>
                </div>
                <div className="row-wrap">
                  <Button onClick={() => onAdd(s.categoryId, s.suggestedQty)}>{t('bring.canBring')}</Button>
                  <Button variant="secondary" onClick={() => onAdd(s.categoryId, s.suggestedQty)}>
                    {t('bring.addQty')}
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setBringFlag(eventId, s.categoryId, 'dontHave');
                      bump();
                    }}
                  >
                    {t('bring.dontHave')}
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setBringFlag(eventId, s.categoryId, 'later');
                      bump();
                    }}
                  >
                    {t('bring.later')}
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setBringFlag(eventId, s.categoryId, 'hidden');
                      bump();
                    }}
                  >
                    {t('bring.hide')}
                  </Button>
                </div>
              </div>
            </Card>
          );
        })
      )}
    </div>
  );
}
