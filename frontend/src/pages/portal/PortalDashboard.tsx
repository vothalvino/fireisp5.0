// =============================================================================
// FireISP 5.0 — Portal Dashboard (§11.1)
// =============================================================================
// Landing page: account overview, plan info, session status, usage graph,
// unpaid invoices, open tickets.
// =============================================================================

import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { usePortalAuth, portalTokenStore } from '@/auth/PortalAuthContext';

const API_BASE = '/api/v1/portal';

interface DashboardData {
  client: { id: number; name: string; email: string };
  contract: {
    id: number;
    status: string;
    connection_type: string;
    ip_address: string | null;
    plan: {
      id: number;
      name: string;
      price: number;
      download_speed_mbps: number | null;
      upload_speed_mbps: number | null;
      billing_cycle_months: number;
      data_cap_gb: number | null;
    };
  } | null;
  balance: number;
  next_due_date: string | null;
  session: {
    status: string;
    username: string;
    ip: string | null;
    session_seconds: number;
    bytes_in: number;
    bytes_out: number;
  } | null;
  usage_this_month: {
    download_gb: number;
    upload_gb: number;
    total_gb: number;
  } | null;
}

interface UsageDay {
  date: string;
  download_gb: number;
  upload_gb: number;
  total_gb: number;
}

async function portalFetch<T>(path: string): Promise<T> {
  const token = portalTokenStore.getAccess();
  const res = await fetch(`${API_BASE}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error('Request failed');
  return (await res.json()) as T;
}

function fmtBytes(bytes: number): string {
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(2)} GB`;
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  return `${(bytes / 1024).toFixed(0)} KB`;
}

function fmtSeconds(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function PortalDashboard() {
  const { client } = usePortalAuth();

  const { data: dashData, isLoading: dashLoading } = useQuery({
    queryKey: ['portal-dashboard'],
    queryFn: () => portalFetch<{ data: DashboardData }>('/dashboard'),
    staleTime: 30_000,
  });

  const { data: usageData } = useQuery({
    queryKey: ['portal-usage-month'],
    queryFn: () => portalFetch<{ data: UsageDay[] }>('/usage/current-month'),
    staleTime: 60_000,
  });

  const overview = dashData?.data;
  const usageDays = usageData?.data ?? [];
  const maxUsage = usageDays.reduce((m, d) => Math.max(m, d.total_gb), 0.001);

  return (
    <div>
      <h1 style={styles.heading}>Welcome, {client?.name}</h1>
      <p style={styles.sub}>Your service overview</p>

      {dashLoading && <p style={styles.muted}>Loading…</p>}

      {overview && (
        <div style={styles.grid}>
          {/* Plan & Account */}
          <section style={styles.card}>
            <h2 style={styles.cardTitle}>My Plan</h2>
            {overview.contract ? (
              <dl style={styles.dl}>
                <dt style={styles.dt}>Plan</dt>
                <dd style={styles.dd}>{overview.contract.plan.name}</dd>
                <dt style={styles.dt}>Price</dt>
                <dd style={styles.dd}>${overview.contract.plan.price.toFixed(2)} / month</dd>
                {overview.contract.plan.download_speed_mbps && (
                  <>
                    <dt style={styles.dt}>Speed</dt>
                    <dd style={styles.dd}>
                      {overview.contract.plan.download_speed_mbps} / {overview.contract.plan.upload_speed_mbps} Mbps
                    </dd>
                  </>
                )}
                {overview.contract.plan.data_cap_gb && (
                  <>
                    <dt style={styles.dt}>Data cap</dt>
                    <dd style={styles.dd}>{overview.contract.plan.data_cap_gb} GB</dd>
                  </>
                )}
                <dt style={styles.dt}>Connection</dt>
                <dd style={styles.dd}>{overview.contract.connection_type}</dd>
              </dl>
            ) : (
              <p style={styles.muted}>No active contract</p>
            )}
            <div style={{ marginTop: '0.75rem' }}>
              <Link to="/portal/account" style={styles.linkBtn}>Manage account →</Link>
            </div>
          </section>

          {/* Balance */}
          <section style={styles.card}>
            <h2 style={styles.cardTitle}>Balance &amp; Billing</h2>
            <div style={{
              fontSize: '2rem', fontWeight: 700,
              color: overview.balance > 0 ? '#dc2626' : '#16a34a',
            }}>
              ${overview.balance.toFixed(2)}
            </div>
            <p style={styles.muted}>Outstanding balance</p>
            {overview.next_due_date && (
              <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                Next due: {overview.next_due_date.slice(0, 10)}
              </p>
            )}
            <Link to="/portal/invoices" style={styles.linkBtn}>View invoices →</Link>
          </section>

          {/* Session status */}
          <section style={styles.card}>
            <h2 style={styles.cardTitle}>Connection Status</h2>
            {overview.session ? (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                  <span style={{
                    width: 10, height: 10, borderRadius: '50%',
                    background: overview.session.status === 'connected' ? '#16a34a' : '#dc2626',
                    display: 'inline-block',
                  }} />
                  <strong style={{ textTransform: 'capitalize' }}>{overview.session.status}</strong>
                </div>
                <dl style={styles.dl}>
                  {overview.session.ip && (
                    <>
                      <dt style={styles.dt}>IP</dt>
                      <dd style={styles.dd}>{overview.session.ip}</dd>
                    </>
                  )}
                  {overview.session.session_seconds > 0 && (
                    <>
                      <dt style={styles.dt}>Session</dt>
                      <dd style={styles.dd}>{fmtSeconds(overview.session.session_seconds)}</dd>
                    </>
                  )}
                  {(overview.session.bytes_in > 0 || overview.session.bytes_out > 0) && (
                    <>
                      <dt style={styles.dt}>Downloaded</dt>
                      <dd style={styles.dd}>{fmtBytes(overview.session.bytes_in)}</dd>
                      <dt style={styles.dt}>Uploaded</dt>
                      <dd style={styles.dd}>{fmtBytes(overview.session.bytes_out)}</dd>
                    </>
                  )}
                </dl>
              </>
            ) : (
              <p style={styles.muted}>No active session data</p>
            )}
          </section>

          {/* Usage this month */}
          {overview.usage_this_month && (
            <section style={styles.card}>
              <h2 style={styles.cardTitle}>Usage This Month</h2>
              <dl style={styles.dl}>
                <dt style={styles.dt}>Download</dt>
                <dd style={styles.dd}>{overview.usage_this_month.download_gb.toFixed(2)} GB</dd>
                <dt style={styles.dt}>Upload</dt>
                <dd style={styles.dd}>{overview.usage_this_month.upload_gb.toFixed(2)} GB</dd>
                <dt style={styles.dt}>Total</dt>
                <dd style={{ ...styles.dd, fontWeight: 600 }}>{overview.usage_this_month.total_gb.toFixed(2)} GB</dd>
              </dl>
            </section>
          )}
        </div>
      )}

      {/* Daily usage chart */}
      {usageDays.length > 0 && (
        <section style={{ ...styles.card, marginTop: '1.5rem' }}>
          <h2 style={styles.cardTitle}>Daily Usage (Current Month)</h2>
          <div style={styles.chartOuter}>
            <div style={styles.chartBars}>
              {usageDays.map(d => (
                <div key={d.date} style={styles.barGroup} title={`${d.date}: ${d.total_gb.toFixed(3)} GB`}>
                  <div style={{ ...styles.bar, height: `${Math.max(2, (d.total_gb / maxUsage) * 100)}%` }} />
                  <span style={styles.barLabel}>{d.date.slice(8)}</span>
                </div>
              ))}
            </div>
          </div>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
            Total days shown: {usageDays.length}
          </p>
        </section>
      )}

      {/* Quick links */}
      <div style={{ ...styles.grid, marginTop: '1.5rem' }}>
        <Link to="/portal/tickets" style={styles.quickCard}>
          <span style={styles.quickIcon}>🎫</span>
          <span>Support Tickets</span>
        </Link>
        <Link to="/portal/kb" style={styles.quickCard}>
          <span style={styles.quickIcon}>📖</span>
          <span>Knowledge Base</span>
        </Link>
        <Link to="/portal/account" style={styles.quickCard}>
          <span style={styles.quickIcon}>⚙️</span>
          <span>Account Settings</span>
        </Link>
        <Link to="/portal/speed-test" style={styles.quickCard}>
          <span style={styles.quickIcon}>⚡</span>
          <span>Speed Test</span>
        </Link>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  heading: { margin: '0 0 0.25rem', fontSize: '1.5rem', color: 'var(--text-primary)' },
  sub: { margin: '0 0 1.5rem', color: 'var(--text-muted)', fontSize: '0.95rem' },
  muted: { color: 'var(--text-muted)', margin: '0.5rem 0', fontSize: '0.9rem' },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
    gap: '1.25rem',
  },
  card: {
    background: 'var(--bg-card)',
    borderRadius: 8,
    padding: '1.25rem',
    boxShadow: '0 0 0 1px var(--border)',
  },
  cardTitle: { margin: '0 0 0.75rem', fontSize: '0.95rem', color: 'var(--text-secondary)', fontWeight: 600 },
  dl: { margin: 0, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '0.2rem 1rem' },
  dt: { color: 'var(--text-muted)', fontSize: '0.85rem' },
  dd: { margin: 0, color: 'var(--text-primary)', fontSize: '0.9rem' },
  linkBtn: { display: 'inline-block', marginTop: '0.75rem', fontSize: '0.85rem', color: 'var(--accent)', textDecoration: 'none' },
  chartOuter: { overflowX: 'auto' },
  chartBars: { display: 'flex', alignItems: 'flex-end', gap: 3, height: 80, minWidth: 200 },
  barGroup: { display: 'flex', flexDirection: 'column', alignItems: 'center', flex: '1 0 12px', maxWidth: 20 },
  bar: { width: '100%', background: 'var(--accent)', borderRadius: '2px 2px 0 0', transition: 'height 0.2s' },
  barLabel: { fontSize: 9, color: 'var(--text-muted)', marginTop: 2, writingMode: 'vertical-rl' as const },
  quickCard: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '0.5rem',
    padding: '1rem',
    background: 'var(--bg-card)',
    borderRadius: 8,
    boxShadow: '0 0 0 1px var(--border)',
    textDecoration: 'none',
    color: 'var(--text-secondary)',
    fontSize: '0.875rem',
    fontWeight: 500,
    textAlign: 'center',
  },
  quickIcon: { fontSize: '1.5rem' },
};
