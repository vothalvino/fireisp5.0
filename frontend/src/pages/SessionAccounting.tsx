// =============================================================================
// FireISP 5.0 — Session Accounting Dashboard
// =============================================================================
// Page at /session-accounting. Shows per-client data usage aggregated by day,
// with a daily bar chart and top-consumers ranking.
//
// Features:
//   • Date range picker (default: last 30 days)
//   • Optional client_id filter
//   • Summary bar: total ↓/↑ GB, total sessions, unique clients
//   • SVG daily bar chart (aggregate bytes_total per day)
//   • Top consumers table (top 10 by total bytes)
//   • Paginated per-day breakdown table
// =============================================================================

import { useState } from 'react';
import type { CSSProperties, FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { tokenStore } from '@/api/client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DailyRow {
  usage_date: string;
  client_id: number;
  contract_id: number;
  username: string;
  session_count: number;
  bytes_in: number;
  bytes_out: number;
  bytes_total: number;
  duration_seconds: number;
}

interface DailyUsageResponse {
  data: DailyRow[];
  meta: {
    total: number;
    page: number;
    limit: number;
    date_from: string;
    date_to: string;
  };
}

interface TopConsumer {
  client_id: number;
  contract_id: number;
  username: string;
  active_days: number;
  session_count: number;
  bytes_in: number;
  bytes_out: number;
  bytes_total: number;
  duration_seconds: number;
}

interface TopConsumersResponse {
  data: TopConsumer[];
  meta: { date_from: string; date_to: string; limit: number };
}

// ---------------------------------------------------------------------------
// Constants & helpers
// ---------------------------------------------------------------------------

const PAGE_SIZE = 50;
const API_BASE = '/api/v1';
const BYTES_PER_GB = 1024 * 1024 * 1024;
const BYTES_PER_MB = 1024 * 1024;

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function defaultRange(): { from: string; to: string } {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 30);
  return { from: isoDate(from), to: isoDate(to) };
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < BYTES_PER_MB) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < BYTES_PER_GB) return `${(bytes / BYTES_PER_MB).toFixed(2)} MB`;
  return `${(bytes / BYTES_PER_GB).toFixed(3)} GB`;
}

function toGb(bytes: number): number {
  return parseFloat((bytes / BYTES_PER_GB).toFixed(3));
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

async function apiFetch<T>(path: string): Promise<T> {
  const token = tokenStore.getAccess();
  const res = await fetch(`${API_BASE}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error || `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// SVG Daily Bar Chart
// ---------------------------------------------------------------------------

interface DailyAgg {
  date: string;
  bytes_total: number;
}

function DailyBarChart({ rows, dateFrom, dateTo }: { rows: DailyRow[]; dateFrom: string; dateTo: string }) {
  // Aggregate by date across all clients on this page
  const aggMap = new Map<string, number>();

  // Build full date range with 0 defaults
  const start = new Date(dateFrom);
  const end = new Date(dateTo);
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    aggMap.set(isoDate(new Date(d)), 0);
  }
  for (const row of rows) {
    const key = row.usage_date.slice(0, 10);
    aggMap.set(key, (aggMap.get(key) || 0) + row.bytes_total);
  }

  const points: DailyAgg[] = Array.from(aggMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, bytes_total]) => ({ date, bytes_total }));

  if (points.length === 0) return null;

  const WIDTH = 700;
  const HEIGHT = 160;
  const PAD = { top: 10, right: 10, bottom: 30, left: 60 };
  const chartW = WIDTH - PAD.left - PAD.right;
  const chartH = HEIGHT - PAD.top - PAD.bottom;
  const maxBytes = Math.max(...points.map(p => p.bytes_total), 1);
  const barW = Math.max(2, Math.floor(chartW / points.length) - 2);

  return (
    <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} style={{ width: '100%', maxWidth: WIDTH, display: 'block' }}>
      {/* Y-axis label */}
      <text
        x={PAD.left - 8}
        y={PAD.top + chartH / 2}
        textAnchor="middle"
        dominantBaseline="middle"
        fontSize={10}
        fill="#888"
        transform={`rotate(-90, ${PAD.left - 8}, ${PAD.top + chartH / 2})`}
      >
        GB
      </text>

      {/* Y-axis gridlines */}
      {[0, 0.25, 0.5, 0.75, 1].map(frac => {
        const y = PAD.top + chartH - frac * chartH;
        const label = toGb(maxBytes * frac).toFixed(1);
        return (
          <g key={frac}>
            <line x1={PAD.left} y1={y} x2={PAD.left + chartW} y2={y} stroke="#e8e8e8" strokeWidth={1} />
            <text x={PAD.left - 4} y={y} textAnchor="end" dominantBaseline="middle" fontSize={9} fill="#aaa">
              {label}
            </text>
          </g>
        );
      })}

      {/* Bars */}
      {points.map((pt, i) => {
        const x = PAD.left + i * (chartW / points.length) + (chartW / points.length - barW) / 2;
        const barH = (pt.bytes_total / maxBytes) * chartH;
        const y = PAD.top + chartH - barH;
        const showLabel = points.length <= 14 || i % Math.ceil(points.length / 10) === 0;
        return (
          <g key={pt.date}>
            <rect x={x} y={y} width={barW} height={barH} fill="var(--accent)" rx={1} opacity={0.85}>
              <title>{pt.date}: {formatBytes(pt.bytes_total)}</title>
            </rect>
            {showLabel && (
              <text
                x={x + barW / 2}
                y={PAD.top + chartH + 14}
                textAnchor="middle"
                fontSize={8}
                fill="#999"
              >
                {pt.date.slice(5)}
              </text>
            )}
          </g>
        );
      })}

      {/* X axis */}
      <line
        x1={PAD.left} y1={PAD.top + chartH}
        x2={PAD.left + chartW} y2={PAD.top + chartH}
        stroke="#ccc" strokeWidth={1}
      />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SessionAccounting() {
  const def = defaultRange();

  // Filter inputs (controlled)
  const [dateFrom, setDateFrom] = useState(def.from);
  const [dateTo, setDateTo] = useState(def.to);
  const [clientIdInput, setClientIdInput] = useState('');

  // Applied filter state (used for queries)
  const [appliedFrom, setAppliedFrom] = useState(def.from);
  const [appliedTo, setAppliedTo] = useState(def.to);
  const [appliedClientId, setAppliedClientId] = useState('');

  const [page, setPage] = useState(1);

  // ── Daily Usage query ──────────────────────────────────────────────────────
  const dailyParams = new URLSearchParams({
    date_from: appliedFrom,
    date_to: appliedTo,
    page: String(page),
    limit: String(PAGE_SIZE),
  });
  if (appliedClientId) dailyParams.set('client_id', appliedClientId);

  const { data: dailyData, isFetching: dailyFetching } = useQuery<DailyUsageResponse>({
    queryKey: ['session-accounting-daily', appliedFrom, appliedTo, appliedClientId, page],
    queryFn: () => apiFetch<DailyUsageResponse>(`/connection-logs/daily-usage?${dailyParams}`),
    refetchOnWindowFocus: false,
  });

  // ── Top consumers query ────────────────────────────────────────────────────
  const topParams = new URLSearchParams({
    date_from: appliedFrom,
    date_to: appliedTo,
    limit: '10',
  });
  if (appliedClientId) topParams.set('client_id', appliedClientId);

  const { data: topData } = useQuery<TopConsumersResponse>({
    queryKey: ['session-accounting-top', appliedFrom, appliedTo, appliedClientId],
    queryFn: () => apiFetch<TopConsumersResponse>(`/connection-logs/top-consumers?${topParams}`),
    refetchOnWindowFocus: false,
  });

  // ── Filter handlers ────────────────────────────────────────────────────────
  function handleApply(e: FormEvent) {
    e.preventDefault();
    setAppliedFrom(dateFrom);
    setAppliedTo(dateTo);
    setAppliedClientId(clientIdInput);
    setPage(1);
  }

  function handleClear() {
    const d = defaultRange();
    setDateFrom(d.from);
    setDateTo(d.to);
    setClientIdInput('');
    setAppliedFrom(d.from);
    setAppliedTo(d.to);
    setAppliedClientId('');
    setPage(1);
  }

  // ── Derived summary ────────────────────────────────────────────────────────
  const rows = dailyData?.data || [];
  const total = dailyData?.meta?.total || 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const topRows = topData?.data || [];

  // Summary from top-consumers (full period aggregates)
  const totalBytesIn = topRows.reduce((s, r) => s + r.bytes_in, 0);
  const totalBytesOut = topRows.reduce((s, r) => s + r.bytes_out, 0);
  const totalSessions = topRows.reduce((s, r) => s + r.session_count, 0);

  return (
    <div style={s.page}>
      <h1 style={s.title}>📊 Session Accounting</h1>
      <p style={s.subtitle}>
        Data usage per client per day — {appliedFrom} to {appliedTo}
      </p>

      {/* Filters */}
      <form onSubmit={handleApply} style={s.filterBar}>
        <label style={s.filterLabel}>From</label>
        <input
          type="date"
          value={dateFrom}
          onChange={e => setDateFrom(e.target.value)}
          style={s.filterInput}
        />
        <label style={s.filterLabel}>To</label>
        <input
          type="date"
          value={dateTo}
          onChange={e => setDateTo(e.target.value)}
          style={s.filterInput}
        />
        <input
          type="number"
          placeholder="Client ID (optional)"
          value={clientIdInput}
          onChange={e => setClientIdInput(e.target.value)}
          style={{ ...s.filterInput, width: 160 }}
          min={1}
        />
        <button type="submit" style={s.applyBtn}>Apply</button>
        <button type="button" onClick={handleClear} style={s.clearBtn}>Clear</button>
      </form>

      {/* Summary bar */}
      <div style={s.summaryBar}>
        <div style={s.summaryCard}>
          <div style={s.summaryValue}>{topRows.length}</div>
          <div style={s.summaryLabel}>Active Clients</div>
        </div>
        <div style={s.summaryCard}>
          <div style={s.summaryValue}>{formatBytes(totalBytesIn)}</div>
          <div style={s.summaryLabel}>↓ Total Download</div>
        </div>
        <div style={s.summaryCard}>
          <div style={s.summaryValue}>{formatBytes(totalBytesOut)}</div>
          <div style={s.summaryLabel}>↑ Total Upload</div>
        </div>
        <div style={s.summaryCard}>
          <div style={s.summaryValue}>{formatBytes(totalBytesIn + totalBytesOut)}</div>
          <div style={s.summaryLabel}>Combined Traffic</div>
        </div>
        <div style={s.summaryCard}>
          <div style={s.summaryValue}>{totalSessions.toLocaleString()}</div>
          <div style={s.summaryLabel}>Sessions</div>
        </div>
      </div>

      {/* Daily bar chart */}
      <div style={s.chartCard}>
        <h2 style={s.sectionTitle}>Daily Traffic (current page)</h2>
        {rows.length > 0 ? (
          <DailyBarChart rows={rows} dateFrom={appliedFrom} dateTo={appliedTo} />
        ) : (
          <p style={s.empty}>{dailyFetching ? 'Loading…' : 'No data for this period.'}</p>
        )}
      </div>

      {/* Top consumers */}
      <div style={s.card}>
        <h2 style={s.sectionTitle}>Top 10 Consumers — {appliedFrom} to {appliedTo}</h2>
        <div style={s.tableWrap}>
          <table style={s.table}>
            <thead>
              <tr>
                <th style={s.th}>#</th>
                <th style={s.th}>Username</th>
                <th style={s.th}>Client ID</th>
                <th style={s.th}>Contract ID</th>
                <th style={s.th}>Active Days</th>
                <th style={s.th}>Sessions</th>
                <th style={s.th}>↓ Download</th>
                <th style={s.th}>↑ Upload</th>
                <th style={s.th}>Total</th>
                <th style={s.th}>Duration</th>
              </tr>
            </thead>
            <tbody>
              {topRows.length === 0 && (
                <tr>
                  <td colSpan={10} style={s.emptyCell}>No data for this period.</td>
                </tr>
              )}
              {topRows.map((r, i) => (
                <tr key={`${r.client_id}-${r.contract_id}`} style={s.tr}>
                  <td style={{ ...s.td, color: i < 3 ? 'var(--accent)' : '#555', fontWeight: i < 3 ? 700 : 400 }}>
                    {i + 1}
                  </td>
                  <td style={{ ...s.td, fontFamily: 'monospace' }}>{r.username}</td>
                  <td style={s.td}>{r.client_id}</td>
                  <td style={s.td}>{r.contract_id}</td>
                  <td style={s.td}>{r.active_days}</td>
                  <td style={s.td}>{r.session_count}</td>
                  <td style={s.td}>{formatBytes(r.bytes_in)}</td>
                  <td style={s.td}>{formatBytes(r.bytes_out)}</td>
                  <td style={{ ...s.td, fontWeight: 600 }}>{formatBytes(r.bytes_total)}</td>
                  <td style={s.td}>{formatDuration(r.duration_seconds)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Per-day breakdown */}
      <div style={s.card}>
        <h2 style={s.sectionTitle}>Daily Breakdown</h2>
        {dailyFetching && rows.length === 0 && <p style={s.empty}>Loading…</p>}
        <div style={s.tableWrap}>
          <table style={s.table}>
            <thead>
              <tr>
                <th style={s.th}>Date</th>
                <th style={s.th}>Username</th>
                <th style={s.th}>Client ID</th>
                <th style={s.th}>Contract ID</th>
                <th style={s.th}>Sessions</th>
                <th style={s.th}>↓ Download</th>
                <th style={s.th}>↑ Upload</th>
                <th style={s.th}>Total</th>
                <th style={s.th}>Duration</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && !dailyFetching && (
                <tr>
                  <td colSpan={9} style={s.emptyCell}>No data for this period.</td>
                </tr>
              )}
              {rows.map((r, i) => (
                <tr key={`${r.usage_date}-${r.contract_id}-${i}`} style={s.tr}>
                  <td style={{ ...s.td, fontWeight: 500 }}>{r.usage_date.slice(0, 10)}</td>
                  <td style={{ ...s.td, fontFamily: 'monospace' }}>{r.username}</td>
                  <td style={s.td}>{r.client_id}</td>
                  <td style={s.td}>{r.contract_id}</td>
                  <td style={s.td}>{r.session_count}</td>
                  <td style={s.td}>{formatBytes(r.bytes_in)}</td>
                  <td style={s.td}>{formatBytes(r.bytes_out)}</td>
                  <td style={{ ...s.td, fontWeight: 600 }}>{formatBytes(r.bytes_total)}</td>
                  <td style={s.td}>{formatDuration(r.duration_seconds)}</td>
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
            <span style={s.pageInfo}>Page {page} / {totalPages} ({total} rows)</span>
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              style={s.pageBtn}
            >
              Next →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const s: Record<string, CSSProperties> = {
  page: { padding: '1.5rem', fontFamily: 'var(--font-sans)', fontSize: '0.9rem' },
  title: { margin: '0 0 0.25rem', fontSize: '1.4rem' },
  subtitle: { margin: '0 0 1rem', color: 'var(--text-faint)', fontSize: '0.85rem' },

  filterBar: { display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap', alignItems: 'center' },
  filterLabel: { color: 'var(--text-muted)', fontSize: '0.85rem' },
  filterInput: {
    padding: '6px 10px', border: '1px solid var(--input-border)', borderRadius: 4,
    fontSize: '0.85rem',
  },
  applyBtn: {
    padding: '6px 14px', background: 'var(--accent)', color: '#fff',
    border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: '0.85rem',
  },
  clearBtn: {
    padding: '6px 14px', background: 'var(--bg-subtle)', color: 'var(--text-secondary)',
    border: '1px solid var(--border)', borderRadius: 4, cursor: 'pointer', fontSize: '0.85rem',
  },

  summaryBar: { display: 'flex', gap: '1rem', marginBottom: '1.25rem', flexWrap: 'wrap' },
  summaryCard: {
    flex: '1 1 120px', background: 'var(--bg-card)', borderRadius: 8,
    padding: '0.9rem 1.2rem', boxShadow: '0 0 0 1px var(--border)',
    minWidth: 110,
  },
  summaryValue: { fontSize: '1.4rem', fontWeight: 700, color: 'var(--text-primary)' },
  summaryLabel: { fontSize: '0.73rem', color: 'var(--text-faint)', marginTop: 2 },

  chartCard: {
    background: 'var(--bg-card)', borderRadius: 8, padding: '1rem 1.25rem',
    boxShadow: '0 0 0 1px var(--border)', marginBottom: '1.25rem',
  },
  card: {
    background: 'var(--bg-card)', borderRadius: 8, padding: '1rem 1.25rem',
    boxShadow: '0 0 0 1px var(--border)', marginBottom: '1.25rem',
  },
  sectionTitle: { margin: '0 0 0.75rem', fontSize: '1rem', fontWeight: 600 },

  tableWrap: { overflowX: 'auto' },
  table: { width: '100%', borderCollapse: 'collapse' },
  th: {
    padding: '0.6rem 0.85rem', background: '#f0f2f8', borderBottom: '2px solid #e0e3ef',
    textAlign: 'left', fontWeight: 600, fontSize: '0.8rem', whiteSpace: 'nowrap',
  },
  tr: {},
  td: {
    padding: '0.55rem 0.85rem', borderBottom: '1px solid #f0f2f8',
    verticalAlign: 'middle', whiteSpace: 'nowrap', fontSize: '0.85rem',
  },
  emptyCell: { padding: '1.5rem', textAlign: 'center', color: 'var(--text-faint)', fontStyle: 'italic' },
  empty: { color: 'var(--text-faint)', fontSize: '0.85rem', fontStyle: 'italic', margin: '0.5rem 0' },

  pagination: { display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '1rem', marginTop: '0.75rem' },
  pageBtn: {
    padding: '5px 12px', background: 'var(--bg-subtle)', border: '1px solid var(--border)',
    borderRadius: 4, cursor: 'pointer', fontSize: '0.83rem',
  },
  pageInfo: { color: 'var(--text-muted)', fontSize: '0.83rem' },
};
