/** App chrome: header, responsive nav, offline banner. */
import { useMemo, type ReactNode } from 'react';
import { Link, NavLink, Outlet, Navigate } from 'react-router-dom';
import { getToken, clearToken } from '../api/client';
import { useLogout, useMe } from '../api/hooks';
import { useT } from '../i18n/LocaleContext';
import { useWsConnection, WsContext } from '../realtime/useWs';
import { Icon } from '../ui/icons';
import { LanguageToggle } from './LanguageToggle';
import { OfflineBanner } from './OfflineBanner';

function NavItem({ to, icon, label }: { to: string; icon: string; label: string }) {
  return (
    <NavLink to={to} className="nav-item">
      <Icon name={icon} />
      <span>{label}</span>
    </NavLink>
  );
}

export function AppShell() {
  const t = useT();
  const authed = !!getToken();
  const me = useMe(authed);
  const ws = useWsConnection(authed);
  const wsValue = useMemo(() => ({ connected: ws.connected }), [ws.connected]);
  const isModerator = me.data?.role === 'moderator' || me.data?.role === 'admin';
  const logout = useLogout();

  const items: { to: string; icon: string; label: string }[] = [];
  if (isModerator) items.push({ to: '/admin', icon: 'shield', label: t('nav.admin') });

  const signOut = () => {
    logout.mutate(undefined, { onSettled: () => clearToken() });
  };

  return (
    <WsContext.Provider value={wsValue}>
      <div className="app-shell">
        <a href="#main" className="skip-link">
          {t('nav.skipToContent')}
        </a>
        <header className="app-header">
          <div className="app-header-inner">
            <Link to="/" className="app-logo">
              <Icon name="heart" size={24} />
              <span>{t('common.appName')}</span>
            </Link>
            <nav className="app-nav-desktop" aria-label={t('misc.menu')}>
              <LanguageToggle />
              <a href="/#how-it-works" className="app-nav-link">
                {t('landing.howTitle')}
              </a>
              <a href="/#safety" className="app-nav-link">
                {t('landing.safetyNav')}
              </a>
              <Link to="/support" className="app-nav-link">
                {t('landing.faqNav')}
              </Link>
              {items.map((item) => (
                <NavItem key={item.to} {...item} />
              ))}
              {authed ? (
                <button type="button" className="btn btn-secondary" onClick={signOut}>
                  {t('auth.logout')}
                </button>
              ) : (
                <Link to="/auth" className="btn-admin-pill">
                  {t('landing.signInCta')}
                </Link>
              )}
            </nav>
            <span className="hide-desktop">
              <LanguageToggle />
            </span>
          </div>
        </header>
        <OfflineBanner />
        <main id="main" className="app-main">
          <Outlet />
        </main>
      </div>
    </WsContext.Provider>
  );
}

export function RequireModerator({ children }: { children: ReactNode }) {
  const t = useT();
  const me = useMe();
  if (!getToken()) return <Navigate to="/auth?next=%2Fadmin" replace />;
  if (me.isLoading) return <p className="text-soft">{t('common.loading')}</p>;
  if (me.data && me.data.role !== 'moderator' && me.data.role !== 'admin') {
    return (
      <div className="empty-state" role="alert">
        <h2>{t('errors.forbidden')}</h2>
      </div>
    );
  }
  return <>{children}</>;
}
