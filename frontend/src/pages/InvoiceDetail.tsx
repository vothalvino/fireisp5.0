// =============================================================================
// FireISP 5.0 — Invoice Detail
// =============================================================================
// Shows a single invoice at /invoices/:id with:
//   • Invoice metadata (number, dates, status, amounts)
//   • Line items table
//   • Actions: Send Email, Download PDF, Record Payment
//   • Applied payments list
// =============================================================================

import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, tokenStore } from '@/api/client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Invoice {
  id: number;
  client_id: number;
  contract_id: number | null;
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
}

interface InvoiceItem {
  id: number;
  description: string;
  quantity: string;
  unit_price: string;
  amount: string;
  tax_rate: string | null;
}

interface Payment {
  id: number;
  payment_id: number;
  invoice_id: number;
  amount: string;
  payment_amount: string;
  payment_method: string;
  payment_date: string | null;
}

interface Client {
  id: number;
  name: string;
  email: string | null;
}

// ---------------------------------------------------------------------------
// Fetch helpers
// ---------------------------------------------------------------------------

const API_BASE = '/api/v1';

async function fetchInvoice(id: string): Promise<Invoice> {
  const res = await api.GET('/invoices/{id}', { params: { path: { id: Number(id) } } });
  if (res.error) throw new Error('Invoice not found');
  return (res.data as unknown as { data: Invoice }).data ?? (res.data as unknown as Invoice);
}

async function fetchItems(id: string): Promise<InvoiceItem[]> {
  const res = await api.GET('/invoices/{id}/items' as never, { params: { path: { id: Number(id) } } } as never);
  if ((res as { error?: unknown }).error) return [];
  return ((res as { data: { data: InvoiceItem[] } }).data?.data) ?? [];
}

async function fetchAppliedPayments(id: string): Promise<Payment[]> {
  const res = await api.GET('/invoices/{id}/payments' as never, { params: { path: { id: Number(id) } } } as never);
  if ((res as { error?: unknown }).error) return [];
  return ((res as { data: { data: Payment[] } }).data?.data) ?? [];
}

async function fetchClient(id: number): Promise<Client> {
  const res = await api.GET('/clients/{id}', { params: { path: { id } } });
  if (res.error) throw new Error('Client not found');
  return (res.data as unknown as { data: Client }).data ?? (res.data as unknown as Client);
}

async function sendInvoiceEmail(invoiceId: number): Promise<{ to: string }> {
  const token = tokenStore.getAccess();
  const res = await fetch(`${API_BASE}/invoices/${invoiceId}/send-email`, {
    method: 'POST',
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error || 'Failed to send email');
  return body as { to: string };
}

async function createPayment(invoiceId: number, body: RecordPaymentBody): Promise<void> {
  const token = tokenStore.getAccess();
  // Create payment then allocate to this invoice
  const createRes = await fetch(`${API_BASE}/payments`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!createRes.ok) {
    const err = await createRes.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || 'Failed to create payment');
  }
  const { data: payment } = await createRes.json() as { data: { id: number } };

  // Allocate the payment to this invoice
  const allocRes = await fetch(`${API_BASE}/payments/${payment.id}/allocate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ invoice_id: invoiceId, amount: body.amount }),
  });
  if (!allocRes.ok) {
    const err = await allocRes.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || 'Failed to allocate payment');
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface RecordPaymentBody {
  client_id: number;
  amount: number;
  currency: string;
  payment_method: string;
  reference_number?: string;
  payment_date: string;
}

function fmt(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('es-MX', {
    year: 'numeric', month: 'short', day: 'numeric',
  });
}

function fmtAmount(amount: string | null | undefined, currency: string): string {
  if (!amount) return '—';
  const num = parseFloat(amount);
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency: currency || 'MXN' }).format(num);
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; color: string }> = {
    draft:     { bg: '#f3f4f6', color: '#6b7280' },
    pending:   { bg: '#ede9fe', color: '#5b21b6' },
    sent:      { bg: '#dbeafe', color: '#1e40af' },
    paid:      { bg: '#d1fae5', color: '#065f46' },
    overdue:   { bg: '#fee2e2', color: '#991b1b' },
    cancelled: { bg: '#fef3c7', color: '#92400e' },
    void:      { bg: '#f3f4f6', color: '#374151' },
  };
  const s = map[status] ?? { bg: '#f3f4f6', color: '#374151' };
  return (
    <span style={{
      background: s.bg, color: s.color, padding: '3px 10px',
      borderRadius: 12, fontSize: '0.78rem', fontWeight: 600, textTransform: 'capitalize',
    }}>
      {status}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Record Payment Modal
// ---------------------------------------------------------------------------

const PAYMENT_METHODS = ['cash', 'bank_transfer', 'credit_card', 'debit_card', 'check', 'stripe', 'conekta', 'paypal', 'other'];
const TODAY = new Date().toISOString().split('T')[0];

interface RecordPaymentModalProps {
  invoice: Invoice;
  clientId: number;
  onClose: () => void;
  onRecorded: () => void;
}

function RecordPaymentModal({ invoice, clientId, onClose, onRecorded }: RecordPaymentModalProps) {
  const [form, setForm] = useState({
    amount: invoice.total,
    currency: invoice.currency || 'MXN',
    payment_method: 'cash',
    reference_number: '',
    payment_date: TODAY,
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  function setField(name: string, value: string) {
    setForm(prev => ({ ...prev, [name]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.amount || isNaN(parseFloat(form.amount))) {
      setError('Please enter a valid amount.');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      await createPayment(invoice.id, {
        client_id: clientId,
        amount: parseFloat(form.amount),
        currency: form.currency,
        payment_method: form.payment_method,
        ...(form.reference_number ? { reference_number: form.reference_number } : {}),
        payment_date: form.payment_date,
      });
      onRecorded();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to record payment');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={overlay}>
      <div style={modalBox}>
        <h3 style={{ margin: '0 0 1rem' }}>Record Payment</h3>
        <p style={{ margin: '0 0 1rem', fontSize: '0.85rem', color: '#6b7280' }}>
          Invoice {invoice.invoice_number} — balance {fmtAmount(invoice.total, invoice.currency)}
        </p>
        {error && <div style={errorBox}>{error}</div>}
        <form onSubmit={handleSubmit}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 12px' }}>
            <div>
              <label style={labelStyle}>Amount</label>
              <input
                type="number" step="0.01" min="0.01"
                style={inputStyle}
                value={form.amount}
                onChange={e => setField('amount', e.target.value)}
                required
              />
            </div>
            <div>
              <label style={labelStyle}>Currency</label>
              <input
                type="text" maxLength={3}
                style={inputStyle}
                value={form.currency}
                onChange={e => setField('currency', e.target.value.toUpperCase())}
                required
              />
            </div>
          </div>

          <label style={labelStyle}>Payment Method</label>
          <select
            style={inputStyle}
            value={form.payment_method}
            onChange={e => setField('payment_method', e.target.value)}
          >
            {PAYMENT_METHODS.map(m => (
              <option key={m} value={m}>{m.replace('_', ' ')}</option>
            ))}
          </select>

          <label style={labelStyle}>Payment Date</label>
          <input
            type="date" style={inputStyle}
            value={form.payment_date}
            onChange={e => setField('payment_date', e.target.value)}
            required
          />

          <label style={labelStyle}>Reference / Folio (optional)</label>
          <input
            type="text" style={inputStyle}
            value={form.reference_number}
            onChange={e => setField('reference_number', e.target.value)}
            placeholder="e.g. transfer ID, check number"
          />

          <div style={{ display: 'flex', gap: 8, marginTop: '1.25rem', justifyContent: 'flex-end' }}>
            <button type="button" onClick={onClose} style={cancelBtn}>Cancel</button>
            <button type="submit" style={submitBtn} disabled={submitting}>
              {submitting ? 'Saving…' : 'Record Payment'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export function InvoiceDetail() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const [showPayment, setShowPayment] = useState(false);
  const [toastMsg, setToastMsg] = useState('');

  const invoiceQ = useQuery({
    queryKey: ['invoice', id],
    queryFn: () => fetchInvoice(id!),
    enabled: !!id,
  });

  const itemsQ = useQuery({
    queryKey: ['invoice-items', id],
    queryFn: () => fetchItems(id!),
    enabled: !!id,
  });

  const paymentsQ = useQuery({
    queryKey: ['invoice-payments', id],
    queryFn: () => fetchAppliedPayments(id!),
    enabled: !!id,
  });

  const clientQ = useQuery({
    queryKey: ['client', invoiceQ.data?.client_id],
    queryFn: () => fetchClient(invoiceQ.data!.client_id),
    enabled: !!invoiceQ.data?.client_id,
  });

  const sendEmailMutation = useMutation({
    mutationFn: () => sendInvoiceEmail(Number(id)),
    onSuccess: (result) => {
      showToast(`Invoice emailed to ${result.to}`);
      qc.invalidateQueries({ queryKey: ['invoice', id] });
    },
    onError: (err: Error) => showToast(`Error: ${err.message}`, true),
  });

  function showToast(msg: string, _isError = false) {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(''), 4000);
  }

  function handleDownloadPdf() {
    const token = tokenStore.getAccess();
    const url = `${API_BASE}/pdf/invoices/${id}`;
    // Open in new tab — browser will download the PDF
    const link = document.createElement('a');
    link.href = url;
    link.target = '_blank';
    // Add auth token as query param for the download (simple approach since PDF endpoint requires auth)
    if (token) link.href = `${url}?_t=${encodeURIComponent(token)}`;
    link.click();
  }

  const invoice = invoiceQ.data;
  const client = clientQ.data;

  return (
    <div style={{ padding: '1.5rem', maxWidth: 860 }}>
      {/* Breadcrumb */}
      <div style={{ fontSize: '0.8rem', color: '#9ca3af', marginBottom: '0.75rem' }}>
        <Link to="/invoices" style={{ color: '#6b7280', textDecoration: 'none' }}>🧾 Invoices</Link>
        {invoice && <> / {invoice.invoice_number || `#${invoice.id}`}</>}
      </div>

      {invoiceQ.isLoading && <p style={{ color: '#888' }}>Loading…</p>}
      {invoiceQ.isError && <p style={{ color: '#e25822' }}>Invoice not found.</p>}

      {invoice && (
        <>
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '1.25rem', gap: 12, flexWrap: 'wrap' }}>
            <div>
              <h1 style={{ margin: 0, fontSize: '1.4rem', fontWeight: 700 }}>
                {invoice.invoice_number || `Invoice #${invoice.id}`}
              </h1>
              {client && (
                <div style={{ marginTop: 4, fontSize: '0.875rem', color: '#6b7280' }}>
                  Client:{' '}
                  <Link to={`/clients/${client.id}`} style={{ color: '#e25822', textDecoration: 'none' }}>
                    {client.name}
                  </Link>
                  {client.email && <span style={{ marginLeft: 8, color: '#9ca3af' }}>{client.email}</span>}
                </div>
              )}
            </div>

            {/* Action buttons */}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                onClick={() => sendEmailMutation.mutate()}
                disabled={sendEmailMutation.isPending}
                style={actionBtn('#2563eb')}
              >
                {sendEmailMutation.isPending ? 'Sending…' : '✉️ Send Email'}
              </button>
              <button onClick={handleDownloadPdf} style={actionBtn('#059669')}>
                ⬇ Download PDF
              </button>
              <button
                onClick={() => setShowPayment(true)}
                disabled={invoice.status === 'paid' || invoice.status === 'void'}
                style={actionBtn('#e25822')}
              >
                💳 Record Payment
              </button>
            </div>
          </div>

          {/* Toast */}
          {toastMsg && (
            <div style={{
              background: '#1a1a2e', color: '#fff', padding: '10px 16px',
              borderRadius: 6, marginBottom: '1rem', fontSize: '0.85rem',
            }}>
              {toastMsg}
            </div>
          )}

          {/* Invoice metadata card */}
          <div style={card}>
            <div style={metaGrid}>
              <MetaRow label="Status" value={<StatusBadge status={invoice.status} />} />
              <MetaRow label="Total" value={<strong style={{ fontSize: '1.05rem' }}>{fmtAmount(invoice.total, invoice.currency)}</strong>} />
              <MetaRow label="Subtotal" value={fmtAmount(invoice.subtotal, invoice.currency)} />
              <MetaRow label="Tax" value={fmtAmount(invoice.tax_amount, invoice.currency)} />
              {invoice.discount_amount && parseFloat(invoice.discount_amount) !== 0 && (
                <MetaRow label="Discount" value={fmtAmount(invoice.discount_amount, invoice.currency)} />
              )}
              <MetaRow label="Currency" value={invoice.currency} />
              <MetaRow label="Due Date" value={fmt(invoice.due_date)} />
              <MetaRow label="Paid At" value={fmt(invoice.paid_at)} />
              {invoice.period_start && <MetaRow label="Period" value={`${fmt(invoice.period_start)} – ${fmt(invoice.period_end)}`} />}
              <MetaRow label="Created" value={fmt(invoice.created_at)} />
              {invoice.contract_id && <MetaRow label="Contract" value={`#${invoice.contract_id}`} />}
            </div>
            {invoice.notes && (
              <p style={{ margin: '0.75rem 0 0', fontSize: '0.85rem', color: '#6b7280', borderTop: '1px solid #f3f4f6', paddingTop: '0.75rem' }}>
                <strong>Notes:</strong> {invoice.notes}
              </p>
            )}
          </div>

          {/* Line Items */}
          <h3 style={{ marginTop: '1.5rem', marginBottom: '0.5rem', fontSize: '1rem' }}>Line Items</h3>
          <div style={card}>
            {itemsQ.isLoading && <p style={{ color: '#888', margin: 0 }}>Loading items…</p>}
            {!itemsQ.isLoading && (itemsQ.data ?? []).length === 0 && (
              <p style={{ color: '#9ca3af', margin: 0, fontSize: '0.85rem' }}>No line items.</p>
            )}
            {(itemsQ.data ?? []).length > 0 && (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid #f3f4f6' }}>
                    {['Description', 'Qty', 'Unit Price', 'Tax %', 'Amount'].map(h => (
                      <th key={h} style={{ padding: '6px 10px', textAlign: 'left', fontWeight: 600, color: '#374151' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(itemsQ.data ?? []).map(item => (
                    <tr key={item.id} style={{ borderBottom: '1px solid #f9fafb' }}>
                      <td style={{ padding: '8px 10px' }}>{item.description}</td>
                      <td style={{ padding: '8px 10px' }}>{item.quantity}</td>
                      <td style={{ padding: '8px 10px', fontVariantNumeric: 'tabular-nums' }}>{fmtAmount(item.unit_price, invoice.currency)}</td>
                      <td style={{ padding: '8px 10px', color: '#9ca3af' }}>{item.tax_rate ? `${item.tax_rate}%` : '—'}</td>
                      <td style={{ padding: '8px 10px', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{fmtAmount(item.amount, invoice.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Applied Payments */}
          <h3 style={{ marginTop: '1.5rem', marginBottom: '0.5rem', fontSize: '1rem' }}>Applied Payments</h3>
          <div style={card}>
            {paymentsQ.isLoading && <p style={{ color: '#888', margin: 0 }}>Loading payments…</p>}
            {!paymentsQ.isLoading && (paymentsQ.data ?? []).length === 0 && (
              <p style={{ color: '#9ca3af', margin: 0, fontSize: '0.85rem' }}>No payments applied yet.</p>
            )}
            {(paymentsQ.data ?? []).length > 0 && (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid #f3f4f6' }}>
                    {['Payment #', 'Method', 'Amount Applied', 'Payment Date'].map(h => (
                      <th key={h} style={{ padding: '6px 10px', textAlign: 'left', fontWeight: 600, color: '#374151' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(paymentsQ.data ?? []).map(p => (
                    <tr key={p.id} style={{ borderBottom: '1px solid #f9fafb' }}>
                      <td style={{ padding: '8px 10px', color: '#e25822', fontWeight: 600 }}>#{p.payment_id}</td>
                      <td style={{ padding: '8px 10px', textTransform: 'capitalize' }}>{(p.payment_method || '').replace('_', ' ')}</td>
                      <td style={{ padding: '8px 10px', fontVariantNumeric: 'tabular-nums' }}>{fmtAmount(p.amount, invoice.currency)}</td>
                      <td style={{ padding: '8px 10px', color: '#6b7280' }}>{fmt(p.payment_date)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Record Payment Modal */}
          {showPayment && (
            <RecordPaymentModal
              invoice={invoice}
              clientId={invoice.client_id}
              onClose={() => setShowPayment(false)}
              onRecorded={() => {
                qc.invalidateQueries({ queryKey: ['invoice', id] });
                qc.invalidateQueries({ queryKey: ['invoice-payments', id] });
                qc.invalidateQueries({ queryKey: ['invoices'] });
                showToast('Payment recorded successfully');
              }}
            />
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function MetaRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: 'contents' }}>
      <dt style={{ color: '#6b7280', fontWeight: 600, fontSize: '0.8rem', padding: '5px 0' }}>{label}</dt>
      <dd style={{ margin: 0, padding: '5px 0', fontSize: '0.875rem', color: '#111827' }}>{value}</dd>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared styles
// ---------------------------------------------------------------------------

const card: React.CSSProperties = {
  background: '#fff', borderRadius: 8, padding: '1rem',
  boxShadow: '0 1px 4px rgba(0,0,0,.08)', marginBottom: '0.25rem',
};
const metaGrid: React.CSSProperties = {
  display: 'grid', gridTemplateColumns: 'auto 1fr',
  columnGap: '1.5rem', rowGap: 0,
};
const overlay: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
};
const modalBox: React.CSSProperties = {
  background: '#fff', borderRadius: 10, padding: '1.5rem',
  width: 440, maxWidth: '92vw', boxShadow: '0 8px 32px rgba(0,0,0,.18)',
};
const errorBox: React.CSSProperties = {
  background: '#fee2e2', color: '#991b1b', padding: '8px 12px',
  borderRadius: 6, marginBottom: '0.75rem', fontSize: '0.85rem',
};
const labelStyle: React.CSSProperties = {
  display: 'block', fontWeight: 600, fontSize: '0.8rem',
  color: '#374151', marginBottom: 4, marginTop: 12,
};
const inputStyle: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', padding: '7px 10px',
  border: '1px solid #d1d5db', borderRadius: 6, fontSize: '0.875rem',
};
const submitBtn: React.CSSProperties = {
  background: '#e25822', color: '#fff', border: 'none',
  padding: '7px 18px', borderRadius: 6, cursor: 'pointer',
  fontWeight: 600, fontSize: '0.875rem',
};
const cancelBtn: React.CSSProperties = {
  background: '#fff', color: '#374151', border: '1px solid #d1d5db',
  padding: '7px 18px', borderRadius: 6, cursor: 'pointer',
  fontWeight: 600, fontSize: '0.875rem',
};

function actionBtn(bg: string): React.CSSProperties {
  return {
    background: bg, color: '#fff', border: 'none',
    padding: '7px 14px', borderRadius: 6, cursor: 'pointer',
    fontWeight: 600, fontSize: '0.8rem',
  };
}
