// =============================================================================
// FireISP 5.0 — Suspension Rule Viewer
// =============================================================================
// Read-only page at /suspension-rules. Lists the dunning rules that drive the
// automated suspension engine: how many days past due trigger an action, the
// grace period, advance-notice window and the action to take (suspend / notify /
// disconnect). Rules are evaluated by the suspension automation job, so this is
// a visibility/list view and exposes no create/edit/delete actions.
// =============================================================================

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import { styles } from './crudStyles';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SuspensionRule {
  id: number;
  name: string;
  days_past_due: number;
  grace_period_days: number;
  action: string;
  notify_before_days: number | null;
  is_active: number | boolean;
}

interface SuspensionRuleResponse {
  data: SuspensionRule[];
  meta: { total: number; page: number; limit: number; totalPages?: number };
}

const DEFAULT_PAGE_SIZE = 50;

// ---------------------------------------------------------------------------
// Fetch helper
// ---------------------------------------------------------------------------

async function fetchSuspensionRules(page: number): Promise<SuspensionRuleResponse> {
  const query = { page, limit: DEFAULT_PAGE_SIZE };
  const res = await api.GET('/suspension-rules', { params: { query: query as never } });
  if (res.error) throw new Error('Failed to load suspension rules');
  return res.data as unknown as SuspensionRuleResponse;
}

// ---------------------------------------------------------------------------
// Badges
// ---------------------------------------------------------------------------

function ActionBadge({ action }: { action: string }) {
  const map: Record<string, { bg: string; color: string }> = {
    auto_suspend: { bg: '#fef3c7', color: '#92400e' },
    auto_disconnect: { bg: '#fee2e2', color: '#991b1b' },
    notify_only: { bg: '#dbeafe', color: '#1e40af' },
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
      {action.replace(/_/g, ' ')}
    </span>
  );
}

function EnabledBadge({ enabled }: { enabled: boolean }) {
  return (
    <span
      style={{
        background: enabled ? '#d1fae5' : '#f3f4f6',
        color: enabled ? '#065f46' : '#374151',
        padding: '2px 8px',
        borderRadius: 12,
        fontSize: '0.72rem',
        fontWeight: 600,
      }}
    >
      {enabled ? 'Enabled' : 'Disabled'}
    </span>
  );
}

// ---------------------------------------------------------------------------
// SuspensionRuleList component
// ---------------------------------------------------------------------------

export function SuspensionRuleList() {
  const [page, setPage] = useState(1);

  const rulesQ = useQuery({
    queryKey: ['suspension-rules', page],
    queryFn: () => fetchSuspensionRules(page),
  });

  const rules = rulesQ.data?.data ?? [];
  const meta = rulesQ.data?.meta;
  const totalPages = meta?.totalPages ?? (meta ? Math.max(1, Math.ceil(meta.total / meta.limit)) : 1);

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.pageTitle}>⛔ Suspension Rules</h1>
        {meta && <span style={styles.countBadge}>{meta.total} total</span>}
      </div>

      <div style={styles.tableCard}>
        {rulesQ.isLoading ? (
          <p style={styles.msg}>Loading…</p>
        ) : rulesQ.error ? (
          <p style={styles.msgError}>Failed to load suspension rules.</p>
        ) : rules.length === 0 ? (
          <p style={styles.msg}>No suspension rules configured.</p>
        ) : (
          <>
            <div style={{ overflowX: 'auto' }}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    {['ID', 'Name', 'Days Past Due', 'Grace Days', 'Notify Before', 'Action', 'Status'].map(
                      h => <th key={h} style={styles.th}>{h}</th>,
                    )}
                  </tr>
                </thead>
                <tbody>
                  {rules.map(r => (
                    <tr key={r.id} style={styles.tr}>
                      <td style={styles.td}>#{r.id}</td>
                      <td style={{ ...styles.td, fontWeight: 500 }}>{r.name}</td>
                      <td style={styles.td}>{r.days_past_due} days</td>
                      <td style={styles.td}>{r.grace_period_days} days</td>
                      <td style={styles.td}>{r.notify_before_days != null ? `${r.notify_before_days} days` : '—'}</td>
                      <td style={styles.td}><ActionBadge action={r.action} /></td>
                      <td style={styles.td}><EnabledBadge enabled={Boolean(r.is_active)} /></td>
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
