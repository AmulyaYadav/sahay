import React, { useMemo, useState } from 'react';
import { ScrollView, Switch, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import type { RequestUrgency, RequestView } from '@sahay/shared';
import { LIMITS } from '@sahay/shared';
import { api, idempotencyKey, isOfflineError } from '../../src/api';
import { useAuth } from '../../src/auth';
import { useActiveEvent } from '../../src/activeEvent';
import { useCatalogue } from '../../src/hooks';
import { ensureLocationPermission, getCoarseCoords } from '../../src/locationPings';
import { useLocale, useT } from '../../src/locale';
import { categoryById, categoryGlyph, categoryName, groupCategories } from '../../src/catalogue';
import { spacing, useTheme } from '../../src/theme';
import { Icon } from '../../src/components/icons';
import {
  Body,
  BodyBold,
  Button,
  Card,
  CategoryChip,
  Chip,
  Field,
  Gap,
  Heading,
  ListRow,
  Muted,
  MutedCaption,
  Row,
  Stepper,
} from '../../src/components/ui';

export default function NewRequestScreen() {
  const t = useT();
  const th = useTheme();
  const router = useRouter();
  const qc = useQueryClient();
  const { locale } = useLocale();
  const { token } = useAuth();
  const { activeEventId } = useActiveEvent();
  const catalogue = useCatalogue();

  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [qty, setQty] = useState(1);
  const [urgency, setUrgency] = useState<RequestUrgency>('standard');
  const [note, setNote] = useState('');
  const [useLocation, setUseLocation] = useState(true);
  const [areaHint, setAreaHint] = useState('');
  const [expiresIn, setExpiresIn] = useState(15);
  const [safetyAck, setSafetyAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cats = catalogue.data?.categories ?? [];
  const cat = categoryId ? categoryById(cats, categoryId) : undefined;
  const grouped = useMemo(() => groupCategories(cats), [cats]);

  const submit = async () => {
    if (!cat || !activeEventId || !token || !safetyAck) return;
    setBusy(true);
    setError(null);
    try {
      let coords: { lat: number; lng: number } | undefined;
      if (useLocation) {
        const granted = await ensureLocationPermission();
        if (granted) coords = (await getCoarseCoords()) ?? undefined;
      }
      const body = {
        eventId: activeEventId,
        categoryId: cat.id,
        qty,
        unit: cat.unit,
        urgency,
        note: note.trim() || undefined,
        expiresInMinutes: expiresIn,
        coords,
        areaHint: !coords && areaHint.trim() ? areaHint.trim() : undefined,
        safetyAcknowledged: true as const,
        idempotencyKey: idempotencyKey(),
      };
      const created = await api<RequestView>('/requests', { method: 'POST', token, body });
      void qc.invalidateQueries({ queryKey: ['requests'] });
      router.replace(`/request/${created.id}`);
    } catch (err) {
      setError(
        isOfflineError(err) ? t('common.offline') : (err as Error).message || t('common.error'),
      );
      setBusy(false);
    }
  };

  if (!activeEventId) {
    return (
      <View style={{ padding: spacing.xl }}>
        <Body>{t('home.noEventBody')}</Body>
        <Gap />
        <Button title={t('events.discover')} onPress={() => router.replace('/(tabs)/events')} />
      </View>
    );
  }

  return (
    <ScrollView
      contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl }}
    >
      <Heading>{t('request.what')}</Heading>

      {/* Step 1: category */}
      {!cat ? (
        <View style={{ gap: spacing.md }}>
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
                    setQty(1);
                  }}
                />
              ))}
            </View>
          ))}
        </View>
      ) : (
        <>
          {/* What + how many */}
          <Card>
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
            <MutedCaption>{t('request.howMany')}</MutedCaption>
            <Stepper
              value={qty}
              onChange={setQty}
              min={1}
              max={cat.maxRequestQty}
              unitLabel={t(`units.${cat.unit}`)}
            />
          </Card>

          {/* Urgency: segmented chips — standard→green, soon→orange, urgent→red (§4.8) */}
          <Card>
            <BodyBold>{t('request.urgency')}</BodyBold>
            <Row gap={spacing.sm} style={{ flexWrap: 'wrap' }}>
              <Chip
                label={t('request.std')}
                tone="success"
                selected={urgency === 'standard'}
                onPress={() => setUrgency('standard')}
              />
              <Chip
                label={t('request.soon')}
                tone="warn"
                selected={urgency === 'soon'}
                onPress={() => setUrgency('soon')}
              />
              <Chip
                label={t('request.urgent')}
                selected={urgency === 'urgent'}
                tone="danger"
                onPress={() => setUrgency('urgent')}
              />
            </Row>
            {urgency === 'urgent' ? (
              <Card tone="danger" style={{ padding: spacing.md }}>
                <BodyBold>{t('request.medicalTitle')}</BodyBold>
                <Body>{t('request.medicalBody')}</Body>
              </Card>
            ) : null}
          </Card>

          {/* Note */}
          <Card>
            <Field
              label={t('request.note')}
              placeholder={t('request.notePlaceholder')}
              value={note}
              onChangeText={(v) => setNote(v.slice(0, LIMITS.maxNoteLength))}
              multiline
            />
          </Card>

          {/* Location consent card (§4.9) — green, pin icon right */}
          <Card tone={useLocation ? 'success' : 'default'}>
            <Row gap={spacing.md} style={{ alignItems: 'flex-start' }}>
              <View style={{ flex: 1, gap: spacing.xs }}>
                <BodyBold>
                  {useLocation ? t('request.useLocation') : t('request.useArea')}
                </BodyBold>
                <MutedCaption>{t('request.locationWhy')}</MutedCaption>
              </View>
              <Icon
                name="map-pin"
                size={20}
                color={useLocation ? th.colors.success : th.colors.textSecondary}
              />
            </Row>
            <Row gap={spacing.sm} style={{ flexWrap: 'wrap' }}>
              <Chip
                label={t('request.useLocation')}
                tone="success"
                selected={useLocation}
                onPress={() => setUseLocation(true)}
              />
              <Chip
                label={t('request.useArea')}
                selected={!useLocation}
                onPress={() => setUseLocation(false)}
              />
            </Row>
            {!useLocation ? (
              <Field
                label={t('request.areaHint')}
                placeholder={t('request.notePlaceholder')}
                value={areaHint}
                onChangeText={(v) => setAreaHint(v.slice(0, 80))}
              />
            ) : null}
          </Card>

          {/* Expiry */}
          <Card>
            <BodyBold>{t('request.expiresIn')}</BodyBold>
            <Row gap={spacing.sm} style={{ flexWrap: 'wrap' }}>
              {LIMITS.requestExpiryOptionsMin.map((m) => (
                <Chip
                  key={m}
                  label={t('misc.minutes', { count: m })}
                  selected={expiresIn === m}
                  onPress={() => setExpiresIn(m)}
                />
              ))}
            </Row>
          </Card>

          {/* Safety acknowledgement */}
          <Card>
            <Row style={{ justifyContent: 'space-between' }}>
              <Body style={{ flex: 1 }}>{t('request.safetyAck')}</Body>
              <Switch
                accessibilityLabel={t('request.safetyAck')}
                value={safetyAck}
                onValueChange={setSafetyAck}
                trackColor={{ true: th.colors.primary, false: th.colors.border }}
              />
            </Row>
          </Card>

          {error ? <Body color={th.colors.error}>{error}</Body> : null}
          {/* "Send request" is a GREEN button (design system §1) */}
          <Button
            title={t('request.submit')}
            variant="success"
            onPress={() => void submit()}
            loading={busy}
            disabled={!safetyAck || (!useLocation && !areaHint.trim())}
          />
        </>
      )}
      <Gap />
    </ScrollView>
  );
}
