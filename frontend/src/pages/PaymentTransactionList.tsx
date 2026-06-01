// =============================================================================
// FireISP 5.0 — Payment Transaction Viewer
// =============================================================================
// Read-only page at /payment-transactions. Lists the raw gateway transaction
// log (every charge attempt) with its provider reference, client, amount,
// gateway status and timestamp for auditing and reconciliation. This is a
// historical/audit view and exposes no create/edit/delete actions.
// =============================================================================

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import { styles, fmtDate, fmtMoney } from './crudStyles';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PaymentTransaction {
  id: number;
  payment_id: number | null;
  payment_gateway_id: number;
  client_id: number;
  gateway_reference_id: string;
  amount: number | string;
  currency: string;
  gateway_status: string;
  gateway_response_code: string | null;
  created_at: string | null;
}

interface PaymentTransactionResponse {
  data: PaymentTransaction[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

const DEFAULT_PAGE_SIZE = 50;
const STATUS_FILTER_OPTIONS = ['', 'pending', 'succeeded', 'failed', 'refunded', 'disputed', 'cancelled'];

// ---------------------------------------------------------------------------
// Fetch helper
// ---------------------------------------------------------------------------

async function fetchTransactions(page: number, statusFilter: string): Promise<PaymentTransactionResponse> {
  const query: Record<string, string | number> = { page, limit: DEFAULT_PAGE_SIZE };
  if (statusFilter) query.gateway_status = statusFilter;
  const res = await api.GET('/payment-transactions', { params: { query: query as never } });
  if (res.error) throw new Error('Failed to load payment transactions');
  return res.data as unknown as PaymentTransactionResponse;
}

// ---------------------------------------------------------------------------
// Badge
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; color: string }> = {
    succeeded: { bg: '#d1fae5', color: '#065f46' },
    pending: { bg: '#fef3c7', color: '#92400e' },
    failed: { bg: '#fee2e2', color: '#991b1b' },
    refunded: { bg: '#dbeafe', color: '#1e40af' },
    disputed: { bg: '#fde68a', color: '#92400e' },
    cancelled: { bg: '#f3f4f6', color: '#374151' },
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
// PaymentTransactionList component
// ---------------------------------------------------------------------------

export function PaymentTransactionList() {
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('');

  const transactionsQ = useQuery({
    queryKey: ['payment-transactions', page, statusFilter],
    queryFn: () => fetchTransactions(page, statusFilter),
  });

  function handleFilterChange(value: string) {
    setStatusFilter(value);
    setPage(1);
  }

  const transactions = transactionsQ.data?.data ?? [];
  const meta = transactionsQ.data?.meta;
  const totalPages = meta?.totalPages ?? 1;

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.pageTitle}>🧾 Payment Transactions</h1>
        {meta && <span style={styles.countBadge}>{meta.total} total</span>}
      </div>

      <div style={styles.filterRow}>
        <label style={styles.filterLabel}>Status:</label>
        <select
          style={styles.filterSelect}
          value={statusFilter}
          onChange={e => handleFilterChange(e.target.value)}
        >
          {STATUS_FILTER_OPTIONS.map(s => (
            <option key={s} value={s}>{s ? s.charAt(0).toUpperCase() + s.slice(1) : 'All'}</option>
          ))}
        </select>
        {statusFilter && (
          <button type="button" style={styles.btnSecondary} onClick={() => handleFilterChange('')}>
            Clear filter
          </button>
        )}
      </div>

      <div style={styles.tableCard}>
        {transactionsQ.isLoading ? (
          <p style={styles.msg}>Loading…</p>
        ) : transactionsQ.error ? (
          <p style={styles.msgError}>Failed to load payment transactions.</p>
        ) : transactions.length === 0 ? (
          <p style={styles.msg}>No payment transactions found{statusFilter ? ` with status "${statusFilter}"` : ''}.</p>
        ) : (
          <>
            <div style={{ overflowX: 'auto' }}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    {['ID', 'Reference', 'Client', 'Gateway', 'Amount', 'Status', 'Code', 'Date'].map(
                      h => <th key={h} style={styles.th}>{h}</th>,
                    )}
                  </tr>
                </thead>
                <tbody>
                  {transactions.map(t => (
                    <tr key={t.id} style={styles.tr}>
                      <td style={styles.td}>#{t.id}</td>
                      <td style={{ ...styles.td, fontFamily: 'monospace', fontSize: '0.78rem', maxWidth: 220, overflowWrap: 'anywhere' }}>
                        {t.gateway_reference_id}
                      </td>
                      <td style={styles.td}>#{t.client_id}</td>
                      <td style={styles.td}>#{t.payment_gateway_id}</td>
                      <td style={styles.td}>{fmtMoney(t.amount, t.currency)}</td>
                      <td style={styles.td}><StatusBadge status={t.gateway_status} /></td>
                      <td style={styles.td}>{t.gateway_response_code ?? '—'}</td>
                      <td style={{ ...styles.td, whiteSpace: 'nowrap' }}>{t.created_at ? fmtDate(t.created_at) : '—'}</td>
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
