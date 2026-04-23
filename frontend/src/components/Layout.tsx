// =============================================================================
// FireISP 5.0 — App Layout (shell + nav)
// =============================================================================

import { useState, type ChangeEvent } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '@/auth/AuthContext';
import { hasRole } from '@/auth/PrivateRoute';

interface NavItem {
  to: string;
  label: string;
  requiredRole?: string;
}

const NAV_ITEMS: NavItem[] = [
  { to: '/', label: '📊 Dashboard' },
  { to: '/clients', label: '👥 Clients' },
  { to: '/contracts', label: '📄 Contracts' },
  { to: '/invoices', label: '🧾 Invoices' },
  { to: '/payments', label: '💳 Payments' },
  { to: '/tickets', label: '🎫 Tickets' },
  { to: '/devices', label: '🖧 Devices' },
  { to: '/inventory', label: '📦 Inventory', requiredRole: 'technician' },
  { to: '/warehouses', label: '🏭 Warehouses', requiredRole: 'technician' },
  { to: '/radius-sessions', label: '📡 RADIUS Sessions', requiredRole: 'technician' },
  { to: '/session-accounting', label: '📈 Session Accounting', requiredRole: 'technician' },
  { to: '/snmp-metrics', label: '📶 SNMP Metrics', requiredRole: 'technician' },
  { to: '/snmp-traps', label: '🚨 SNMP Traps', requiredRole: 'technician' },
  { to: '/coverage-zones', label: '🗺️ Coverage Zones', requiredRole: 'technician' },
  { to: '/cfdi', label: '🏛️ CFDI', requiredRole: 'billing' },
  // Admin-only
  { to: '/users', label: '🔑 Users', requiredRole: 'admin' },
  { to: '/reports', label: '📈 Reports', requiredRole: 'billing' },
  { to: '/settings', label: '⚙️ Settings', requiredRole: 'admin' },
];

export function Layout() {
  const { user, logout, switchOrganization } = useAuth();
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
      alert(err instanceof Error ? err.message : 'Failed to switch organization');
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
        aria-label={sidebarOpen ? 'Close navigation' : 'Open navigation'}
        aria-expanded={sidebarOpen}
      >
        {sidebarOpen ? '✕' : '☰'}
      </button>

      {/* Mobile top bar — visible only on mobile via CSS */}
      <div className="mobile-topbar">🔥 FireISP</div>

      {/* Backdrop overlay — shown on mobile when sidebar is open */}
      <div
        className={`nav-overlay${sidebarOpen ? ' overlay-open' : ''}`}
        onClick={closeSidebar}
        aria-hidden="true"
      />

      {/* Sidebar */}
      <aside className={`app-sidebar${sidebarOpen ? ' sidebar-open' : ''}`}>
        <div style={styles.logo}>🔥 FireISP</div>

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
              {item.label}
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
                  aria-label="Active organization"
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
          <button onClick={handleLogout} style={styles.logoutBtn}>
            Sign out
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="app-main">
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
} as const;
