// =============================================================================
// FireISP 5.0 — Field Job Status View
// =============================================================================
// Standalone read-only page at /jobs. Surfaces the field-service jobs
// (installations, maintenance, repairs, surveys) that already exist in the
// backend so operators can see their scheduling and status at a glance.
// Data is fetched through the typed `api` client + React Query. This is a
// status view, so there are no create/edit/delete actions here.
// =============================================================================

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import { styles, capitalize, fmtDate } from './crudStyles';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Job {
  id: number;
  client_id: number | null;
  contract_id: number | null;
  ticket_id: number | null;
  assigned_to: number | null;
  title: string;
  type: string;
  priority: string;
  status: string;
  scheduled_date: string | null;
  completed_date: string | null;
}

interface JobsResponse {
  data: Job[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_PAGE_SIZE = 50;
const STATUSES = ['scheduled', 'in_progress', 'completed', 'cancelled'];

// ---------------------------------------------------------------------------
// Fetch helper
// ---------------------------------------------------------------------------

async function fetchJobs(page: number, status: string): Promise<JobsResponse> {
  const query: Record<string, string | number> = { page, limit: DEFAULT_PAGE_SIZE };
  if (status) query.status = status;
  const res = await api.GET('/jobs', { params: { query: query as never } });
  if (res.error) throw new Error('Failed to load jobs');
  return res.data as unknown as JobsResponse;
}

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; color: string }> = {
    scheduled: { bg: '#dbeafe', color: '#1e40af' },
    in_progress: { bg: '#fef3c7', color: '#92400e' },
    completed: { bg: '#d1fae5', color: '#065f46' },
    cancelled: { bg: '#fee2e2', color: '#991b1b' },
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

// ---------------------------------------------------------------------------
// JobList component
// ---------------------------------------------------------------------------

export function JobList() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');

  const jobsQ = useQuery({
    queryKey: ['jobs', page, status],
    queryFn: () => fetchJobs(page, status),
  });

  function setStatusFilter(value: string) {
    setStatus(value);
    setPage(1);
  }

  const jobs = jobsQ.data?.data ?? [];
  const meta = jobsQ.data?.meta;
  const totalPages = meta?.totalPages ?? 1;

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.pageTitle}>🛠️ Field Jobs</h1>
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
          {STATUSES.map(s => <option key={s} value={s}>{capitalize(s.replace(/_/g, ' '))}</option>)}
        </select>
      </div>

      <div style={styles.tableCard}>
        {jobsQ.isLoading ? (
          <p style={styles.msg}>Loading…</p>
        ) : jobsQ.error ? (
          <p style={styles.msgError}>Failed to load jobs.</p>
        ) : jobs.length === 0 ? (
          <p style={styles.msg}>No jobs found{status ? ' for the selected status' : ''}.</p>
        ) : (
          <>
            <div style={{ overflowX: 'auto' }}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    {['ID', 'Title', 'Type', 'Priority', 'Status', 'Scheduled', 'Completed', 'Assigned'].map(
                      h => <th key={h} style={styles.th}>{h}</th>,
                    )}
                  </tr>
                </thead>
                <tbody>
                  {jobs.map(j => (
                    <tr key={j.id} style={styles.tr}>
                      <td style={styles.td}>#{j.id}</td>
                      <td style={{ ...styles.td, fontWeight: 500 }}>{j.title}</td>
                      <td style={{ ...styles.td, textTransform: 'capitalize' }}>{j.type?.replace(/_/g, ' ') ?? '—'}</td>
                      <td style={{ ...styles.td, textTransform: 'capitalize' }}>{j.priority ?? '—'}</td>
                      <td style={styles.td}><StatusBadge status={j.status} /></td>
                      <td style={{ ...styles.td, whiteSpace: 'nowrap' }}>{j.scheduled_date ? fmtDate(j.scheduled_date) : '—'}</td>
                      <td style={{ ...styles.td, whiteSpace: 'nowrap' }}>{j.completed_date ? fmtDate(j.completed_date) : '—'}</td>
                      <td style={styles.td}>{j.assigned_to != null ? `#${j.assigned_to}` : 'Unassigned'}</td>
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
