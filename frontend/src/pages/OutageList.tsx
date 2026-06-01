// =============================================================================
// FireISP 5.0 — Outage Viewer
// =============================================================================
// Read-only page at /outages. Lists logged network outages (planned and
// unplanned) with their severity, lifecycle status, affected scope and
// start/resolved timestamps for operational visibility and post-mortems. This
// is a monitoring/history view and exposes no create/edit/delete actions.
// =============================================================================

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import { styles, fmtDate } from './crudStyles';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Outage {
  id: number;
  site_id: number | null;
  device_id: number | null;
  outage_type: string;
  title: string;
  description: string | null;
  severity: string;
  started_at: string | null;
  resolved_at: string | null;
  affected_clients_count: number | null;
  status: string;
}

interface OutageResponse {
  data: Outage[];
  meta: { total: number; page: number; limit: number; totalPages?: number };
}

const DEFAULT_PAGE_SIZE = 50;
const STATUS_FILTER_OPTIONS = ['', 'ongoing', 'resolved', 'post_mortem'];

// ---------------------------------------------------------------------------
// Fetch helper
// ---------------------------------------------------------------------------

async function fetchOutages(page: number, statusFilter: string): Promise<OutageResponse> {
  const query: Record<string, string | number> = { page, limit: DEFAULT_PAGE_SIZE };
  if (statusFilter) query.status = statusFilter;
  const res = await api.GET('/outages', { params: { query: query as never } });
  if (res.error) throw new Error('Failed to load outages');
  return res.data as unknown as OutageResponse;
}

// ---------------------------------------------------------------------------
// Badges
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; color: string }> = {
    ongoing: { bg: '#fee2e2', color: '#991b1b' },
    resolved: { bg: '#d1fae5', color: '#065f46' },
    post_mortem: { bg: '#dbeafe', color: '#1e40af' },
  };
  const s = map[status] ?? { bg: '#f3f4f6', color: '#374151' };
  return (
    <span
      style={{
        background: s.bg,
        color: s.color,
        padding: '2px 8px',
        borderRadius: 12,
        fontSize: '0.72rem',
        fontWeight: 600,
        textTransform: 'capitalize',
      }}
    >
      {status.replace(/_/g, ' ')}
    </span>
  );
}

function SeverityBadge({ severity }: { severity: string }) {
  const map: Record<string, { bg: string; color: string }> = {
    minor: { bg: '#f3f4f6', color: '#374151' },
    major: { bg: '#fef3c7', color: '#92400e' },
    critical: { bg: '#fee2e2', color: '#991b1b' },
  };
  const s = map[severity] ?? { bg: '#f3f4f6', color: '#374151' };
  return (
    <span
      style={{
        background: s.bg,
        color: s.color,
        padding: '2px 8px',
        borderRadius: 12,
        fontSize: '0.72rem',
        fontWeight: 600,
        textTransform: 'capitalize',
      }}
    >
      {severity}
    </span>
  );
}

// ---------------------------------------------------------------------------
// OutageList component
// ---------------------------------------------------------------------------

export function OutageList() {
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('');

  const outagesQ = useQuery({
    queryKey: ['outages', page, statusFilter],
    queryFn: () => fetchOutages(page, statusFilter),
  });

  function handleFilterChange(value: string) {
    setStatusFilter(value);
    setPage(1);
  }

  const outages = outagesQ.data?.data ?? [];
  const meta = outagesQ.data?.meta;
  const totalPages = meta?.totalPages ?? (meta ? Math.max(1, Math.ceil(meta.total / meta.limit)) : 1);

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.pageTitle}>🚧 Outages</h1>
        {meta && <span style={styles.countBadge}>{meta.total} total</span>}
      </div>

      <div style={styles.filterRow}>
        <label style={styles.filterLabel}>Status:</label>
        <select
          style={styles.filterSelect}
          value={statusFilter}
          onChange={e => handleFilterChange(e.target.value)}
        >
          {STATUS_FILTER_OPTIONS.map(s => (
            <option key={s} value={s}>{s ? s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : 'All'}</option>
          ))}
        </select>
        {statusFilter && (
          <button type="button" style={styles.btnSecondary} onClick={() => handleFilterChange('')}>
            Clear filter
          </button>
        )}
      </div>

      <div style={styles.tableCard}>
        {outagesQ.isLoading ? (
          <p style={styles.msg}>Loading…</p>
        ) : outagesQ.error ? (
          <p style={styles.msgError}>Failed to load outages.</p>
        ) : outages.length === 0 ? (
          <p style={styles.msg}>No outages found{statusFilter ? ` with status "${statusFilter.replace(/_/g, ' ')}"` : ''}.</p>
        ) : (
          <>
            <div style={{ overflowX: 'auto' }}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    {['ID', 'Title', 'Type', 'Severity', 'Status', 'Affected', 'Started', 'Resolved'].map(
                      h => <th key={h} style={styles.th}>{h}</th>,
                    )}
                  </tr>
                </thead>
                <tbody>
                  {outages.map(o => (
                    <tr key={o.id} style={styles.tr}>
                      <td style={styles.td}>#{o.id}</td>
                      <td style={{ ...styles.td, fontWeight: 500, maxWidth: 280, overflowWrap: 'anywhere' }}>{o.title}</td>
                      <td style={{ ...styles.td, textTransform: 'capitalize' }}>{o.outage_type}</td>
                      <td style={styles.td}><SeverityBadge severity={o.severity} /></td>
                      <td style={styles.td}><StatusBadge status={o.status} /></td>
                      <td style={styles.td}>{o.affected_clients_count != null ? o.affected_clients_count : '—'}</td>
                      <td style={{ ...styles.td, whiteSpace: 'nowrap' }}>{o.started_at ? fmtDate(o.started_at) : '—'}</td>
                      <td style={{ ...styles.td, whiteSpace: 'nowrap' }}>{o.resolved_at ? fmtDate(o.resolved_at) : '—'}</td>
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
