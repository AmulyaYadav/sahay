import React, { useState } from 'react';
import { ActivityIndicator, Alert, ScrollView } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import type { RequestView } from '@sahay/shared';
import { api } from '../../src/api';
import { useAuth } from '../../src/auth';
import { qk, useCatalogue, useRequest } from '../../src/hooks';
import { useLocale, useT } from '../../src/locale';
import { categoryBySlug, categoryGlyph, categoryName } from '../../src/catalogue';
import { minutesUntil } from '../../src/format';
import { spacing, useTheme } from '../../src/theme';
import {
  Badge,
  Body,
  BodyBold,
  Button,
  Card,
  ErrorView,
  Gap,
  Heading,
  LoadingView,
  Muted,
  MutedCaption,
  Row,
} from '../../src/components/ui';

/** Live matching screen: state comes from the server only — no fake progress. */
export default function RequestScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useT();
  const th = useTheme();
  const router = useRouter();
  const qc = useQueryClient();
  const { locale } = useLocale();
  const { token } = useAuth();
  const catalogue = useCatalogue();

  const request = useRequest(id, { poll: true });
  const [busy, setBusy] = useState(false);

  if (request.isLoading) return <LoadingView />;
  if (request.isError || !request.data)
    return <ErrorView onRetry={() => void request.refetch()} />;
  const r: RequestView = request.data;
  const cat = categoryBySlug(catalogue.data?.categories, r.categorySlug);

  const act = async (path: string, body?: unknown) => {
    setBusy(true);
    try {
      await api(`/requests/${r.id}${path}`, { method: 'POST', token, body });
      void qc.invalidateQueries({ queryKey: qk.request(r.id) });
      void qc.invalidateQueries({ queryKey: ['requests'] });
    } catch (err) {
      Alert.alert((err as Error).message || t('common.error'));
    } finally {
      setBusy(false);
    }
  };

  const searching = r.status === 'searching' || r.status === 'offering';
  const remaining = Math.max(0, r.qty - r.qtyFulfilled);

  return (
    <>
      <Stack.Screen
        options={{
          title: searching
            ? t('sync.matching')
            : r.status === 'matched'
              ? t('match.matched')
              : t('request.title'),
        }}
      />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}>
        <Card>
          <Row style={{ justifyContent: 'space-between' }}>
            <Heading style={{ flex: 1 }}>
              {categoryGlyph(cat)} {categoryName(cat, locale)}
            </Heading>
            <Badge label={`${r.qty} ${t(`units.${r.unit}`)}`} tone="accent" />
          </Row>
          <Row gap={spacing.sm} style={{ flexWrap: 'wrap' }}>
            <Badge
              label={
                r.urgency === 'urgent'
                  ? t('request.urgent')
                  : r.urgency === 'soon'
                    ? t('request.soon')
                    : t('request.std')
              }
              tone={r.urgency === 'urgent' ? 'danger' : 'default'}
            />
            {r.qtyFulfilled > 0 ? <Badge label={`${r.qtyFulfilled}/${r.qty}`} tone="success" /> : null}
          </Row>
          {r.note ? <Muted>{r.note}</Muted> : null}
        </Card>

        {searching ? (
          <Card tone="accent">
            <Row gap={spacing.md}>
              <ActivityIndicator color={th.colors.accent} />
              <BodyBold style={{ flex: 1 }}>{t('request.searching')}</BodyBold>
            </Row>
            <Muted>{t('request.attempt', { count: r.attemptCount })}</Muted>
            <MutedCaption>
              {t('request.expiresIn')}: {t('misc.minutes', { count: minutesUntil(r.expiresAt) })}
            </MutedCaption>
            <Button
              title={t('request.cancelReq')}
              variant="danger"
              loading={busy}
              onPress={() => void act('/cancel')}
            />
          </Card>
        ) : null}

        {r.status === 'matched' && r.activeMatchId ? (
          <Card tone="accent">
            <BodyBold>{t('match.matched')}</BodyBold>
            <Button
              title={t('match.matched')}
              onPress={() => router.push(`/match/${r.activeMatchId}`)}
            />
          </Card>
        ) : null}

        {r.status === 'no_match' ? (
          <Card tone="warn">
            <Body>{t('request.noMatch')}</Body>
            <Button title={t('request.renew')} loading={busy} onPress={() => void act('/renew', { expiresInMinutes: 15 })} />
          </Card>
        ) : null}

        {r.status === 'expired' ? (
          <Card tone="warn">
            <Body>{t('request.expired')}</Body>
            <Button title={t('request.renew')} loading={busy} onPress={() => void act('/renew', { expiresInMinutes: 15 })} />
          </Card>
        ) : null}

        {r.status === 'partially_fulfilled' ? (
          <Card tone="warn">
            <Body>{t('request.partial', { remaining })}</Body>
            <Row gap={spacing.sm}>
              <Button
                title={t('request.continueSearch')}
                loading={busy}
                onPress={() => void act('/continue', { continueSearching: true })}
                style={{ flex: 1 }}
              />
              <Button
                title={t('request.closeRequest')}
                variant="secondary"
                loading={busy}
                onPress={() => void act('/continue', { continueSearching: false })}
                style={{ flex: 1 }}
              />
            </Row>
          </Card>
        ) : null}

        {r.status === 'fulfilled' ? (
          <Card tone="accent">
            <BodyBold>{t('request.fulfilled')}</BodyBold>
          </Card>
        ) : null}

        {r.status === 'cancelled' ? (
          <Card>
            <Muted>{t('match.cancelled')}</Muted>
          </Card>
        ) : null}

        {r.urgency === 'urgent' ? (
          <Card tone="danger">
            <BodyBold>{t('request.medicalTitle')}</BodyBold>
            <Body>{t('request.medicalBody')}</Body>
          </Card>
        ) : null}
        <Gap />
      </ScrollView>
    </>
  );
}
