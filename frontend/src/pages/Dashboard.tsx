// =============================================================================
// FireISP 5.0 — Dashboard (KPI placeholder — Milestone 2.2 will fill this in)
// =============================================================================

import { useAuth } from '@/auth/AuthContext';

export function Dashboard() {
  const { user } = useAuth();

  return (
    <div style={styles.container}>
      <h1 style={styles.heading}>Dashboard</h1>
      <p style={styles.welcome}>
        Welcome back, <strong>{user?.name ?? user?.email}</strong>!
        {user?.role && (
          <> &nbsp;·&nbsp; <span style={styles.badge}>{user.role}</span></>
        )}
      </p>
      <p style={styles.note}>
        KPI cards (active clients, MRR, overdue invoices, open tickets, device
        uptime) will be added in Milestone 2.2.
      </p>
    </div>
  );
}

const styles = {
  container: {
    padding: '2rem',
    fontFamily: 'system-ui, sans-serif',
  },
  heading: { marginTop: 0, color: '#1a1a1a' },
  welcome: { color: '#444', marginBottom: '1rem' },
  badge: {
    background: '#e25822',
    color: '#fff',
    padding: '2px 8px',
    borderRadius: 12,
    fontSize: '0.75rem',
    fontWeight: 700,
  },
  note: {
    color: '#888',
    fontStyle: 'italic',
    border: '1px dashed #ccc',
    padding: '1rem',
    borderRadius: 6,
    background: '#fafafa',
  },
} as const;
