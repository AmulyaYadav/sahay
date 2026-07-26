import React, { useEffect, useState } from 'react';
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
  Badge,
  Body,
  BodyBold,
  Button,
  Card,
  Gap,
  Heading,
  LoadingView,
  Muted,
  MutedCaption,
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
  const [busy, setBusy] = useState<'accept' | 'decline' | 'declineStop' | null>(null);
  const [expired, setExpired] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Live countdown.
  useEffect(() => {
    if (!offer) return;
    const tick = () => {
      const s = secondsUntil(offer.respondBy);
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
        router.replace(`/match/${res.match.id}`);
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

  return (
    <ScrollView
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

      <Card tone="accent">
        <Heading center>
          {categoryGlyph(cat)} {catLabel}
        </Heading>
        <Body center>
          {t('offer.needs', {
            qty: offer.qtyRequested,
            unit: t(`units.${offer.unit}`),
            category: catLabel,
          })}
        </Body>
        <Body center color={th.colors.muted}>
          {t('offer.youHave', { qty: offer.qtyYouHave, unit: t(`units.${offer.unit}`) })}
        </Body>
        <Row style={{ justifyContent: 'center', flexWrap: 'wrap' }} gap={spacing.sm}>
          <Badge label={t(`proximity.${offer.proximity}`)} tone="accent" />
          <Badge
            label={
              offer.urgency === 'urgent'
                ? t('request.urgent')
                : offer.urgency === 'soon'
                  ? t('request.soon')
                  : t('request.std')
            }
            tone={offer.urgency === 'urgent' ? 'danger' : 'default'}
          />
        </Row>
        {offer.note ? <Muted center>“{offer.note}”</Muted> : null}
      </Card>

      {secondsLeft !== null ? (
        <BodyBold
          center
          color={secondsLeft <= 10 ? th.colors.danger : th.colors.text}
          accessibilityLabel={t('offer.respondIn', { seconds: secondsLeft })}
        >
          {t('offer.respondIn', { seconds: secondsLeft })}
        </BodyBold>
      ) : null}

      {error ? <Body center color={th.colors.danger}>{error}</Body> : null}

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
