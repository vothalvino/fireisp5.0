// =============================================================================
// FireISP 5.0 — Portal Invoice Detail
// =============================================================================
// Shows a single invoice for the client with line items and a Pay button.
// At /portal/invoices/:id
// =============================================================================

import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import { portalTokenStore } from '@/auth/PortalAuthContext';

const API_BASE = '/api/v1/portal';

interface InvoiceItem {
  id: number;
  description: string;
  quantity: string;
  unit_price: string;
  amount: string;
  tax_rate: string | null;
}

interface Payment {
  allocated_amount: string;
  payment_method: string;
  payment_date: string | null;
}

interface Invoice {
  id: number;
  invoice_number: string;
  subtotal: string;
  tax_amount: string;
  discount_amount: string | null;
  total: string;
  currency: string;
  period_start: string | null;
  period_end: string | null;
  due_date: string | null;
  paid_at: string | null;
  status: string;
  notes: string | null;
  created_at: string;
  items: InvoiceItem[];
  payments: Payment[];
}

async function portalGet<T>(path: string): Promise<T> {
  const token = portalTokenStore.getAccess();
  const res = await fetch(`${API_BASE}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error('Not found');
  return (await res.json() as { data: T }).data;
}

async function startPayment(invoiceId: number): Promise<{ payment_url: string }> {
  const token = portalTokenStore.getAccess();
  const res = await fetch(`${API_BASE}/invoices/${invoiceId}/pay`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ return_url: window.location.href }),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new Error(err.error?.message ?? 'Payment initiation failed');
  }
  return (await res.json() as { data: { payment_url: string } }).data;
}

export function PortalInvoiceDetail() {
  const { id } = useParams<{ id: string }>();
  const [payError, setPayError] = useState<string | null>(null);

  const { data: invoice, isLoading, error } = useQuery({
    queryKey: ['portal-invoice', id],
    queryFn: () => portalGet<Invoice>(`/invoices/${id}`),
    enabled: !!id,
  });

  const payMutation = useMutation({
    mutationFn: () => startPayment(Number(id)),
    onSuccess: result => {
      window.location.href = result.payment_url;
    },
    onError: (err: Error) => {
      setPayError(err.message);
    },
  });

  if (isLoading) return <p style={{ color: '#6b7280' }}>Loading…</p>;
  if (error || !invoice) return <p style={{ color: '#b91c1c' }}>Invoice not found.</p>;

  const canPay = invoice.status === 'issued' || invoice.status === 'overdue';

  return (
    <div>
      <div style={styles.breadcrumb}>
        <Link to="/portal/invoices" style={styles.back}>← Back to invoices</Link>
      </div>

      <div style={styles.card}>
        {/* Header */}
        <div style={styles.invoiceHeader}>
          <div>
            <h1 style={styles.invoiceNum}>{invoice.invoice_number}</h1>
            <p style={styles.meta}>Issued: {invoice.created_at.slice(0, 10)}</p>
            {invoice.due_date && (
              <p style={styles.meta}>Due: {invoice.due_date.slice(0, 10)}</p>
            )}
            {invoice.period_start && invoice.period_end && (
              <p style={styles.meta}>Period: {invoice.period_start.slice(0, 10)} – {invoice.period_end.slice(0, 10)}</p>
            )}
          </div>
          <div style={styles.statusBlock}>
            <span style={{ ...styles.badge, ...badgeColor(invoice.status) }}>
              {invoice.status.toUpperCase()}
            </span>
            {canPay && (
              <div style={{ marginTop: '0.75rem' }}>
                {payError && <p style={styles.payError}>{payError}</p>}
                <button
                  onClick={() => { setPayError(null); payMutation.mutate(); }}
                  disabled={payMutation.isPending}
                  style={styles.payBtn}
                >
                  {payMutation.isPending ? 'Processing…' : '💳 Pay Now'}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Line items */}
        <h2 style={styles.sectionTitle}>Items</h2>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>Description</th>
              <th style={{ ...styles.th, textAlign: 'right' }}>Qty</th>
              <th style={{ ...styles.th, textAlign: 'right' }}>Unit Price</th>
              <th style={{ ...styles.th, textAlign: 'right' }}>Amount</th>
            </tr>
          </thead>
          <tbody>
            {invoice.items.map(item => (
              <tr key={item.id}>
                <td style={styles.td}>{item.description}</td>
                <td style={{ ...styles.td, textAlign: 'right' }}>{item.quantity}</td>
                <td style={{ ...styles.td, textAlign: 'right' }}>{parseFloat(item.unit_price).toFixed(2)}</td>
                <td style={{ ...styles.td, textAlign: 'right' }}>{parseFloat(item.amount).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Totals */}
        <div style={styles.totals}>
          <div style={styles.totalRow}><span>Subtotal</span><span>{invoice.currency} {parseFloat(invoice.subtotal).toFixed(2)}</span></div>
          <div style={styles.totalRow}><span>Tax</span><span>{invoice.currency} {parseFloat(invoice.tax_amount).toFixed(2)}</span></div>
          {invoice.discount_amount && parseFloat(invoice.discount_amount) > 0 && (
            <div style={styles.totalRow}><span>Discount</span><span>− {invoice.currency} {parseFloat(invoice.discount_amount).toFixed(2)}</span></div>
          )}
          <div style={{ ...styles.totalRow, fontWeight: 700, fontSize: '1.1rem', borderTop: '2px solid #e5e7eb', paddingTop: '0.5rem' }}>
            <span>Total</span><span>{invoice.currency} {parseFloat(invoice.total).toFixed(2)}</span>
          </div>
        </div>

        {/* Applied payments */}
        {invoice.payments.length > 0 && (
          <>
            <h2 style={styles.sectionTitle}>Payments Applied</h2>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>Date</th>
                  <th style={styles.th}>Method</th>
                  <th style={{ ...styles.th, textAlign: 'right' }}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {invoice.payments.map((p, i) => (
                  <tr key={i}>
                    <td style={styles.td}>{p.payment_date ? p.payment_date.slice(0, 10) : '—'}</td>
                    <td style={styles.td}>{p.payment_method}</td>
                    <td style={{ ...styles.td, textAlign: 'right' }}>{invoice.currency} {parseFloat(p.allocated_amount).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        {invoice.notes && (
          <p style={styles.notes}><strong>Notes:</strong> {invoice.notes}</p>
        )}
      </div>
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
  breadcrumb: { marginBottom: '1rem' },
  back: { color: '#6b7280', textDecoration: 'none', fontSize: '0.9rem' },
  card: { background: '#fff', borderRadius: 8, padding: '1.5rem', boxShadow: '0 1px 4px rgba(0,0,0,.07)' },
  invoiceHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem', flexWrap: 'wrap' as const, gap: '1rem' },
  invoiceNum: { margin: '0 0 0.25rem', fontSize: '1.4rem', color: '#111827' },
  meta: { margin: '0.15rem 0', color: '#6b7280', fontSize: '0.875rem' },
  statusBlock: { textAlign: 'right' as const },
  badge: { display: 'inline-block', padding: '0.3rem 0.75rem', borderRadius: 12, fontSize: '0.8rem', fontWeight: 700 },
  payBtn: { padding: '0.6rem 1.5rem', background: '#e25822', color: '#fff', border: 'none', borderRadius: 4, fontSize: '1rem', fontWeight: 600, cursor: 'pointer' },
  payError: { color: '#b91c1c', fontSize: '0.85rem', margin: '0 0 0.5rem' },
  sectionTitle: { fontSize: '1rem', color: '#374151', margin: '1.25rem 0 0.5rem' },
  table: { width: '100%', borderCollapse: 'collapse' as const, fontSize: '0.875rem' },
  th: { textAlign: 'left' as const, padding: '0.5rem 0.5rem', color: '#6b7280', fontWeight: 600, borderBottom: '2px solid #f3f4f6' },
  td: { padding: '0.5rem', borderBottom: '1px solid #f9fafb', color: '#374151' },
  totals: { marginTop: '1rem', maxWidth: 320, marginLeft: 'auto' },
  totalRow: { display: 'flex', justifyContent: 'space-between', padding: '0.25rem 0', fontSize: '0.9rem', color: '#374151' },
  notes: { marginTop: '1rem', color: '#6b7280', fontSize: '0.875rem' },
} as const;
