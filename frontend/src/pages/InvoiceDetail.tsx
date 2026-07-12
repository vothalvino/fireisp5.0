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
import { useTranslation } from 'react-i18next';
import { api, tokenStore, authedFetch } from '@/api/client';
import { extractApiError } from '@/components/ClientFormModal';

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
  const res = await authedFetch(`${API_BASE}/invoices/${invoiceId}/send-email`, {
    method: 'POST',
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error || 'Failed to send email');
  return body as { to: string };
}

async function createPayment(invoiceId: number, body: RecordPaymentBody): Promise<void> {
  // Create payment then allocate to this invoice
  const createRes = await authedFetch(`${API_BASE}/payments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!createRes.ok) {
    const err = await createRes.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || 'Failed to create payment');
  }
  const { data: payment } = await createRes.json() as { data: { id: number } };

  // Allocate the payment to this invoice
  const allocRes = await authedFetch(`${API_BASE}/payments/${payment.id}/allocate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ invoice_id: invoiceId, amount: body.amount }),
  });
  if (!allocRes.ok) {
    const err = await allocRes.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || 'Failed to allocate payment');
  }
}

interface UpdateInvoiceBody {
  invoice_number?: string;
  currency?: string;
  due_date?: string;
  status?: string;
  subtotal?: number;
  tax_amount?: number;
  total?: number;
}

async function updateInvoice(id: number, body: UpdateInvoiceBody): Promise<void> {
  const { error } = await api.PUT('/invoices/{id}', {
    params: { path: { id } },
    body: body as never,
  });
  if (error) throw new Error(extractApiError(error, 'Failed to update invoice'));
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

// Must match the backend payment_method enum exactly (src/middleware/schemas/payments.js
// + the DB ENUM, database/schema.sql) — a value here that isn't accepted
// there 422s on submit with no client-side warning.
const PAYMENT_METHODS = [
  'cash', 'check', 'card', 'transfer', 'online',
  'credit_card', 'debit_card', 'bank_transfer',
  'oxxo_pay', 'spei', 'codi', 'convenience_store',
  'digital_wallet', 'other',
];
const TODAY = new Date().toISOString().split('T')[0];

interface RecordPaymentModalProps {
  invoice: Invoice;
  clientId: number;
  onClose: () => void;
  onRecorded: () => void;
}

function RecordPaymentModal({ invoice, clientId, onClose, onRecorded }: RecordPaymentModalProps) {
  const { t } = useTranslation();
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
              <option key={m} value={m}>{t(`paymentMethods.${m}`)}</option>
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
// Edit Invoice Modal
// ---------------------------------------------------------------------------

const INVOICE_STATUSES = ['draft', 'issued', 'paid', 'overdue', 'cancelled', 'void'];

interface EditInvoiceModalProps {
  invoice: Invoice;
  onClose: () => void;
  onSaved: () => void;
}

function EditInvoiceModal({ invoice, onClose, onSaved }: EditInvoiceModalProps) {
  const [form, setForm] = useState({
    invoice_number: invoice.invoice_number ?? '',
    currency: invoice.currency || 'MXN',
    due_date: invoice.due_date ? invoice.due_date.split('T')[0] : '',
    status: invoice.status,
    subtotal: invoice.subtotal ?? '',
    tax_amount: invoice.tax_amount ?? '',
    total: invoice.total ?? '',
  });
  const [error, setError] = useState('');

  function setField(name: keyof typeof form, value: string) {
    setForm(prev => ({ ...prev, [name]: value }));
  }

  const mutation = useMutation({
    mutationFn: () => {
      const body: UpdateInvoiceBody = { status: form.status };
      if (form.invoice_number.trim()) body.invoice_number = form.invoice_number.trim();
      if (form.currency.trim()) body.currency = form.currency.trim();
      if (form.due_date) body.due_date = form.due_date;
      if (form.subtotal !== '') body.subtotal = parseFloat(form.subtotal);
      if (form.tax_amount !== '') body.tax_amount = parseFloat(form.tax_amount);
      if (form.total !== '') body.total = parseFloat(form.total);
      return updateInvoice(invoice.id, body);
    },
    onSuccess: () => { onSaved(); onClose(); },
    onError: (err: Error) => setError(err.message),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    mutation.mutate();
  }

  return (
    <div style={overlay} role="dialog" aria-modal="true" aria-label="Edit Invoice">
      <div style={modalBox}>
        <h3 style={{ margin: '0 0 1rem' }}>Edit Invoice</h3>
        {error && <div style={errorBox}>{error}</div>}
        <form onSubmit={handleSubmit}>
          <label style={labelStyle}>Invoice Number</label>
          <input style={inputStyle} value={form.invoice_number} onChange={e => setField('invoice_number', e.target.value)} />

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 12px' }}>
            <div>
              <label style={labelStyle}>Status</label>
              <select style={inputStyle} value={form.status} onChange={e => setField('status', e.target.value)}>
                {INVOICE_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Currency</label>
              <input style={inputStyle} maxLength={3} value={form.currency} onChange={e => setField('currency', e.target.value.toUpperCase())} />
            </div>
          </div>

          <label style={labelStyle}>Due Date</label>
          <input type="date" style={inputStyle} value={form.due_date} onChange={e => setField('due_date', e.target.value)} />

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0 12px' }}>
            <div>
              <label style={labelStyle}>Subtotal</label>
              <input type="number" step="0.01" min="0" style={inputStyle} value={form.subtotal} onChange={e => setField('subtotal', e.target.value)} />
            </div>
            <div>
              <label style={labelStyle}>Tax</label>
              <input type="number" step="0.01" min="0" style={inputStyle} value={form.tax_amount} onChange={e => setField('tax_amount', e.target.value)} />
            </div>
            <div>
              <label style={labelStyle}>Total</label>
              <input type="number" step="0.01" min="0" style={inputStyle} value={form.total} onChange={e => setField('total', e.target.value)} />
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: '1.25rem', justifyContent: 'flex-end' }}>
            <button type="button" onClick={onClose} style={cancelBtn} disabled={mutation.isPending}>Cancel</button>
            <button type="submit" style={submitBtn} disabled={mutation.isPending}>
              {mutation.isPending ? 'Saving…' : 'Save Changes'}
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
  const [showEdit, setShowEdit] = useState(false);
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
    onError: (err: Error) => showToast(`Error: ${err.message}`),
  });

  const voidMutation = useMutation({
    mutationFn: () => updateInvoice(Number(id), { status: 'void' }),
    onSuccess: () => {
      showToast('Invoice voided');
      qc.invalidateQueries({ queryKey: ['invoice', id] });
      qc.invalidateQueries({ queryKey: ['invoices'] });
    },
    onError: (err: Error) => showToast(`Error: ${err.message}`),
  });

  function handleVoid() {
    const isPaid = invoice?.status === 'paid';
    const msg = isPaid
      ? 'Void this paid invoice? The invoice will be cancelled and its payment(s) will be released to the client as unallocated credit. This cannot be undone.'
      : 'Void this invoice? This marks it as void and cannot be undone.';
    if (window.confirm(msg)) {
      voidMutation.mutate();
    }
  }

  function showToast(msg: string) {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(''), 4000);
  }

  async function handleDownloadPdf() {
    const token = tokenStore.getAccess();
    const url = `${API_BASE}/pdf/invoices/${id}`;
    try {
      const res = await fetch(url, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error('Failed to download PDF');
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = `invoice-${invoice?.invoice_number || id}.pdf`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(blobUrl), 10_000);
    } catch (err) {
      showToast(`Error: ${err instanceof Error ? err.message : 'Download failed'}`);
    }
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
      {invoiceQ.isError && <p style={{ color: 'var(--accent)' }}>Invoice not found.</p>}

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
                  <Link to={`/clients/${client.id}`} style={{ color: 'var(--accent)', textDecoration: 'none' }}>
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
                onClick={() => setShowEdit(true)}
                disabled={invoice.status === 'void'}
                style={actionBtn('#6b7280')}
                title={invoice.status === 'void' ? 'Voided invoices cannot be edited' : undefined}
              >
                ✏️ Edit
              </button>
              <button
                onClick={() => setShowPayment(true)}
                disabled={invoice.status === 'paid' || invoice.status === 'void'}
                style={actionBtn('var(--accent)')}
              >
                💳 Record Payment
              </button>
              <button
                onClick={handleVoid}
                disabled={invoice.status === 'void' || voidMutation.isPending}
                style={actionBtn('#b91c1c')}
                title={invoice.status === 'paid' ? 'Voiding a paid invoice releases its payment(s) as unallocated client credit' : undefined}
              >
                {voidMutation.isPending ? 'Voiding…' : '🚫 Void'}
              </button>
            </div>
          </div>

          {/* Toast */}
          {toastMsg && (
            <div style={{
              background: 'var(--sidebar-bg)', color: '#fff', padding: '10px 16px',
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
                      <td style={{ padding: '8px 10px', color: 'var(--accent)', fontWeight: 600 }}>#{p.payment_id}</td>
                      <td style={{ padding: '8px 10px', textTransform: 'capitalize' }}>{(p.payment_method || '').replace('_', ' ')}</td>
                      <td style={{ padding: '8px 10px', fontVariantNumeric: 'tabular-nums' }}>{fmtAmount(p.amount, invoice.currency)}</td>
                      <td style={{ padding: '8px 10px', color: '#6b7280' }}>{fmt(p.payment_date)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Edit Invoice Modal */}
          {showEdit && (
            <EditInvoiceModal
              invoice={invoice}
              onClose={() => setShowEdit(false)}
              onSaved={() => {
                qc.invalidateQueries({ queryKey: ['invoice', id] });
                qc.invalidateQueries({ queryKey: ['invoices'] });
                showToast('Invoice updated');
              }}
            />
          )}

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
  background: 'var(--bg-card)', borderRadius: 8, padding: '1rem',
  boxShadow: '0 0 0 1px var(--border)', marginBottom: '0.25rem',
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
  background: 'var(--bg-card)', borderRadius: 10, padding: '1.5rem',
  width: 440, maxWidth: '92vw', boxShadow: '0 8px 32px rgba(0,0,0,.18)',
};
const errorBox: React.CSSProperties = {
  background: '#fee2e2', color: '#991b1b', padding: '8px 12px',
  borderRadius: 6, marginBottom: '0.75rem', fontSize: '0.85rem',
};
const labelStyle: React.CSSProperties = {
  display: 'block', fontWeight: 600, fontSize: '0.8rem',
  color: 'var(--text-secondary)', marginBottom: 4, marginTop: 12,
};
const inputStyle: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', padding: '7px 10px',
  border: '1px solid var(--input-border)', borderRadius: 6, fontSize: '0.875rem',
};
const submitBtn: React.CSSProperties = {
  background: 'var(--accent)', color: '#fff', border: 'none',
  padding: '7px 18px', borderRadius: 6, cursor: 'pointer',
  fontWeight: 600, fontSize: '0.875rem',
};
const cancelBtn: React.CSSProperties = {
  background: 'var(--bg-card)', color: 'var(--text-secondary)', border: '1px solid var(--border-strong)',
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
