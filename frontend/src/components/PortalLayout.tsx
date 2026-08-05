// =============================================================================
// FireISP 5.0 — Portal Layout
// =============================================================================
// Minimal shell for the client self-service portal.
// Separate from the admin Layout — no sidebar nav for internal routes.
// =============================================================================

import { Link, NavLink, Outlet } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { usePortalAuth, portalTokenStore } from '@/auth/PortalAuthContext';
import { useDarkMode } from '@/auth/DarkModeContext';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';

export function PortalLayout() {
  const { client, logout } = usePortalAuth();
  const { t } = useTranslation();
  const { effectiveTheme, toggleTheme } = useDarkMode();

  // LFPDPPP: nag (never block) until the current notice version is accepted.
  // Same query key as PortalPrivacy, so accepting there clears this banner.
  const notice = useQuery({
    queryKey: ['portal-privacy-notice'],
    queryFn: async () => {
      const token = portalTokenStore.getAccess();
      const res = await fetch('/api/v1/portal/privacy-notice', {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error('privacy notice fetch failed');
      return res.json() as Promise<{ data: { accepted: boolean; version: string; content: string; accepted_at: string | null } }>;
    },
    staleTime: 5 * 60 * 1000,
  });
  const needsAcceptance = notice.data ? !notice.data.data.accepted : false;

  // IFT: the Carta de Derechos Minimos must be AVAILABLE to every MX
  // subscriber — a permanent footer link makes availability provable.
  const legalInfo = useQuery({
    queryKey: ['portal-legal-info'],
    queryFn: async () => {
      const token = portalTokenStore.getAccess();
      const res = await fetch('/api/v1/portal/legal-info', {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error('legal info fetch failed');
      return res.json() as Promise<{ data: { locale: string; carta_derechos_url: string } }>;
    },
    staleTime: 60 * 60 * 1000,
    retry: false,
  });
  const cartaUrl = legalInfo.data?.data.locale === 'MX' ? legalInfo.data.data.carta_derechos_url : null;

  async function handleLogout() {
    await logout();
  }

  return (
    <div style={styles.shell}>
      {/* Top bar */}
      <header className="portal-header">
        <Link to="/portal" style={styles.logo}>{t('portalLayout.brandName')}</Link>
        <nav className="portal-nav">
          <NavLink
            to="/portal"
            end
            style={({ isActive }) => ({ ...styles.navLink, ...(isActive ? styles.navLinkActive : {}) })}
          >
            {t('portalLayout.navHome')}
          </NavLink>
          <NavLink
            to="/portal/invoices"
            style={({ isActive }) => ({ ...styles.navLink, ...(isActive ? styles.navLinkActive : {}) })}
          >
            {t('portalLayout.navInvoices')}
          </NavLink>
          <NavLink
            to="/portal/tickets"
            style={({ isActive }) => ({ ...styles.navLink, ...(isActive ? styles.navLinkActive : {}) })}
          >
            {t('portalLayout.navSupport')}
          </NavLink>
          <NavLink
            to="/portal/kb"
            style={({ isActive }) => ({ ...styles.navLink, ...(isActive ? styles.navLinkActive : {}) })}
          >
            {t('portalLayout.navKb', 'Help')}
          </NavLink>
          <NavLink
            to="/portal/account"
            style={({ isActive }) => ({ ...styles.navLink, ...(isActive ? styles.navLinkActive : {}) })}
          >
            {t('portalLayout.navAccount', 'Account')}
          </NavLink>
        </nav>
        <div className="portal-user-area">
          {client && <span style={styles.userName}>{client.name}</span>}
          <LanguageSwitcher variant="bar" />
          <button
            onClick={toggleTheme}
            style={styles.themeBtn}
            aria-label={effectiveTheme === 'dark' ? t('darkMode.switchToLight') : t('darkMode.switchToDark')}
            title={effectiveTheme === 'dark' ? t('darkMode.switchToLight') : t('darkMode.switchToDark')}
          >
            {effectiveTheme === 'dark' ? '☀️' : '🌙'}
          </button>
          <button onClick={handleLogout} style={styles.logoutBtn}>{t('common.signOut')}</button>
        </div>
      </header>

      {/* Page content */}
      <main style={styles.main}>
        {needsAcceptance && (
          <div style={styles.privacyBanner} role="status">
            <span>{t('portalLayout.privacyBanner')}</span>
            <Link to="/portal/privacy" style={styles.privacyBannerLink}>
              {t('portalLayout.privacyBannerLink')}
            </Link>
          </div>
        )}
        <Outlet />
      </main>

      <footer style={styles.footer}>
        {t('portalLayout.footer', { year: new Date().getFullYear() })}
        {' · '}
        <Link to="/portal/privacy" style={styles.footerLink}>{t('portalLayout.privacyLink')}</Link>
        {cartaUrl && (
          <a href={cartaUrl} target="_blank" rel="noopener noreferrer" style={styles.footerLink}>
            {t('portalLayout.cartaDerechosLink')}
          </a>
        )}
      </footer>
    </div>
  );
}

const styles = {
  shell: {
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column' as const,
    fontFamily: 'var(--font-sans)',
    background: 'var(--bg-body)',
  },
  logo: {
    fontWeight: 700,
    fontSize: '1.1rem',
    color: 'var(--accent)',
    textDecoration: 'none',
    marginRight: 'auto',
  },
  navLink: {
    padding: '0.4rem 0.8rem',
    borderRadius: 4,
    textDecoration: 'none',
    color: 'var(--text-secondary)',
    fontSize: '0.9rem',
  },
  navLinkActive: {
    background: 'var(--bg-subtle)',
    color: 'var(--accent)',
    fontWeight: 600,
  },
  userName: {
    fontSize: '0.85rem',
    color: 'var(--text-muted)',
  },
  logoutBtn: {
    padding: '0.35rem 0.75rem',
    background: 'transparent',
    border: '1px solid var(--border-strong)',
    borderRadius: 4,
    cursor: 'pointer',
    fontSize: '0.85rem',
    color: 'var(--text-secondary)',
  },
  themeBtn: {
    background: 'transparent',
    border: '1px solid var(--border-strong)',
    color: 'var(--text-muted)',
    padding: '0.35rem 0.75rem',
    borderRadius: 4,
    cursor: 'pointer',
    fontSize: '0.85rem',
  },
  main: {
    flex: 1,
    padding: '1.5rem',
    maxWidth: 900,
    width: '100%',
    margin: '0 auto',
  },
  footer: {
    textAlign: 'center' as const,
    padding: '1rem',
    fontSize: '0.8rem',
    color: 'var(--text-dimmed)',
    borderTop: '1px solid var(--border)',
  },
  footerLink: {
    color: 'var(--text-dimmed)',
    textDecoration: 'underline',
  },
  privacyBanner: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    flexWrap: 'wrap' as const,
    padding: '0.6rem 1rem',
    marginBottom: '1rem',
    borderRadius: 6,
    border: '1px solid var(--warning-border, #e6c200)',
    background: 'var(--warning-bg, #fff8dc)',
    color: 'var(--text-primary)',
    fontSize: '0.9rem',
  },
  privacyBannerLink: {
    color: 'var(--accent)',
    fontWeight: 600,
  },
};
