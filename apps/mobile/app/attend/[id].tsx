import React from 'react';
import { Alert, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { api } from '../../src/api';
import { useAuth } from '../../src/auth';
import { useEvent } from '../../src/hooks';
import { useLocale, useT } from '../../src/locale';
import { lineHeightFor, spacing } from '../../src/theme';
import { Body, BodyBold, Title } from '../../src/components/ui';
import { GradientScreen, SwipeChoiceSheet, TopBar } from '../../src/components/mock';
import { ArtFrame, CalendarArt, Confetti } from '../../src/components/mockArt';
import { formatDateTime } from '../../src/format';
import { markAttendanceAnswered, relevantOccurrence } from '../../src/attendancePrompt';
import { forgetJoinedEvent } from '../../src/storage';

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
  // Which day this prompt is about — not necessarily the event's original start.
  const occurrence = event.data
    ? relevantOccurrence(event.data.startsAt, event.data.endsAt)
    : null;

  const next = async () => {
    await markAttendanceAnswered(id);
    await api(`/events/${id}/attendance`, { method: 'POST', token, body: { attending: true } }).catch(
      () => {},
    );
    router.replace(`/warrior/${id}`);
  };
  const home = () => router.replace('/(tabs)/home');

  /**
   * Declining is answered server-side, because whether it also ends the
   * membership depends on the event: on a day with a successor it is just a
   * decline and tomorrow's reminder still fires; on the last day there is no
   * later day to ask about, so the server removes the person and says so.
   */
  const notComing = async () => {
    await markAttendanceAnswered(id);
    try {
      const res = await api<{ leftEvent: boolean }>(`/events/${id}/attendance`, {
        method: 'POST',
        token,
        body: { attending: false },
      });
      if (res.leftEvent) {
        await forgetJoinedEvent(id);
        Alert.alert(t('attend.removedTitle'), t('attend.removedBody'));
      }
    } catch {
      // Never trap someone on this screen because the answer failed to send.
    } finally {
      home();
    }
  };

  return (
    <GradientScreen variant="night">
      <TopBar
        onBack={() => router.back()}
        onSkip={() => {
          // Skipping is an answer too: do not re-ask on every app open today.
          void markAttendanceAnswered(id);
          home();
        }}
        skipLabel={t('attend.skip')}
      />

      <View style={{ flex: 1, justifyContent: 'center', gap: spacing.xl }}>
        <ArtFrame>
          <View style={{ position: 'absolute' }}>
            <Confetti size={300} />
          </View>
          <CalendarArt size={168} />
        </ArtFrame>

        <View style={{ gap: spacing.sm, paddingHorizontal: spacing.xl }}>
          <Title center color="#FFFFFF">
            {t(occurrence?.isToday ? 'attend.today' : 'attend.tomorrow')}
          </Title>
          <BodyBold color="#FFFFFF" style={{ textAlign: 'center', fontSize: 17, lineHeight: lineHeightFor(17) }}>
            {event.data?.title ?? ''}
          </BodyBold>
          {occurrence ? (
            <Body color="#FFFFFFB3" style={{ textAlign: 'center' }}>
              {formatDateTime(occurrence.when.toISOString(), locale)}
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
          onYes={() => void next()}
        />
      </View>
    </GradientScreen>
  );
}
