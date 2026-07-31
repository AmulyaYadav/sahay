import React from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { api } from '../../src/api';
import { useAuth } from '../../src/auth';
import { useT } from '../../src/locale';
import { spacing } from '../../src/theme';
import { GradientHeading, GradientScreen, SwipeChoiceSheet, TopBar } from '../../src/components/mock';
import { ArtFrame, ShieldHeartArt } from '../../src/components/mockArt';

/**
 * Mockup 3 — "Be a Sahay Warrior?".
 *
 * Saying yes is what actually makes someone available to receive requests, so it
 * turns event availability on rather than only recording a sentiment.
 */
export default function BeAWarrior() {
  const t = useT();
  const router = useRouter();
  const { token } = useAuth();
  const { id } = useLocalSearchParams<{ id: string }>();

  const home = () => router.replace('/(tabs)/home');

  const optIn = async () => {
    try {
      await api(`/events/${id}/availability`, { method: 'PUT', token, body: { isOn: true } });
    } catch {
      // Availability can be turned on later from the home screen's toggle; a
      // failure here must not strand someone mid-flow.
    }
    router.replace(`/needs/${id}`);
  };

  return (
    <GradientScreen variant="warrior">
      <TopBar onBack={() => router.back()} onSkip={home} skipLabel={t('attend.skip')} />

      <View style={{ flex: 1, justifyContent: 'center', gap: spacing.xl }}>
        <ArtFrame>
          <ShieldHeartArt size={188} />
        </ArtFrame>
        <GradientHeading title={t('warrior.title')} body={t('warrior.body')} />
      </View>

      <View style={{ padding: spacing.lg }}>
        <SwipeChoiceSheet
          promptTop={t('warrior.swipeTop')}
          promptBottom={t('warrior.swipeBottom')}
          noLabel={t('warrior.notNow')}
          yesLabel={t('warrior.imIn')}
          onNo={home}
          onYes={() => void optIn()}
        />
      </View>
    </GradientScreen>
  );
}
