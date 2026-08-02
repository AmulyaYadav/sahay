import React from 'react';
import { ScrollView, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import type { Locale } from '@sahay/shared';
import { useCatalogue, useMatch } from '../../src/hooks';
import { useLocale, useT } from '../../src/locale';
import { spacing } from '../../src/theme';
import { Body, BodyBold, Title } from '../../src/components/ui';
import { GradientScreen, PrimaryCta } from '../../src/components/mock';
import { ArtFrame, Confetti, MatchAvatarsArt } from '../../src/components/mockArt';

/**
 * Mockup 9 — "Match Found (In-App)".
 *
 * A celebratory moment presented over a dark scrim, distinct from the working
 * match screen at /match/[id] that follows it. "Open chat" replaces this route
 * rather than pushing, so backing out of the conversation does not land the
 * person on a confetti screen for a match they have already seen.
 */
export default function MatchFound() {
  const t = useT();
  const router = useRouter();
  const { locale } = useLocale();
  const { id } = useLocalSearchParams<{ id: string }>();
  const match = useMatch(id);
  const catalogue = useCatalogue();

  const cat = (catalogue.data?.categories ?? []).find((c) => c.slug === match.data?.categorySlug);
  const name = cat?.name[locale as Locale] ?? cat?.name.en ?? '';
  const qty = match.data ? Math.round(Number(match.data.qtyReserved)) : null;
  const item = qty != null ? `${qty} ${name}`.trim() : name;

  return (
    <GradientScreen variant="matchScrim">
      {/* Scrolls when the artwork and copy do not fit, so "Open chat" is always
          reachable rather than centred off the bottom edge. */}
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          justifyContent: 'center',
          gap: spacing.xl,
          padding: spacing.lg,
        }}
      >
        <ArtFrame>
          <View style={{ position: 'absolute' }}>
            <Confetti size={300} />
          </View>
          <MatchAvatarsArt size={230} />
        </ArtFrame>

        <View style={{ gap: spacing.md }}>
          <Title center color="#FFFFFF">
            {t('matchFound.title')}
          </Title>
          {item ? (
            <Body color="#FFFFFFE6" style={{ textAlign: 'center' }}>
              {t('matchFound.matchedFor', { item })}
            </Body>
          ) : null}
          <Body color="#FFFFFFB3" style={{ textAlign: 'center' }}>
            {t('matchFound.body')}
          </Body>
        </View>

        <PrimaryCta title={t('matchFound.openChat')} onPress={() => router.replace(`/match/${id}`)} />
      </ScrollView>
    </GradientScreen>
  );
}
