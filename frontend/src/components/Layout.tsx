// =============================================================================
// FireISP 5.0 — App Layout (shell + nav)
// =============================================================================

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
  { to: '/cfdi', label: '🏛️ CFDI', requiredRole: 'billing' },
  // Admin-only
  { to: '/users', label: '🔑 Users', requiredRole: 'admin' },
  { to: '/reports', label: '📈 Reports', requiredRole: 'billing' },
  { to: '/settings', label: '⚙️ Settings', requiredRole: 'admin' },
];

export function Layout() {
  const { user, logout } = useAuth();

  async function handleLogout() {
    await logout();
  }

  return (
    <div style={styles.shell}>
      {/* Sidebar */}
      <aside style={styles.sidebar}>
        <div style={styles.logo}>🔥 FireISP</div>

        <nav style={styles.nav}>
          {NAV_ITEMS.filter(
            item => !item.requiredRole || (user && hasRole(user.role, item.requiredRole)),
          ).map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
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
            </>
          )}
          <button onClick={handleLogout} style={styles.logoutBtn}>
            Sign out
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main style={styles.main}>
        <Outlet />
      </main>
    </div>
  );
}

const styles = {
  shell: {
    display: 'flex',
    height: '100vh',
    fontFamily: 'system-ui, sans-serif',
    fontSize: '0.9rem',
    background: '#f5f6fa',
  },
  sidebar: {
    width: 220,
    background: '#1a1a2e',
    color: '#ccc',
    display: 'flex',
    flexDirection: 'column' as const,
    flexShrink: 0,
  },
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
  main: {
    flex: 1,
    overflow: 'auto',
  },
} as const;
