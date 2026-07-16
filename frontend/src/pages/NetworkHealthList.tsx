// =============================================================================
// FireISP 5.0 — Network Health Viewer
// =============================================================================
// Read-only analytics page at /network-health. Lists daily network health
// snapshots per device/link (uptime, latency, throughput, packet loss and
// downtime) for capacity planning and SLA reporting. Snapshots are aggregated
// by background jobs, so this is a read/analytics view and exposes no
// create/edit/delete actions.
// =============================================================================

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import { styles, fmtDate } from './crudStyles';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface NetworkHealthSnapshot {
  id: number;
  device_id: number | null;
  network_link_id: number | null;
  snapshot_date: string;
  uptime_pct: number | string | null;
  avg_latency_ms: number | string | null;
  max_latency_ms: number | string | null;
  avg_throughput_in_mbps: number | string | null;
  avg_throughput_out_mbps: number | string | null;
  packet_loss_pct: number | string | null;
  total_downtime_minutes: number | null;
}

interface NetworkHealthResponse {
  data: NetworkHealthSnapshot[];
  meta: { total: number; page: number; limit: number; totalPages?: number };
}

const DEFAULT_PAGE_SIZE = 50;

// ---------------------------------------------------------------------------
// Fetch helper
// ---------------------------------------------------------------------------

async function fetchNetworkHealth(page: number): Promise<NetworkHealthResponse> {
  const query = { page, limit: DEFAULT_PAGE_SIZE };
  const res = await api.GET('/network-health', { params: { query: query as never } });
  if (res.error) throw new Error('Failed to load network health snapshots');
  return res.data as unknown as NetworkHealthResponse;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtNum(v: number | string | null, suffix: string): string {
  if (v == null) return '—';
  const n = Number(v);
  if (Number.isNaN(n)) return '—';
  return `${n}${suffix}`;
}

function UptimeBadge({ value }: { value: number | string | null }) {
  if (value == null) return <span>—</span>;
  const n = Number(value);
  if (Number.isNaN(n)) return <span>—</span>;
  const ok = n >= 99.9;
  const warn = n >= 99 && n < 99.9;
  const bg = ok ? '#d1fae5' : warn ? '#fef3c7' : '#fee2e2';
  const color = ok ? '#065f46' : warn ? '#92400e' : '#991b1b';
  return (
    <span
      style={{
        background: bg,
        color,
        padding: '2px 8px',
        borderRadius: 12,
        fontSize: '0.72rem',
        fontWeight: 600,
      }}
    >
      {n.toFixed(2)}%
    </span>
  );
}

// ---------------------------------------------------------------------------
// NetworkHealthList component
// ---------------------------------------------------------------------------

export function NetworkHealthList() {
  const [page, setPage] = useState(1);

  const snapshotsQ = useQuery({
    queryKey: ['network-health', page],
    queryFn: () => fetchNetworkHealth(page),
  });

  const snapshots = snapshotsQ.data?.data ?? [];
  const meta = snapshotsQ.data?.meta;
  const totalPages = meta?.totalPages ?? (meta ? Math.max(1, Math.ceil(meta.total / meta.limit)) : 1);

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.pageTitle}>💓 Network Health</h1>
        {meta && <span style={styles.countBadge}>{meta.total} total</span>}
      </div>

      <div style={styles.tableCard}>
        {snapshotsQ.isLoading ? (
          <p style={styles.msg}>Loading…</p>
        ) : snapshotsQ.error ? (
          <p style={styles.msgError}>Failed to load network health snapshots.</p>
        ) : snapshots.length === 0 ? (
          <p style={styles.msg}>No network health snapshots found.</p>
        ) : (
          <>
            <div style={{ overflowX: 'auto' }}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    {['ID', 'Date', 'Device', 'Link', 'Uptime', 'Avg Latency', 'Max Latency', 'Avg In', 'Avg Out', 'Loss', 'Downtime'].map(
                      h => <th key={h} style={styles.th}>{h}</th>,
                    )}
                  </tr>
                </thead>
                <tbody>
                  {snapshots.map(s => (
                    <tr key={s.id} style={styles.tr}>
                      <td style={styles.td}>#{s.id}</td>
                      <td style={{ ...styles.td, whiteSpace: 'nowrap' }}>{s.snapshot_date ? fmtDate(s.snapshot_date) : '—'}</td>
                      <td style={styles.td}>
                        {s.device_id != null
                          ? <Link to={`/devices/${s.device_id}`}>{`#${s.device_id}`}</Link>
                          : '—'}
                      </td>
                      <td style={styles.td}>{s.network_link_id != null ? `#${s.network_link_id}` : '—'}</td>
                      <td style={styles.td}><UptimeBadge value={s.uptime_pct} /></td>
                      <td style={styles.td}>{fmtNum(s.avg_latency_ms, ' ms')}</td>
                      <td style={styles.td}>{fmtNum(s.max_latency_ms, ' ms')}</td>
                      <td style={styles.td}>{fmtNum(s.avg_throughput_in_mbps, ' Mbps')}</td>
                      <td style={styles.td}>{fmtNum(s.avg_throughput_out_mbps, ' Mbps')}</td>
                      <td style={styles.td}>{fmtNum(s.packet_loss_pct, '%')}</td>
                      <td style={styles.td}>{s.total_downtime_minutes != null ? `${s.total_downtime_minutes} min` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {totalPages > 1 && (
              <div style={styles.pagination}>
                <button style={styles.pageBtn} onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>
                  ← Prev
                </button>
                <span style={styles.pageInfo}>Page {page} of {totalPages}</span>
                <button
                  style={styles.pageBtn}
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                >
                  Next →
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
