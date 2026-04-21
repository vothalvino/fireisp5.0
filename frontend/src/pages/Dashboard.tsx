// =============================================================================
// FireISP 5.0 — Dashboard
// =============================================================================
// KPIs: active clients, MRR, overdue invoices, open tickets, device uptime.
// Data fetched from /dashboard/summary, /dashboard/mrr, /dashboard/device-health,
// and /dashboard/overdue.
// =============================================================================

import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/auth/AuthContext';
import { api } from '@/api/client';

// ---------------------------------------------------------------------------
// Response shapes (the OpenAPI spec uses generic `object` — cast at runtime)
// ---------------------------------------------------------------------------

interface SummaryData {
  clients: { total: number; active: number };
  contracts: { total: number; active: number; suspended: number };
  revenue_30d: { outstanding: string; collected: string; total_invoiced: string };
  tickets: { total: number; open_count: number };
  devices: { total: number; monitored: number };
}

interface MrrRow {
  currency: string;
  active_contracts: number;
  mrr: string;
  arpu: string;
}

interface DeviceHealthData {
  devices_by_type: Array<{ type: string; total: number; monitored: number; active: number }>;
  health_snapshots: Array<{
    snapshot_date: string;
    device_count: number;
    avg_uptime: number;
    avg_latency: number;
    avg_packet_loss: number;
  }>;
}

interface OverdueInvoice {
  id: number;
  invoice_number: string;
  total: string;
  currency: string;
  due_date: string;
  client_id: number;
  first_name: string;
  last_name: string;
  days_overdue: number;
}

// ---------------------------------------------------------------------------
// Fetch helpers — use the typed api client (auth + silent refresh middleware)
// ---------------------------------------------------------------------------

async function fetchSummary(): Promise<SummaryData> {
  const res = await api.GET('/dashboard/summary');
  if (res.error) throw new Error('Failed to load summary');
  return (res.data as unknown as { data: SummaryData }).data;
}

async function fetchMrr(): Promise<MrrRow[]> {
  const res = await api.GET('/dashboard/mrr');
  if (res.error) throw new Error('Failed to load MRR');
  return (res.data as unknown as { data: MrrRow[] }).data;
}

async function fetchDeviceHealth(): Promise<DeviceHealthData> {
  const res = await api.GET('/dashboard/device-health');
  if (res.error) throw new Error('Failed to load device health');
  return (res.data as unknown as { data: DeviceHealthData }).data;
}

async function fetchOverdue(): Promise<OverdueInvoice[]> {
  const res = await api.GET('/dashboard/overdue');
  if (res.error) throw new Error('Failed to load overdue invoices');
  return (res.data as unknown as { data: OverdueInvoice[] }).data;
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function formatCurrency(amount: number | string, currency = 'MXN'): string {
  const num = typeof amount === 'string' ? parseFloat(amount) : amount;
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
  }).format(num);
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('es-MX', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

// ---------------------------------------------------------------------------
// KPI Card
// ---------------------------------------------------------------------------

interface KpiCardProps {
  label: string;
  value: string | number;
  sub?: string;
  icon: string;
  accent?: string;
  loading?: boolean;
  error?: boolean;
}

function KpiCard({ label, value, sub, icon, accent = '#e25822', loading, error }: KpiCardProps) {
  return (
    <div style={{ ...styles.card, borderTop: `3px solid ${accent}` }}>
      <div style={styles.cardIcon}>{icon}</div>
      <div style={styles.cardBody}>
        <div style={styles.cardLabel}>{label}</div>
        {loading ? (
          <div style={styles.cardLoading}>Loading…</div>
        ) : error ? (
          <div style={styles.cardError}>—</div>
        ) : (
          <>
            <div style={styles.cardValue}>{value}</div>
            {sub && <div style={styles.cardSub}>{sub}</div>}
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dashboard page
// ---------------------------------------------------------------------------

export function Dashboard() {
  const { user } = useAuth();

  const summaryQ = useQuery({ queryKey: ['dashboard-summary'], queryFn: fetchSummary });
  const mrrQ = useQuery({ queryKey: ['dashboard-mrr'], queryFn: fetchMrr });
  const healthQ = useQuery({ queryKey: ['dashboard-device-health'], queryFn: fetchDeviceHealth });
  const overdueQ = useQuery({ queryKey: ['dashboard-overdue'], queryFn: fetchOverdue });

  const summary  = summaryQ.data;
  const mrrRows  = mrrQ.data ?? [];
  const health   = healthQ.data;
  const overdue  = overdueQ.data ?? [];

  // Derived values
  const totalMrr       = mrrRows.reduce((sum, r) => sum + parseFloat(r.mrr), 0);
  const primaryCurrency = mrrRows[0]?.currency ?? 'MXN';
  const totalContracts  = mrrRows.reduce((sum, r) => sum + r.active_contracts, 0);

  const latestSnapshot = health?.health_snapshots?.[0];
  const avgUptime      = latestSnapshot?.avg_uptime ?? null;
  const totalDevices   = health?.devices_by_type.reduce((s, d) => s + d.total, 0) ?? 0;

  const overdueTotal = overdue.reduce((sum, inv) => sum + parseFloat(inv.total), 0);

  return (
    <div style={styles.page}>
      {/* Page header */}
      <div style={styles.header}>
        <div>
          <h1 style={styles.pageTitle}>Dashboard</h1>
          <p style={styles.welcomeMsg}>
            Welcome back, <strong>{user?.name ?? user?.email}</strong>
            {user?.role && (
              <> &nbsp;·&nbsp; <span style={styles.roleBadge}>{user.role}</span></>
            )}
          </p>
        </div>
      </div>

      {/* KPI cards */}
      <div style={styles.kpiGrid}>
        <KpiCard
          icon="👥"
          label="Active Clients"
          value={summary?.clients.active ?? '—'}
          sub={summary ? `${summary.clients.total} total` : undefined}
          accent="#3b82f6"
          loading={summaryQ.isLoading}
          error={!!summaryQ.error}
        />
        <KpiCard
          icon="💰"
          label="Monthly Recurring Revenue"
          value={mrrQ.isLoading || mrrQ.error ? '—' : formatCurrency(totalMrr, primaryCurrency)}
          sub={totalContracts > 0 ? `${totalContracts} active contracts` : undefined}
          accent="#10b981"
          loading={mrrQ.isLoading}
          error={!!mrrQ.error}
        />
        <KpiCard
          icon="⚠️"
          label="Overdue Invoices"
          value={overdueQ.isLoading || overdueQ.error ? '—' : overdue.length}
          sub={
            overdueQ.isLoading || overdueQ.error
              ? undefined
              : overdue.length > 0
              ? `${formatCurrency(overdueTotal, overdue[0]?.currency)} outstanding`
              : 'None outstanding'
          }
          accent="#ef4444"
          loading={overdueQ.isLoading}
          error={!!overdueQ.error}
        />
        <KpiCard
          icon="🎫"
          label="Open Tickets"
          value={summary?.tickets.open_count ?? '—'}
          sub={summary ? `${summary.tickets.total} total` : undefined}
          accent="#f59e0b"
          loading={summaryQ.isLoading}
          error={!!summaryQ.error}
        />
        <KpiCard
          icon="🖧"
          label="Device Uptime"
          value={
            healthQ.isLoading || healthQ.error
              ? '—'
              : avgUptime !== null
              ? `${avgUptime}%`
              : 'N/A'
          }
          sub={
            latestSnapshot
              ? `${latestSnapshot.device_count} devices · ${latestSnapshot.avg_latency} ms avg latency`
              : totalDevices > 0
              ? `${totalDevices} devices (no snapshots yet)`
              : undefined
          }
          accent="#8b5cf6"
          loading={healthQ.isLoading}
          error={!!healthQ.error}
        />
      </div>

      {/* Overdue invoices table */}
      <div style={styles.section}>
        <h2 style={styles.sectionTitle}>⚠️ Overdue Invoices</h2>
        {overdueQ.isLoading ? (
          <p style={styles.tableEmpty}>Loading…</p>
        ) : overdueQ.error ? (
          <p style={styles.tableError}>Failed to load overdue invoices.</p>
        ) : overdue.length === 0 ? (
          <p style={styles.tableEmpty}>🎉 No overdue invoices — great news!</p>
        ) : (
          <div style={styles.tableWrapper}>
            <table style={styles.table}>
              <thead>
                <tr>
                  {['Invoice #', 'Client', 'Amount', 'Due Date', 'Days Overdue'].map(h => (
                    <th key={h} style={styles.th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {overdue.slice(0, 20).map(inv => (
                  <tr key={inv.id} style={styles.tr}>
                    <td style={styles.td}>{inv.invoice_number}</td>
                    <td style={styles.td}>{inv.first_name} {inv.last_name}</td>
                    <td style={{ ...styles.td, fontVariantNumeric: 'tabular-nums' }}>
                      {formatCurrency(inv.total, inv.currency)}
                    </td>
                    <td style={styles.td}>{formatDate(inv.due_date)}</td>
                    <td
                      style={{
                        ...styles.td,
                        color:
                          inv.days_overdue > 60
                            ? '#ef4444'
                            : inv.days_overdue > 30
                            ? '#f59e0b'
                            : '#374151',
                        fontWeight: inv.days_overdue > 60 ? 700 : undefined,
                      }}
                    >
                      {inv.days_overdue}d
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {overdue.length > 20 && (
              <p style={styles.tableMore}>
                Showing top 20 of {overdue.length} overdue invoices.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = {
  page: {
    padding: '2rem',
    fontFamily: 'system-ui, sans-serif',
    maxWidth: 1200,
  },
  header: {
    marginBottom: '1.5rem',
  },
  pageTitle: { margin: 0, color: '#111827', fontSize: '1.5rem', fontWeight: 700 },
  welcomeMsg: { margin: '0.25rem 0 0', color: '#6b7280', fontSize: '0.9rem' },
  roleBadge: {
    background: '#e25822',
    color: '#fff',
    padding: '2px 8px',
    borderRadius: 12,
    fontSize: '0.72rem',
    fontWeight: 700,
  },
  kpiGrid: {
    display: 'grid' as const,
    gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
    gap: '1rem',
    marginBottom: '2rem',
  },
  card: {
    background: '#fff',
    borderRadius: 8,
    padding: '1.25rem 1rem',
    boxShadow: '0 1px 3px rgba(0,0,0,.08)',
    display: 'flex' as const,
    gap: '0.75rem',
    alignItems: 'flex-start' as const,
  },
  cardIcon: { fontSize: '1.5rem', lineHeight: '1' },
  cardBody: { flex: 1 },
  cardLabel: {
    color: '#6b7280',
    fontSize: '0.78rem',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.04em',
    marginBottom: '0.3rem',
  },
  cardValue: { color: '#111827', fontSize: '1.6rem', fontWeight: 700, lineHeight: '1.1' },
  cardSub: { color: '#9ca3af', fontSize: '0.78rem', marginTop: '0.25rem' },
  cardLoading: { color: '#9ca3af', fontSize: '0.85rem' },
  cardError: { color: '#ef4444', fontSize: '0.85rem' },
  section: {
    background: '#fff',
    borderRadius: 8,
    padding: '1.25rem',
    boxShadow: '0 1px 3px rgba(0,0,0,.08)',
  },
  sectionTitle: { margin: '0 0 1rem', color: '#111827', fontSize: '1rem', fontWeight: 600 },
  tableWrapper: { overflowX: 'auto' as const },
  table: { width: '100%', borderCollapse: 'collapse' as const, fontSize: '0.85rem' },
  th: {
    padding: '0.5rem 0.75rem',
    textAlign: 'left' as const,
    color: '#6b7280',
    fontSize: '0.75rem',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.04em',
    borderBottom: '2px solid #f3f4f6',
  },
  tr: { borderBottom: '1px solid #f3f4f6' },
  td: { padding: '0.55rem 0.75rem', color: '#374151' },
  tableEmpty: { color: '#6b7280', fontStyle: 'italic' as const, margin: 0 },
  tableError: { color: '#ef4444', margin: 0 },
  tableMore: { color: '#9ca3af', fontSize: '0.8rem', marginTop: '0.5rem', margin: '0.5rem 0 0' },
} as const;
