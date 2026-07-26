/** App chrome: header, responsive nav, offline banner, WS provider, global offer sheet. */
import { useMemo, type ReactNode } from 'react';
import { Link, NavLink, Outlet, useLocation, Navigate } from 'react-router-dom';
import { getToken } from '../api/client';
import { useMe } from '../api/hooks';
import { useT } from '../i18n/LocaleContext';
import { useWsConnection, WsContext } from '../realtime/useWs';
import { Icon } from '../ui/icons';
import { LanguageToggle } from './LanguageToggle';
import { OfferSheet } from './OfferSheet';
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

  const items: { to: string; icon: string; label: string }[] = authed
    ? [
        { to: '/home', icon: 'home', label: t('nav.home') },
        { to: '/events', icon: 'calendar', label: t('nav.events') },
        { to: '/profile', icon: 'user', label: t('nav.profile') },
        { to: '/settings', icon: 'settings', label: t('nav.settings') },
      ]
    : [{ to: '/events', icon: 'calendar', label: t('nav.events') }];
  if (isModerator) items.push({ to: '/admin', icon: 'shield', label: t('nav.admin') });

  return (
    <WsContext.Provider value={wsValue}>
      <div className="app-shell">
        <a href="#main" className="skip-link">
          {t('nav.skipToContent')}
        </a>
        <header className="app-header">
          <div className="app-header-inner">
            <Link to={authed ? '/home' : '/'} className="app-logo">
              <Icon name="heart" size={24} />
              <span>
                {t('common.appName')} <span lang="hi">सहाय</span>
              </span>
            </Link>
            <nav className="app-nav-desktop" aria-label={t('misc.menu')}>
              {items.map((item) => (
                <NavItem key={item.to} {...item} />
              ))}
              <LanguageToggle />
              {!authed ? (
                <Link to="/auth" className="btn btn-primary">
                  {t('nav.signIn')}
                </Link>
              ) : null}
            </nav>
            <span className="spacer app-nav-mobile-spacer" style={{ flex: 1 }} />
            <span className="hide-desktop">
              <LanguageToggle />
            </span>
          </div>
        </header>
        <OfflineBanner />
        <main id="main" className="app-main">
          <Outlet />
        </main>
        <nav className="app-nav-mobile" aria-label={t('misc.menu')}>
          {(authed ? items : [...items, { to: '/auth', icon: 'user', label: t('nav.signIn') }]).map((item) => (
            <NavItem key={item.to} {...item} />
          ))}
        </nav>
        {authed ? <OfferSheet /> : null}
      </div>
    </WsContext.Provider>
  );
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const location = useLocation();
  if (!getToken()) {
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/auth?next=${next}`} replace />;
  }
  return <>{children}</>;
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
