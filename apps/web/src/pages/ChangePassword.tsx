/**
 * First-sign-in password change. Staff accounts are created with a password we
 * generated and sent over a channel we do not control, so the console routes
 * here until it is replaced (ADR-0013). Also reachable voluntarily later.
 */
import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { ApiClientError, getToken } from '../api/client';
import { useChangePassword, useMe } from '../api/hooks';
import { useLocale } from '../i18n/LocaleContext';
import { Banner, Button, Card, Input } from '../ui/components';

const MIN_LENGTH = 12; // mirrors zChangePassword on the server

export function ChangePasswordPage() {
  const { t } = useLocale();
  const navigate = useNavigate();
  const me = useMe();
  const change = useChangePassword();

  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (!getToken()) return <Navigate to="/auth?next=%2Fauth%2Fpassword" replace />;

  const tooShort = next !== '' && next.length < MIN_LENGTH;
  const mismatch = confirm !== '' && next !== confirm;
  const canSubmit = current !== '' && next.length >= MIN_LENGTH && next === confirm && !change.isPending;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    change.mutate(
      { currentPassword: current, newPassword: next },
      {
        onSuccess: () => navigate('/admin', { replace: true }),
        onError: (err) => {
          if (err instanceof ApiClientError) {
            if (err.status === 401) return setError(t('auth.currentPasswordWrong'));
            if (err.code === 'rate_limited') return setError(t('auth.tooManyAttempts'));
            if (err.status === 400) return setError(t('auth.newPasswordRejected'));
          }
          setError(err instanceof Error ? err.message : t('common.error'));
        },
      },
    );
  };

  return (
    <div className="stack app-col-narrow">
      <h1 style={{ margin: 0 }}>{t('auth.changePasswordTitle')}</h1>

      {me.data?.mustChangePassword ? (
        <Banner tone="info" icon="shield">
          {t('auth.changePasswordWhy')}
        </Banner>
      ) : null}

      <Card>
        <form className="stack" onSubmit={submit}>
          <Input
            label={t('auth.currentPasswordLabel')}
            type="password"
            autoComplete="current-password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            required
          />
          <Input
            label={t('auth.newPasswordLabel')}
            type="password"
            autoComplete="new-password"
            hint={t('auth.newPasswordHint', { min: MIN_LENGTH })}
            error={tooShort ? t('auth.newPasswordHint', { min: MIN_LENGTH }) : undefined}
            value={next}
            onChange={(e) => setNext(e.target.value)}
            required
          />
          <Input
            label={t('auth.confirmPasswordLabel')}
            type="password"
            autoComplete="new-password"
            error={mismatch ? t('auth.confirmPasswordMismatch') : error}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
          />
          <Button type="submit" block large loading={change.isPending} disabled={!canSubmit}>
            {t('auth.changePasswordSave')}
          </Button>
        </form>
      </Card>

      <p className="text-sm text-soft" style={{ margin: 0 }}>
        {t('auth.changePasswordSignsOutOthers')}
      </p>
    </div>
  );
}
