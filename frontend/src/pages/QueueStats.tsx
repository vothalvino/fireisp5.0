// =============================================================================
// FireISP 5.0 — Background Queue Status View
// =============================================================================
// Standalone read-only page at /queue-stats. Surfaces the background job
// queue counters (waiting / active / completed / failed / delayed) for each
// named queue, plus the active queue mode (in-process vs BullMQ). Data is
// fetched through the typed `api` client + React Query and can be refreshed
// on demand. This is a status view, so there are no mutations.
// =============================================================================

import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import { styles, capitalize } from './crudStyles';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface QueueCounts {
  name: string;
  waiting?: number;
  active?: number;
  completed?: number;
  failed?: number;
  delayed?: number;
}

interface QueueStatsResponse {
  mode: string;
  queues: QueueCounts[];
  error?: string;
}

const COUNT_COLUMNS: { key: keyof QueueCounts; label: string; color: string }[] = [
  { key: 'waiting', label: 'Waiting', color: '#92400e' },
  { key: 'active', label: 'Active', color: '#1e40af' },
  { key: 'completed', label: 'Completed', color: '#065f46' },
  { key: 'failed', label: 'Failed', color: '#991b1b' },
  { key: 'delayed', label: 'Delayed', color: '#5b21b6' },
];

// ---------------------------------------------------------------------------
// Fetch helper
// ---------------------------------------------------------------------------

async function fetchQueueStats(): Promise<QueueStatsResponse> {
  const res = await api.GET('/queue-stats', {});
  if (res.error) throw new Error('Failed to load queue stats');
  return res.data as unknown as QueueStatsResponse;
}

// ---------------------------------------------------------------------------
// QueueStats component
// ---------------------------------------------------------------------------

export function QueueStats() {
  const statsQ = useQuery({
    queryKey: ['queue-stats'],
    queryFn: fetchQueueStats,
  });

  const stats = statsQ.data;
  const queues = stats?.queues ?? [];

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.pageTitle}>📥 Queue Status</h1>
        {stats && <span style={styles.countBadge}>Mode: {capitalize(stats.mode)}</span>}
        <button
          style={{ ...styles.btnSecondary, marginLeft: 'auto' }}
          onClick={() => statsQ.refetch()}
          disabled={statsQ.isFetching}
        >
          {statsQ.isFetching ? 'Refreshing…' : '↻ Refresh'}
        </button>
      </div>

      {stats?.error && (
        <p style={{ color: '#92400e', marginBottom: '0.75rem', fontSize: '0.85rem' }}>
          {stats.error}
        </p>
      )}

      <div style={styles.tableCard}>
        {statsQ.isLoading ? (
          <p style={styles.msg}>Loading…</p>
        ) : statsQ.error ? (
          <p style={styles.msgError}>Failed to load queue stats.</p>
        ) : queues.length === 0 ? (
          <p style={styles.msg}>
            No active queues. The in-process queue mode does not expose per-queue
            counters; set <code>REDIS_URL</code> and install BullMQ for a distributed
            queue with live statistics.
          </p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>Queue</th>
                  {COUNT_COLUMNS.map(c => <th key={c.key} style={styles.th}>{c.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {queues.map(q => (
                  <tr key={q.name} style={styles.tr}>
                    <td style={{ ...styles.td, fontWeight: 500 }}>{q.name}</td>
                    {COUNT_COLUMNS.map(c => (
                      <td key={c.key} style={{ ...styles.td, color: c.color, fontWeight: 600 }}>
                        {q[c.key] ?? 0}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
