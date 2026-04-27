// =============================================================================
// FireISP 5.0 — RADIUS Session Viewer
// =============================================================================
// Page at /radius-sessions. Shows live PPPoE sessions pulled from
// connection_logs (start events with no corresponding stop event).
//
// Features:
//   • Summary bar: total active, total ↓ bytes, total ↑ bytes
//   • Filters: username search, IP address search, NAS IP filter
//   • Auto-refresh toggle (polls every 30 s when enabled)
//   • Paginated table: username, client IP, NAS IP, started, duration,
//     bytes ↓/↑, session-id
//   • Disconnect action — posts to /radius/:radius_id/disconnect
// =============================================================================

import { useState, useEffect, useRef } from 'react';
import type { CSSProperties, FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { tokenStore } from '@/api/client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ActiveSession {
  id: number;
  contract_id: number;
  client_id: number;
  nas_id: number | null;
  username: string;
  session_id: string | null;
  ip_address: string | null;
  ipv6_address: string | null;
  nas_ip_address: string | null;
  event_type: string;
  bytes_in: number | null;
  bytes_out: number | null;
  session_duration: number | null;
  event_at: string;
}

interface ActiveSessionsResponse {
  data: ActiveSession[];
  meta: { total: number; page: number; limit: number };
}

interface RadiusAccount {
  id: number;
  contract_id: number;
  username: string;
}

// ---------------------------------------------------------------------------
// Constants & helpers
// ---------------------------------------------------------------------------

const PAGE_SIZE = 50;
const API_BASE = '/api/v1';
const REFRESH_INTERVAL_MS = 30_000;

function formatBytes(bytes: number | null): string {
  if (bytes == null) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(3)} GB`;
}

function formatSessionId(sessionId: string | null): string {
  if (!sessionId) return '—';
  return sessionId.length > 16 ? `${sessionId.slice(0, 16)}…` : sessionId;
}

function formatDuration(seconds: number | null): string {
  if (seconds == null) return '—';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function sessionDuration(eventAt: string): string {
  const startMs = new Date(eventAt).getTime();
  const nowMs = Date.now();
  const seconds = Math.floor((nowMs - startMs) / 1000);
  return formatDuration(seconds);
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString();
}

async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = tokenStore.getAccess();
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error || `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function RadiusSessions() {
  const qc = useQueryClient();

  // Filter state
  const [usernameFilter, setUsernameFilter] = useState('');
  const [ipFilter, setIpFilter] = useState('');
  const [nasIpFilter, setNasIpFilter] = useState('');

  // Applied (debounced) filters
  const [appliedUsername, setAppliedUsername] = useState('');
  const [appliedIp, setAppliedIp] = useState('');
  const [appliedNasIp, setAppliedNasIp] = useState('');

  const [page, setPage] = useState(1);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastRefreshed, setLastRefreshed] = useState<Date>(new Date());

  // Disconnect dialog
  const [disconnectTarget, setDisconnectTarget] = useState<ActiveSession | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);
  const [disconnectError, setDisconnectError] = useState('');
  const [disconnectSuccess, setDisconnectSuccess] = useState('');

  // Auto-refresh ticker
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function buildQueryKey() {
    return ['radius-active-sessions', appliedUsername, appliedIp, appliedNasIp, page];
  }

  const { data, isFetching, refetch } = useQuery<ActiveSessionsResponse>({
    queryKey: buildQueryKey(),
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
      if (appliedUsername) params.set('username', appliedUsername);
      if (appliedIp) params.set('ip_address', appliedIp);
      if (appliedNasIp) params.set('nas_ip_address', appliedNasIp);
      const result = await apiFetch<ActiveSessionsResponse>(`/connection-logs/active?${params}`);
      setLastRefreshed(new Date());
      return result;
    },
    refetchOnWindowFocus: false,
  });

  // Start/stop auto-refresh timer
  useEffect(() => {
    if (autoRefresh) {
      timerRef.current = setInterval(() => {
        refetch();
      }, REFRESH_INTERVAL_MS);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [autoRefresh, refetch]);

  function handleFilterSubmit(e: FormEvent) {
    e.preventDefault();
    setAppliedUsername(usernameFilter);
    setAppliedIp(ipFilter);
    setAppliedNasIp(nasIpFilter);
    setPage(1);
  }

  function handleFilterClear() {
    setUsernameFilter('');
    setIpFilter('');
    setNasIpFilter('');
    setAppliedUsername('');
    setAppliedIp('');
    setAppliedNasIp('');
    setPage(1);
  }

  async function handleDisconnect(session: ActiveSession) {
    setDisconnectTarget(session);
    setDisconnectError('');
    setDisconnectSuccess('');
  }

  async function confirmDisconnect() {
    if (!disconnectTarget) return;
    setDisconnecting(true);
    setDisconnectError('');
    try {
      // Find the RADIUS account for this contract to get the radius ID
      const radiusRes = await apiFetch<{ data: RadiusAccount[] }>(
        `/radius/contract/${disconnectTarget.contract_id}`,
      );
      const radiusAccounts = radiusRes.data;
      if (!radiusAccounts.length) {
        setDisconnectError('No RADIUS account found for this contract.');
        return;
      }
      const radiusId = radiusAccounts[0].id;
      await apiFetch(`/radius/${radiusId}/disconnect`, { method: 'POST' });
      setDisconnectSuccess(`Session for ${disconnectTarget.username} disconnected.`);
      qc.invalidateQueries({ queryKey: ['radius-active-sessions'] });
    } catch (err) {
      setDisconnectError(err instanceof Error ? err.message : 'Disconnect failed');
    } finally {
      setDisconnecting(false);
    }
  }

  const sessions = data?.data || [];
  const total = data?.meta?.total || 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const totalBytesIn = sessions.reduce((s, r) => s + (r.bytes_in || 0), 0);
  const totalBytesOut = sessions.reduce((s, r) => s + (r.bytes_out || 0), 0);

  return (
    <div style={s.page}>
      <div style={s.header}>
        <h1 style={s.title}>📡 RADIUS Sessions</h1>
        <div style={s.headerRight}>
          <span style={s.refreshedAt}>
            Last refreshed: {lastRefreshed.toLocaleTimeString()}
          </span>
          <label style={s.autoRefreshLabel}>
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={e => setAutoRefresh(e.target.checked)}
              style={{ marginRight: 6 }}
            />
            Auto-refresh (30 s)
          </label>
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            style={s.refreshBtn}
          >
            {isFetching ? 'Refreshing…' : '↻ Refresh'}
          </button>
        </div>
      </div>

      {/* Summary bar */}
      <div style={s.summaryBar}>
        <div style={s.summaryCard}>
          <div style={s.summaryValue}>{total}</div>
          <div style={s.summaryLabel}>Active Sessions</div>
        </div>
        <div style={s.summaryCard}>
          <div style={s.summaryValue}>{formatBytes(totalBytesIn)}</div>
          <div style={s.summaryLabel}>↓ Download (current page)</div>
        </div>
        <div style={s.summaryCard}>
          <div style={s.summaryValue}>{formatBytes(totalBytesOut)}</div>
          <div style={s.summaryLabel}>↑ Upload (current page)</div>
        </div>
      </div>

      {/* Filters */}
      <form onSubmit={handleFilterSubmit} style={s.filterBar}>
        <input
          type="text"
          placeholder="Username…"
          value={usernameFilter}
          onChange={e => setUsernameFilter(e.target.value)}
          style={s.filterInput}
        />
        <input
          type="text"
          placeholder="Client IP…"
          value={ipFilter}
          onChange={e => setIpFilter(e.target.value)}
          style={s.filterInput}
        />
        <input
          type="text"
          placeholder="NAS IP…"
          value={nasIpFilter}
          onChange={e => setNasIpFilter(e.target.value)}
          style={s.filterInput}
        />
        <button type="submit" style={s.applyBtn}>Apply</button>
        <button type="button" onClick={handleFilterClear} style={s.clearBtn}>Clear</button>
      </form>

      {/* Table */}
      <div style={s.tableWrap}>
        <table style={s.table}>
          <thead>
            <tr>
              <th style={s.th}>Username</th>
              <th style={s.th}>Client IP</th>
              <th style={s.th}>NAS IP</th>
              <th style={s.th}>Session ID</th>
              <th style={s.th}>Started</th>
              <th style={s.th}>Duration</th>
              <th style={s.th}>↓ Download</th>
              <th style={s.th}>↑ Upload</th>
              <th style={s.th}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {sessions.length === 0 && !isFetching && (
              <tr>
                <td colSpan={9} style={s.emptyCell}>
                  No active sessions found.
                </td>
              </tr>
            )}
            {isFetching && sessions.length === 0 && (
              <tr>
                <td colSpan={9} style={s.emptyCell}>Loading…</td>
              </tr>
            )}
            {sessions.map(session => (
              <tr key={session.id} style={s.tr}>
                <td style={s.td}>{session.username}</td>
                <td style={s.td}>{session.ip_address || '—'}</td>
                <td style={s.td}>{session.nas_ip_address || '—'}</td>
                <td style={{ ...s.td, fontFamily: 'monospace', fontSize: '0.78rem' }}>
                  {formatSessionId(session.session_id)}
                </td>
                <td style={s.td}>{formatDate(session.event_at)}</td>
                <td style={s.td}>{sessionDuration(session.event_at)}</td>
                <td style={s.td}>{formatBytes(session.bytes_in)}</td>
                <td style={s.td}>{formatBytes(session.bytes_out)}</td>
                <td style={s.td}>
                  <button
                    onClick={() => handleDisconnect(session)}
                    style={s.disconnectBtn}
                    title="Force-disconnect this session"
                  >
                    ✕ Disconnect
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={s.pagination}>
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page <= 1}
            style={s.pageBtn}
          >
            ← Prev
          </button>
          <span style={s.pageInfo}>Page {page} / {totalPages} ({total} total)</span>
          <button
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
            style={s.pageBtn}
          >
            Next →
          </button>
        </div>
      )}

      {/* Disconnect confirmation dialog */}
      {disconnectTarget && (
        <div style={s.overlay}>
          <div style={s.dialog}>
            <h3 style={s.dialogTitle}>Disconnect Session</h3>
            {!disconnectSuccess ? (
              <>
                <p style={s.dialogBody}>
                  Force-disconnect the active PPPoE session for{' '}
                  <strong>{disconnectTarget.username}</strong>
                  {disconnectTarget.ip_address ? ` (${disconnectTarget.ip_address})` : ''}?
                  <br />
                  This sends a RADIUS Disconnect-Request to the NAS.
                </p>
                {disconnectError && <p style={s.errorText}>{disconnectError}</p>}
                <div style={s.dialogActions}>
                  <button
                    onClick={() => setDisconnectTarget(null)}
                    disabled={disconnecting}
                    style={s.cancelBtn}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={confirmDisconnect}
                    disabled={disconnecting}
                    style={s.confirmBtn}
                  >
                    {disconnecting ? 'Disconnecting…' : 'Disconnect'}
                  </button>
                </div>
              </>
            ) : (
              <>
                <p style={{ color: '#1a7a3a' }}>{disconnectSuccess}</p>
                <div style={s.dialogActions}>
                  <button onClick={() => setDisconnectTarget(null)} style={s.cancelBtn}>
                    Close
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const s: Record<string, CSSProperties> = {
  page: { padding: '1.5rem', fontFamily: 'system-ui, sans-serif', fontSize: '0.9rem' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' },
  title: { margin: 0, fontSize: '1.4rem' },
  headerRight: { display: 'flex', alignItems: 'center', gap: '0.75rem' },
  refreshedAt: { color: 'var(--text-faint)', fontSize: '0.8rem' },
  autoRefreshLabel: { display: 'flex', alignItems: 'center', color: 'var(--text-muted)', fontSize: '0.85rem', cursor: 'pointer' },
  refreshBtn: {
    padding: '6px 14px', background: '#1a1a2e', color: '#fff',
    border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: '0.85rem',
  },

  summaryBar: { display: 'flex', gap: '1rem', marginBottom: '1rem', flexWrap: 'wrap' },
  summaryCard: {
    flex: '1 1 140px', background: 'var(--bg-card)', borderRadius: 8,
    padding: '0.9rem 1.2rem', boxShadow: '0 1px 4px rgba(0,0,0,.08)',
    minWidth: 120,
  },
  summaryValue: { fontSize: '1.5rem', fontWeight: 700, color: '#1a1a2e' },
  summaryLabel: { fontSize: '0.75rem', color: 'var(--text-faint)', marginTop: 2 },

  filterBar: { display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap', alignItems: 'center' },
  filterInput: {
    padding: '6px 10px', border: '1px solid var(--input-border)', borderRadius: 4,
    fontSize: '0.85rem', minWidth: 140,
  },
  applyBtn: {
    padding: '6px 14px', background: '#e25822', color: '#fff',
    border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: '0.85rem',
  },
  clearBtn: {
    padding: '6px 14px', background: 'var(--bg-subtle)', color: 'var(--text-secondary)',
    border: '1px solid var(--border)', borderRadius: 4, cursor: 'pointer', fontSize: '0.85rem',
  },

  tableWrap: { overflowX: 'auto', background: 'var(--bg-card)', borderRadius: 8, boxShadow: '0 1px 4px rgba(0,0,0,.08)' },
  table: { width: '100%', borderCollapse: 'collapse' },
  th: {
    padding: '0.65rem 0.9rem', background: '#f0f2f8', borderBottom: '2px solid #e0e3ef',
    textAlign: 'left', fontWeight: 600, fontSize: '0.82rem', whiteSpace: 'nowrap',
  },
  tr: {},
  td: {
    padding: '0.6rem 0.9rem', borderBottom: '1px solid #f0f2f8',
    verticalAlign: 'middle', whiteSpace: 'nowrap',
  },
  emptyCell: { padding: '2rem', textAlign: 'center', color: 'var(--text-faint)', fontStyle: 'italic' },

  disconnectBtn: {
    padding: '4px 10px', background: 'transparent',
    border: '1px solid #e25822', color: '#e25822',
    borderRadius: 4, cursor: 'pointer', fontSize: '0.78rem',
  },

  pagination: { display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '1rem', marginTop: '1rem' },
  pageBtn: {
    padding: '6px 14px', background: 'var(--bg-subtle)', border: '1px solid var(--border)',
    borderRadius: 4, cursor: 'pointer', fontSize: '0.85rem',
  },
  pageInfo: { color: 'var(--text-muted)', fontSize: '0.85rem' },

  overlay: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
  },
  dialog: {
    background: 'var(--bg-card)', borderRadius: 8, padding: '1.5rem 2rem',
    width: 420, maxWidth: '90vw', boxShadow: '0 8px 32px rgba(0,0,0,.2)',
  },
  dialogTitle: { margin: '0 0 1rem', fontSize: '1.1rem' },
  dialogBody: { margin: '0 0 1rem', lineHeight: 1.5 },
  dialogActions: { display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '1rem' },
  cancelBtn: {
    padding: '7px 16px', background: 'var(--bg-subtle)', border: '1px solid var(--border)',
    borderRadius: 4, cursor: 'pointer', fontSize: '0.85rem',
  },
  confirmBtn: {
    padding: '7px 16px', background: '#e25822', color: '#fff',
    border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: '0.85rem',
  },
  errorText: { color: '#c0392b', margin: '0 0 0.5rem', fontSize: '0.85rem' },
};
