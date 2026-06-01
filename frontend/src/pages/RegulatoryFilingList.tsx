// =============================================================================
// FireISP 5.0 — Regulatory Filing Viewer
// =============================================================================
// Read-only page at /regulatory-filings. Lists the IFT/CRT regulatory filings
// (annual reports, statistics, tariff registrations, coverage/QoS reports,
// spectrum usage) tracked for the organization, with their reporting period,
// submission timestamp, acknowledgement number and lifecycle status. This is a
// compliance visibility view and exposes no create/edit/delete actions.
// =============================================================================

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import { styles, capitalize, fmtDate } from './crudStyles';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RegulatoryFiling {
  id: number;
  filing_type: string;
  period_start: string | null;
  period_end: string | null;
  filed_at: string | null;
  acknowledgement_number: string | null;
  status: string;
  notes: string | null;
}

interface FilingsResponse {
  data: RegulatoryFiling[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

const DEFAULT_PAGE_SIZE = 50;
const STATUSES = ['pending', 'filed', 'accepted', 'rejected', 'overdue'];

// ---------------------------------------------------------------------------
// Fetch helper
// ---------------------------------------------------------------------------

async function fetchFilings(page: number, status: string): Promise<FilingsResponse> {
  const query: Record<string, string | number> = { page, limit: DEFAULT_PAGE_SIZE };
  if (status) query.status = status;
  const res = await api.GET('/regulatory-filings', { params: { query: query as never } });
  if (res.error) throw new Error('Failed to load regulatory filings');
  return res.data as unknown as FilingsResponse;
}

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; color: string }> = {
    pending: { bg: '#fef3c7', color: '#92400e' },
    filed: { bg: '#dbeafe', color: '#1e40af' },
    accepted: { bg: '#d1fae5', color: '#065f46' },
    rejected: { bg: '#fee2e2', color: '#991b1b' },
    overdue: { bg: '#fecaca', color: '#7f1d1d' },
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
      {status}
    </span>
  );
}

function fmtPeriod(start: string | null, end: string | null): string {
  if (!start && !end) return '—';
  const s = start ? fmtDate(start) : '…';
  const e = end ? fmtDate(end) : '…';
  return `${s} → ${e}`;
}

// ---------------------------------------------------------------------------
// RegulatoryFilingList component
// ---------------------------------------------------------------------------

export function RegulatoryFilingList() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');

  const filingsQ = useQuery({
    queryKey: ['regulatory-filings', page, status],
    queryFn: () => fetchFilings(page, status),
  });

  function setStatusFilter(value: string) {
    setStatus(value);
    setPage(1);
  }

  const filings = filingsQ.data?.data ?? [];
  const meta = filingsQ.data?.meta;
  const totalPages = meta?.totalPages ?? 1;

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.pageTitle}>🏛️ Regulatory Filings</h1>
        {meta && <span style={styles.countBadge}>{meta.total} total</span>}
      </div>

      <div style={styles.filterRow}>
        <label style={styles.filterLabel}>Status:</label>
        <select
          style={styles.filterSelect}
          value={status}
          onChange={e => setStatusFilter(e.target.value)}
        >
          <option value="">All</option>
          {STATUSES.map(s => <option key={s} value={s}>{capitalize(s)}</option>)}
        </select>
      </div>

      <div style={styles.tableCard}>
        {filingsQ.isLoading ? (
          <p style={styles.msg}>Loading…</p>
        ) : filingsQ.error ? (
          <p style={styles.msgError}>Failed to load regulatory filings.</p>
        ) : filings.length === 0 ? (
          <p style={styles.msg}>No regulatory filings found{status ? ' for the selected status' : ''}.</p>
        ) : (
          <>
            <div style={{ overflowX: 'auto' }}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    {['ID', 'Type', 'Period', 'Filed At', 'Ack #', 'Status', 'Notes'].map(
                      h => <th key={h} style={styles.th}>{h}</th>,
                    )}
                  </tr>
                </thead>
                <tbody>
                  {filings.map(f => (
                    <tr key={f.id} style={styles.tr}>
                      <td style={styles.td}>#{f.id}</td>
                      <td style={{ ...styles.td, fontWeight: 500, textTransform: 'capitalize' }}>
                        {f.filing_type?.replace(/_/g, ' ') ?? '—'}
                      </td>
                      <td style={{ ...styles.td, whiteSpace: 'nowrap' }}>{fmtPeriod(f.period_start, f.period_end)}</td>
                      <td style={{ ...styles.td, whiteSpace: 'nowrap' }}>{f.filed_at ? fmtDate(f.filed_at) : '—'}</td>
                      <td style={{ ...styles.td, fontFamily: 'monospace' }}>{f.acknowledgement_number ?? '—'}</td>
                      <td style={styles.td}><StatusBadge status={f.status} /></td>
                      <td style={{ ...styles.td, maxWidth: 280, overflowWrap: 'anywhere' }}>{f.notes ?? '—'}</td>
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
