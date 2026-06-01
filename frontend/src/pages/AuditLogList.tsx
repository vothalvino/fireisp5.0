// =============================================================================
// FireISP 5.0 — Audit Log Viewer
// =============================================================================
// Standalone read-only page at /audit-logs. Lists audit trail entries with
// filters (action, user, date range) and pagination. Data is fetched through
// the typed `api` client + React Query. Audit logs are immutable, so there are
// no create/edit/delete actions.
// =============================================================================

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import { styles, capitalize, fmtDate } from './crudStyles';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AuditLog {
  id: number;
  user_id: number | null;
  action: string;
  entity_type: string;
  entity_id: number | null;
  summary: string | null;
  ip_address: string | null;
  created_at: string;
}

interface AuditLogsResponse {
  data: AuditLog[];
  meta: { total: number; page: number; limit: number };
}

interface Filters {
  action: string;
  user_id: string;
  date_from: string;
  date_to: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_PAGE_SIZE = 50;
const ACTIONS = ['create', 'update', 'delete', 'login', 'logout', 'export', 'other'];

// ---------------------------------------------------------------------------
// Fetch helper
// ---------------------------------------------------------------------------

async function fetchAuditLogs(page: number, filters: Filters): Promise<AuditLogsResponse> {
  const query: Record<string, string | number> = { page, limit: DEFAULT_PAGE_SIZE };
  if (filters.action) query.action = filters.action;
  if (filters.user_id) query.user_id = filters.user_id;
  if (filters.date_from) query.date_from = filters.date_from;
  if (filters.date_to) query.date_to = filters.date_to;
  const res = await api.GET('/audit-logs', { params: { query: query as never } });
  if (res.error) throw new Error('Failed to load audit logs');
  return res.data as unknown as AuditLogsResponse;
}

// ---------------------------------------------------------------------------
// Action badge
// ---------------------------------------------------------------------------

function ActionBadge({ action }: { action: string }) {
  const map: Record<string, { bg: string; color: string }> = {
    create: { bg: '#d1fae5', color: '#065f46' },
    update: { bg: '#dbeafe', color: '#1e40af' },
    delete: { bg: '#fee2e2', color: '#991b1b' },
    login: { bg: '#ede9fe', color: '#5b21b6' },
    logout: { bg: '#f3f4f6', color: '#374151' },
    export: { bg: '#fef3c7', color: '#92400e' },
  };
  const s = map[action] ?? { bg: '#f3f4f6', color: '#374151' };
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
      {action}
    </span>
  );
}

// ---------------------------------------------------------------------------
// AuditLogList component
// ---------------------------------------------------------------------------

const EMPTY_FILTERS: Filters = { action: '', user_id: '', date_from: '', date_to: '' };

export function AuditLogList() {
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);

  const logsQ = useQuery({
    queryKey: ['audit-logs', page, filters],
    queryFn: () => fetchAuditLogs(page, filters),
  });

  function setFilter(name: keyof Filters, value: string) {
    setFilters(prev => ({ ...prev, [name]: value }));
    setPage(1);
  }

  function clearFilters() {
    setFilters(EMPTY_FILTERS);
    setPage(1);
  }

  const logs = logsQ.data?.data ?? [];
  const meta = logsQ.data?.meta;
  const totalPages = meta ? Math.max(1, Math.ceil(meta.total / meta.limit)) : 1;
  const hasFilters = Boolean(filters.action || filters.user_id || filters.date_from || filters.date_to);

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.pageTitle}>📜 Audit Logs</h1>
        {meta && <span style={styles.countBadge}>{meta.total} total</span>}
      </div>

      <div style={{ ...styles.filterRow, flexWrap: 'wrap' }}>
        <label style={styles.filterLabel}>Action:</label>
        <select
          style={styles.filterSelect}
          value={filters.action}
          onChange={e => setFilter('action', e.target.value)}
        >
          <option value="">All</option>
          {ACTIONS.map(a => <option key={a} value={a}>{capitalize(a)}</option>)}
        </select>

        <label style={styles.filterLabel}>User ID:</label>
        <input
          style={{ ...styles.filterSelect, width: 90 }}
          type="number"
          min={1}
          value={filters.user_id}
          onChange={e => setFilter('user_id', e.target.value)}
          placeholder="Any"
        />

        <label style={styles.filterLabel}>From:</label>
        <input
          style={styles.filterSelect}
          type="date"
          value={filters.date_from}
          onChange={e => setFilter('date_from', e.target.value)}
        />

        <label style={styles.filterLabel}>To:</label>
        <input
          style={styles.filterSelect}
          type="date"
          value={filters.date_to}
          onChange={e => setFilter('date_to', e.target.value)}
        />

        {hasFilters && (
          <button type="button" style={styles.btnSecondary} onClick={clearFilters}>
            Clear filters
          </button>
        )}
      </div>

      <div style={styles.tableCard}>
        {logsQ.isLoading ? (
          <p style={styles.msg}>Loading…</p>
        ) : logsQ.error ? (
          <p style={styles.msgError}>Failed to load audit logs.</p>
        ) : logs.length === 0 ? (
          <p style={styles.msg}>No audit log entries found{hasFilters ? ' for the selected filters' : ''}.</p>
        ) : (
          <>
            <div style={{ overflowX: 'auto' }}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    {['Time', 'User', 'Action', 'Entity', 'Entity ID', 'Summary', 'IP'].map(
                      h => <th key={h} style={styles.th}>{h}</th>,
                    )}
                  </tr>
                </thead>
                <tbody>
                  {logs.map(l => (
                    <tr key={l.id} style={styles.tr}>
                      <td style={{ ...styles.td, whiteSpace: 'nowrap' }}>{fmtDate(l.created_at)}</td>
                      <td style={styles.td}>{l.user_id != null ? `#${l.user_id}` : 'System'}</td>
                      <td style={styles.td}><ActionBadge action={l.action} /></td>
                      <td style={styles.td}>{l.entity_type}</td>
                      <td style={styles.td}>{l.entity_id != null ? `#${l.entity_id}` : '—'}</td>
                      <td style={{ ...styles.td, maxWidth: 320, overflowWrap: 'anywhere' }}>{l.summary ?? '—'}</td>
                      <td style={styles.td}>{l.ip_address ?? '—'}</td>
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
