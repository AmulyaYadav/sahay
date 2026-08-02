import React, { useEffect, useRef, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import type { Locale } from '@sahay/shared';
import { useCatalogue, useMatch } from '../../src/hooks';
import { useLocale, useT } from '../../src/locale';
import { spacing } from '../../src/theme';
import { Body, BodyBold, LoadingView, Title } from '../../src/components/ui';
import { GradientScreen, PrimaryCta } from '../../src/components/mock';
import { ArtFrame, Confetti, MatchAvatarsArt } from '../../src/components/mockArt';
import { PeerSummary } from '../../src/components/PeerSummary';
import { markMatchFoundSeen } from '../../src/matchFoundSeen';

/**
 * Mockup 9 — "Match Found (In-App)".
 *
 * Shown to both people, not just the requester. The helper used to be dropped
 * straight into the conversation the instant they accepted, so the two sides
 * saw different things and the helper never learned who they had been matched
 * with before having to speak to them.
 *
 * It advances on its own after a few seconds. The moment is a handover, not a
 * decision, and leaving someone parked on confetti with an unread message
 * waiting helps nobody — but neither should the details flash past, hence the
 * visible countdown and the button that skips it.
 */
const AUTO_OPEN_SECONDS = 5;

export default function MatchFound() {
  const t = useT();
  const router = useRouter();
  const { locale } = useLocale();
  const { id } = useLocalSearchParams<{ id: string }>();
  const match = useMatch(id);
  const catalogue = useCatalogue();

  const [remaining, setRemaining] = useState(AUTO_OPEN_SECONDS);
  // Guards against the timer and a tap both navigating.
  const left = useRef(false);

  const openChat = React.useCallback(() => {
    if (left.current) return;
    left.current = true;
    void markMatchFoundSeen(id);
    // `replace`, so backing out of the conversation does not land on a
    // celebration for a match already seen.
    router.replace(`/match/${id}`);
  }, [id, router]);

  /*
    The countdown starts once there is something to read, not on mount. On a
    slow connection the match query can take a couple of seconds, and starting
    earlier would spend the whole window on a spinner and then move on.
  */
  const ready = !!match.data;
  useEffect(() => {
    if (!ready) return;
    const tick = setInterval(() => setRemaining((n) => n - 1), 1000);
    return () => clearInterval(tick);
  }, [ready]);

  useEffect(() => {
    if (ready && remaining <= 0) openChat();
  }, [ready, remaining, openChat]);

  if (match.isLoading) return <LoadingView />;

  const m = match.data;
  const cat = (catalogue.data?.categories ?? []).find((c) => c.slug === m?.categorySlug);
  const name = cat?.name[locale as Locale] ?? cat?.name.en ?? '';
  const qty = m ? Math.round(Number(m.qtyReserved)) : null;
  const item = qty != null ? `${qty} ${name}`.trim() : name;

  return (
    <GradientScreen variant="matchScrim">
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          justifyContent: 'center',
          gap: spacing.lg,
          padding: spacing.lg,
        }}
      >
        <ArtFrame>
          <View style={{ position: 'absolute' }}>
            <Confetti size={300} />
          </View>
          <MatchAvatarsArt size={230} />
        </ArtFrame>

        <View style={{ gap: spacing.sm }}>
          <Title center color="#FFFFFF">
            {t('matchFound.title')}
          </Title>
          {item ? (
            // The item is the one fact worth bolding — it is what the other
            // person is expecting to hand over or receive.
            <Body color="#FFFFFFE6" style={{ textAlign: 'center' }}>
              {t('matchFound.matchedForPrefix')} <BodyBold color="#FFFFFF">{item}</BodyBold>
            </Body>
          ) : null}
          <Body color="#FFFFFFB3" style={{ textAlign: 'center' }}>
            {t('matchFound.body')}
          </Body>
        </View>

        {m ? <PeerSummary match={m} onDark /> : null}

        <View style={{ gap: spacing.xs }}>
          <PrimaryCta title={t('matchFound.openChat')} onPress={openChat} />
          <Body color="#FFFFFF8C" style={{ textAlign: 'center' }}>
            {t('matchFound.openingIn', { count: Math.max(0, remaining) })}
          </Body>
        </View>
      </ScrollView>
    </GradientScreen>
  );
}
