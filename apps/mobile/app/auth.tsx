import React, { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { AuthSession } from '@sahay/shared';
import { api, ApiRequestError, isOfflineError } from '../src/api';
import { useAuth } from '../src/auth';
import { useLocale, useT } from '../src/locale';
import { spacing, useTheme } from '../src/theme';
import { Body, Button, Field, Title } from '../src/components/ui';
import { LanguageToggle } from '../src/components/LanguageToggle';

/**
 * Attendee authentication.
 *
 * Creating an account is the ONLY flow that emails a code: it proves the address
 * once, then the person picks a username and password. Signing in afterwards is
 * username + password with no code — an attendee at a protest on congested mobile
 * data should not need an email round-trip to get back into their own app.
 *
 * Recovery goes through email because the address is the only thing we can prove:
 * "forgot username" mails it back, "forgot password" sends a code and accepts a
 * new password in the same request (so it works for someone who cannot sign in).
 */
type Mode = 'register' | 'signin';
type Step =
  | 'email' // register: where to send the code
  | 'code' // register: enter it
  | 'credentials' // register: choose username + password
  | 'login' // signin: username + password
  | 'forgotUsername'
  | 'forgotUsernameSent'
  | 'resetEmail'
  | 'resetCode';

const device = () => ({
  platform: (Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'web') as
    | 'ios'
    | 'android'
    | 'web',
});

export default function AuthScreen() {
  const t = useT();
  const th = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { locale } = useLocale();
  const { signIn } = useAuth();

  const params = useLocalSearchParams<{ mode?: string }>();
  const mode: Mode = params.mode === 'register' ? 'register' : 'signin';

  const [step, setStep] = useState<Step>(mode === 'register' ? 'email' : 'login');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(0);
  // api() takes the bearer token explicitly, and the value from useAuth() is not
  // updated synchronously by signIn(), so the token from verification is held
  // here for the credentials call that immediately follows it.
  const [freshToken, setFreshToken] = useState<string | null>(null);

  useEffect(() => {
    if (resendIn <= 0) return;
    const timer = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendIn]);

  const normalizedEmail = email.trim().toLowerCase();
  const emailValid = /^\S+@\S+\.\S+$/.test(normalizedEmail);
  const home = () => router.replace('/(tabs)/home');

  const run = (fn: () => Promise<void>) => async () => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(messageFor(err, t));
    } finally {
      setBusy(false);
    }
  };

  const sendCode = (next: 'code' | 'resetCode') =>
    run(async () => {
      const res = await api<{ ok: boolean; retryAfterSeconds: number }>('/auth/otp/start', {
        method: 'POST',
        body: { email: normalizedEmail, locale },
      });
      setResendIn(res.retryAfterSeconds ?? 30);
      setStep(next);
    })();

  const verifyCode = run(async () => {
    const session = await api<AuthSession>('/auth/otp/verify', {
      method: 'POST',
      body: { email: normalizedEmail, code, device: device() },
    });
    await signIn(session);
    setFreshToken(session.token);
    // The account exists now but cannot be signed into until it has a username
    // and password, so this step is not skippable.
    setStep('credentials');
  });

  const saveCredentials = run(async () => {
    await api<{ ok: boolean }>('/auth/credentials', {
      method: 'POST',
      token: freshToken ?? undefined,
      body: { username: username.trim().toLowerCase(), password },
    });
    home();
  });

  const login = run(async () => {
    const session = await api<AuthSession>('/auth/login', {
      method: 'POST',
      body: { username: username.trim().toLowerCase(), password, device: device() },
    });
    await signIn(session);
    home();
  });

  const forgotUsername = run(async () => {
    await api<{ ok: boolean }>('/auth/forgot-username', {
      method: 'POST',
      body: { email: normalizedEmail, locale },
    });
    setStep('forgotUsernameSent');
  });

  const resetPassword = run(async () => {
    await api<{ ok: boolean }>('/auth/password/reset', {
      method: 'POST',
      body: { email: normalizedEmail, code, newPassword: password },
    });
    setNotice(t('auth.resetPasswordDone'));
    setCode('');
    setPassword('');
    setStep('login');
  });

  const back = () => (router.canGoBack() ? router.back() : router.replace('/'));
  const goStep = (next: Step) => () => {
    setError(null);
    setNotice(null);
    setStep(next);
  };

  const title = () => {
    if (step === 'email' || step === 'code' || step === 'credentials') return t('auth.createAccountTitle');
    if (step === 'forgotUsername' || step === 'forgotUsernameSent') return t('auth.forgotUsername');
    if (step === 'resetEmail' || step === 'resetCode') return t('auth.resetPasswordTitle');
    return t('auth.signInTitle');
  };

  const err = error ? <Body color={th.colors.danger}>{error}</Body> : null;

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        contentContainerStyle={{
          padding: spacing.xl,
          paddingTop: insets.top + spacing.lg,
          paddingBottom: insets.bottom + spacing.xl,
          gap: spacing.lg,
        }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ alignItems: 'flex-end' }}>
          <LanguageToggle />
        </View>
        <Title>{title()}</Title>
        {notice ? <Body color={th.colors.success}>{notice}</Body> : null}

        {step === 'email' ? (
          <View style={{ gap: spacing.lg }}>
            <Body color={th.colors.muted}>{t('auth.createAccountWhy')}</Body>
            <Body color={th.colors.muted}>{t('auth.emailWhy')}</Body>
            <Field
              label={t('auth.emailLabel')}
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoComplete="email"
              autoCapitalize="none"
            />
            {err}
            <Button title={t('auth.sendCode')} onPress={() => void sendCode('code')} loading={busy} disabled={!emailValid} />
            <Button title={t('common.back')} variant="ghost" onPress={back} />
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
            />
            {err}
            <Button title={t('auth.verify')} onPress={() => void verifyCode()} loading={busy} disabled={code.length !== 6} />
            <Button
              title={resendIn > 0 ? `${t('auth.resend')} (${resendIn})` : t('auth.resend')}
              variant="ghost"
              disabled={resendIn > 0}
              onPress={() => void sendCode('code')}
            />
            <Button title={t('common.back')} variant="ghost" onPress={goStep('email')} />
          </View>
        ) : null}

        {step === 'credentials' ? (
          <View style={{ gap: spacing.lg }}>
            <Field
              label={t('auth.chooseUsername')}
              hint={t('auth.chooseUsernameHint')}
              value={username}
              onChangeText={(v) => setUsername(v.replace(/[^a-zA-Z0-9._-]/g, '').toLowerCase())}
              autoCapitalize="none"
            />
            <Field
              label={t('auth.choosePassword')}
              hint={t('auth.choosePasswordHint')}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
            />
            {err}
            <Button
              title={t('auth.finishSetup')}
              onPress={() => void saveCredentials()}
              loading={busy}
              disabled={username.trim().length < 3 || password.length < 8}
            />
          </View>
        ) : null}

        {step === 'login' ? (
          <View style={{ gap: spacing.lg }}>
            <Field
              label={t('auth.usernameLabelLogin')}
              value={username}
              onChangeText={setUsername}
              autoCapitalize="none"
              autoComplete="username"
            />
            <Field
              label={t('auth.passwordLabel')}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoComplete="password"
            />
            {err}
            <Button
              title={t('auth.signIn')}
              onPress={() => void login()}
              loading={busy}
              disabled={!username.trim() || !password}
            />
            <Button title={t('auth.forgotUsername')} variant="ghost" onPress={goStep('forgotUsername')} />
            <Button title={t('auth.forgotPassword')} variant="ghost" onPress={goStep('resetEmail')} />
            <Button title={t('common.back')} variant="ghost" onPress={back} />
          </View>
        ) : null}

        {step === 'forgotUsername' ? (
          <View style={{ gap: spacing.lg }}>
            <Field
              label={t('auth.emailLabel')}
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoComplete="email"
              autoCapitalize="none"
            />
            {err}
            <Button title={t('auth.sendEmail')} onPress={() => void forgotUsername()} loading={busy} disabled={!emailValid} />
            <Button title={t('common.back')} variant="ghost" onPress={goStep('login')} />
          </View>
        ) : null}

        {step === 'forgotUsernameSent' ? (
          <View style={{ gap: spacing.lg }}>
            {/* Deliberately "if that address has an account": the server answers
                identically whether or not it does, and so must this screen. */}
            <Body>{t('auth.usernameSentBody')}</Body>
            <Button title={t('auth.signIn')} onPress={goStep('login')} />
          </View>
        ) : null}

        {step === 'resetEmail' ? (
          <View style={{ gap: spacing.lg }}>
            <Body color={th.colors.muted}>{t('auth.resetPasswordBody')}</Body>
            <Field
              label={t('auth.emailLabel')}
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoComplete="email"
              autoCapitalize="none"
            />
            {err}
            <Button title={t('auth.sendCode')} onPress={() => void sendCode('resetCode')} loading={busy} disabled={!emailValid} />
            <Button title={t('common.back')} variant="ghost" onPress={goStep('login')} />
          </View>
        ) : null}

        {step === 'resetCode' ? (
          <View style={{ gap: spacing.lg }}>
            <Field
              label={t('auth.codeLabel')}
              value={code}
              onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))}
              keyboardType="number-pad"
              autoComplete="one-time-code"
            />
            <Field
              label={t('auth.newPasswordLabelReset')}
              hint={t('auth.choosePasswordHint')}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
            />
            {err}
            <Button
              title={t('auth.resetPasswordCta')}
              onPress={() => void resetPassword()}
              loading={busy}
              disabled={code.length !== 6 || password.length < 8}
            />
            <Button title={t('common.back')} variant="ghost" onPress={goStep('resetEmail')} />
          </View>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function messageFor(err: unknown, t: (k: string) => string): string {
  if (isOfflineError(err)) return t('common.offline');
  if (err instanceof ApiRequestError) {
    // A username collision is the one conflict this screen can produce.
    if (err.code === 'request_conflict') return t('auth.usernameTaken');
    if (err.status === 429) return t('auth.tooManyAttempts');
    if (err.code === 'account_restricted') return t('auth.accountRestricted');
    if (err.status === 400 || err.status === 401) return t('auth.invalidCode');
    return err.message || t('common.error');
  }
  return t('common.error');
}
