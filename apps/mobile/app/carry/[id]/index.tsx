import React from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useT } from '../../../src/locale';
import { spacing, useTheme } from '../../../src/theme';
import { Body, Title } from '../../../src/components/ui';
import { GradientScreen, SwipeChoiceSheet, TopBar } from '../../../src/components/mock';
import { ArtFrame, BackpackArt } from '../../../src/components/mockArt';

/** Mockup 5 — "Can You Carry Something?". */
export default function CanYouCarry() {
  const t = useT();
  const th = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  return (
    <GradientScreen variant="carry">
      {/* Dark chrome: this screen is the one pale gradient in the set. */}
      <TopBar onBack={() => router.back()} tint={th.colors.text} />

      <View style={{ flex: 1, justifyContent: 'center', gap: spacing.xl }}>
        <ArtFrame>
          <BackpackArt size={190} />
        </ArtFrame>
        <View style={{ gap: spacing.sm, paddingHorizontal: spacing.xl }}>
          <Title center>{t('carry.dear')}</Title>
          <Title center>{t('carry.question')}</Title>
          <Body color={th.colors.textSecondary} style={{ textAlign: 'center' }}>
            {t('carry.body')}
          </Body>
        </View>
      </View>

      <View style={{ padding: spacing.lg }}>
        <SwipeChoiceSheet
          promptTop={t('carry.swipeTop')}
          promptBottom={t('carry.swipeBottom')}
          noLabel={t('carry.notToday')}
          yesLabel={t('carry.yesICan')}
          onNo={() => router.replace('/(tabs)/home')}
          onYes={() => router.replace(`/carry/${id}/items`)}
        />
      </View>
    </GradientScreen>
  );
}
