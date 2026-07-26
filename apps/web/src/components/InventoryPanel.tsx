/**
 * "My supplies": per-event inventory with quick add (category picker grouped by CATEGORY_GROUPS),
 * unit-appropriate detail fields, qty edit, pause/resume, deplete, delete, and reserved quantities.
 */
import { CATEGORY_GROUPS, type Category, type InventoryItem } from '@sahay/shared';
import { useEffect, useMemo, useState } from 'react';
import { useAddInventory, useCatalogue, useDeleteInventory, useInventory, useUpdateInventory } from '../api/hooks';
import { useLocale } from '../i18n/LocaleContext';
import { categoryName, newIdempotencyKey, unitLabel } from '../lib/format';
import { Badge, Button, Card, EmptyState, Input, Select, SkeletonCard, Stepper, Toggle } from '../ui/components';
import { Dialog } from '../ui/Dialog';
import { Icon } from '../ui/icons';
import { useToast } from '../ui/Toast';

export interface AddPrefill {
  categoryId?: string;
  qty?: number;
}

export function AddInventoryDialog({
  eventId,
  open,
  onClose,
  prefill,
}: {
  eventId: string;
  open: boolean;
  onClose: () => void;
  prefill?: AddPrefill;
}) {
  const { t, locale } = useLocale();
  const { toast } = useToast();
  const catalogue = useCatalogue();
  const add = useAddInventory(eventId);

  const [categoryId, setCategoryId] = useState<string | undefined>(prefill?.categoryId);
  const [qty, setQty] = useState(prefill?.qty ?? 1);
  const [sealed, setSealed] = useState(true);
  const [expiry, setExpiry] = useState('');
  const [charge, setCharge] = useState(100);
  const [sizeLabel, setSizeLabel] = useState('');

  useEffect(() => {
    if (open) {
      setCategoryId(prefill?.categoryId);
      setQty(prefill?.qty ?? 1);
      setSealed(true);
      setExpiry('');
      setCharge(100);
      setSizeLabel('');
    }
  }, [open, prefill?.categoryId, prefill?.qty]);

  const byGroup = useMemo(() => {
    const map = new Map<string, Category[]>();
    for (const g of CATEGORY_GROUPS) map.set(g, []);
    for (const cat of catalogue.data?.categories ?? []) {
      if (!cat.active) continue;
      map.get(cat.group)?.push(cat);
    }
    return map;
  }, [catalogue.data]);

  const selected = catalogue.data?.categories.find((c) => c.id === categoryId);
  const isClothing = selected?.group === 'clothing';
  const isPowerBank = selected?.slug === 'power-bank';

  const submit = () => {
    if (!selected) return;
    const details: Record<string, unknown> = {};
    if (selected.sealedRequired) details['sealed'] = sealed;
    if (selected.expiryRelevant && expiry) details['expiryDate'] = expiry;
    if (isPowerBank) details['chargePercent'] = charge;
    if (isClothing && sizeLabel) details['sizeLabel'] = sizeLabel;
    add.mutate(
      { categoryId: selected.id, qty, unit: selected.unit, details, idempotencyKey: newIdempotencyKey() },
      {
        onSuccess: () => {
          toast(t('sync.submitted'));
          onClose();
        },
        onError: (e) => toast(e instanceof Error ? e.message : t('common.error'), 'error'),
      },
    );
  };

  return (
    <Dialog open={open} onClose={onClose} title={t('inventory.add')} sheet>
      <div className="stack">
        {!selected ? (
          <div className="stack">
            {CATEGORY_GROUPS.map((group) => {
              const cats = byGroup.get(group) ?? [];
              if (cats.length === 0) return null;
              return (
                <section key={group}>
                  <h3 style={{ fontSize: 'var(--fs-sm)', color: 'var(--c-text-soft)' }}>{t(`groups.${group}`)}</h3>
                  <div className="row-wrap">
                    {cats.map((cat) => (
                      <button key={cat.id} type="button" className="chip" onClick={() => setCategoryId(cat.id)}>
                        <Icon name={cat.icon} size={16} /> {categoryName(cat, locale)}
                      </button>
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        ) : (
          <div className="stack">
            <div className="row">
              <Icon name={selected.icon} size={24} />
              <strong style={{ flex: 1 }}>{categoryName(selected, locale)}</strong>
              <Button variant="ghost" onClick={() => setCategoryId(undefined)}>
                {t('common.edit')}
              </Button>
            </div>
            {selected.warningKey ? (
              <p className="text-xs text-danger" role="note">
                <Icon name="warning" size={14} /> {t(selected.warningKey)}
              </p>
            ) : null}
            <div className="field">
              <span className="field-label">{t('inventory.qty')}</span>
              <Stepper
                value={qty}
                min={1}
                max={selected.maxOfferQty}
                onChange={setQty}
                unitLabel={unitLabel(t, selected.unit)}
                decreaseLabel={t('misc.decrease')}
                increaseLabel={t('misc.increase')}
              />
            </div>
            {selected.sealedRequired ? (
              <div className="row">
                <span className="field-label" style={{ flex: 1 }}>
                  {t('inventory.sealed')}
                </span>
                <Toggle checked={sealed} onChange={setSealed} label={t('inventory.sealed')} />
              </div>
            ) : null}
            {selected.expiryRelevant ? (
              <Input label={t('inventory.expiry')} type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} />
            ) : null}
            {isPowerBank ? (
              <Input
                label={t('inventory.chargePercent')}
                type="number"
                min={0}
                max={100}
                value={charge}
                onChange={(e) => setCharge(Math.max(0, Math.min(100, Number(e.target.value) || 0)))}
              />
            ) : null}
            {isClothing ? (
              <Input label={t('inventory.sizeLabel')} value={sizeLabel} maxLength={20} onChange={(e) => setSizeLabel(e.target.value)} />
            ) : null}
            <Button block large loading={add.isPending} disabled={selected.sealedRequired && !sealed} onClick={submit}>
              {t('inventory.add')}
            </Button>
          </div>
        )}
      </div>
    </Dialog>
  );
}

function InventoryRow({ item, eventId }: { item: InventoryItem; eventId: string }) {
  const { t, locale } = useLocale();
  const catalogue = useCatalogue();
  const update = useUpdateInventory(eventId);
  const remove = useDeleteInventory(eventId);
  const cat = catalogue.data?.categories.find((c) => c.id === item.categoryId);

  return (
    <Card className={item.active ? '' : 'card-plain'}>
      <div className="stack-sm" style={{ opacity: item.active ? 1 : 0.65 }}>
        <div className="row">
          <Icon name={cat?.icon ?? 'box'} size={22} />
          <strong style={{ flex: 1 }}>{categoryName(cat, locale) || item.categorySlug}</strong>
          {!item.active ? <Badge tone="warn">{t('inventory.disabled')}</Badge> : null}
        </div>
        <div className="row">
          <div className="field" style={{ flex: 1 }}>
            <span className="field-label">{t('inventory.qty')}</span>
            <Stepper
              value={item.qtyTotal}
              min={Math.max(1, item.qtyReserved)}
              max={cat?.maxOfferQty ?? 10000}
              onChange={(v) => update.mutate({ itemId: item.id, qtyTotal: v })}
              unitLabel={unitLabel(t, item.unit)}
              decreaseLabel={t('misc.decrease')}
              increaseLabel={t('misc.increase')}
            />
          </div>
        </div>
        {item.qtyReserved > 0 ? (
          <p className="text-xs" style={{ color: 'var(--c-warn)', margin: 0 }}>
            <Icon name="clock" size={14} /> {t('inventory.reserved', { count: item.qtyReserved })}
          </p>
        ) : null}
        <div className="row-wrap">
          <Button
            variant="secondary"
            loading={update.isPending}
            onClick={() => update.mutate({ itemId: item.id, active: !item.active })}
          >
            {item.active ? t('inventory.disabled') : t('inventory.resume')}
          </Button>
          <Button variant="secondary" loading={remove.isPending} onClick={() => remove.mutate(item.id)}>
            {t('inventory.depleted')}
          </Button>
          <Button variant="ghost" loading={remove.isPending} onClick={() => remove.mutate(item.id)}>
            {t('common.remove')}
          </Button>
        </div>
      </div>
    </Card>
  );
}

export function InventoryPanel({
  eventId,
  isMember,
  addOpen,
  setAddOpen,
  prefill,
}: {
  eventId: string;
  isMember: boolean;
  addOpen: boolean;
  setAddOpen: (v: boolean) => void;
  prefill?: AddPrefill;
}) {
  const { t } = useLocale();
  const inventory = useInventory(eventId, isMember);

  if (!isMember) return <EmptyState title={t('eventPage.memberOnly')} />;

  return (
    <div className="stack">
      <div className="row">
        <p className="text-xs text-soft" style={{ flex: 1, margin: 0 }}>
          {t('inventory.scopeNote')}
        </p>
        <Button onClick={() => setAddOpen(true)}>
          <Icon name="plus" /> {t('inventory.quickAdd')}
        </Button>
      </div>

      {inventory.isLoading ? (
        <SkeletonCard lines={3} />
      ) : (inventory.data?.items.length ?? 0) === 0 ? (
        <EmptyState
          title={t('misc.emptyTitle')}
          body={t('inventory.empty')}
          action={<Button onClick={() => setAddOpen(true)}>{t('inventory.add')}</Button>}
        />
      ) : (
        inventory.data?.items.map((item) => <InventoryRow key={item.id} item={item} eventId={eventId} />)
      )}

      <AddInventoryDialog eventId={eventId} open={addOpen} onClose={() => setAddOpen(false)} prefill={prefill} />
    </div>
  );
}
