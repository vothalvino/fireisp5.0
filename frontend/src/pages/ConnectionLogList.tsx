// =============================================================================
// FireISP 5.0 — Connection Log Viewer
// =============================================================================
// Read-only analytics page at /connection-logs. Lists RADIUS accounting events
// (session start / interim-update / stop) with the assigned IP, byte counters
// and session duration for the client/contract under each session. This is a
// compliance/audit history view and exposes no create/edit/delete actions.
// =============================================================================

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import { styles, fmtDate } from './crudStyles';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ConnectionLog {
  id: number;
  contract_id: number;
  client_id: number;
  username: string;
  ip_address: string | null;
  event_type: string;
  bytes_in: number | string | null;
  bytes_out: number | string | null;
  session_duration: number | null;
  event_at: string | null;
}

interface ConnectionLogResponse {
  data: ConnectionLog[];
  meta: { total: number; page: number; limit: number; totalPages?: number };
}

const DEFAULT_PAGE_SIZE = 50;
const EVENT_FILTER_OPTIONS = ['', 'start', 'stop', 'interim-update'];

// ---------------------------------------------------------------------------
// Fetch helper
// ---------------------------------------------------------------------------

async function fetchConnectionLogs(page: number, eventFilter: string): Promise<ConnectionLogResponse> {
  const query: Record<string, string | number> = { page, limit: DEFAULT_PAGE_SIZE };
  if (eventFilter) query.event_type = eventFilter;
  const res = await api.GET('/connection-logs', { params: { query: query as never } });
  if (res.error) throw new Error('Failed to load connection logs');
  return res.data as unknown as ConnectionLogResponse;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function EventBadge({ event }: { event: string }) {
  const map: Record<string, { bg: string; color: string }> = {
    start: { bg: '#d1fae5', color: '#065f46' },
    stop: { bg: '#fee2e2', color: '#991b1b' },
    'interim-update': { bg: '#dbeafe', color: '#1e40af' },
  };
  const s = map[event] ?? { bg: '#f3f4f6', color: '#374151' };
  return (
    <span
      style={{
        background: s.bg,
        color: s.color,
        padding: '2px 8px',
        borderRadius: 12,
        fontSize: '0.72rem',
        fontWeight: 600,
      }}
    >
      {event}
    </span>
  );
}

function fmtBytes(v: number | string | null): string {
  if (v == null) return '—';
  const n = Number(v);
  if (Number.isNaN(n)) return '—';
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = n / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value.toFixed(1)} ${units[i]}`;
}

function fmtDuration(sec: number | null): string {
  if (sec == null) return '—';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

// ---------------------------------------------------------------------------
// ConnectionLogList component
// ---------------------------------------------------------------------------

export function ConnectionLogList() {
  const [page, setPage] = useState(1);
  const [eventFilter, setEventFilter] = useState('');

  const logsQ = useQuery({
    queryKey: ['connection-logs', page, eventFilter],
    queryFn: () => fetchConnectionLogs(page, eventFilter),
  });

  function handleFilterChange(value: string) {
    setEventFilter(value);
    setPage(1);
  }

  const logs = logsQ.data?.data ?? [];
  const meta = logsQ.data?.meta;
  const totalPages = meta?.totalPages ?? (meta ? Math.max(1, Math.ceil(meta.total / meta.limit)) : 1);

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.pageTitle}>📡 Connection Logs</h1>
        {meta && <span style={styles.countBadge}>{meta.total} total</span>}
      </div>

      <div style={styles.filterRow}>
        <label style={styles.filterLabel}>Event:</label>
        <select
          style={styles.filterSelect}
          value={eventFilter}
          onChange={e => handleFilterChange(e.target.value)}
        >
          {EVENT_FILTER_OPTIONS.map(e => (
            <option key={e} value={e}>{e || 'All'}</option>
          ))}
        </select>
        {eventFilter && (
          <button type="button" style={styles.btnSecondary} onClick={() => handleFilterChange('')}>
            Clear filter
          </button>
        )}
      </div>

      <div style={styles.tableCard}>
        {logsQ.isLoading ? (
          <p style={styles.msg}>Loading…</p>
        ) : logsQ.error ? (
          <p style={styles.msgError}>Failed to load connection logs.</p>
        ) : logs.length === 0 ? (
          <p style={styles.msg}>No connection logs found{eventFilter ? ` for event "${eventFilter}"` : ''}.</p>
        ) : (
          <>
            <div style={{ overflowX: 'auto' }}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    {['ID', 'Client', 'Contract', 'Username', 'IP', 'Event', 'In', 'Out', 'Duration', 'When'].map(
                      h => <th key={h} style={styles.th}>{h}</th>,
                    )}
                  </tr>
                </thead>
                <tbody>
                  {logs.map(l => (
                    <tr key={`${l.id}-${l.event_at ?? ''}`} style={styles.tr}>
                      <td style={styles.td}>#{l.id}</td>
                      <td style={styles.td}>#{l.client_id}</td>
                      <td style={styles.td}>#{l.contract_id}</td>
                      <td style={{ ...styles.td, fontFamily: 'monospace', fontSize: '0.78rem' }}>{l.username}</td>
                      <td style={{ ...styles.td, fontFamily: 'monospace', fontSize: '0.78rem' }}>{l.ip_address ?? '—'}</td>
                      <td style={styles.td}><EventBadge event={l.event_type} /></td>
                      <td style={styles.td}>{fmtBytes(l.bytes_in)}</td>
                      <td style={styles.td}>{fmtBytes(l.bytes_out)}</td>
                      <td style={styles.td}>{fmtDuration(l.session_duration)}</td>
                      <td style={{ ...styles.td, whiteSpace: 'nowrap' }}>{l.event_at ? fmtDate(l.event_at) : '—'}</td>
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
