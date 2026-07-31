import React from 'react';
import { ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Body, BodyBold, Button, IconSquare, Row, Title } from '../../src/components/ui';
import { LanguageToggle } from '../../src/components/LanguageToggle';
import { ParcelHandsVignette } from '../../src/components/vignettes';
import { useT } from '../../src/locale';
import { spacing, useTheme } from '../../src/theme';
import { K } from '../../src/storage';

/**
 * Welcome screen: what Sahay is, the pseudonymity promise, and honest limits —
 * three value-prop rows under a flat vignette (Warm Relief frame 01).
 */
export default function OnboardingIntro() {
  const t = useT();
  const th = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const props: { icon: 'hand-heart' | 'eye-off' | 'shield'; bg: string; fg: string; title: string; body: string }[] = [
    {
      icon: 'hand-heart',
      bg: th.colors.primaryTint,
      fg: th.colors.primary,
      title: t('onboarding.intro1Title'),
      body: t('onboarding.intro1'),
    },
    {
      icon: 'eye-off',
      bg: th.colors.successTint,
      fg: th.colors.success,
      title: t('common.tagline'),
      body: t('onboarding.intro2'),
    },
    {
      icon: 'shield',
      bg: th.colors.warningTint,
      fg: th.colors.warning,
      title: t('onboarding.safetyTitle'),
      body: t('onboarding.intro3'),
    },
  ];

  // Both buttons lead to the same OTP screen, which adapts its copy to `mode`.
  // The mechanism cannot differ: the server deliberately never reveals whether
  // an email already has an account, so we cannot branch on that before sending
  // a code. What differs is what we tell the person, before and after.
  const go = async (mode: 'register' | 'signin') => {
    await AsyncStorage.setItem(K.onboarded, '1').catch(() => {});
    router.replace({ pathname: '/auth', params: { mode } });
  };

  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{
        flexGrow: 1,
        padding: spacing.xl,
        paddingTop: insets.top + spacing.xl,
        paddingBottom: insets.bottom + spacing.xl,
        justifyContent: 'space-between',
        gap: spacing.lg,
      }}
    >
      {/* Language is reachable here and from the app chrome, rather than being a
          forced step during sign-up — someone who only reads Hindi needs it on
          this screen, before any account exists. */}
      <Row style={{ justifyContent: 'flex-end' }}>
        <LanguageToggle />
      </Row>

      <View style={{ gap: spacing.xl, flex: 1, justifyContent: 'center' }}>
        <ParcelHandsVignette />
        <Title center>{t('common.appName')}</Title>
        <View style={{ gap: spacing.lg }}>
          {props.map((p) => (
            <Row key={p.icon} gap={spacing.md} style={{ alignItems: 'flex-start' }}>
              <IconSquare name={p.icon} bg={p.bg} color={p.fg} />
              <View style={{ flex: 1, gap: 2 }}>
                <BodyBold>{p.title}</BodyBold>
                <Body color={th.colors.textSecondary}>{p.body}</Body>
              </View>
            </Row>
          ))}
        </View>
      </View>

      <View style={{ gap: spacing.sm }}>
        <Button title={t('onboarding.createAccount')} onPress={() => void go('register')} />
        <Button title={t('nav.signIn')} variant="ghost" onPress={() => void go('signin')} />
      </View>
    </ScrollView>
  );
}
