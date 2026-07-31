import React, { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { AuthSession } from '@sahay/shared';
import { api, ApiRequestError, isOfflineError } from '../src/api';
import { useAuth } from '../src/auth';
import { useLocale, useT } from '../src/locale';
import { registerForPush } from '../src/push';
import { spacing, useTheme } from '../src/theme';
import { Body, Button, Card, Field, Gap, Muted, Title } from '../src/components/ui';

type Step = 'email' | 'code' | 'push';

export default function AuthScreen() {
  const t = useT();
  const th = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { locale } = useLocale();
  const { signIn, token } = useAuth();

  // 'register' or 'signin' — set by whichever button was tapped on the welcome
  // screen. Only the copy differs; see the comment there for why the mechanism
  // cannot. Anything unrecognised falls back to sign-in, the safer framing:
  // it does not promise a new account to someone who already has one.
  const params = useLocalSearchParams<{ mode?: string }>();
  const mode: 'register' | 'signin' = params.mode === 'register' ? 'register' : 'signin';

  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(0);
  const [pseudonym, setPseudonym] = useState<string | null>(null);
  // Whether verification actually created an account, which we only learn from
  // the server's response — so the closing message can be truthful even when it
  // contradicts the button the person tapped.
  const [wasNew, setWasNew] = useState(false);

  useEffect(() => {
    if (resendIn <= 0) return;
    const timer = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendIn]);

  const normalizedEmail = email.trim().toLowerCase();

  const startOtp = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ ok: boolean; retryAfterSeconds: number }>('/auth/otp/start', {
        method: 'POST',
        body: { email: normalizedEmail, locale },
      });
      setResendIn(res.retryAfterSeconds ?? 30);
      setStep('code');
    } catch (err) {
      setError(messageFor(err, t));
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    setBusy(true);
    setError(null);
    try {
      const session = await api<AuthSession>('/auth/otp/verify', {
        method: 'POST',
        body: {
          email: normalizedEmail,
          code,
          device: { platform: Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'web' },
        },
      });
      await signIn(session);
      setPseudonym(session.user.pseudonym);
      setWasNew(session.isNewAccount);
      setStep('push');
    } catch (err) {
      setError(messageFor(err, t));
    } finally {
      setBusy(false);
    }
  };

  const finish = () => router.replace('/(tabs)/home');

  const enablePush = async () => {
    setBusy(true);
    try {
      const current = token; // token set by signIn
      if (current) await registerForPush(current);
    } finally {
      setBusy(false);
      finish();
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={{
          padding: spacing.xl,
          paddingTop: insets.top + spacing.xxl,
          paddingBottom: insets.bottom + spacing.xl,
          gap: spacing.lg,
        }}
        keyboardShouldPersistTaps="handled"
      >
        <Title>{step === 'email' ? t(`auth.${mode === 'register' ? 'createAccountTitle' : 'signInTitle'}`) : t('common.appName')}</Title>

        {step === 'email' ? (
          <View style={{ gap: spacing.lg }}>
            <Body color={th.colors.muted}>
              {t(mode === 'register' ? 'auth.createAccountWhy' : 'auth.signInWhy')}
            </Body>
            <Body color={th.colors.muted}>{t('auth.emailWhy')}</Body>
            <Field
              label={t('auth.emailLabel')}
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoComplete="email"
              textContentType="emailAddress"
              autoCapitalize="none"
            />
            {error ? <Body color={th.colors.danger}>{error}</Body> : null}
            <Button
              title={t('auth.sendCode')}
              onPress={() => void startOtp()}
              loading={busy}
              disabled={!/^\S+@\S+\.\S+$/.test(normalizedEmail)}
            />
          </View>
        ) : null}

        {step === 'code' ? (
          <View style={{ gap: spacing.lg }}>
            <Field
              label={t('auth.codeLabel')}
              value={code}
              onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))}
              keyboardType="number-pad"
              autoComplete="one-time-code"
              textContentType="oneTimeCode"
            />
            {error ? <Body color={th.colors.danger}>{error}</Body> : null}
            <Button
              title={t('auth.verify')}
              onPress={() => void verify()}
              loading={busy}
              disabled={code.length !== 6}
            />
            <Button
              title={resendIn > 0 ? `${t('auth.resend')} (${resendIn})` : t('auth.resend')}
              variant="ghost"
              disabled={resendIn > 0}
              onPress={() => void startOtp()}
            />
            <Button title={t('common.back')} variant="ghost" onPress={() => setStep('email')} />
          </View>
        ) : null}

        {step === 'push' ? (
          <View style={{ gap: spacing.lg }}>
            {pseudonym ? (
              <Body>
                {t(
                  wasNew
                    ? mode === 'register'
                      ? 'auth.welcome'
                      : 'auth.accountCreated'
                    : 'auth.welcomeBack',
                  { pseudonym },
                )}
              </Body>
            ) : null}
            <Card>
              <Body>{t('notifications.match_offer')}</Body>
              <Muted>{t('notifications.vaguePreview')}</Muted>
              <Gap size={spacing.sm} />
              <Button
                title={t('common.ok')}
                onPress={() => void enablePush()}
                loading={busy}
                accessibilityLabel={t('notifications.title')}
              />
              <Button title={t('common.close')} variant="ghost" onPress={finish} />
            </Card>
          </View>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function messageFor(err: unknown, t: (k: string) => string): string {
  if (isOfflineError(err)) return t('common.offline');
  if (err instanceof ApiRequestError) {
    if (err.status === 429) return t('auth.tooManyAttempts');
    if (err.status === 400 || err.status === 401) return t('auth.invalidCode');
    return err.message || t('common.error');
  }
  return t('common.error');
}
