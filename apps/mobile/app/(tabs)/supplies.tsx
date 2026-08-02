import React, { useEffect, useMemo, useState } from 'react';
import { Alert, ScrollView, Switch, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import type { Category, InventoryItem } from '@sahay/shared';
import { api, idempotencyKey, isOfflineError } from '../../src/api';
import { useAuth } from '../../src/auth';
import { useActiveEvent } from '../../src/activeEvent';
import { qk, useCatalogue, useInventory } from '../../src/hooks';
import { enqueueInventoryOp, usePendingInventory } from '../../src/pendingOps';
import { useLocale, useT } from '../../src/locale';
import { categoryById, categoryGlyph, categoryName, groupCategories } from '../../src/catalogue';
import { spacing, useTheme } from '../../src/theme';
import {
  AvailabilityBadge,
  Badge,
  Body,
  BodyBold,
  Button,
  Card,
  CategoryChip,
  Chip,
  EmptyState,
  Field,
  Gap,
  Heading,
  ListRow,
  Muted,
  MutedCaption,
  Row,
  Stepper,
} from '../../src/components/ui';
import { AppHeader } from '../../src/components/AppHeader';

export default function SuppliesScreen() {
  const t = useT();
  const router = useRouter();
  const params = useLocalSearchParams<{
    prefillCategoryId?: string;
    prefillQty?: string;
    eventId?: string;
  }>();
  const { locale } = useLocale();
  const qc = useQueryClient();
  const { activeEventId, setActiveEventId } = useActiveEvent();
  const th = useTheme();

  // "I can bring this" can arrive scoped to a specific event.
  useEffect(() => {
    if (params.eventId && params.eventId !== activeEventId) setActiveEventId(params.eventId);
  }, [params.eventId, activeEventId, setActiveEventId]);

  const eventId = params.eventId ?? activeEventId;
  const catalogue = useCatalogue();
  const inventory = useInventory(eventId);
  const { pending, flush } = usePendingInventory(eventId);

  const [adding, setAdding] = useState(false);
  const [prefillCategory, setPrefillCategory] = useState<string | null>(null);

  useEffect(() => {
    if (params.prefillCategoryId) {
      setPrefillCategory(params.prefillCategoryId);
      setAdding(true);
    }
  }, [params.prefillCategoryId]);

  if (!eventId) {
    return (
      <View style={{ flex: 1 }}>
        <EmptyState message={t('inventory.scopeNote')} />
        <View style={{ paddingHorizontal: spacing.xl }}>
          <Button title={t('events.join')} onPress={() => router.push('/(tabs)/events')} />
        </View>
      </View>
    );
  }

  const items = (inventory.data?.items ?? []).filter((i) => i.active || i.qtyReserved > 0);

  return (
    <View style={{ flex: 1, backgroundColor: th.colors.bg }}>
    <AppHeader />
    <ScrollView
      contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl }}
    >
      <MutedCaption>{t('inventory.scopeNote')}</MutedCaption>

      {adding ? (
        <QuickAdd
          eventId={eventId}
          categories={catalogue.data?.categories ?? []}
          prefillCategoryId={prefillCategory}
          prefillQty={params.prefillQty ? Number(params.prefillQty) : undefined}
          onFlush={() => void flush()}
          onDone={() => {
            setAdding(false);
            setPrefillCategory(null);
          }}
        />
      ) : (
        <Button
          title={`+ ${t('inventory.add')}`}
          variant="secondary"
          accessibilityLabel={t('inventory.add')}
          onPress={() => setAdding(true)}
        />
      )}

      {/* Offline-queued adds: never shown as live until the server says 2xx. */}
      {pending.map((op) => {
        const cat = categoryById(catalogue.data?.categories, op.body.categoryId);
        return (
          <Card key={op.id} tone="warn">
            <Row gap={spacing.md}>
              <CategoryChip glyph={categoryGlyph(cat)} group={cat?.group} />
              <BodyBold style={{ flex: 1 }}>
                {categoryName(cat, locale)} · {op.body.qty} {op.body.unit}
              </BodyBold>
              <Badge label={t('sync.savedLocally')} tone="warn" />
            </Row>
            <Row style={{ justifyContent: 'space-between' }}>
              <MutedCaption>{t('sync.waitingUpload')}</MutedCaption>
              <Button title={t('common.retry')} variant="ghost" small onPress={() => void flush()} />
            </Row>
          </Card>
        );
      })}

      {items.length === 0 && pending.length === 0 && !inventory.isLoading ? (
        <EmptyState message={t('inventory.empty')} />
      ) : null}

      {items.map((item) => (
        <InventoryRow
          key={item.id}
          item={item}
          category={categoryById(catalogue.data?.categories, item.categoryId)}
          onChanged={() => void qc.invalidateQueries({ queryKey: qk.inventory(eventId) })}
        />
      ))}
      <Gap />
    </ScrollView>
    </View>
  );
}

/* --------------------------------------------------------- inventory row */

function InventoryRow({
  item,
  category,
  onChanged,
}: {
  item: InventoryItem;
  category: Category | undefined;
  onChanged: () => void;
}) {
  const t = useT();
  const { locale } = useLocale();
  const { token } = useAuth();
  const [busy, setBusy] = useState(false);

  const patch = async (body: Record<string, unknown>) => {
    setBusy(true);
    try {
      await api(`/inventory/${item.id}`, { method: 'PATCH', token, body });
      onChanged();
    } catch {
      Alert.alert(t('common.error'));
    } finally {
      setBusy(false);
    }
  };

  const del = () => {
    Alert.alert(t('common.remove'), categoryName(category, locale), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.remove'),
        style: 'destructive',
        onPress: () => {
          void (async () => {
            setBusy(true);
            try {
              await api(`/inventory/${item.id}`, { method: 'DELETE', token });
              onChanged();
            } catch {
              Alert.alert(t('common.error'));
            } finally {
              setBusy(false);
            }
          })();
        },
      },
    ]);
  };

  // Details caption, e.g. "4 bottle(s) · Sealed · Exp 2026-08-01"
  const details = [
    `${item.qtyAvailable} ${t(`units.${item.unit}`)}`,
    item.details.sealed ? t('inventory.sealed') : null,
    item.details.expiryDate ? `${t('inventory.expiry')}: ${item.details.expiryDate}` : null,
    typeof item.details.chargePercent === 'number' ? `${item.details.chargePercent}%` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <Card>
      <Row gap={spacing.md} style={{ alignItems: 'flex-start' }}>
        <CategoryChip glyph={categoryGlyph(category)} group={category?.group} />
        <View style={{ flex: 1, gap: 2 }}>
          <BodyBold>{categoryName(category, locale)}</BodyBold>
          <MutedCaption>{details}</MutedCaption>
        </View>
        {!item.active ? (
          <Badge label={t('inventory.disabled')} tone="warn" />
        ) : (
          <AvailabilityBadge count={item.qtyAvailable} />
        )}
      </Row>
      {item.qtyReserved > 0 ? (
        <Badge label={t('inventory.reserved', { count: item.qtyReserved })} tone="accent" />
      ) : null}
      <Row gap={spacing.sm} style={{ flexWrap: 'wrap' }}>
        <Button
          title={`${t('inventory.replenish')} +1`}
          variant="secondary"
          small
          disabled={busy}
          onPress={() => void patch({ qtyTotal: item.qtyTotal + 1 })}
        />
        {item.qtyTotal > Math.max(1, item.qtyReserved) ? (
          <Button
            title="−1"
            variant="secondary"
            small
            disabled={busy}
            accessibilityLabel={`${t('common.edit')} −1`}
            onPress={() => void patch({ qtyTotal: item.qtyTotal - 1 })}
          />
        ) : null}
        <Button
          title={item.active ? t('inventory.depleted') : t('inventory.resume')}
          variant="ghost"
          small
          disabled={busy}
          onPress={() => void patch({ active: !item.active })}
        />
        <Button title={t('common.remove')} variant="ghost" small disabled={busy} onPress={del} />
      </Row>
    </Card>
  );
}

/* -------------------------------------------------------------- quick add */

function QuickAdd({
  eventId,
  categories,
  prefillCategoryId,
  prefillQty,
  onFlush,
  onDone,
}: {
  eventId: string;
  categories: Category[];
  prefillCategoryId: string | null;
  prefillQty?: number;
  onFlush: () => void;
  onDone: () => void;
}) {
  const t = useT();
  const th = useTheme();
  const { locale } = useLocale();
  const { token } = useAuth();
  const qc = useQueryClient();

  const [categoryId, setCategoryId] = useState<string | null>(prefillCategoryId);
  const [qty, setQty] = useState(prefillQty && prefillQty > 0 ? Math.round(prefillQty) : 1);
  const [unit, setUnit] = useState<string | null>(null);
  const [sealed, setSealed] = useState(true);
  const [expiry, setExpiry] = useState('');
  const [charge, setCharge] = useState(80);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const cat = categoryId ? categoryById(categories, categoryId) : undefined;
  const grouped = useMemo(() => groupCategories(categories), [categories]);

  const submit = async () => {
    if (!cat) return;
    setBusy(true);
    setNotice(null);
    const details: Record<string, unknown> = {};
    if (cat.sealedRequired) details.sealed = sealed;
    if (cat.expiryRelevant && /^\d{4}-\d{2}-\d{2}$/.test(expiry)) details.expiryDate = expiry;
    if (cat.slug === 'power-bank') details.chargePercent = charge;
    const body = {
      categoryId: cat.id,
      qty,
      unit: unit ?? cat.unit,
      details,
      idempotencyKey: idempotencyKey(),
    };
    try {
      await api(`/events/${eventId}/inventory`, { method: 'POST', token, body });
      void qc.invalidateQueries({ queryKey: qk.inventory(eventId) });
      onDone();
    } catch (err) {
      if (isOfflineError(err)) {
        await enqueueInventoryOp({
          id: body.idempotencyKey,
          eventId,
          body,
          createdAt: Date.now(),
          attempts: 0,
        });
        onFlush();
        onDone();
      } else {
        setNotice((err as Error).message || t('common.error'));
        setBusy(false);
      }
      return;
    }
    setBusy(false);
  };

  if (!cat) {
    return (
      <View style={{ gap: spacing.md }}>
        <Heading>{t('inventory.add')}</Heading>
        <Muted>{t('inventory.whatCarrying')}</Muted>
        {[...grouped.entries()].map(([group, list]) => (
          <View key={group} style={{ gap: spacing.sm }}>
            <MutedCaption>{t(`groups.${group}`)}</MutedCaption>
            {list.map((c) => (
              <ListRow
                key={c.id}
                accessibilityLabel={categoryName(c, locale)}
                leading={<CategoryChip glyph={categoryGlyph(c)} group={c.group} />}
                title={categoryName(c, locale)}
                onPress={() => {
                  setCategoryId(c.id);
                  setUnit(c.unit);
                }}
              />
            ))}
          </View>
        ))}
        <Button title={t('common.cancel')} variant="ghost" onPress={onDone} />
      </View>
    );
  }

  return (
    <View style={{ gap: spacing.md }}>
      {/* Header with Save top-right (frame 05) */}
      <Row style={{ justifyContent: 'space-between' }}>
        <View style={{ flex: 1 }}>
          <Heading>{t('inventory.add')}</Heading>
          <Muted>{t('inventory.whatCarrying')}</Muted>
        </View>
        <Button
          title={t('common.save')}
          small
          onPress={() => void submit()}
          loading={busy}
          disabled={cat.sealedRequired && !sealed}
        />
      </Row>

      {/* Category field card */}
      <Card>
        <MutedCaption>{t('inventory.category')}</MutedCaption>
        <Row gap={spacing.md}>
          <CategoryChip glyph={categoryGlyph(cat)} group={cat.group} />
          <BodyBold style={{ flex: 1 }}>{categoryName(cat, locale)}</BodyBold>
          <Button
            title={t('common.edit')}
            variant="ghost"
            small
            onPress={() => setCategoryId(null)}
          />
        </Row>
        {cat.warningKey ? <Body color={th.colors.warning}>{t(cat.warningKey)}</Body> : null}
      </Card>

      {/* Quantity + unit field card */}
      <Card>
        <MutedCaption>{t('inventory.qty')}</MutedCaption>
        <Stepper
          value={qty}
          onChange={setQty}
          min={1}
          max={cat.maxOfferQty}
          unitLabel={t(`units.${unit ?? cat.unit}`)}
        />
        {cat.altUnits.length > 0 ? (
          <>
            <MutedCaption>{t('inventory.unit')}</MutedCaption>
            <Row gap={spacing.sm} style={{ flexWrap: 'wrap' }}>
              {[cat.unit, ...cat.altUnits].map((u) => (
                <Chip
                  key={u}
                  label={t(`units.${u}`)}
                  selected={(unit ?? cat.unit) === u}
                  onPress={() => setUnit(u)}
                />
              ))}
            </Row>
          </>
        ) : null}
      </Card>

      {/* Condition / expiry / charge field cards */}
      {cat.sealedRequired ? (
        <Card>
          <MutedCaption>{t('inventory.condition')}</MutedCaption>
          <Row style={{ justifyContent: 'space-between' }}>
            {/* flex: 1 like the app's other switch rows — without it a longer
                translation at a large font size pushes the switch off the edge. */}
            <Body style={{ flex: 1 }}>{t('inventory.sealed')}</Body>
            <Switch
              accessibilityLabel={t('inventory.sealed')}
              value={sealed}
              onValueChange={setSealed}
              trackColor={{ true: th.colors.primary, false: th.colors.border }}
            />
          </Row>
          {!sealed ? <MutedCaption>{t('safety.inspectSealed')}</MutedCaption> : null}
        </Card>
      ) : null}

      {cat.expiryRelevant ? (
        <Card>
          <Field
            label={t('inventory.expiry')}
            placeholder="YYYY-MM-DD"
            value={expiry}
            onChangeText={setExpiry}
            autoCapitalize="none"
          />
        </Card>
      ) : null}

      {cat.slug === 'power-bank' ? (
        <Card>
          <MutedCaption>{t('inventory.chargePercent')}</MutedCaption>
          <Stepper value={charge} onChange={setCharge} min={0} max={100} step={10} unitLabel="%" />
        </Card>
      ) : null}

      {notice ? <Body color={th.colors.error}>{notice}</Body> : null}

      <Row gap={spacing.sm}>
        <Button
          title={t('common.save')}
          onPress={() => void submit()}
          loading={busy}
          disabled={cat.sealedRequired && !sealed}
          style={{ flex: 1 }}
        />
        <Button title={t('common.back')} variant="ghost" onPress={() => setCategoryId(null)} />
      </Row>
    </View>
  );
}
