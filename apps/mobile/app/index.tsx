import React from 'react';
import { ScrollView, View } from 'react-native';
import { Redirect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../src/auth';
import { Body, BodyBold, Button, IconSquare, LoadingView, Row, Title } from '../src/components/ui';
import { LanguageToggle } from '../src/components/LanguageToggle';
import { ParcelHandsVignette } from '../src/components/vignettes';
import { useT } from '../src/locale';
import { spacing, useTheme } from '../src/theme';

/**
 * The app's landing screen: what Sahay is, the pseudonymity promise, and honest
 * limits, with the two ways in.
 *
 * This is deliberately NOT an onboarding gate. A persisted "onboarded" flag used
 * to show this screen exactly once and send every later visit straight to /auth,
 * so a returning signed-out person was dropped into a bare form with no context
 * and no choice of what they were doing. The rule is now simply: signed in → the
 * app, signed out → here. Both buttons `push`, so the back gesture returns here
 * instead of trapping someone inside the auth flow.
 */
export default function Landing() {
  const t = useT();
  const th = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { token, ready } = useAuth();

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

  // Both buttons reach the same OTP screen, which adapts its copy to `mode`.
  // The mechanism cannot differ: the server deliberately never reveals whether
  // an email already has an account, so we cannot branch on that before sending
  // a code. What differs is what we tell the person, before and after.
  const go = (mode: 'register' | 'signin') => router.push(`/auth?mode=${mode}`);

  if (!ready) return <LoadingView />;
  if (token) return <Redirect href="/(tabs)/home" />;

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
      {/* Language lives here as well as in the app chrome: someone who only
          reads Hindi needs it before any account exists. */}
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
        <Button title={t('onboarding.createAccount')} onPress={() => go('register')} />
        <Button title={t('nav.signIn')} variant="ghost" onPress={() => go('signin')} />
      </View>
    </ScrollView>
  );
}
