// =============================================================================
// FireISP 5.0 — IFT Statistical Report Viewer
// =============================================================================
// Read-only page at /ift-statistical-reports. Lists the periodic statistical
// snapshots submitted to IFT/CRT (subscriber counts, coverage and speed
// metrics per reporting period). The reports aggregate large JSON breakdowns
// produced by the compliance pipeline, so this is a visibility/list view and
// exposes no create/edit/delete actions.
// =============================================================================

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import { styles } from './crudStyles';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface IftStatisticalReport {
  id: number;
  report_period: string;
  period_start: string | null;
  period_end: string | null;
  total_subscribers: number | null;
  coverage_municipalities: number | null;
  status: string;
}

interface IftStatisticalReportResponse {
  data: IftStatisticalReport[];
  meta: { total: number; page: number; limit: number; totalPages?: number };
}

const DEFAULT_PAGE_SIZE = 50;

// ---------------------------------------------------------------------------
// Fetch helper
// ---------------------------------------------------------------------------

async function fetchReports(page: number): Promise<IftStatisticalReportResponse> {
  const query = { page, limit: DEFAULT_PAGE_SIZE };
  const res = await api.GET('/ift-statistical-reports', { params: { query: query as never } });
  if (res.error) throw new Error('Failed to load IFT statistical reports');
  return res.data as unknown as IftStatisticalReportResponse;
}

// ---------------------------------------------------------------------------
// Badge
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; color: string }> = {
    draft: { bg: '#f3f4f6', color: '#374151' },
    final: { bg: '#dbeafe', color: '#1e40af' },
    filed: { bg: '#d1fae5', color: '#065f46' },
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

// ---------------------------------------------------------------------------
// IftStatisticalReportList component
// ---------------------------------------------------------------------------

export function IftStatisticalReportList() {
  const [page, setPage] = useState(1);

  const reportsQ = useQuery({
    queryKey: ['ift-statistical-reports', page],
    queryFn: () => fetchReports(page),
  });

  const reports = reportsQ.data?.data ?? [];
  const meta = reportsQ.data?.meta;
  const totalPages = meta?.totalPages ?? (meta ? Math.max(1, Math.ceil(meta.total / meta.limit)) : 1);

  const fmtDate = (d: string | null) => (d ? d.slice(0, 10) : '—');
  const fmtNum = (n: number | null) => (n != null ? n.toLocaleString() : '—');

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.pageTitle}>📊 IFT Statistical Reports</h1>
        {meta && <span style={styles.countBadge}>{meta.total} total</span>}
      </div>

      <div style={styles.tableCard}>
        {reportsQ.isLoading ? (
          <p style={styles.msg}>Loading…</p>
        ) : reportsQ.error ? (
          <p style={styles.msgError}>Failed to load IFT statistical reports.</p>
        ) : reports.length === 0 ? (
          <p style={styles.msg}>No statistical reports recorded.</p>
        ) : (
          <>
            <div style={{ overflowX: 'auto' }}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    {['ID', 'Period', 'Start', 'End', 'Subscribers', 'Municipalities', 'Status'].map(
                      h => <th key={h} style={styles.th}>{h}</th>,
                    )}
                  </tr>
                </thead>
                <tbody>
                  {reports.map(r => (
                    <tr key={r.id} style={styles.tr}>
                      <td style={styles.td}>#{r.id}</td>
                      <td style={{ ...styles.td, fontWeight: 500 }}>{r.report_period}</td>
                      <td style={styles.td}>{fmtDate(r.period_start)}</td>
                      <td style={styles.td}>{fmtDate(r.period_end)}</td>
                      <td style={styles.td}>{fmtNum(r.total_subscribers)}</td>
                      <td style={styles.td}>{fmtNum(r.coverage_municipalities)}</td>
                      <td style={styles.td}><StatusBadge status={r.status} /></td>
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
