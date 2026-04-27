// =============================================================================
// FireISP 5.0 — App Layout (shell + nav)
// =============================================================================

import { useState, type ChangeEvent } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/auth/AuthContext';
import { hasRole } from '@/auth/PrivateRoute';
import { DrDrillBanner } from '@/components/DrDrillBanner';
import { useDarkMode } from '@/auth/DarkModeContext';

interface NavItem {
  to: string;
  labelKey: string;
  requiredRole?: string;
}

const NAV_ITEMS: NavItem[] = [
  { to: '/', labelKey: 'nav.dashboard' },
  { to: '/clients', labelKey: 'nav.clients' },
  { to: '/contracts', labelKey: 'nav.contracts' },
  { to: '/invoices', labelKey: 'nav.invoices' },
  { to: '/payments', labelKey: 'nav.payments' },
  { to: '/tickets', labelKey: 'nav.tickets' },
  { to: '/devices', labelKey: 'nav.devices' },
  { to: '/inventory', labelKey: 'nav.inventory', requiredRole: 'technician' },
  { to: '/warehouses', labelKey: 'nav.warehouses', requiredRole: 'technician' },
  { to: '/radius-sessions', labelKey: 'nav.radiusSessions', requiredRole: 'technician' },
  { to: '/session-accounting', labelKey: 'nav.sessionAccounting', requiredRole: 'technician' },
  { to: '/snmp-metrics', labelKey: 'nav.snmpMetrics', requiredRole: 'technician' },
  { to: '/snmp-traps', labelKey: 'nav.snmpTraps', requiredRole: 'technician' },
  { to: '/coverage-zones', labelKey: 'nav.coverageZones', requiredRole: 'technician' },
  { to: '/cfdi', labelKey: 'nav.cfdi', requiredRole: 'billing' },
  // Admin-only
  { to: '/users', labelKey: 'nav.users', requiredRole: 'admin' },
  { to: '/reports', labelKey: 'nav.reports', requiredRole: 'billing' },
  { to: '/settings', labelKey: 'nav.settings', requiredRole: 'admin' },
];

export function Layout() {
  const { user, logout, switchOrganization } = useAuth();
  const { t } = useTranslation();
  const { effectiveTheme, toggleTheme } = useDarkMode();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [switching, setSwitching] = useState(false);

  async function handleLogout() {
    await logout();
  }

  function closeSidebar() {
    setSidebarOpen(false);
  }

  async function handleOrgChange(e: ChangeEvent<HTMLSelectElement>) {
    const newOrgId = Number(e.target.value);
    if (!user || newOrgId === user.organization_id) return;
    setSwitching(true);
    try {
      await switchOrganization(newOrgId);
    } catch (err) {
      // Restore the select to the current org and surface the error
      // eslint-disable-next-line no-alert
      alert(err instanceof Error ? err.message : t('layout.switchOrgFailed'));
    } finally {
      setSwitching(false);
    }
  }

  const orgs = user?.organizations ?? [];
  const showOrgSwitcher = orgs.length > 1;

  return (
    <div className="app-shell">
      {/* Hamburger button — visible only on mobile via CSS */}
      <button
        className="hamburger-btn"
        onClick={() => setSidebarOpen(v => !v)}
        aria-label={sidebarOpen ? t('layout.closeNav') : t('layout.openNav')}
        aria-expanded={sidebarOpen}
      >
        {sidebarOpen ? '✕' : '☰'}
      </button>

      {/* Mobile top bar — visible only on mobile via CSS */}
      <div className="mobile-topbar">{t('layout.brandName')}</div>

      {/* Backdrop overlay — shown on mobile when sidebar is open */}
      <div
        className={`nav-overlay${sidebarOpen ? ' overlay-open' : ''}`}
        onClick={closeSidebar}
        aria-hidden="true"
      />

      {/* Sidebar */}
      <aside className={`app-sidebar${sidebarOpen ? ' sidebar-open' : ''}`}>
        <div style={styles.logo}>{t('layout.brandName')}</div>

        <nav style={styles.nav}>
          {NAV_ITEMS.filter(
            item => !item.requiredRole || (user && hasRole(user.role, item.requiredRole)),
          ).map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              onClick={closeSidebar}
              style={({ isActive }) => ({
                ...styles.navLink,
                ...(isActive ? styles.navLinkActive : {}),
              })}
            >
              {t(item.labelKey)}
            </NavLink>
          ))}
        </nav>

        {/* User info + logout */}
        <div style={styles.userArea}>
          {user && (
            <>
              <div style={styles.userName}>{user.name || user.email}</div>
              <div style={styles.userRole}>{user.role}</div>
              {showOrgSwitcher && (
                <select
                  aria-label={t('layout.orgSwitcherLabel')}
                  value={user.organization_id ?? ''}
                  onChange={handleOrgChange}
                  disabled={switching}
                  style={styles.orgSelect}
                >
                  {orgs.map(org => (
                    <option key={org.id} value={org.id}>
                      {org.name}
                    </option>
                  ))}
                </select>
              )}
            </>
          )}
          <button
            onClick={toggleTheme}
            style={styles.themeBtn}
            aria-label={effectiveTheme === 'dark' ? t('darkMode.switchToLight') : t('darkMode.switchToDark')}
            title={effectiveTheme === 'dark' ? t('darkMode.switchToLight') : t('darkMode.switchToDark')}
          >
            {effectiveTheme === 'dark' ? '☀️' : '🌙'}
          </button>
            <button onClick={handleLogout} style={styles.logoutBtn}>
            {t('common.signOut')}
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="app-main">
        <DrDrillBanner />
        <Outlet />
      </main>
    </div>
  );
}

const styles = {
  logo: {
    padding: '1.25rem 1rem',
    fontWeight: 700,
    fontSize: '1.1rem',
    color: '#fff',
    borderBottom: '1px solid #333',
  },
  nav: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column' as const,
    padding: '0.5rem 0',
    overflowY: 'auto' as const,
  },
  navLink: {
    display: 'block',
    padding: '0.55rem 1rem',
    color: '#aaa',
    textDecoration: 'none',
    borderRadius: 4,
    margin: '1px 8px',
    transition: 'background .15s',
  },
  navLinkActive: {
    background: '#e25822',
    color: '#fff',
  },
  userArea: {
    padding: '0.75rem 1rem',
    borderTop: '1px solid #333',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 4,
  },
  userName: { color: '#fff', fontWeight: 600, fontSize: '0.85rem' },
  userRole: { color: '#888', fontSize: '0.75rem', textTransform: 'capitalize' as const },
  orgSelect: {
    marginTop: 6,
    background: '#222',
    color: '#fff',
    border: '1px solid #555',
    borderRadius: 4,
    padding: '4px 6px',
    fontSize: '0.8rem',
  },
  logoutBtn: {
    marginTop: 6,
    background: 'transparent',
    border: '1px solid #555',
    color: '#aaa',
    padding: '4px 10px',
    borderRadius: 4,
    cursor: 'pointer',
    fontSize: '0.8rem',
    alignSelf: 'flex-start' as const,
  },
  themeBtn: {
    background: 'transparent',
    border: '1px solid var(--border-strong)',
    color: 'var(--text-muted)',
    padding: '4px 10px',
    borderRadius: 4,
    cursor: 'pointer',
    fontSize: '0.9rem',
    alignSelf: 'flex-start' as const,
  },
};
