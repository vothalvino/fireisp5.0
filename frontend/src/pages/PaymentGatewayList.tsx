// =============================================================================
// FireISP 5.0 — Payment Gateway Viewer
// =============================================================================
// Read-only page at /payment-gateways. Lists the payment provider gateways
// configured for the organization with their provider, environment, default
// flag and status. Gateway secret keys are encrypted at rest and managed
// through a dedicated secure flow, so this page is a visibility view and
// exposes no create/edit/delete actions.
// =============================================================================

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import { styles } from './crudStyles';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PaymentGateway {
  id: number;
  name: string;
  provider: string;
  environment: string;
  public_key: string | null;
  is_default: number | boolean;
  status: string;
}

interface PaymentGatewayResponse {
  data: PaymentGateway[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

const DEFAULT_PAGE_SIZE = 50;

// ---------------------------------------------------------------------------
// Fetch helper
// ---------------------------------------------------------------------------

async function fetchGateways(page: number): Promise<PaymentGatewayResponse> {
  const query = { page, limit: DEFAULT_PAGE_SIZE };
  const res = await api.GET('/payment-gateways', { params: { query: query as never } });
  if (res.error) throw new Error('Failed to load payment gateways');
  return res.data as unknown as PaymentGatewayResponse;
}

// ---------------------------------------------------------------------------
// Badges
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; color: string }> = {
    active: { bg: '#d1fae5', color: '#065f46' },
    inactive: { bg: '#f3f4f6', color: '#374151' },
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

function EnvBadge({ env }: { env: string }) {
  const isProd = env === 'production';
  return (
    <span
      style={{
        background: isProd ? '#fee2e2' : '#dbeafe',
        color: isProd ? '#991b1b' : '#1e40af',
        padding: '2px 8px',
        borderRadius: 12,
        fontSize: '0.72rem',
        fontWeight: 600,
        textTransform: 'capitalize',
      }}
    >
      {env}
    </span>
  );
}

// ---------------------------------------------------------------------------
// PaymentGatewayList component
// ---------------------------------------------------------------------------

export function PaymentGatewayList() {
  const [page, setPage] = useState(1);

  const gatewaysQ = useQuery({
    queryKey: ['payment-gateways', page],
    queryFn: () => fetchGateways(page),
  });

  const gateways = gatewaysQ.data?.data ?? [];
  const meta = gatewaysQ.data?.meta;
  const totalPages = meta?.totalPages ?? 1;

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.pageTitle}>💳 Payment Gateways</h1>
        {meta && <span style={styles.countBadge}>{meta.total} total</span>}
      </div>

      <div style={styles.tableCard}>
        {gatewaysQ.isLoading ? (
          <p style={styles.msg}>Loading…</p>
        ) : gatewaysQ.error ? (
          <p style={styles.msgError}>Failed to load payment gateways.</p>
        ) : gateways.length === 0 ? (
          <p style={styles.msg}>No payment gateways configured.</p>
        ) : (
          <>
            <div style={{ overflowX: 'auto' }}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    {['ID', 'Name', 'Provider', 'Environment', 'Public Key', 'Default', 'Status'].map(
                      h => <th key={h} style={styles.th}>{h}</th>,
                    )}
                  </tr>
                </thead>
                <tbody>
                  {gateways.map(g => (
                    <tr key={g.id} style={styles.tr}>
                      <td style={styles.td}>#{g.id}</td>
                      <td style={{ ...styles.td, fontWeight: 500 }}>{g.name}</td>
                      <td style={{ ...styles.td, textTransform: 'capitalize' }}>{g.provider}</td>
                      <td style={styles.td}><EnvBadge env={g.environment} /></td>
                      <td style={{ ...styles.td, maxWidth: 280, overflowWrap: 'anywhere', fontFamily: 'monospace', fontSize: '0.78rem' }}>
                        {g.public_key ?? '—'}
                      </td>
                      <td style={styles.td}>{g.is_default ? '⭐' : '—'}</td>
                      <td style={styles.td}><StatusBadge status={g.status} /></td>
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

      <p style={{ ...styles.msg, textAlign: 'left', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
        Gateway secret keys are encrypted at rest and managed through the secure configuration flow.
      </p>
    </div>
  );
}
