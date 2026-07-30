/**
 * Staff sign-in: username + password. Admin credentials are issued by the
 * operators (see the request form on the support page), so there is no
 * self-service code flow here — volunteers sign in with email OTP on mobile.
 */
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ApiClientError, getToken, setToken } from '../api/client';
import { usePasswordLogin } from '../api/hooks';
import { useLocale } from '../i18n/LocaleContext';
import { Banner, Button, Card, Input } from '../ui/components';

export function AuthPage() {
  const { t } = useLocale();
  const navigate = useNavigate();
  const [search] = useSearchParams();
  const qc = useQueryClient();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  const login = usePasswordLogin();

  const next = search.get('next');
  const dest = next && next.startsWith('/') ? next : '/admin';

  useEffect(() => {
    if (getToken()) navigate(dest, { replace: true });
  }, [navigate, dest]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    login.mutate(
      { username: username.trim(), password },
      {
        onSuccess: (session) => {
          setToken(session.token);
          qc.setQueryData(['me'], session.user);
          // A password we generated has to be replaced before anything else —
          // the server refuses every other route until it is.
          navigate(session.user.mustChangePassword ? '/auth/password' : dest, { replace: true });
        },
        onError: (err) => {
          if (err instanceof ApiClientError) {
            if (err.code === 'rate_limited') return setError(t('auth.tooManyAttempts'));
            if (err.code === 'account_restricted') return setError(t('auth.accountRestricted'));
            if (err.status === 400 || err.status === 401) return setError(t('auth.invalidCredentials'));
          }
          setError(err instanceof Error ? err.message : t('common.error'));
        },
      },
    );
  };

  const canSubmit = username.trim() !== '' && password !== '';

  return (
    <div className="stack app-col-narrow">
      <h1 style={{ margin: 0 }}>{t('auth.staffSignInTitle')}</h1>

      <Banner tone="info" icon="shield">
        {t('auth.staffCredentialsNote')}
      </Banner>

      <Card>
        <form className="stack" onSubmit={submit}>
          <Input
            label={t('auth.usernameLabel')}
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />
          <Input
            label={t('auth.passwordLabel')}
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            error={error}
            required
          />
          <Button type="submit" block large loading={login.isPending} disabled={!canSubmit}>
            {t('auth.signIn')}
          </Button>
        </form>
      </Card>

      <p className="text-sm text-soft" style={{ margin: 0 }}>
        {t('auth.noAccountYet')} <Link to="/support">{t('auth.requestAccountLink')}</Link>
      </p>
    </div>
  );
}
