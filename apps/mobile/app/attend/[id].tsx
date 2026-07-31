import React from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { api } from '../../src/api';
import { useAuth } from '../../src/auth';
import { useEvent } from '../../src/hooks';
import { useLocale, useT } from '../../src/locale';
import { spacing } from '../../src/theme';
import { Body, BodyBold, Title } from '../../src/components/ui';
import { GradientScreen, SwipeChoiceSheet, TopBar } from '../../src/components/mock';
import { ArtFrame, CalendarArt, Confetti } from '../../src/components/mockArt';
import { formatDateTime } from '../../src/format';

/**
 * Mockup 2 — "Confirm Attendance (Day Before)".
 *
 * "No" leaves the event, which is the honest meaning of saying you are not
 * coming: it turns availability off and stops the organiser counting on you.
 * "Skip" answers nothing and just moves on.
 */
export default function ConfirmAttendance() {
  const t = useT();
  const router = useRouter();
  const { locale } = useLocale();
  const { token } = useAuth();
  const { id } = useLocalSearchParams<{ id: string }>();
  const event = useEvent(id);

  const next = () => router.replace(`/warrior/${id}`);
  const home = () => router.replace('/(tabs)/home');

  const notComing = async () => {
    try {
      await api(`/events/${id}/leave`, { method: 'POST', token, body: {} });
    } finally {
      home();
    }
  };

  return (
    <GradientScreen variant="night">
      <TopBar onBack={() => router.back()} onSkip={home} skipLabel={t('attend.skip')} />

      <View style={{ flex: 1, justifyContent: 'center', gap: spacing.xl }}>
        <ArtFrame>
          <View style={{ position: 'absolute' }}>
            <Confetti size={300} />
          </View>
          <CalendarArt size={168} />
        </ArtFrame>

        <View style={{ gap: spacing.sm, paddingHorizontal: spacing.xl }}>
          <Title center color="#FFFFFF">
            {t('attend.tomorrow')}
          </Title>
          <BodyBold color="#FFFFFF" style={{ textAlign: 'center', fontSize: 17, lineHeight: 24 }}>
            {event.data?.title ?? ''}
          </BodyBold>
          {event.data ? (
            <Body color="#FFFFFFB3" style={{ textAlign: 'center' }}>
              {formatDateTime(event.data.startsAt, locale)}
            </Body>
          ) : null}
        </View>
      </View>

      <View style={{ padding: spacing.lg }}>
        <SwipeChoiceSheet
          promptTop={t('attend.swipeTop')}
          promptBottom={t('attend.swipeBottom')}
          noLabel={t('attend.no')}
          yesLabel={t('attend.yes')}
          onNo={() => void notComing()}
          onYes={next}
        />
      </View>
    </GradientScreen>
  );
}
