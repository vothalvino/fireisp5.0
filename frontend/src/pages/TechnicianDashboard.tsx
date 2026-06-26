// =============================================================================
// FireISP 5.0 — Technician Dashboard
// =============================================================================
// A field/NOC dashboard for the technician role. Every widget is backed by an
// endpoint the technician permission set can actually load (verified against
// the backend requirePermission slugs), so nothing here shows "failed to load":
//   • Device uptime / monitored      → GET /dashboard/device-health (devices.view)
//   • Work orders (total + in-prog)   → GET /work-orders            (work_orders.view)
//   • Active alerts                   → GET /alerts/events          (devices.view)
//   • Due follow-ups                  → GET /follow-up-reminders/due (follow_ups.view)
//   • Tickets to escalate             → GET /escalations/candidates  (escalations.view)
//   • NAS / BNG devices               → GET /nas                     (devices.view)
// The admin/management dashboard (Dashboard.tsx) is unchanged.
// =============================================================================

import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useAuth } from '@/auth/AuthContext';
import { api } from '@/api/client';

// ---------------------------------------------------------------------------
// Response shapes (the OpenAPI spec uses generic `object` — cast at runtime)
// ---------------------------------------------------------------------------

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

interface WorkOrderRow {
  id: number;
  title: string;
  status: string;
  work_type: string | null;
  scheduled_at: string | null;
  client_name: string | null;
  site_name: string | null;
  device_name: string | null;
}

interface AlertRow {
  id: number;
  rule_name?: string | null;
  metric?: string | null;
  value?: number | string | null;
  status?: string | null;
  created_at?: string | null;
}

interface ListMeta { total: number; page: number; limit: number }

// ---------------------------------------------------------------------------
// Fetch helpers — use the typed api client (auth + silent refresh middleware).
// Several of these paths are generic in the OpenAPI spec, so cast through never.
// ---------------------------------------------------------------------------

async function fetchDeviceHealth(): Promise<DeviceHealthData> {
  const res = await api.GET('/dashboard/device-health');
  if (res.error) throw new Error('device-health');
  return (res.data as unknown as { data: DeviceHealthData }).data;
}

async function fetchWorkOrders(query: Record<string, string | number>): Promise<{ data: WorkOrderRow[]; meta: ListMeta }> {
  const res = await api.GET('/work-orders' as never, { params: { query: query as never } } as never);
  if ((res as { error?: unknown }).error) throw new Error('work-orders');
  return (res as { data: unknown }).data as { data: WorkOrderRow[]; meta: ListMeta };
}

async function fetchAlerts(): Promise<{ data: AlertRow[]; meta?: ListMeta }> {
  const res = await api.GET('/alerts/events' as never, { params: { query: { page: 1, limit: 8 } as never } } as never);
  if ((res as { error?: unknown }).error) throw new Error('alerts');
  return (res as { data: unknown }).data as { data: AlertRow[]; meta?: ListMeta };
}

async function fetchCount(path: string, query: Record<string, string | number> = {}): Promise<number> {
  const res = await api.GET(path as never, { params: { query: { limit: 1, ...query } as never } } as never);
  if ((res as { error?: unknown }).error) throw new Error(path);
  const body = (res as { data: unknown }).data as { meta?: ListMeta; data?: unknown[] };
  return body.meta?.total ?? body.data?.length ?? 0;
}

// ---------------------------------------------------------------------------
// Small presentational helpers
// ---------------------------------------------------------------------------

interface KpiCardProps {
  label: string;
  value: string | number;
  sub?: string;
  icon: string;
  accent: string;
  to?: string;
  loading?: boolean;
  error?: boolean;
}

function KpiCard({ label, value, sub, icon, accent, to, loading, error }: KpiCardProps) {
  const { t } = useTranslation();
  const body = (
    <div style={{ ...styles.card, borderTop: `3px solid ${accent}` }}>
      <div style={styles.cardIcon}>{icon}</div>
      <div style={styles.cardBody}>
        <div style={styles.cardLabel}>{label}</div>
        {loading ? (
          <div style={styles.cardLoading}>{t('dashboard.loadingKpi')}</div>
        ) : error ? (
          <div style={styles.cardError}>{t('common.errorDash')}</div>
        ) : (
          <>
            <div style={styles.cardValue}>{value}</div>
            {sub && <div style={styles.cardSub}>{sub}</div>}
          </>
        )}
      </div>
    </div>
  );
  return to ? (
    <Link to={to} style={{ textDecoration: 'none' }}>{body}</Link>
  ) : body;
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, { bg: string; color: string }> = {
    pending: { bg: '#fef3c7', color: '#92400e' },
    assigned: { bg: '#dbeafe', color: '#1e40af' },
    in_progress: { bg: '#ede9fe', color: '#5b21b6' },
    completed: { bg: '#d1fae5', color: '#065f46' },
    cancelled: { bg: '#f3f4f6', color: '#6b7280' },
    active: { bg: '#fee2e2', color: '#991b1b' },
    resolved: { bg: '#d1fae5', color: '#065f46' },
  };
  const s = colors[status] ?? { bg: '#f3f4f6', color: '#374151' };
  return (
    <span style={{ background: s.bg, color: s.color, padding: '2px 8px', borderRadius: 12, fontSize: '0.72rem', fontWeight: 600, textTransform: 'capitalize' }}>
      {String(status).replace(/_/g, ' ')}
    </span>
  );
}

function relativeTime(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('es-MX', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function TechnicianDashboard() {
  const { user } = useAuth();
  const { t } = useTranslation();

  const healthQ = useQuery({ queryKey: ['tech-device-health'], queryFn: fetchDeviceHealth });
  const recentWoQ = useQuery({
    queryKey: ['tech-work-orders-recent'],
    queryFn: () => fetchWorkOrders({ page: 1, limit: 8, order_by: 'created_at', order: 'DESC' }),
  });
  const inProgressQ = useQuery({
    queryKey: ['tech-work-orders-inprogress'],
    queryFn: () => fetchCount('/work-orders', { status: 'in_progress' }),
  });
  const alertsQ = useQuery({ queryKey: ['tech-alerts'], queryFn: fetchAlerts });
  const dueFollowUpsQ = useQuery({ queryKey: ['tech-due-followups'], queryFn: () => fetchCount('/follow-up-reminders/due') });
  const escalationsQ = useQuery({ queryKey: ['tech-escalations'], queryFn: () => fetchCount('/escalations/candidates') });
  const nasQ = useQuery({ queryKey: ['tech-nas-count'], queryFn: () => fetchCount('/nas') });

  // Derived device-health values
  const snapshot = healthQ.data?.health_snapshots?.[0];
  const byType = healthQ.data?.devices_by_type ?? [];
  const totalDevices = byType.reduce((s, d) => s + (d.total ?? 0), 0);
  const monitoredDevices = byType.reduce((s, d) => s + (d.monitored ?? 0), 0);

  const recentWorkOrders = recentWoQ.data?.data ?? [];
  const totalWorkOrders = recentWoQ.data?.meta?.total ?? 0;
  const recentAlerts = alertsQ.data?.data ?? [];

  const woTarget = (wo: WorkOrderRow) => wo.client_name || wo.site_name || wo.device_name || t('workOrders.none');

  return (
    <div style={styles.page}>
      {/* Header */}
      <div style={styles.header}>
        <div>
          <h1 style={styles.pageTitle}>{t('technicianDashboard.title')}</h1>
          <p style={styles.welcomeMsg}>
            {t('dashboard.welcome', { name: user?.name ?? user?.email })}
            <> &nbsp;·&nbsp; <span style={styles.roleBadge}>{t('technicianDashboard.subtitle')}</span></>
          </p>
        </div>
      </div>

      {/* KPI cards */}
      <div style={styles.kpiGrid}>
        <KpiCard
          icon="📡" accent="#8b5cf6"
          label={t('dashboard.kpi.deviceUptime')}
          value={snapshot?.avg_uptime != null ? `${snapshot.avg_uptime}%` : t('common.na')}
          sub={snapshot ? t('technicianDashboard.kpi.latencyMs', { latency: snapshot.avg_latency }) : undefined}
          loading={healthQ.isLoading} error={!!healthQ.error}
        />
        <KpiCard
          icon="🖧" accent="#3b82f6"
          label={t('technicianDashboard.kpi.devicesMonitored')}
          value={monitoredDevices}
          sub={t('technicianDashboard.kpi.ofTotalDevices', { total: totalDevices })}
          loading={healthQ.isLoading} error={!!healthQ.error}
        />
        <KpiCard
          icon="🔧" accent="#5b21b6" to="/work-orders"
          label={t('technicianDashboard.kpi.workOrdersInProgress')}
          value={inProgressQ.data ?? 0}
          sub={t('technicianDashboard.kpi.ofTotalWorkOrders', { total: totalWorkOrders })}
          loading={inProgressQ.isLoading || recentWoQ.isLoading} error={!!inProgressQ.error}
        />
        <KpiCard
          icon="🚨" accent="#ef4444"
          label={t('technicianDashboard.kpi.activeAlerts')}
          value={alertsQ.data?.meta?.total ?? recentAlerts.length}
          loading={alertsQ.isLoading} error={!!alertsQ.error}
        />
        <KpiCard
          icon="⏰" accent="#f59e0b" to="/follow-up-reminders"
          label={t('technicianDashboard.kpi.dueFollowUps')}
          value={dueFollowUpsQ.data ?? 0}
          loading={dueFollowUpsQ.isLoading} error={!!dueFollowUpsQ.error}
        />
        <KpiCard
          icon="📈" accent="#dc2626" to="/escalations"
          label={t('technicianDashboard.kpi.escalations')}
          value={escalationsQ.data ?? 0}
          loading={escalationsQ.isLoading} error={!!escalationsQ.error}
        />
        <KpiCard
          icon="🛰️" accent="#10b981" to="/nas"
          label={t('technicianDashboard.kpi.nasDevices')}
          value={nasQ.data ?? 0}
          loading={nasQ.isLoading} error={!!nasQ.error}
        />
      </div>

      {/* Recent work orders */}
      <div style={styles.section}>
        <div style={styles.sectionHeader}>
          <h2 style={styles.sectionTitle}>{t('technicianDashboard.recentWorkOrders')}</h2>
          <Link to="/work-orders" style={styles.sectionLink}>{t('technicianDashboard.viewAll')}</Link>
        </div>
        {recentWoQ.isLoading ? (
          <p style={styles.tableEmpty}>{t('common.loading')}</p>
        ) : recentWoQ.error ? (
          <p style={styles.tableError}>{t('common.errorDash')}</p>
        ) : recentWorkOrders.length === 0 ? (
          <p style={styles.tableEmpty}>{t('technicianDashboard.noWorkOrders')}</p>
        ) : (
          <div style={styles.tableWrapper}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>{t('common.id')}</th>
                  <th style={styles.th}>{t('technicianDashboard.col.title')}</th>
                  <th style={styles.th}>{t('workOrders.target')}</th>
                  <th style={styles.th}>{t('technicianDashboard.col.status')}</th>
                  <th style={styles.th}>{t('technicianDashboard.col.scheduled')}</th>
                </tr>
              </thead>
              <tbody>
                {recentWorkOrders.map(wo => (
                  <tr key={wo.id} style={styles.tr}>
                    <td style={styles.td}>{wo.id}</td>
                    <td style={styles.td}>{wo.title}</td>
                    <td style={styles.td}>{woTarget(wo)}</td>
                    <td style={styles.td}><StatusBadge status={wo.status} /></td>
                    <td style={styles.td}>{wo.scheduled_at ? wo.scheduled_at.slice(0, 10) : t('common.na')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Recent alerts */}
      <div style={styles.section}>
        <h2 style={styles.sectionTitle}>{t('technicianDashboard.recentAlerts')}</h2>
        {alertsQ.isLoading ? (
          <p style={styles.tableEmpty}>{t('common.loading')}</p>
        ) : alertsQ.error ? (
          <p style={styles.tableError}>{t('common.errorDash')}</p>
        ) : recentAlerts.length === 0 ? (
          <p style={styles.tableEmpty}>{t('technicianDashboard.noAlerts')}</p>
        ) : (
          <div style={styles.tableWrapper}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>{t('technicianDashboard.col.rule')}</th>
                  <th style={styles.th}>{t('technicianDashboard.col.metric')}</th>
                  <th style={styles.th}>{t('technicianDashboard.col.status')}</th>
                  <th style={styles.th}>{t('technicianDashboard.col.time')}</th>
                </tr>
              </thead>
              <tbody>
                {recentAlerts.map(a => (
                  <tr key={a.id} style={styles.tr}>
                    <td style={styles.td}>{a.rule_name ?? `#${a.id}`}</td>
                    <td style={styles.td}>
                      {a.metric ? `${a.metric}${a.value != null ? ` = ${a.value}` : ''}` : '—'}
                    </td>
                    <td style={styles.td}>{a.status ? <StatusBadge status={a.status} /> : '—'}</td>
                    <td style={styles.td}>{relativeTime(a.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Styles (mirrors Dashboard.tsx tokens)
// ---------------------------------------------------------------------------

const styles = {
  page: { padding: '2rem', fontFamily: 'var(--font-sans)', maxWidth: 1200 },
  header: { marginBottom: '1.5rem', display: 'flex' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const, flexWrap: 'wrap' as const, gap: '0.5rem' },
  pageTitle: { margin: 0, color: 'var(--text-primary)', fontSize: '1.5rem', fontWeight: 700 },
  welcomeMsg: { margin: '0.25rem 0 0', color: 'var(--text-muted)', fontSize: '0.9rem' },
  roleBadge: { background: 'var(--accent)', color: '#fff', padding: '2px 8px', borderRadius: 12, fontSize: '0.72rem', fontWeight: 700 },
  kpiGrid: { display: 'grid' as const, gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '1rem', marginBottom: '2rem' },
  card: { background: 'var(--bg-card)', borderRadius: 8, padding: '1.25rem 1rem', boxShadow: '0 0 0 1px var(--border)', display: 'flex' as const, gap: '0.75rem', alignItems: 'flex-start' as const, height: '100%' },
  cardIcon: { fontSize: '1.5rem', lineHeight: '1' },
  cardBody: { flex: 1 },
  cardLabel: { color: 'var(--text-muted)', fontSize: '0.78rem', textTransform: 'uppercase' as const, letterSpacing: '0.04em', marginBottom: '0.3rem' },
  cardValue: { color: 'var(--text-primary)', fontSize: '1.6rem', fontWeight: 700, lineHeight: '1.1', fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' as const },
  cardSub: { color: 'var(--text-dimmed)', fontSize: '0.78rem', marginTop: '0.25rem' },
  cardLoading: { color: 'var(--text-dimmed)', fontSize: '0.85rem' },
  cardError: { color: '#ef4444', fontSize: '0.85rem' },
  section: { background: 'var(--bg-card)', borderRadius: 8, padding: '1.25rem', boxShadow: '0 0 0 1px var(--border)', marginBottom: '1.5rem' },
  sectionHeader: { display: 'flex' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const, marginBottom: '1rem' },
  sectionTitle: { margin: '0 0 1rem', color: 'var(--text-primary)', fontSize: '1rem', fontWeight: 600 },
  sectionLink: { color: 'var(--accent)', fontSize: '0.82rem', textDecoration: 'none', fontWeight: 600 },
  tableWrapper: { overflowX: 'auto' as const },
  table: { width: '100%', borderCollapse: 'collapse' as const, fontSize: '0.85rem' },
  th: { padding: '0.5rem 0.75rem', textAlign: 'left' as const, color: 'var(--text-muted)', fontSize: '0.75rem', textTransform: 'uppercase' as const, letterSpacing: '0.04em', borderBottom: '2px solid var(--border-subtle)' },
  tr: { borderBottom: '1px solid var(--border-subtle)' },
  td: { padding: '0.55rem 0.75rem', color: 'var(--text-secondary)' },
  tableEmpty: { color: 'var(--text-muted)', fontStyle: 'italic' as const, margin: 0 },
  tableError: { color: '#ef4444', margin: 0 },
};
