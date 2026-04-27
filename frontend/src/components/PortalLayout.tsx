// =============================================================================
// FireISP 5.0 — Portal Layout
// =============================================================================
// Minimal shell for the client self-service portal.
// Separate from the admin Layout — no sidebar nav for internal routes.
// =============================================================================

import { Link, NavLink, Outlet } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { usePortalAuth } from '@/auth/PortalAuthContext';
import { useDarkMode } from '@/auth/DarkModeContext';

export function PortalLayout() {
  const { client, logout } = usePortalAuth();
  const { t } = useTranslation();
  const { effectiveTheme, toggleTheme } = useDarkMode();

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
        </nav>
        <div className="portal-user-area">
          {client && <span style={styles.userName}>{client.name}</span>}
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
        <Outlet />
      </main>

      <footer style={styles.footer}>
        {t('portalLayout.footer', { year: new Date().getFullYear() })}
      </footer>
    </div>
  );
}

const styles = {
  shell: {
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column' as const,
    fontFamily: 'system-ui, sans-serif',
    background: 'var(--bg-body)',
  },
  logo: {
    fontWeight: 700,
    fontSize: '1.1rem',
    color: '#e25822',
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
};
