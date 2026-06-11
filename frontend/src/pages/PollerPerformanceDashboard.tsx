// =============================================================================
// FireISP 5.0 — Poller Performance Dashboard (§6.4)
// =============================================================================
// Read-only dashboard at /poller-performance. Shows aggregated stats and
// a table of recent performance snapshots across all poller nodes.
// =============================================================================

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';
import { styles } from './crudStyles';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PollerPerformanceDashboard {
  hours: number;
  total_snapshots: number;
  total_devices_polled: number;
  total_devices_failed: number;
  avg_poll_duration_ms: number | null;
  max_poll_duration_ms: number | null;
  timeout_rate_pct: number | null;
}

interface PerformanceSnapshot {
  id: number;
  poller_node_id: number | null;
  node_name: string | null;
  snapshot_at: string;
  devices_polled: number;
  devices_failed: number;
  avg_poll_duration_ms: number | null;
  max_poll_duration_ms: number | null;
  queue_depth: number;
  timeout_rate_pct: string | null;
}

interface DashboardResponse {
  data: PollerPerformanceDashboard;
  snapshots: PerformanceSnapshot[];
}

// ---------------------------------------------------------------------------
// Fetch helpers
// ---------------------------------------------------------------------------

async function fetchDashboard(hours: number): Promise<DashboardResponse> {
  const res = await api.GET('/poller-performance/dashboard' as never, { params: { query: { hours } as never } } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to load performance data');
  return (res as { data: unknown }).data as unknown as DashboardResponse;
}

// ---------------------------------------------------------------------------
// Summary card
// ---------------------------------------------------------------------------

function StatCard({ label, value }: { label: string; value: string | number | null }) {
  return (
    <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 8, padding: '1rem 1.25rem', minWidth: 140 }}>
      <div style={{ fontSize: '0.75rem', color: '#6b7280', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#111827' }}>{value ?? '—'}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page component
// ---------------------------------------------------------------------------

export function PollerPerformanceDashboard() {
  const { t } = useTranslation();
  const [hours, setHours] = useState(24);

  const dashQ = useQuery({
    queryKey: ['poller-performance-dashboard', hours],
    queryFn: () => fetchDashboard(hours),
    refetchInterval: 60_000, // auto-refresh every minute
  });

  const dashboard = dashQ.data?.data;
  const snapshots = dashQ.data?.snapshots ?? [];

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.pageTitle}>{t('poller_performance.title', 'Poller Performance')}</h1>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          <label style={{ fontSize: '0.85rem', color: '#6b7280' }}>Lookback:</label>
          <select
            style={{ padding: '0.35rem 0.6rem', borderRadius: 6, border: '1px solid #d1d5db', fontSize: '0.85rem' }}
            value={hours}
            onChange={e => setHours(parseInt(e.target.value, 10))}
          >
            <option value={1}>1 hour</option>
            <option value={6}>6 hours</option>
            <option value={24}>24 hours</option>
            <option value={72}>3 days</option>
            <option value={168}>7 days</option>
          </select>
        </div>
      </div>

      {dashQ.isLoading && <p style={styles.msg}>Loading...</p>}
      {dashQ.error && <p style={styles.msgError}>{t('poller_performance.error', 'Failed to load performance data.')}</p>}

      {dashboard && (
        <>
          <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginBottom: '1.5rem' }}>
            <StatCard label={t('poller_performance.devices_polled', 'Devices Polled')} value={dashboard.total_devices_polled} />
            <StatCard label={t('poller_performance.devices_failed', 'Devices Failed')} value={dashboard.total_devices_failed} />
            <StatCard label={t('poller_performance.avg_poll_duration', 'Avg Duration (ms)')} value={dashboard.avg_poll_duration_ms} />
            <StatCard label={t('poller_performance.max_poll_duration', 'Max Duration (ms)')} value={dashboard.max_poll_duration_ms} />
            <StatCard label={t('poller_performance.timeout_rate', 'Timeout Rate (%)')} value={dashboard.timeout_rate_pct != null ? `${dashboard.timeout_rate_pct}%` : null} />
          </div>

          <div style={styles.tableCard}>
            {snapshots.length === 0 ? (
              <p style={styles.msg}>{t('poller_performance.empty', 'No performance snapshots found.')}</p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={styles.table}>
                  <thead>
                    <tr>
                      <th style={styles.th}>{t('poller_performance.snapshot_at', 'Snapshot Time')}</th>
                      <th style={styles.th}>Node</th>
                      <th style={styles.th}>{t('poller_performance.devices_polled', 'Polled')}</th>
                      <th style={styles.th}>{t('poller_performance.devices_failed', 'Failed')}</th>
                      <th style={styles.th}>{t('poller_performance.avg_poll_duration', 'Avg (ms)')}</th>
                      <th style={styles.th}>{t('poller_performance.queue_depth', 'Queue')}</th>
                      <th style={styles.th}>{t('poller_performance.timeout_rate', 'Timeout %')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {snapshots.map(s => (
                      <tr key={s.id} style={styles.tr}>
                        <td style={styles.td}>{new Date(s.snapshot_at).toLocaleString()}</td>
                        <td style={styles.td}>{s.node_name ?? `#${s.poller_node_id}`}</td>
                        <td style={styles.td}>{s.devices_polled}</td>
                        <td style={{ ...styles.td, color: s.devices_failed > 0 ? '#dc2626' : undefined }}>{s.devices_failed}</td>
                        <td style={styles.td}>{s.avg_poll_duration_ms ?? '—'}</td>
                        <td style={styles.td}>{s.queue_depth}</td>
                        <td style={styles.td}>{s.timeout_rate_pct ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
