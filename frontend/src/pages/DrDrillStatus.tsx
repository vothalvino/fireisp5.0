// =============================================================================
// FireISP 5.0 — Disaster-Recovery Drill Status
// =============================================================================
// Admin page at /dr-drill. Read-only view of the latest automated DR drill
// result via GET /dr-drill/status: when it last ran, whether it passed, how
// many days have elapsed, and whether a new drill is overdue (> 90 days or the
// last run did not pass) — plus the full DR runbook document (served by
// GET /dr-drill/runbook; this page is where the DrDrillBanner modal's
// "Open DR runbook" link lands). Data is fetched through the typed `api`
// client + React Query and can be refreshed on demand. This is a status view,
// so there are no mutations.
// =============================================================================

import { lazy, Suspense } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import { styles, fmtDate } from './crudStyles';

// Markdown renderer loads only on this page (own chunk), not with the app shell.
const MarkdownView = lazy(() => import('@/components/MarkdownView'));

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DrDrillStatus {
  last_run_at: string | null;
  status: string | null;
  days_since_drill: number | null;
  overdue: boolean;
  last_error: string | null;
}

// ---------------------------------------------------------------------------
// Fetch helper
// ---------------------------------------------------------------------------

async function fetchStatus(): Promise<DrDrillStatus> {
  const res = await api.GET('/dr-drill/status', {});
  if (res.error) throw new Error('Failed to load DR drill status');
  return (res.data as unknown as { data: DrDrillStatus }).data;
}

async function fetchRunbook(): Promise<string> {
  const res = await api.GET('/dr-drill/runbook', {});
  if (res.error) throw new Error('Failed to load DR runbook');
  return (res.data as unknown as { data: { markdown: string } }).data.markdown;
}

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

function ResultBadge({ status }: { status: string | null }) {
  const map: Record<string, { bg: string; color: string; label: string }> = {
    pass: { bg: '#d1fae5', color: '#065f46', label: 'Pass' },
    fail: { bg: '#fee2e2', color: '#991b1b', label: 'Fail' },
    error: { bg: '#fef3c7', color: '#92400e', label: 'Error' },
  };
  const s = map[status ?? ''] ?? { bg: '#f3f4f6', color: '#374151', label: status ?? 'Never run' };
  return (
    <span style={{ background: s.bg, color: s.color, padding: '2px 10px', borderRadius: 12, fontSize: '0.78rem', fontWeight: 600 }}>
      {s.label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// DrDrillStatus component
// ---------------------------------------------------------------------------

export function DrDrillStatus() {
  const statusQ = useQuery({
    queryKey: ['dr-drill-status'],
    queryFn: fetchStatus,
  });

  // The runbook document only changes with a code deploy — cache it long.
  const runbookQ = useQuery({
    queryKey: ['dr-drill-runbook'],
    queryFn: fetchRunbook,
    staleTime: 60 * 60 * 1000,
  });

  const status = statusQ.data;

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.pageTitle}>🛟 Disaster-Recovery Drill</h1>
        {status && (
          <span style={{ ...styles.countBadge, ...(status.overdue ? { background: '#fee2e2', color: '#991b1b' } : { background: '#d1fae5', color: '#065f46' }) }}>
            {status.overdue ? 'Overdue' : 'Up to date'}
          </span>
        )}
        <button
          style={{ ...styles.btnSecondary, marginLeft: 'auto' }}
          onClick={() => statusQ.refetch()}
          disabled={statusQ.isFetching}
        >
          {statusQ.isFetching ? 'Refreshing…' : '↻ Refresh'}
        </button>
      </div>

      <p style={{ margin: '0 0 1rem', fontSize: '0.85rem', color: 'var(--text-secondary)', maxWidth: 720 }}>
        The automated quarterly drill takes a verified backup and runs referential-integrity and
        financial-consistency checks against the live database. A new drill is due every 90 days.
      </p>

      <div style={styles.tableCard}>
        {statusQ.isLoading ? (
          <p style={styles.msg}>Loading…</p>
        ) : statusQ.error ? (
          <p style={styles.msgError}>Failed to load DR drill status.</p>
        ) : !status || status.last_run_at === null ? (
          <p style={styles.msg}>No drill has been run yet. The first automated drill will populate this view.</p>
        ) : (
          <table style={styles.table}>
            <tbody>
              <tr style={styles.tr}>
                <td style={{ ...styles.td, fontWeight: 500, width: 220 }}>Last result</td>
                <td style={styles.td}><ResultBadge status={status.status} /></td>
              </tr>
              <tr style={styles.tr}>
                <td style={{ ...styles.td, fontWeight: 500 }}>Last run</td>
                <td style={styles.td}>{fmtDate(status.last_run_at)}</td>
              </tr>
              <tr style={styles.tr}>
                <td style={{ ...styles.td, fontWeight: 500 }}>Days since drill</td>
                <td style={styles.td}>{status.days_since_drill ?? '—'}</td>
              </tr>
              <tr style={styles.tr}>
                <td style={{ ...styles.td, fontWeight: 500 }}>Overdue</td>
                <td style={{ ...styles.td, color: status.overdue ? '#991b1b' : '#065f46', fontWeight: 600 }}>
                  {status.overdue ? 'Yes' : 'No'}
                </td>
              </tr>
              {status.last_error && (
                <tr style={styles.tr}>
                  <td style={{ ...styles.td, fontWeight: 500 }}>Last error</td>
                  <td style={{ ...styles.td, color: '#991b1b' }}>{status.last_error}</td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {/* Full runbook document (docs/dr-drill.md served by the backend) */}
      <div style={{ ...styles.tableCard, marginTop: '1rem', padding: '1rem 1.25rem' }} id="runbook">
        <h2 style={{ margin: '0 0 0.5rem', fontSize: '1rem' }}>📖 DR Runbook</h2>
        {runbookQ.isLoading ? (
          <p style={styles.msg}>Loading runbook…</p>
        ) : runbookQ.error || !runbookQ.data ? (
          <p style={styles.msgError}>Failed to load the runbook document.</p>
        ) : (
          <Suspense fallback={<p style={styles.msg}>Loading…</p>}>
            <MarkdownView markdown={runbookQ.data} />
          </Suspense>
        )}
      </div>
    </div>
  );
}
