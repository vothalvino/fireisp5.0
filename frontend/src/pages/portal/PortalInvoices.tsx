// =============================================================================
// FireISP 5.0 — Portal Invoices
// =============================================================================
// Lists all invoices for the authenticated client at /portal/invoices.
// =============================================================================

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { portalTokenStore } from '@/auth/PortalAuthContext';

const API_BASE = '/api/v1/portal';

interface Invoice {
  id: number;
  invoice_number: string;
  subtotal: string;
  tax_amount: string;
  total: string;
  currency: string;
  due_date: string | null;
  paid_at: string | null;
  status: string;
  created_at: string;
}

interface InvoicesResponse {
  data: Invoice[];
  meta: { page: number; limit: number; total: number; pages: number };
}

async function fetchPortalInvoices(page: number, status: string): Promise<InvoicesResponse> {
  const token = portalTokenStore.getAccess();
  const query = new URLSearchParams({ page: String(page), limit: '20' });
  if (status) query.set('status', status);
  const res = await fetch(`${API_BASE}/invoices?${query}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error('Failed to load invoices');
  return res.json() as Promise<InvoicesResponse>;
}

const STATUS_LABELS: Record<string, string> = {
  draft: '⬜ Draft',
  issued: '📤 Issued',
  paid: '✅ Paid',
  overdue: '🔴 Overdue',
  cancelled: '❌ Cancelled',
};

export function PortalInvoices() {
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('');

  const { data, isLoading, error } = useQuery({
    queryKey: ['portal-invoices', page, statusFilter],
    queryFn: () => fetchPortalInvoices(page, statusFilter),
  });

  const invoices = data?.data ?? [];
  const meta = data?.meta;

  return (
    <div>
      <div style={styles.header}>
        <h1 style={styles.heading}>🧾 My Invoices</h1>
        <select
          value={statusFilter}
          onChange={e => { setStatusFilter(e.target.value); setPage(1); }}
          style={styles.select}
        >
          <option value="">All statuses</option>
          <option value="draft">Draft</option>
          <option value="issued">Issued</option>
          <option value="paid">Paid</option>
          <option value="overdue">Overdue</option>
          <option value="cancelled">Cancelled</option>
        </select>
      </div>

      {isLoading && <p style={styles.info}>Loading…</p>}
      {error && <p style={styles.error}>Failed to load invoices.</p>}

      {!isLoading && invoices.length === 0 && (
        <p style={styles.info}>No invoices found.</p>
      )}

      {invoices.length > 0 && (
        <div style={styles.card}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Invoice #</th>
                <th style={styles.th}>Date</th>
                <th style={styles.th}>Due</th>
                <th style={styles.th}>Total</th>
                <th style={styles.th}>Status</th>
                <th style={styles.th}></th>
              </tr>
            </thead>
            <tbody>
              {invoices.map(inv => (
                <tr key={inv.id}>
                  <td style={styles.td}>
                    <Link to={`/portal/invoices/${inv.id}`} style={styles.link}>{inv.invoice_number}</Link>
                  </td>
                  <td style={styles.td}>{inv.created_at.slice(0, 10)}</td>
                  <td style={styles.td}>{inv.due_date ? inv.due_date.slice(0, 10) : '—'}</td>
                  <td style={styles.td}>{inv.currency} {parseFloat(inv.total).toFixed(2)}</td>
                  <td style={styles.td}>
                    <span style={{ ...styles.badge, ...badgeColor(inv.status) }}>
                      {STATUS_LABELS[inv.status] ?? inv.status}
                    </span>
                  </td>
                  <td style={styles.td}>
                    {(inv.status === 'issued' || inv.status === 'overdue') && (
                      <Link to={`/portal/invoices/${inv.id}`} style={styles.payBtn}>Pay →</Link>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {meta && meta.pages > 1 && (
        <div style={styles.pagination}>
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} style={styles.pageBtn}>
            ‹ Prev
          </button>
          <span style={styles.pageInfo}>Page {page} of {meta.pages}</span>
          <button onClick={() => setPage(p => Math.min(meta.pages, p + 1))} disabled={page === meta.pages} style={styles.pageBtn}>
            Next ›
          </button>
        </div>
      )}
    </div>
  );
}

function badgeColor(status: string): React.CSSProperties {
  switch (status) {
    case 'paid': return { background: '#d1fae5', color: '#065f46' };
    case 'issued': return { background: '#dbeafe', color: '#1e40af' };
    case 'overdue': return { background: '#fee2e2', color: '#991b1b' };
    case 'cancelled': return { background: '#f3f4f6', color: '#6b7280' };
    default: return { background: '#f3f4f6', color: '#374151' };
  }
}

const styles = {
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' },
  heading: { margin: 0, fontSize: '1.4rem', color: 'var(--text-primary)' },
  select: { padding: '0.4rem 0.6rem', border: '1px solid var(--input-border)', borderRadius: 4, fontSize: '0.9rem' },
  info: { color: 'var(--text-muted)' },
  error: { color: '#b91c1c' },
  card: { background: 'var(--bg-card)', borderRadius: 8, boxShadow: '0 1px 4px rgba(0,0,0,.07)', overflow: 'auto' },
  table: { width: '100%', borderCollapse: 'collapse' as const, fontSize: '0.875rem' },
  th: { textAlign: 'left' as const, padding: '0.6rem 0.75rem', color: 'var(--text-muted)', fontWeight: 600, borderBottom: '2px solid var(--border-subtle)' },
  td: { padding: '0.6rem 0.75rem', borderBottom: '1px solid #f9fafb', color: 'var(--text-secondary)' },
  link: { color: '#1d4ed8', textDecoration: 'none', fontWeight: 500 },
  badge: { display: 'inline-block', padding: '0.2rem 0.5rem', borderRadius: 12, fontSize: '0.78rem', fontWeight: 600 },
  payBtn: { color: '#e25822', fontWeight: 600, textDecoration: 'none', fontSize: '0.875rem' },
  pagination: { display: 'flex', alignItems: 'center', gap: '1rem', marginTop: '1rem', justifyContent: 'center' },
  pageBtn: { padding: '0.4rem 0.8rem', border: '1px solid var(--border-strong)', borderRadius: 4, cursor: 'pointer', background: 'var(--bg-card)', fontSize: '0.875rem' },
  pageInfo: { color: 'var(--text-muted)', fontSize: '0.875rem' },
};
