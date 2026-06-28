// =============================================================================
// FireISP 5.0 — Payment List
// =============================================================================
// Standalone page at /payments. Shows all payments across all clients with:
//   • Filtering by status
//   • Paginated table (client, amount, method, status, date, reference)
//   • "Record Payment" button opens an inline modal form
//   • Per-row "Allocations" button expands inline to show invoice allocations
//   • Per-row "Send Receipt" action
//   • Gateway transaction status badge when available
// =============================================================================

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, tokenStore } from '@/api/client';
import { extractApiError } from '@/components/ClientFormModal';
import { useTableSort, SortableTh } from '@/components/SortableTh';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Payment {
  id: number;
  client_id: number;
  amount: string;
  currency: string;
  payment_method: string | null;
  reference: string | null;
  status: string;
  payment_date: string | null;
  created_at: string;
}

interface PaymentsResponse {
  data: Payment[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

interface Client {
  id: number;
  name: string;
  email: string | null;
}

interface Invoice {
  id: number;
  invoice_number: string;
  total: string;
}

interface PaymentAllocation {
  id: number;
  payment_id: number;
  invoice_id: number;
  amount: string;
}

interface GatewayTransaction {
  id: number;
  payment_id: number | null;
  gateway: string;
  status: string;
  gateway_transaction_id: string | null;
  amount: string;
  currency: string;
  created_at: string;
}

interface RecordPaymentBody {
  client_id: number;
  amount: number;
  currency: string;
  payment_method: string;
  payment_date?: string;
  reference?: string;
  status: string;
  invoice_id?: number;
}

// ---------------------------------------------------------------------------
// Fetch / mutate helpers
// ---------------------------------------------------------------------------

const PAGE_SIZE = 25;
const API_BASE = '/api/v1';

/**
 * Normalises paginated and non-paginated API responses that wrap arrays in
 * either `{ data: { data: T[] } }` or `{ data: T[] }`.
 */
function extractList<T>(body: unknown): T[] {
  const b = body as { data?: { data?: T[] } | T[] };
  if (Array.isArray(b?.data)) return b.data as T[];
  if (Array.isArray((b?.data as { data?: T[] })?.data)) return (b.data as { data: T[] }).data;
  return [];
}

async function fetchPayments(page: number, statusFilter: string, orderBy: string, order: string): Promise<PaymentsResponse> {
  const query: Record<string, string | number> = { page, limit: PAGE_SIZE, order_by: orderBy, order };
  if (statusFilter) query.status = statusFilter;
  const res = await api.GET('/payments', { params: { query: query as never } });
  if (res.error) throw new Error('Failed to load payments');
  return res.data as unknown as PaymentsResponse;
}

async function fetchClients(): Promise<Client[]> {
  const res = await api.GET('/clients', { params: { query: { limit: 500 } as never } });
  if (res.error) throw new Error('Failed to load clients');
  return (res.data as unknown as { data: Client[] }).data;
}

async function fetchOpenInvoices(clientId: number): Promise<Invoice[]> {
  const token = tokenStore.getAccess();
  const params = new URLSearchParams({ client_id: String(clientId), status: 'sent', limit: '100' });
  const res = await fetch(`${API_BASE}/invoices?${params}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) return [];
  const body = await res.json() as unknown;
  return extractList<Invoice>(body);
}

async function fetchAllocations(paymentId: number): Promise<PaymentAllocation[]> {
  const token = tokenStore.getAccess();
  const res = await fetch(`${API_BASE}/payments/${paymentId}/allocations`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) return [];
  const body = await res.json() as { data: PaymentAllocation[] };
  return body.data ?? [];
}

async function fetchGatewayTransactions(clientId: number): Promise<GatewayTransaction[]> {
  const token = tokenStore.getAccess();
  const params = new URLSearchParams({ client_id: String(clientId), limit: '50' });
  const res = await fetch(`${API_BASE}/payment-transactions?${params}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) return [];
  const body = await res.json() as unknown;
  return extractList<GatewayTransaction>(body);
}

async function recordPayment(body: RecordPaymentBody): Promise<{ id: number }> {
  const token = tokenStore.getAccess();
  const { invoice_id, ...paymentBody } = body;

  // Create payment
  const createRes = await fetch(`${API_BASE}/payments`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(paymentBody),
  });
  if (!createRes.ok) {
    const err = await createRes.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || 'Failed to record payment');
  }
  const { data: payment } = await createRes.json() as { data: { id: number } };

  // Allocate to invoice if provided
  if (invoice_id) {
    const allocRes = await fetch(`${API_BASE}/payments/${payment.id}/allocate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ invoice_id, amount: paymentBody.amount }),
    });
    if (!allocRes.ok) {
      const err = await allocRes.json().catch(() => ({}));
      throw new Error((err as { error?: string }).error || 'Failed to allocate payment to invoice');
    }
  }

  return payment;
}

async function sendReceipt(paymentId: number): Promise<{ to: string }> {
  const token = tokenStore.getAccess();
  const res = await fetch(`${API_BASE}/payments/${paymentId}/send-receipt`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error || 'Failed to send receipt');
  return body as { to: string };
}

// Download the payment receipt as a PDF (GET /api/v1/pdf/payments/:id streams the
// file). Mirrors InvoiceDetail's invoice-PDF download.
async function downloadReceipt(paymentId: number): Promise<void> {
  const token = tokenStore.getAccess();
  const res = await fetch(`${API_BASE}/pdf/payments/${paymentId}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error(`Failed to download receipt (${res.status})`);
  const blob = await res.blob();
  const blobUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = blobUrl;
  link.download = `receipt-${paymentId}.pdf`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(blobUrl), 10_000);
}

interface UpdatePaymentBody {
  amount?: number;
  currency?: string;
  payment_method?: string;
  reference?: string;
  status?: string;
}

async function updatePayment(id: number, body: UpdatePaymentBody): Promise<void> {
  const { error } = await api.PUT('/payments/{id}', {
    params: { path: { id } },
    body: body as never,
  });
  if (error) throw new Error(extractApiError(error, 'Failed to update payment'));
}

async function deletePayment(id: number): Promise<void> {
  const { error } = await api.DELETE('/payments/{id}', { params: { path: { id } } });
  if (error) throw new Error(extractApiError(error, 'Failed to delete payment'));
}

async function allocatePayment(id: number, invoiceId: number, amount: number): Promise<void> {
  const { error } = await api.POST('/payments/{id}/allocate', {
    params: { path: { id } },
    body: { invoice_id: invoiceId, amount } as never,
  });
  if (error) throw new Error(extractApiError(error, 'Failed to allocate payment'));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
    pending:   { bg: '#ede9fe', color: '#5b21b6' },
    completed: { bg: '#d1fae5', color: '#065f46' },
    failed:    { bg: '#fee2e2', color: '#991b1b' },
    refunded:  { bg: '#dbeafe', color: '#1e40af' },
    cancelled: { bg: '#fef3c7', color: '#92400e' },
  };
  const s = map[status] ?? { bg: '#f3f4f6', color: '#374151' };
  return (
    <span style={{
      background: s.bg, color: s.color,
      padding: '2px 8px', borderRadius: 12,
      fontSize: '0.72rem', fontWeight: 600, textTransform: 'capitalize',
    }}>
      {status}
    </span>
  );
}

function GatewayBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; color: string }> = {
    pending:    { bg: '#fef9c3', color: '#854d0e' },
    authorized: { bg: '#d1fae5', color: '#065f46' },
    captured:   { bg: '#d1fae5', color: '#065f46' },
    settled:    { bg: '#d1fae5', color: '#065f46' },
    failed:     { bg: '#fee2e2', color: '#991b1b' },
    declined:   { bg: '#fee2e2', color: '#991b1b' },
    refunded:   { bg: '#dbeafe', color: '#1e40af' },
    voided:     { bg: '#f3f4f6', color: '#374151' },
  };
  const s = map[status] ?? { bg: '#f3f4f6', color: '#374151' };
  return (
    <span style={{
      background: s.bg, color: s.color,
      padding: '2px 8px', borderRadius: 12,
      fontSize: '0.7rem', fontWeight: 600, textTransform: 'capitalize',
      border: '1px solid rgba(0,0,0,.06)',
    }}>
      GW: {status}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Record Payment Modal
// ---------------------------------------------------------------------------

const PAYMENT_METHODS = [
  'cash', 'card', 'transfer', 'check', 'online', 'other',
];

interface RecordPaymentModalProps {
  clients: Client[];
  onClose: () => void;
  onRecorded: () => void;
}

function RecordPaymentModal({ clients, onClose, onRecorded }: RecordPaymentModalProps) {
  const TODAY = new Date().toISOString().split('T')[0];
  const [form, setForm] = useState({
    client_id: '',
    amount: '',
    currency: 'MXN',
    payment_method: 'cash',
    reference: '',
    status: 'completed',
    payment_date: TODAY,
  });
  const [invoiceId, setInvoiceId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const { data: openInvoices = [], isLoading: loadingInvoices } = useQuery({
    queryKey: ['open-invoices', form.client_id],
    queryFn: () => fetchOpenInvoices(Number(form.client_id)),
    enabled: !!form.client_id,
  });

  function setField(name: string, value: string) {
    setForm(prev => ({ ...prev, [name]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.client_id) { setError('Please select a client.'); return; }
    if (!form.amount || isNaN(parseFloat(form.amount))) {
      setError('Please enter a valid amount.');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      await recordPayment({
        client_id: Number(form.client_id),
        amount: parseFloat(form.amount),
        currency: form.currency,
        payment_method: form.payment_method,
        payment_date: form.payment_date,
        ...(form.reference ? { reference: form.reference } : {}),
        status: form.status,
        ...(invoiceId ? { invoice_id: Number(invoiceId) } : {}),
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
    <div style={overlay} role="dialog" aria-modal="true" aria-label="Record Payment">
      <div style={{ ...modalBox, maxHeight: '90vh', overflowY: 'auto' }}>
        <h3 style={{ margin: '0 0 1rem' }}>Record Payment</h3>
        {error && <div style={errorBox}>{error}</div>}
        <form onSubmit={handleSubmit}>
          <label style={labelStyle}>Client *</label>
          <select
            style={inputStyle}
            value={form.client_id}
            onChange={e => { setField('client_id', e.target.value); setInvoiceId(''); }}
            required
          >
            <option value="">— select client —</option>
            {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 12px' }}>
            <div>
              <label style={labelStyle}>Amount *</label>
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
              <option key={m} value={m}>{m.charAt(0).toUpperCase() + m.slice(1)}</option>
            ))}
          </select>

          <label style={labelStyle}>Status</label>
          <select
            style={inputStyle}
            value={form.status}
            onChange={e => setField('status', e.target.value)}
          >
            {['pending', 'completed', 'failed', 'refunded', 'cancelled'].map(s => (
              <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
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
            value={form.reference}
            onChange={e => setField('reference', e.target.value)}
            placeholder="e.g. transfer ID, check number"
          />

          {form.client_id && (
            <>
              <label style={labelStyle}>Apply to Invoice (optional)</label>
              <select
                style={inputStyle}
                value={invoiceId}
                onChange={e => setInvoiceId(e.target.value)}
                disabled={loadingInvoices}
              >
                <option value="">— no allocation —</option>
                {openInvoices.map(inv => (
                  <option key={inv.id} value={inv.id}>
                    {inv.invoice_number || `#${inv.id}`} — {fmtAmount(inv.total, form.currency)}
                  </option>
                ))}
              </select>
              {loadingInvoices && (
                <p style={{ fontSize: '0.78rem', color: '#9ca3af', margin: '4px 0 0' }}>
                  Loading open invoices…
                </p>
              )}
              {!loadingInvoices && openInvoices.length === 0 && form.client_id && (
                <p style={{ fontSize: '0.78rem', color: '#9ca3af', margin: '4px 0 0' }}>
                  No open invoices for this client.
                </p>
              )}
            </>
          )}

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
// Edit Payment Modal
// ---------------------------------------------------------------------------

interface EditPaymentModalProps {
  payment: Payment;
  onClose: () => void;
  onSaved: () => void;
}

function EditPaymentModal({ payment, onClose, onSaved }: EditPaymentModalProps) {
  const [form, setForm] = useState({
    amount: payment.amount,
    currency: payment.currency,
    payment_method: payment.payment_method || 'cash',
    reference: payment.reference || '',
    status: payment.status,
  });

  const mutation = useMutation({
    mutationFn: () => updatePayment(payment.id, {
      amount: parseFloat(form.amount),
      currency: form.currency,
      payment_method: form.payment_method,
      reference: form.reference,
      status: form.status,
    }),
    onSuccess: () => { onSaved(); onClose(); },
  });

  function setField(name: string, value: string) {
    setForm(prev => ({ ...prev, [name]: value }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.amount || isNaN(parseFloat(form.amount))) return;
    mutation.mutate();
  }

  return (
    <div style={overlay} role="dialog" aria-modal="true" aria-label="Edit Payment">
      <div style={{ ...modalBox, maxHeight: '90vh', overflowY: 'auto' }}>
        <h3 style={{ margin: '0 0 1rem' }}>Edit Payment #{payment.id}</h3>
        {mutation.isError && (
          <div style={errorBox}>{(mutation.error as Error).message}</div>
        )}
        <form onSubmit={handleSubmit}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 12px' }}>
            <div>
              <label style={labelStyle}>Amount *</label>
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
              <option key={m} value={m}>{m.charAt(0).toUpperCase() + m.slice(1)}</option>
            ))}
          </select>

          <label style={labelStyle}>Status</label>
          <select
            style={inputStyle}
            value={form.status}
            onChange={e => setField('status', e.target.value)}
          >
            {['pending', 'completed', 'failed', 'refunded', 'cancelled'].map(s => (
              <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
            ))}
          </select>

          <label style={labelStyle}>Reference / Folio (optional)</label>
          <input
            type="text" style={inputStyle}
            value={form.reference}
            onChange={e => setField('reference', e.target.value)}
            placeholder="e.g. transfer ID, check number"
          />

          <div style={{ display: 'flex', gap: 8, marginTop: '1.25rem', justifyContent: 'flex-end' }}>
            <button type="button" onClick={onClose} style={cancelBtn}>Cancel</button>
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
// Manual Allocate Modal
// ---------------------------------------------------------------------------

interface AllocateModalProps {
  payment: Payment;
  onClose: () => void;
  onAllocated: () => void;
}

function AllocateModal({ payment, onClose, onAllocated }: AllocateModalProps) {
  const [invoiceId, setInvoiceId] = useState('');
  const [amount, setAmount] = useState(payment.amount);

  const { data: openInvoices = [], isLoading: loadingInvoices } = useQuery({
    queryKey: ['open-invoices', payment.client_id],
    queryFn: () => fetchOpenInvoices(payment.client_id),
  });

  const mutation = useMutation({
    mutationFn: () => allocatePayment(payment.id, Number(invoiceId), parseFloat(amount)),
    onSuccess: () => { onAllocated(); onClose(); },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!invoiceId) return;
    if (!amount || isNaN(parseFloat(amount))) return;
    mutation.mutate();
  }

  return (
    <div style={overlay} role="dialog" aria-modal="true" aria-label="Allocate Payment">
      <div style={{ ...modalBox, maxHeight: '90vh', overflowY: 'auto' }}>
        <h3 style={{ margin: '0 0 1rem' }}>Allocate Payment #{payment.id}</h3>
        {mutation.isError && (
          <div style={errorBox}>{(mutation.error as Error).message}</div>
        )}
        <form onSubmit={handleSubmit}>
          <label style={labelStyle}>Invoice *</label>
          <select
            style={inputStyle}
            value={invoiceId}
            onChange={e => setInvoiceId(e.target.value)}
            disabled={loadingInvoices}
            required
          >
            <option value="">— select invoice —</option>
            {openInvoices.map(inv => (
              <option key={inv.id} value={inv.id}>
                {inv.invoice_number || `#${inv.id}`} — {fmtAmount(inv.total, payment.currency)}
              </option>
            ))}
          </select>
          {loadingInvoices && (
            <p style={{ fontSize: '0.78rem', color: '#9ca3af', margin: '4px 0 0' }}>
              Loading open invoices…
            </p>
          )}
          {!loadingInvoices && openInvoices.length === 0 && (
            <p style={{ fontSize: '0.78rem', color: '#9ca3af', margin: '4px 0 0' }}>
              No open invoices for this client.
            </p>
          )}

          <label style={labelStyle}>Amount *</label>
          <input
            type="number" step="0.01" min="0.01"
            style={inputStyle}
            value={amount}
            onChange={e => setAmount(e.target.value)}
            required
          />

          <div style={{ display: 'flex', gap: 8, marginTop: '1.25rem', justifyContent: 'flex-end' }}>
            <button type="button" onClick={onClose} style={cancelBtn}>Cancel</button>
            <button type="submit" style={submitBtn} disabled={mutation.isPending}>
              {mutation.isPending ? 'Allocating…' : 'Allocate'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inline Allocations Drawer
// ---------------------------------------------------------------------------

interface AllocationsRowProps {
  paymentId: number;
  currency: string;
}

function AllocationsRow({ paymentId, currency }: AllocationsRowProps) {
  const { data: allocs = [], isLoading } = useQuery({
    queryKey: ['payment-allocs', paymentId],
    queryFn: () => fetchAllocations(paymentId),
  });

  if (isLoading) {
    return (
      <tr>
        <td colSpan={8} style={{ padding: '8px 20px', background: '#f8faff', fontSize: '0.82rem', color: '#9ca3af' }}>
          Loading allocations…
        </td>
      </tr>
    );
  }

  return (
    <tr>
      <td colSpan={8} style={{ padding: '8px 20px 12px', background: '#f8faff' }}>
        {allocs.length === 0 ? (
          <p style={{ margin: 0, fontSize: '0.82rem', color: '#9ca3af' }}>No invoice allocations.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
            <thead>
              <tr>
                {['Invoice', 'Allocated Amount'].map(h => (
                  <th key={h} style={{ textAlign: 'left', padding: '4px 8px', color: '#6b7280', fontWeight: 600 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {allocs.map(a => (
                <tr key={a.id}>
                  <td style={{ padding: '4px 8px' }}>
                    <Link
                      to={`/invoices/${a.invoice_id}`}
                      style={{ color: 'var(--accent)', textDecoration: 'none', fontWeight: 600 }}
                    >
                      Invoice #{a.invoice_id}
                    </Link>
                  </td>
                  <td style={{ padding: '4px 8px', fontVariantNumeric: 'tabular-nums' }}>
                    {fmtAmount(a.amount, currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Gateway Status Row
// ---------------------------------------------------------------------------

interface GatewayRowProps {
  clientId: number;
  paymentId: number;
}

function GatewayRow({ clientId, paymentId }: GatewayRowProps) {
  const { data: txns = [], isLoading } = useQuery({
    queryKey: ['gateway-txns', clientId],
    queryFn: () => fetchGatewayTransactions(clientId),
  });

  const linked = txns.filter(t => t.payment_id === paymentId);

  if (isLoading) {
    return (
      <tr>
        <td colSpan={8} style={{ padding: '8px 20px', background: '#fafff8', fontSize: '0.82rem', color: '#9ca3af' }}>
          Loading gateway transactions…
        </td>
      </tr>
    );
  }

  return (
    <tr>
      <td colSpan={8} style={{ padding: '8px 20px 12px', background: '#fafff8' }}>
        {linked.length === 0 ? (
          <p style={{ margin: 0, fontSize: '0.82rem', color: '#9ca3af' }}>
            No gateway transactions linked to this payment.
          </p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
            <thead>
              <tr>
                {['Gateway', 'Gateway Txn ID', 'Amount', 'Status', 'Date'].map(h => (
                  <th key={h} style={{ textAlign: 'left', padding: '4px 8px', color: '#6b7280', fontWeight: 600 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {linked.map(t => (
                <tr key={t.id}>
                  <td style={{ padding: '4px 8px', textTransform: 'capitalize' }}>{t.gateway}</td>
                  <td style={{ padding: '4px 8px', fontFamily: 'monospace', fontSize: '0.78rem', color: '#6b7280' }}>
                    {t.gateway_transaction_id || '—'}
                  </td>
                  <td style={{ padding: '4px 8px', fontVariantNumeric: 'tabular-nums' }}>
                    {fmtAmount(t.amount, t.currency)}
                  </td>
                  <td style={{ padding: '4px 8px' }}><GatewayBadge status={t.status} /></td>
                  <td style={{ padding: '4px 8px', color: '#9ca3af' }}>{fmt(t.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Payment Row
// ---------------------------------------------------------------------------

interface PaymentRowProps {
  payment: Payment;
  idx: number;
  onSendReceipt: (id: number) => void;
  onDownloadReceipt: (id: number) => void;
  sendingReceipt: number | null;
  onEdit: (payment: Payment) => void;
  onAllocate: (payment: Payment) => void;
  onDelete: (payment: Payment) => void;
}

function PaymentRow({ payment, idx, onSendReceipt, onDownloadReceipt, sendingReceipt, onEdit, onAllocate, onDelete }: PaymentRowProps) {
  const [expanded, setExpanded] = useState<'none' | 'alloc' | 'gateway'>('none');

  function toggleExpand(mode: 'alloc' | 'gateway') {
    setExpanded(prev => (prev === mode ? 'none' : mode));
  }

  return (
    <>
      <tr style={{ borderBottom: '1px solid #f3f4f6', background: idx % 2 === 0 ? '#fff' : '#fafafa' }}>
        {/* Client */}
        <td style={{ padding: '10px 14px' }}>
          <Link to={`/clients/${payment.client_id}`} style={{ color: '#374151', textDecoration: 'none' }}>
            Client {payment.client_id}
          </Link>
        </td>
        {/* Amount */}
        <td style={{ padding: '10px 14px', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
          {fmtAmount(payment.amount, payment.currency)}
        </td>
        {/* Method */}
        <td style={{ padding: '10px 14px', textTransform: 'capitalize', color: '#4b5563' }}>
          {payment.payment_method?.replace('_', ' ') || '—'}
        </td>
        {/* Status */}
        <td style={{ padding: '10px 14px' }}>
          <StatusBadge status={payment.status} />
        </td>
        {/* Date */}
        <td style={{ padding: '10px 14px', color: '#6b7280' }}>
          {fmt(payment.payment_date || payment.created_at)}
        </td>
        {/* Reference */}
        <td style={{ padding: '10px 14px', color: '#9ca3af', fontSize: '0.8rem', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {payment.reference || '—'}
        </td>
        {/* Actions */}
        <td style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              style={{ ...actionBtn, background: expanded === 'alloc' ? '#ede9fe' : '#f3f4f6', color: '#5b21b6' }}
              onClick={() => toggleExpand('alloc')}
              title="Show invoice allocations"
            >
              📎 Alloc
            </button>
            <button
              style={{ ...actionBtn, background: expanded === 'gateway' ? '#d1fae5' : '#f3f4f6', color: '#065f46' }}
              onClick={() => toggleExpand('gateway')}
              title="Show gateway transactions"
            >
              🔗 GW
            </button>
            <button
              style={{ ...actionBtn, background: '#dbeafe', color: '#1e40af' }}
              onClick={() => onDownloadReceipt(payment.id)}
              title="Download receipt PDF"
            >
              🧾 PDF
            </button>
            <button
              style={{ ...actionBtn, background: '#fef3c7', color: '#92400e' }}
              onClick={() => onSendReceipt(payment.id)}
              disabled={sendingReceipt === payment.id}
              title="Send receipt email to client"
            >
              {sendingReceipt === payment.id ? '…' : '📧 Receipt'}
            </button>
            <button
              style={{ ...actionBtn, background: '#e0f2fe', color: '#075985' }}
              onClick={() => onAllocate(payment)}
              title="Allocate payment to an invoice"
            >
              ➕ Allocate
            </button>
            <button
              style={{ ...actionBtn, background: '#f3f4f6', color: '#374151' }}
              onClick={() => onEdit(payment)}
              title="Edit payment"
            >
              ✏️ Edit
            </button>
            <button
              style={{ ...actionBtn, background: '#fee2e2', color: '#991b1b' }}
              onClick={() => onDelete(payment)}
              title="Delete payment"
            >
              🗑 Delete
            </button>
          </div>
        </td>
      </tr>

      {expanded === 'alloc' && (
        <AllocationsRow paymentId={payment.id} currency={payment.currency} />
      )}
      {expanded === 'gateway' && (
        <GatewayRow clientId={payment.client_id} paymentId={payment.id} />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

const STATUS_OPTIONS = ['', 'pending', 'completed', 'failed', 'refunded', 'cancelled'];

export function PaymentList() {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('');
  const [showRecord, setShowRecord] = useState(false);
  const [editPayment, setEditPayment] = useState<Payment | null>(null);
  const [allocatePaymentRow, setAllocatePaymentRow] = useState<Payment | null>(null);
  const [deletePaymentRow, setDeletePaymentRow] = useState<Payment | null>(null);
  const [toast, setToast] = useState('');
  const [sendingReceipt, setSendingReceipt] = useState<number | null>(null);
  const sort = useTableSort('created_at', 'DESC');
  const qc = useQueryClient();

  useEffect(() => { setPage(1); }, [sort.sortBy, sort.sortDir]);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['payments', page, statusFilter, sort.sortBy, sort.sortDir],
    queryFn: () => fetchPayments(page, statusFilter, sort.order_by, sort.order),
    placeholderData: prev => prev,
  });

  const { data: clients = [] } = useQuery({
    queryKey: ['clients-slim'],
    queryFn: fetchClients,
    enabled: showRecord,
  });

  const sendReceiptMutation = useMutation({
    mutationFn: sendReceipt,
    onMutate: (id) => setSendingReceipt(id),
    onSuccess: (res) => {
      showToast(`Receipt sent to ${res.to}`);
      setSendingReceipt(null);
    },
    onError: (err: Error) => {
      showToast(`Error: ${err.message}`);
      setSendingReceipt(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deletePayment(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['payments'] });
      showToast('Payment deleted');
      setDeletePaymentRow(null);
    },
    onError: (err: Error) => {
      showToast(`Error: ${err.message}`);
      setDeletePaymentRow(null);
    },
  });

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(''), 4000);
  }

  async function handleDownloadReceipt(id: number) {
    try {
      await downloadReceipt(id);
    } catch (err) {
      showToast(`Error: ${err instanceof Error ? err.message : 'Failed to download receipt'}`);
    }
  }

  function handleFilterChange(newStatus: string) {
    setStatusFilter(newStatus);
    setPage(1);
  }

  const totalPages = data?.meta?.totalPages ?? 1;
  const total = data?.meta?.total ?? 0;

  return (
    <div style={{ padding: '1.5rem' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: '1rem' }}>
        <h1 style={{ margin: 0, fontSize: '1.4rem', fontWeight: 700 }}>💳 {t('paymentList.title')}</h1>
        <button onClick={() => setShowRecord(true)} style={submitBtn}>
          {t('paymentList.recordPayment')}
        </button>
      </div>

      {/* Status Filters */}
      <div style={{ display: 'flex', gap: 8, marginBottom: '1rem', flexWrap: 'wrap' }}>
        {STATUS_OPTIONS.map(s => (
          <button
            key={s || 'all'}
            onClick={() => handleFilterChange(s)}
            style={{
              padding: '4px 12px', borderRadius: 20, border: '1px solid #d1d5db',
              background: statusFilter === s ? 'var(--accent)' : '#fff',
              color: statusFilter === s ? '#fff' : '#374151',
              cursor: 'pointer', fontSize: '0.8rem', fontWeight: 500,
            }}
          >
            {s ? s.charAt(0).toUpperCase() + s.slice(1) : t('ticketList.all')}
          </button>
        ))}
      </div>

      {/* Table */}
      {isLoading && <p style={{ color: '#888' }}>{t('paymentList.loading')}</p>}
      {isError && <p style={{ color: 'var(--accent)' }}>{t('paymentList.error')}</p>}
      {data && (
        <>
          <div style={{ background: '#fff', borderRadius: 8, boxShadow: '0 0 0 1px var(--border)', overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
              <thead>
                <tr style={{ background: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
                  <SortableTh label={t('paymentList.table.client')} col="client_id" sort={sort} />
                  <SortableTh label={t('paymentList.table.amount')} col="amount" sort={sort} />
                  <SortableTh label={t('paymentList.table.method')} col="payment_method" sort={sort} />
                  <SortableTh label={t('paymentList.table.status')} col="status" sort={sort} />
                  <SortableTh label={t('paymentList.table.date')} col="payment_date" sort={sort} />
                  {/* reference_number column: left non-sortable — UI property 'reference' vs DB column 'reference_number' mismatch */}
                  <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600, color: '#374151', whiteSpace: 'nowrap' }}>{t('paymentList.table.reference')}</th>
                  <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600, color: '#374151', whiteSpace: 'nowrap' }}>{t('paymentList.table.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {data.data.length === 0 && (
                  <tr>
                    <td colSpan={7} style={{ padding: '2rem', textAlign: 'center', color: '#9ca3af' }}>
                      {t('paymentList.noPayments')}
                    </td>
                  </tr>
                )}
                {data.data.map((payment, idx) => (
                  <PaymentRow
                    key={payment.id}
                    payment={payment}
                    idx={idx}
                    onSendReceipt={(id) => sendReceiptMutation.mutate(id)}
                    onDownloadReceipt={handleDownloadReceipt}
                    sendingReceipt={sendingReceipt}
                    onEdit={setEditPayment}
                    onAllocate={setAllocatePaymentRow}
                    onDelete={setDeletePaymentRow}
                  />
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '0.75rem', fontSize: '0.8rem', color: '#6b7280' }}>
            <span>{total} payment{total !== 1 ? 's' : ''}</span>
            <div style={{ display: 'flex', gap: 6 }}>
              <button style={pageBtn} disabled={page <= 1} onClick={() => setPage(p => p - 1)}>← Prev</button>
              <span style={{ padding: '4px 8px' }}>Page {page} / {totalPages}</span>
              <button style={pageBtn} disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>Next →</button>
            </div>
          </div>
        </>
      )}

      {/* Record Payment Modal */}
      {showRecord && (
        <RecordPaymentModal
          clients={clients}
          onClose={() => setShowRecord(false)}
          onRecorded={() => qc.invalidateQueries({ queryKey: ['payments'] })}
        />
      )}

      {/* Edit Payment Modal */}
      {editPayment && (
        <EditPaymentModal
          payment={editPayment}
          onClose={() => setEditPayment(null)}
          onSaved={() => { qc.invalidateQueries({ queryKey: ['payments'] }); showToast('Payment updated'); }}
        />
      )}

      {/* Allocate Payment Modal */}
      {allocatePaymentRow && (
        <AllocateModal
          payment={allocatePaymentRow}
          onClose={() => setAllocatePaymentRow(null)}
          onAllocated={() => {
            qc.invalidateQueries({ queryKey: ['payments'] });
            qc.invalidateQueries({ queryKey: ['payment-allocs', allocatePaymentRow.id] });
            showToast('Payment allocated');
          }}
        />
      )}

      {/* Delete Confirmation */}
      {deletePaymentRow && (
        <div style={overlay} role="alertdialog" aria-modal="true" aria-label="Delete Payment">
          <div style={modalBox}>
            <h3 style={{ margin: '0 0 0.75rem' }}>Delete Payment #{deletePaymentRow.id}?</h3>
            <p style={{ margin: '0 0 1.25rem', color: '#4b5563', fontSize: '0.9rem' }}>
              This will permanently remove payment of {fmtAmount(deletePaymentRow.amount, deletePaymentRow.currency)}. This action cannot be undone.
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button type="button" onClick={() => setDeletePaymentRow(null)} style={cancelBtn}>Cancel</button>
              <button
                type="button"
                onClick={() => deleteMutation.mutate(deletePaymentRow.id)}
                disabled={deleteMutation.isPending}
                style={{ ...submitBtn, background: '#dc2626' }}
              >
                {deleteMutation.isPending ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: 24, right: 24,
          background: 'var(--sidebar-bg)', color: '#fff',
          padding: '10px 18px', borderRadius: 8,
          fontSize: '0.85rem', boxShadow: '0 4px 16px rgba(0,0,0,.25)',
          zIndex: 200,
        }}>
          {toast}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared styles
// ---------------------------------------------------------------------------

const overlay: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
};
const modalBox: React.CSSProperties = {
  background: 'var(--bg-card)', borderRadius: 10, padding: '1.5rem',
  width: 460, maxWidth: '92vw', boxShadow: '0 8px 32px rgba(0,0,0,.18)',
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
const pageBtn: React.CSSProperties = {
  padding: '4px 10px', border: '1px solid var(--border-strong)', borderRadius: 4,
  background: 'var(--bg-card)', cursor: 'pointer', fontSize: '0.8rem',
};
const actionBtn: React.CSSProperties = {
  padding: '3px 9px', border: 'none', borderRadius: 5,
  cursor: 'pointer', fontSize: '0.75rem', fontWeight: 600,
};
