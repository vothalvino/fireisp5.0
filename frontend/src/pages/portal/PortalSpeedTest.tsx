// =============================================================================
// FireISP 5.0 — Portal Speed Test (§11.4)
// =============================================================================
// Queue a speed test job and view past results.
// =============================================================================

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { portalTokenStore } from '@/auth/PortalAuthContext';

const API_BASE = '/api/v1/portal';

interface SpeedTestJob {
  id: number;
  status: string;
  scheduled_at: string;
  completed_at: string | null;
  requested_by: string;
  download_mbps: string | null;
  upload_mbps: string | null;
  latency_ms: string | null;
  jitter_ms: string | null;
  packet_loss_pct: string | null;
  error_message: string | null;
  created_at: string;
}

async function portalFetch<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const token = portalTokenStore.getAccess();
  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: { message?: string } };
    throw new Error(body?.error?.message || 'Request failed');
  }
  return res.json() as Promise<T>;
}

export function PortalSpeedTest() {
  const qc = useQueryClient();
  const [queued, setQueued] = useState(false);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['portal-speed-test-results'],
    queryFn: () => portalFetch<{ data: SpeedTestJob[] }>('/speed-test/results?limit=20'),
    staleTime: 30_000,
  });

  const queueMutation = useMutation({
    mutationFn: () => portalFetch('/speed-test', { method: 'POST' }),
    onSuccess: () => {
      setQueued(true);
      setTimeout(() => {
        setQueued(false);
        qc.invalidateQueries({ queryKey: ['portal-speed-test-results'] });
      }, 5000);
    },
  });

  const results = data?.data ?? [];
  const latest = results.find(r => r.status === 'completed');

  return (
    <div>
      <h1 style={styles.heading}>Speed Test</h1>
      <p style={styles.sub}>Test your connection speed and view history</p>

      <section style={styles.card}>
        {queued ? (
          <div style={styles.queuedMsg}>
            Speed test queued! Results will appear below once complete (usually within 30 seconds).
          </div>
        ) : (
          <button
            style={styles.runBtn}
            onClick={() => queueMutation.mutate()}
            disabled={queueMutation.isPending}
          >
            {queueMutation.isPending ? 'Queuing…' : 'Run Speed Test'}
          </button>
        )}

        {latest && (
          <div style={styles.latestResult}>
            <h3 style={styles.latestTitle}>Latest Result</h3>
            <div style={styles.speedGrid}>
              <div style={styles.speedBox}>
                <div style={styles.speedValue}>
                  {latest.download_mbps ? parseFloat(latest.download_mbps).toFixed(1) : '—'}
                </div>
                <div style={styles.speedLabel}>Mbps Down</div>
              </div>
              <div style={styles.speedBox}>
                <div style={styles.speedValue}>
                  {latest.upload_mbps ? parseFloat(latest.upload_mbps).toFixed(1) : '—'}
                </div>
                <div style={styles.speedLabel}>Mbps Up</div>
              </div>
              <div style={styles.speedBox}>
                <div style={{ ...styles.speedValue, fontSize: '1.25rem' }}>
                  {latest.latency_ms ? `${parseFloat(latest.latency_ms).toFixed(0)}ms` : '—'}
                </div>
                <div style={styles.speedLabel}>Latency</div>
              </div>
            </div>
            <p style={styles.meta}>Tested: {latest.completed_at?.slice(0, 16).replace('T', ' ')}</p>
          </div>
        )}
      </section>

      <section style={{ ...styles.card, marginTop: '1.25rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
          <h2 style={styles.sectionTitle}>Test History</h2>
          <button style={styles.refreshBtn} onClick={() => refetch()}>Refresh</button>
        </div>

        {isLoading && <p style={styles.muted}>Loading…</p>}
        {!isLoading && results.length === 0 && (
          <p style={styles.muted}>No speed tests yet. Run your first test above.</p>
        )}
        {results.length > 0 && (
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Date</th>
                <th style={styles.th}>Status</th>
                <th style={styles.th}>Down</th>
                <th style={styles.th}>Up</th>
                <th style={styles.th}>Ping</th>
              </tr>
            </thead>
            <tbody>
              {results.map(r => (
                <tr key={r.id}>
                  <td style={styles.td}>{r.created_at.slice(0, 16).replace('T', ' ')}</td>
                  <td style={styles.td}>
                    <span style={{ ...styles.badge, ...statusColor(r.status) }}>{r.status}</span>
                  </td>
                  <td style={styles.td}>{r.download_mbps ? `${parseFloat(r.download_mbps).toFixed(1)} Mbps` : '—'}</td>
                  <td style={styles.td}>{r.upload_mbps ? `${parseFloat(r.upload_mbps).toFixed(1)} Mbps` : '—'}</td>
                  <td style={styles.td}>{r.latency_ms ? `${parseFloat(r.latency_ms).toFixed(0)} ms` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function statusColor(status: string): React.CSSProperties {
  switch (status) {
    case 'completed': return { background: '#d1fae5', color: '#065f46' };
    case 'running': return { background: '#dbeafe', color: '#1e40af' };
    case 'queued': return { background: '#fef3c7', color: '#92400e' };
    case 'failed': return { background: '#fee2e2', color: '#991b1b' };
    default: return { background: '#f3f4f6', color: '#374151' };
  }
}

const styles: Record<string, React.CSSProperties> = {
  heading: { margin: '0 0 0.25rem', fontSize: '1.4rem', color: 'var(--text-primary)' },
  sub: { margin: '0 0 1.25rem', color: 'var(--text-muted)', fontSize: '0.95rem' },
  muted: { color: 'var(--text-muted)', fontSize: '0.9rem' },
  card: { background: 'var(--bg-card)', borderRadius: 8, padding: '1.25rem', boxShadow: '0 0 0 1px var(--border)' },
  sectionTitle: { margin: 0, fontSize: '1rem', color: 'var(--text-secondary)', fontWeight: 600 },
  runBtn: { padding: '0.6rem 1.5rem', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: '1rem', fontWeight: 600 },
  queuedMsg: { padding: '0.75rem 1rem', background: '#d1fae5', color: '#065f46', borderRadius: 4, fontSize: '0.9rem' },
  latestResult: { marginTop: '1.25rem' },
  latestTitle: { margin: '0 0 0.75rem', fontSize: '0.95rem', color: 'var(--text-muted)' },
  speedGrid: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem', maxWidth: 360 },
  speedBox: { textAlign: 'center' as const, padding: '0.75rem', background: 'var(--bg-subtle)', borderRadius: 6 },
  speedValue: { fontSize: '1.75rem', fontWeight: 700, color: 'var(--accent)' },
  speedLabel: { fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.25rem' },
  meta: { fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.5rem' },
  refreshBtn: { padding: '0.3rem 0.75rem', border: '1px solid var(--border-strong)', borderRadius: 4, cursor: 'pointer', fontSize: '0.85rem', background: 'var(--bg-card)', color: 'var(--text-secondary)' },
  table: { width: '100%', borderCollapse: 'collapse' as const, fontSize: '0.875rem' },
  th: { textAlign: 'left' as const, padding: '0.5rem 0.75rem', color: 'var(--text-muted)', fontWeight: 600, borderBottom: '2px solid var(--border-subtle)' },
  td: { padding: '0.5rem 0.75rem', borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-secondary)' },
  badge: { display: 'inline-block', padding: '0.15rem 0.4rem', borderRadius: 10, fontSize: '0.78rem', fontWeight: 600 },
};
