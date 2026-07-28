/** Email OTP flow: email → 6-digit code → session. Explains why the email is asked. */
import { LIMITS } from '@sahay/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ApiClientError, getToken, setToken } from '../api/client';
import { useOtpStart, useOtpVerify } from '../api/hooks';
import { LanguageToggle } from '../components/LanguageToggle';
import { useLocale } from '../i18n/LocaleContext';
import { Banner, Button, Card, Input } from '../ui/components';
import { useToast } from '../ui/Toast';

export function AuthPage() {
  const { t, locale } = useLocale();
  const navigate = useNavigate();
  const [search] = useSearchParams();
  const qc = useQueryClient();
  const { toast } = useToast();

  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [retryAfter, setRetryAfter] = useState(0);
  const codeRef = useRef<HTMLInputElement>(null);

  const start = useOtpStart();
  const verify = useOtpVerify();

  const next = search.get('next');
  const dest = next && next.startsWith('/') ? next : '/admin';

  useEffect(() => {
    if (getToken()) navigate(dest, { replace: true });
  }, [navigate, dest]);

  useEffect(() => {
    if (retryAfter <= 0) return;
    const id = window.setInterval(() => setRetryAfter((s) => Math.max(0, s - 1)), 1000);
    return () => window.clearInterval(id);
  }, [retryAfter]);

  const normalizedEmail = email.trim().toLowerCase();

  const sendCode = () => {
    setError(null);
    start.mutate(
      { email: normalizedEmail, locale },
      {
        onSuccess: (res) => {
          setStep('code');
          setRetryAfter(res.retryAfterSeconds ?? 30);
          window.setTimeout(() => codeRef.current?.focus(), 50);
        },
        onError: (e) => {
          if (e instanceof ApiClientError && e.code === 'rate_limited') setError(t('auth.tooManyAttempts'));
          else setError(e instanceof Error ? e.message : t('common.error'));
        },
      },
    );
  };

  const submitCode = () => {
    setError(null);
    verify.mutate(
      { email: normalizedEmail, code, device: { platform: 'web', name: navigator.userAgent.slice(0, 60) } },
      {
        onSuccess: (session) => {
          setToken(session.token);
          qc.setQueryData(['me'], session.user);
          if (session.isNewAccount) toast(t('auth.welcome', { pseudonym: session.user.pseudonym }));
          navigate(dest, { replace: true });
        },
        onError: (e) => {
          if (e instanceof ApiClientError && (e.status === 400 || e.status === 401 || e.status === 422)) {
            setError(t('auth.invalidCode'));
          } else if (e instanceof ApiClientError && e.code === 'rate_limited') {
            setError(t('auth.tooManyAttempts'));
          } else {
            setError(e instanceof Error ? e.message : t('common.error'));
          }
        },
      },
    );
  };

  return (
    <div style={{ maxWidth: 440, margin: '0 auto' }} className="stack">
      <div className="row">
        <h1 style={{ margin: 0, flex: 1 }}>{t('nav.signIn')}</h1>
        <LanguageToggle />
      </div>

      <Card>
        {step === 'email' ? (
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              sendCode();
            }}
          >
            <Input
              label={t('auth.emailLabel')}
              type="email"
              autoComplete="email"
              inputMode="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              hint={t('auth.emailWhy')}
              error={error}
              required
            />
            <Button type="submit" block large loading={start.isPending}>
              {t('auth.sendCode')}
            </Button>
          </form>
        ) : (
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              submitCode();
            }}
          >
            <Input
              ref={codeRef}
              label={t('auth.codeLabel')}
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]*"
              maxLength={LIMITS.otpLength}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              error={error}
              required
            />
            <Button type="submit" block large loading={verify.isPending} disabled={code.length !== LIMITS.otpLength}>
              {t('auth.verify')}
            </Button>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <Button variant="ghost" onClick={() => setStep('email')}>
                {t('common.back')}
              </Button>
              <Button variant="ghost" disabled={retryAfter > 0 || start.isPending} onClick={sendCode}>
                {t('auth.resend')}
                {retryAfter > 0 ? ` (${retryAfter})` : ''}
              </Button>
            </div>
          </form>
        )}
      </Card>

      <Banner tone="info" icon="shield">
        {t('onboarding.intro2')}
      </Banner>
      <p className="text-xs text-soft text-center">{t('onboarding.intro3')}</p>
    </div>
  );
}
