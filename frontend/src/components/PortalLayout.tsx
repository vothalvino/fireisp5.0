// =============================================================================
// FireISP 5.0 — Portal Layout
// =============================================================================
// Minimal shell for the client self-service portal.
// Separate from the admin Layout — no sidebar nav for internal routes.
// =============================================================================

import { Link, NavLink, Outlet } from 'react-router-dom';
import { usePortalAuth } from '@/auth/PortalAuthContext';

export function PortalLayout() {
  const { client, logout } = usePortalAuth();

  async function handleLogout() {
    await logout();
  }

  return (
    <div style={styles.shell}>
      {/* Top bar */}
      <header style={styles.header}>
        <Link to="/portal" style={styles.logo}>🔥 FireISP — My Account</Link>
        <nav style={styles.nav}>
          <NavLink
            to="/portal"
            end
            style={({ isActive }) => ({ ...styles.navLink, ...(isActive ? styles.navLinkActive : {}) })}
          >
            🏠 Home
          </NavLink>
          <NavLink
            to="/portal/invoices"
            style={({ isActive }) => ({ ...styles.navLink, ...(isActive ? styles.navLinkActive : {}) })}
          >
            🧾 Invoices
          </NavLink>
          <NavLink
            to="/portal/tickets"
            style={({ isActive }) => ({ ...styles.navLink, ...(isActive ? styles.navLinkActive : {}) })}
          >
            🎫 Support
          </NavLink>
        </nav>
        <div style={styles.userArea}>
          {client && <span style={styles.userName}>{client.name}</span>}
          <button onClick={handleLogout} style={styles.logoutBtn}>Sign out</button>
        </div>
      </header>

      {/* Page content */}
      <main style={styles.main}>
        <Outlet />
      </main>

      <footer style={styles.footer}>
        &copy; {new Date().getFullYear()} FireISP
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
    background: '#f5f7fa',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: '1.5rem',
    padding: '0.75rem 1.5rem',
    background: '#fff',
    borderBottom: '1px solid #e5e7eb',
    flexWrap: 'wrap' as const,
  },
  logo: {
    fontWeight: 700,
    fontSize: '1.1rem',
    color: '#e25822',
    textDecoration: 'none',
    marginRight: 'auto',
  },
  nav: {
    display: 'flex',
    gap: '0.25rem',
  },
  navLink: {
    padding: '0.4rem 0.8rem',
    borderRadius: 4,
    textDecoration: 'none',
    color: '#374151',
    fontSize: '0.9rem',
  },
  navLinkActive: {
    background: '#fff0eb',
    color: '#e25822',
    fontWeight: 600,
  },
  userArea: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.75rem',
  },
  userName: {
    fontSize: '0.85rem',
    color: '#6b7280',
  },
  logoutBtn: {
    padding: '0.35rem 0.75rem',
    background: 'transparent',
    border: '1px solid #d1d5db',
    borderRadius: 4,
    cursor: 'pointer',
    fontSize: '0.85rem',
    color: '#374151',
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
    color: '#9ca3af',
    borderTop: '1px solid #e5e7eb',
  },
} as const;
