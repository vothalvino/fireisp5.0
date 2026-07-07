// =============================================================================
// FireISP 5.0 — Payment Detail
// =============================================================================
// Shows a single payment with its info card, allocations table, and the full
// set of lifecycle action buttons (Edit, Allocate, Reallocate, Reassign,
// Un-apply, Send Receipt, Download Receipt PDF, Delete).
//
// Action buttons are rendered by the shared <PaymentActionButtons> component
// (frontend/src/pages/payments/PaymentActions.tsx) so that the behaviour stays
// in sync with the PaymentList row actions — no copy-paste divergence.
// =============================================================================

import { useParams, Link, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { gql } from '@/api/graphql';
import { useAuth } from '@/auth/AuthContext';
import { can } from '@/auth/permissions';
import {
  PaymentActionButtons,
  Payment as RestPayment,
} from './payments/PaymentActions';

// ---------------------------------------------------------------------------
// GraphQL query — fetches the payment + allocations + client in one request
// ---------------------------------------------------------------------------

const PAYMENT_DETAIL_QUERY = /* GraphQL */ `
  query PaymentDetail($id: ID!) {
    payment(id: $id) {
      id
      clientId
      amount
      currency
      paymentMethod
      reference
      status
      paymentDate
      createdAt
      client {
        id
        name
        status
      }
      allocations {
        id
        paymentId
        invoiceId
        amount
        invoice {
          id
          invoiceNumber
          total
          currency
          status
        }
      }
    }
  }
`;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PaymentClient {
  id: string;
  name: string;
  status: string;
}

interface AllocationInvoice {
  id: string;
  invoiceNumber: string;
  total: string;
  currency: string;
  status: string;
}

interface PaymentAllocation {
  id: string;
  paymentId: string;
  invoiceId: string;
  amount: string;
  invoice: AllocationInvoice | null;
}

interface Payment {
  id: string;
  clientId: string;
  amount: string;
  currency: string;
  paymentMethod: string;
  reference: string | null;
  status: string;
  paymentDate: string | null;
  createdAt: string;
  client: PaymentClient | null;
  allocations: PaymentAllocation[];
}

// ---------------------------------------------------------------------------
// Fetch helper
// ---------------------------------------------------------------------------

async function fetchPaymentDetail(id: string): Promise<Payment> {
  const data = await gql<{ payment: Payment | null }>(PAYMENT_DETAIL_QUERY, { id });
  if (!data.payment) throw new Error('Payment not found');
  return data.payment;
}

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

function fmt(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  // GraphQL serialises DATETIME columns via Date.valueOf() to an epoch-millis
  // STRING (e.g. "1779165933000"); REST returns ISO. Handle both, then guard an
  // unparseable value (which previously rendered the literal "Invalid Date").
  const s = String(dateStr).trim();
  const n = Number(s);
  const d = /^\d{10,}$/.test(s) ? new Date(n < 1e12 ? n * 1000 : n) : new Date(s);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('es-MX', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function fmtMoney(amount: string | null, currency = 'MXN'): string {
  if (!amount) return '—';
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
  }).format(parseFloat(amount));
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; color: string }> = {
    active:     { bg: '#d1fae5', color: '#065f46' },
    paid:       { bg: '#d1fae5', color: '#065f46' },
    pending:    { bg: '#ede9fe', color: '#5b21b6' },
    suspended:  { bg: '#fef3c7', color: '#92400e' },
    overdue:    { bg: '#fee2e2', color: '#991b1b' },
    cancelled:  { bg: '#fee2e2', color: '#991b1b' },
    terminated: { bg: '#f3f4f6', color: '#6b7280' },
    expired:    { bg: '#fde68a', color: '#78350f' },
    failed:     { bg: '#fee2e2', color: '#991b1b' },
    draft:      { bg: '#f3f4f6', color: '#6b7280' },
    inactive:   { bg: '#f3f4f6', color: '#6b7280' },
    completed:  { bg: '#d1fae5', color: '#065f46' },
    refunded:   { bg: '#fef3c7', color: '#92400e' },
    partial:    { bg: '#ede9fe', color: '#5b21b6' },
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
// Info card helpers
// ---------------------------------------------------------------------------

function InfoRow({
  label,
  value,
  capitalize,
  mono,
}: {
  label: string;
  value: string | null | undefined;
  capitalize?: boolean;
  mono?: boolean;
}) {
  if (!value) return null;
  return (
    <div style={styles.infoRow}>
      <span style={styles.infoLabel}>{label}</span>
      <span
        style={{
          ...styles.infoValue,
          ...(capitalize ? { textTransform: 'capitalize' as const } : {}),
          ...(mono ? { fontFamily: 'monospace' } : {}),
        }}
      >
        {value}
      </span>
    </div>
  );
}

function PaymentInfoCard({ payment }: { payment: Payment }) {
  return (
    <div style={styles.infoCard}>
      <div style={styles.infoGrid}>
        {payment.client && (
          <div style={styles.infoRow}>
            <span style={styles.infoLabel}>Client</span>
            <Link to={`/clients/${payment.client.id}`} style={styles.infoLink}>
              {payment.client.name}
            </Link>
          </div>
        )}
        <InfoRow label="Amount"     value={fmtMoney(payment.amount, payment.currency)} />
        <InfoRow label="Currency"   value={payment.currency} />
        <InfoRow label="Method"     value={payment.paymentMethod} capitalize />
        <InfoRow label="Reference"  value={payment.reference} mono />
        <InfoRow label="Date"       value={fmt(payment.paymentDate || payment.createdAt)} />
        <InfoRow label="Created"    value={fmt(payment.createdAt)} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Allocations section
// ---------------------------------------------------------------------------

function AllocationsSection({ allocations, currency }: { allocations: PaymentAllocation[]; currency: string }) {
  if (!allocations.length) return <p style={styles.msg}>No invoice allocations for this payment.</p>;
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={styles.table}>
        <thead>
          <tr>{['Invoice #', 'Allocated Amount', 'Invoice Total', 'Status'].map(h => (
            <th key={h} style={styles.th}>{h}</th>
          ))}</tr>
        </thead>
        <tbody>
          {allocations.map(alloc => (
            <tr key={alloc.id} style={styles.tr}>
              <td style={styles.td}>
                {alloc.invoice ? (
                  <Link
                    to={`/invoices/${alloc.invoice.id}`}
                    style={{ color: 'var(--accent)', textDecoration: 'none', fontWeight: 600 }}
                  >
                    {alloc.invoice.invoiceNumber}
                  </Link>
                ) : (
                  `#${alloc.invoiceId}`
                )}
              </td>
              <td style={{ ...styles.td, fontVariantNumeric: 'tabular-nums' }}>
                {fmtMoney(alloc.amount, currency)}
              </td>
              <td style={{ ...styles.td, fontVariantNumeric: 'tabular-nums' }}>
                {alloc.invoice ? fmtMoney(alloc.invoice.total, alloc.invoice.currency) : '—'}
              </td>
              <td style={styles.td}>
                {alloc.invoice ? <StatusBadge status={alloc.invoice.status} /> : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Adapter — map GraphQL Payment (camelCase, id=string) → REST shape
// ---------------------------------------------------------------------------

function toRestPayment(p: Payment): RestPayment {
  return {
    id: Number(p.id),
    client_id: Number(p.clientId),
    amount: p.amount,
    currency: p.currency,
    payment_method: p.paymentMethod || null,
    reference_number: p.reference,
    status: p.status,
    payment_date: p.paymentDate,
    created_at: p.createdAt,
  };
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function PaymentDetail() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();

  // Permission gate — same slug as REST route
  const canView = can(user?.role, 'payments.view');

  const { data: payment, isLoading, error } = useQuery({
    queryKey: ['payment-detail-gql', id],
    queryFn: () => fetchPaymentDetail(id!),
    enabled: Boolean(id) && canView,
  });

  if (!canView) {
    return (
      <div style={styles.page}>
        <p style={styles.msgError}>You do not have permission to view payments.</p>
        <Link to="/payments" style={styles.backLink}>Back to Payments</Link>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div style={styles.page}>
        <p style={styles.msg}>Loading payment…</p>
      </div>
    );
  }

  if (error || !payment) {
    return (
      <div style={styles.page}>
        <p style={styles.msgError}>Payment not found.</p>
        <Link to="/payments" style={styles.backLink}>Back to Payments</Link>
      </div>
    );
  }

  const restPayment = toRestPayment(payment);

  return (
    <div style={styles.page}>
      {/* Breadcrumb */}
      <div style={styles.breadcrumb}>
        <Link to="/payments" style={styles.breadcrumbLink}>Payments</Link>
        <span style={styles.breadcrumbSep}>›</span>
        {payment.client && (
          <>
            <Link to={`/clients/${payment.client.id}`} style={styles.breadcrumbLink}>
              {payment.client.name}
            </Link>
            <span style={styles.breadcrumbSep}>›</span>
          </>
        )}
        <span style={styles.breadcrumbCurrent}>Payment #{payment.id}</span>
      </div>

      {/* Header */}
      <div style={styles.paymentHeader}>
        <div>
          <h1 style={styles.paymentTitle}>Payment #{payment.id}</h1>
          <div style={styles.headerMeta}>
            <StatusBadge status={payment.status} />
            <span style={styles.metaChip}>{fmtMoney(payment.amount, payment.currency)}</span>
            {payment.paymentMethod && (
              <span style={styles.metaChip}>{payment.paymentMethod}</span>
            )}
          </div>
        </div>
        {/* Action buttons toolbar */}
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <PaymentActionButtons
            payment={restPayment}
            onChanged={() => qc.invalidateQueries({ queryKey: ['payment-detail-gql', id] })}
            onDeleted={() => navigate('/payments')}
          />
        </div>
      </div>

      {/* Info card */}
      <PaymentInfoCard payment={payment} />

      {/* Allocations */}
      <div style={styles.sectionHeader}>
        <h2 style={styles.sectionTitle}>Invoice Allocations</h2>
      </div>
      <div style={styles.sectionContent}>
        <AllocationsSection allocations={payment.allocations} currency={payment.currency} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = {
  page: {
    padding: '2rem',
    fontFamily: 'var(--font-sans)',
    maxWidth: 1100,
  },
  breadcrumb: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.4rem',
    marginBottom: '1.25rem',
    fontSize: '0.85rem',
  },
  breadcrumbLink:    { color: 'var(--accent)', textDecoration: 'none', fontWeight: 500 },
  breadcrumbSep:     { color: 'var(--text-dimmed)' },
  breadcrumbCurrent: { color: 'var(--text-secondary)' },
  backLink:          { color: 'var(--accent)', textDecoration: 'none', fontWeight: 500, fontSize: '0.85rem' },

  paymentHeader: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: '1rem',
  },
  paymentTitle: {
    margin: '0 0 0.35rem',
    color: 'var(--text-primary)',
    fontSize: '1.6rem',
    fontWeight: 700,
  },
  headerMeta: { display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' as const },
  metaChip: {
    fontSize: '0.78rem',
    color: 'var(--text-secondary)',
    background: 'var(--bg-card)',
    border: '1px solid var(--border)',
    borderRadius: 12,
    padding: '1px 8px',
    textTransform: 'capitalize' as const,
  },

  infoCard: {
    background: 'var(--bg-card)',
    borderRadius: 8,
    boxShadow: '0 0 0 1px var(--border)',
    padding: '1rem 1.25rem',
    marginBottom: '1.5rem',
  },
  infoGrid: {
    display: 'grid' as const,
    gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
    gap: '0.5rem 1.5rem',
  },
  infoRow:   { display: 'flex', gap: '0.5rem', alignItems: 'baseline', fontSize: '0.85rem' },
  infoLabel: { color: 'var(--text-dimmed)', fontSize: '0.75rem', textTransform: 'uppercase' as const, letterSpacing: '0.04em', minWidth: 80 },
  infoValue: { color: 'var(--text-secondary)' },
  infoLink:  { color: 'var(--accent)', textDecoration: 'none', fontWeight: 500, fontSize: '0.85rem' },

  sectionHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottom: '2px solid var(--border)',
    marginBottom: '0',
  },
  sectionTitle: {
    margin: '0',
    padding: '0.6rem 0',
    fontSize: '0.92rem',
    fontWeight: 600,
    color: 'var(--text-primary)',
  },
  sectionContent: {
    background: 'var(--bg-card)',
    borderRadius: '0 0 8px 8px',
    boxShadow: '0 0 0 1px var(--border)',
    minHeight: 100,
  },

  table: { width: '100%', borderCollapse: 'collapse' as const, fontSize: '0.85rem' },
  th: {
    padding: '0.6rem 0.75rem',
    textAlign: 'left' as const,
    color: 'var(--text-muted)',
    fontSize: '0.75rem',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.04em',
    borderBottom: '2px solid var(--border-subtle)',
    whiteSpace: 'nowrap' as const,
  },
  tr:       { borderBottom: '1px solid var(--border-subtle)' },
  td:       { padding: '0.65rem 0.75rem', color: 'var(--text-secondary)', verticalAlign: 'middle' as const },
  msg:      { padding: '2rem 1.5rem', color: 'var(--text-muted)', fontStyle: 'italic' as const, margin: 0 },
  msgError: { padding: '2rem 1.5rem', color: '#ef4444', margin: 0 },
};
