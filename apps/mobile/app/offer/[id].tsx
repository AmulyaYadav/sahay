import React, { useEffect, useRef, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { MatchView, OfferView } from '@sahay/shared';
import { api, ApiRequestError } from '../../src/api';
import { useAuth } from '../../src/auth';
import { qk, useCatalogue, usePendingOffers } from '../../src/hooks';
import { useLocale, useT } from '../../src/locale';
import { categoryBySlug, categoryGlyph, categoryName } from '../../src/catalogue';
import { secondsUntil } from '../../src/format';
import { spacing, useTheme } from '../../src/theme';
import {
  Body,
  Button,
  Card,
  CategoryChip,
  CountdownCard,
  Gap,
  Heading,
  LoadingView,
  Muted,
  MutedCaption,
  NeedPill,
  Row,
  Title,
} from '../../src/components/ui';

/**
 * Full-screen offer modal: the moment someone nearby needs an item you carry.
 * Server state is authoritative — the countdown is honest and expiry is final.
 */
export default function OfferScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useT();
  const th = useTheme();
  const router = useRouter();
  const qc = useQueryClient();
  const insets = useSafeAreaInsets();
  const { locale } = useLocale();
  const { token } = useAuth();

  const offers = usePendingOffers();
  const catalogue = useCatalogue();
  const offer: OfferView | undefined = offers.data?.items.find((o) => o.id === id);

  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const totalSeconds = useRef<number | null>(null);
  const [busy, setBusy] = useState<'accept' | 'decline' | 'declineStop' | null>(null);
  const [expired, setExpired] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Live countdown.
  useEffect(() => {
    if (!offer) return;
    const tick = () => {
      const s = secondsUntil(offer.respondBy);
      if (totalSeconds.current === null) totalSeconds.current = Math.max(1, s);
      setSecondsLeft(s);
      if (s <= 0) setExpired(true);
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [offer]);

  const close = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/home');
  };

  const respond = async (accept: boolean, alsoStopReceiving = false) => {
    if (!offer || !token) return;
    setBusy(accept ? 'accept' : alsoStopReceiving ? 'declineStop' : 'decline');
    setError(null);
    try {
      const res = await api<{ offer: OfferView; match?: MatchView }>(
        `/offers/${offer.id}/respond`,
        { method: 'POST', token, body: { accept, alsoStopReceiving } },
      );
      void qc.invalidateQueries({ queryKey: qk.pendingOffers });
      void qc.invalidateQueries({ queryKey: qk.activeMatches });
      if (alsoStopReceiving) void qc.invalidateQueries({ queryKey: ['availability'] });
      if (accept && res.match) {
        // Via the match-found moment, not straight into the conversation. The
        // helper accepted an offer that named a category and a quantity; this
        // is where they find out who they are about to meet.
        router.replace(`/match-found/${res.match.id}`);
      } else {
        close();
      }
    } catch (err) {
      if (err instanceof ApiRequestError && (err.status === 410 || err.code === 'offer_expired')) {
        setExpired(true);
        void qc.invalidateQueries({ queryKey: qk.pendingOffers });
      } else {
        setError((err as Error).message || t('common.error'));
      }
    } finally {
      setBusy(null);
    }
  };

  if (offers.isLoading && !offer) return <LoadingView />;

  // Unknown or already-gone offer → honest expiry state.
  if (!offer || expired || offer.status !== 'offered') {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: th.colors.canvas,
          padding: spacing.xl,
          paddingTop: insets.top + spacing.xxl,
          justifyContent: 'center',
          gap: spacing.lg,
        }}
      >
        <Heading center>{t('offer.tooLate')}</Heading>
        <Muted center>{t('offer.declineNote')}</Muted>
        <Button title={t('common.close')} onPress={close} />
      </View>
    );
  }

  const cat = categoryBySlug(catalogue.data?.categories, offer.categorySlug);
  const catLabel = categoryName(cat, locale);
  const mins = secondsLeft !== null ? Math.floor(secondsLeft / 60) : 0;
  const secs = secondsLeft !== null ? secondsLeft % 60 : 0;
  const timeLabel = `${mins}:${String(secs).padStart(2, '0')}`;

  return (
    <ScrollView
      style={{ backgroundColor: th.colors.canvas }}
      contentContainerStyle={{
        flexGrow: 1,
        padding: spacing.xl,
        paddingTop: insets.top + spacing.xl,
        paddingBottom: insets.bottom + spacing.xl,
        gap: spacing.lg,
        justifyContent: 'center',
      }}
    >
      <Title center>{t('offer.title')}</Title>

      <Card>
        <View style={{ alignItems: 'center', gap: spacing.sm }}>
          <CategoryChip glyph={categoryGlyph(cat)} group={cat?.group} size={44} />
          <Heading center>{catLabel}</Heading>
        </View>
        <Body center>
          {t('offer.needs', {
            qty: offer.qtyRequested,
            unit: t(`units.${offer.unit}`),
            category: catLabel,
          })}
        </Body>
        <Body center color={th.colors.textSecondary}>
          {t('offer.youHave', { qty: offer.qtyYouHave, unit: t(`units.${offer.unit}`) })}
        </Body>
        <Row style={{ justifyContent: 'center', flexWrap: 'wrap' }} gap={spacing.sm}>
          <NeedPill level="possible_surplus" label={t(`proximity.${offer.proximity}`)} />
          <NeedPill
            level={
              offer.urgency === 'urgent'
                ? 'critical_shortage'
                : offer.urgency === 'soon'
                  ? 'moderate_need'
                  : 'unknown'
            }
            label={
              offer.urgency === 'urgent'
                ? t('request.urgent')
                : offer.urgency === 'soon'
                  ? t('request.soon')
                  : t('request.std')
            }
          />
        </Row>
        {offer.note ? <Muted center>“{offer.note}”</Muted> : null}
      </Card>

      {/* Countdown card (§4.10) */}
      {secondsLeft !== null ? (
        <CountdownCard
          caption={t('offer.respondWithin')}
          timeLabel={timeLabel}
          progress={totalSeconds.current ? secondsLeft / totalSeconds.current : 0}
          urgent={secondsLeft <= 10}
          accessibilityLabel={t('offer.respondIn', { seconds: secondsLeft })}
        />
      ) : null}

      {error ? <Body center color={th.colors.error}>{error}</Body> : null}

      <View style={{ gap: spacing.md }}>
        <Button
          title={t('offer.accept')}
          variant="success"
          loading={busy === 'accept'}
          disabled={busy !== null}
          onPress={() => void respond(true)}
        />
        <Button
          title={t('offer.decline')}
          variant="secondary"
          loading={busy === 'decline'}
          disabled={busy !== null}
          onPress={() => void respond(false)}
        />
        <Button
          title={t('offer.declineAndPause')}
          variant="ghost"
          loading={busy === 'declineStop'}
          disabled={busy !== null}
          onPress={() => void respond(false, true)}
        />
      </View>

      <MutedCaption center>{t('offer.declineNote')}</MutedCaption>
      <Gap size={spacing.sm} />
    </ScrollView>
  );
}
