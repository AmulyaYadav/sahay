import React, { useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import type { RequestView } from '@sahay/shared';
import { api } from '../../src/api';
import { useAuth } from '../../src/auth';
import { qk, useCatalogue, useMatch, useRequest } from '../../src/hooks';
import { useLocale, useT } from '../../src/locale';
import { categoryBySlug, categoryGlyph, categoryName } from '../../src/catalogue';
import { minutesUntil } from '../../src/format';
import { spacing, useTheme } from '../../src/theme';
import { hasSeenMatchFound } from '../../src/matchFoundSeen';
import {
  Badge,
  Body,
  BodyBold,
  Button,
  Card,
  CategoryChip,
  ErrorView,
  Gap,
  LoadingView,
  Muted,
  MutedCaption,
  NeedPill,
  Row,
  Title,
} from '../../src/components/ui';
import { PeerSummary } from '../../src/components/PeerSummary';

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

  const matchedId =
    request.data?.status === 'matched' ? request.data.activeMatchId : null;
  const match = useMatch(matchedId ?? undefined);

  /*
    This screen polls while a request is searching, so it is where the
    requester is standing when a helper accepts. Send them to the match-found
    moment the first time — the same one the helper now sees — rather than
    swapping in a smaller version of it inline.

    Once per match, recorded on that screen: it replaces itself with the
    conversation, and backing out of the conversation returns here to a request
    that is still `matched`, which would otherwise bounce straight back.
  */
  const pushed = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!matchedId || pushed.current === matchedId) return;
    pushed.current = matchedId;
    void hasSeenMatchFound(matchedId).then((seen) => {
      if (!seen) router.push(`/match-found/${matchedId}`);
    });
  }, [matchedId, router]);

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
              ? t('match.found')
              : t('request.title'),
        }}
      />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}>
        {/* Match found moment (§4.10) */}
        {r.status === 'matched' && r.activeMatchId ? (
          /*
            Returning here after the match-found moment, so this is a way back
            into the exchange rather than a second celebration — same peer card,
            no confetti.
          */
          <View style={{ gap: spacing.md }}>
            <Title>{t('match.found')}</Title>
            {match.data ? <PeerSummary match={match.data} /> : null}
            <Button
              title={t('match.startChat')}
              onPress={() => router.push(`/match/${r.activeMatchId}`)}
            />
          </View>
        ) : (
          <Card>
            <Row gap={spacing.md}>
              <CategoryChip glyph={categoryGlyph(cat)} group={cat?.group} />
              <BodyBold style={{ flex: 1 }}>{categoryName(cat, locale)}</BodyBold>
              <Badge label={`${r.qty} ${t(`units.${r.unit}`)}`} tone="accent" />
            </Row>
            <Row gap={spacing.sm} style={{ flexWrap: 'wrap' }}>
              <NeedPill
                level={r.urgency === 'urgent' ? 'critical_shortage' : r.urgency === 'soon' ? 'moderate_need' : 'adequate'}
                label={
                  r.urgency === 'urgent'
                    ? t('request.urgent')
                    : r.urgency === 'soon'
                      ? t('request.soon')
                      : t('request.std')
                }
              />
              {r.qtyFulfilled > 0 ? <Badge label={`${r.qtyFulfilled}/${r.qty}`} tone="success" /> : null}
            </Row>
            {r.note ? <Muted>{r.note}</Muted> : null}
          </Card>
        )}

        {searching ? (
          <Card tone="accent">
            <Row gap={spacing.md}>
              <ActivityIndicator color={th.colors.primary} />
              <BodyBold style={{ flex: 1 }}>{t('request.searching')}</BodyBold>
            </Row>
            <Muted>{t('request.attempt', { count: r.attemptCount })}</Muted>
            <MutedCaption>
              {t('request.expiresIn')}: {t('misc.minutes', { count: minutesUntil(r.expiresAt) })}
            </MutedCaption>
            <Button
              title={t('request.cancelReq')}
              variant="dangerSoft"
              loading={busy}
              onPress={() => void act('/cancel')}
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
          <Card tone="success">
            <BodyBold color={th.colors.success}>{t('request.fulfilled')}</BodyBold>
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
