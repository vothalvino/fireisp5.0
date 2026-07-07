// =============================================================================
// FireISP 5.0 — Shared payment action component
// =============================================================================
// Extracts the Edit / Allocate / Reallocate / Reassign / Un-apply / Send
// Receipt / Download Receipt / Delete actions from PaymentList into a
// self-contained <PaymentActionButtons> component used by BOTH PaymentList
// (per-row) and PaymentDetail (header toolbar).
//
// Types, API helpers, and modal sub-components are also exported so they can
// be reused wherever the Payment REST shape is needed.
// =============================================================================

import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, tokenStore } from '@/api/client';
import { readCsrfCookie } from '@/api/csrf';
import { extractApiError } from '@/components/ClientFormModal';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Payment {
  id: number;
  client_id: number;
  amount: string;
  currency: string;
  payment_method: string | null;
  reference_number: string | null;
  status: string;
  payment_date: string | null;
  created_at: string;
}

export interface Client {
  id: number;
  name: string;
  email: string | null;
}

export interface Invoice {
  id: number;
  invoice_number: string;
  total: string;
  status?: string;
}

interface PaymentAllocation {
  id: number;
  payment_id: number;
  invoice_id: number;
  amount: string;
}

interface UpdatePaymentBody {
  amount?: number;
  currency?: string;
  payment_method?: string;
  reference_number?: string;
  status?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Must match the backend payment_method enum (src/middleware/schemas/payments.js
// + the DB ENUM): card/transfer/online are NOT valid and 422'd on submit.
export const PAYMENT_METHODS = ['cash', 'credit_card', 'debit_card', 'bank_transfer', 'check', 'other'];
export const NON_PAYABLE_STATUSES = new Set(['void', 'cancelled', 'paid', 'draft']);
const API_BASE = '/api/v1';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function extractList<T>(body: unknown): T[] {
  const b = body as { data?: { data?: T[] } | T[] };
  if (Array.isArray(b?.data)) return b.data as T[];
  if (Array.isArray((b?.data as { data?: T[] })?.data)) return (b.data as { data: T[] }).data;
  return [];
}

export function fmtAmount(amount: string | null | undefined, currency: string): string {
  if (!amount) return '—';
  const num = parseFloat(amount);
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency: currency || 'MXN' }).format(num);
}

// ---------------------------------------------------------------------------
// Fetch / mutate helpers
// ---------------------------------------------------------------------------

export async function fetchClients(): Promise<Client[]> {
  const res = await api.GET('/clients', { params: { query: { limit: 500 } as never } });
  if (res.error) throw new Error('Failed to load clients');
  return (res.data as unknown as { data: Client[] }).data;
}

export async function fetchAllocations(paymentId: number): Promise<PaymentAllocation[]> {
  const token = tokenStore.getAccess();
  const res = await fetch(`${API_BASE}/payments/${paymentId}/allocations`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) return [];
  const body = await res.json() as { data: PaymentAllocation[] };
  return body.data ?? [];
}

export async function fetchOpenInvoices(clientId: number): Promise<Invoice[]> {
  const token = tokenStore.getAccess();
  const params = new URLSearchParams({ client_id: String(clientId), limit: '100', order_by: 'id', order: 'DESC' });
  const res = await fetch(`${API_BASE}/invoices?${params}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) return [];
  const body = await res.json() as unknown;
  return extractList<Invoice>(body).filter(inv => !NON_PAYABLE_STATUSES.has(inv.status ?? ''));
}

export async function fetchAllInvoicesForClient(clientId: number): Promise<Invoice[]> {
  const token = tokenStore.getAccess();
  const params = new URLSearchParams({ client_id: String(clientId), limit: '100', order_by: 'id', order: 'DESC' });
  const res = await fetch(`${API_BASE}/invoices?${params}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) return [];
  const body = await res.json() as unknown;
  return extractList<Invoice>(body);
}

export async function updatePayment(id: number, body: UpdatePaymentBody): Promise<void> {
  const { error } = await api.PUT('/payments/{id}', {
    params: { path: { id } },
    body: body as never,
  });
  if (error) throw new Error(extractApiError(error, 'Failed to update payment'));
}

export async function deletePayment(id: number): Promise<void> {
  const { error } = await api.DELETE('/payments/{id}', { params: { path: { id } } });
  if (error) throw new Error(extractApiError(error, 'Failed to delete payment'));
}

export async function allocatePayment(id: number, invoiceId: number, amount: number): Promise<void> {
  const { error } = await api.POST('/payments/{id}/allocate', {
    params: { path: { id } },
    body: { invoice_id: invoiceId, amount } as never,
  });
  if (error) throw new Error(extractApiError(error, 'Failed to allocate payment'));
}

export async function reallocatePayment(
  id: number,
  fromInvoiceId: number,
  toInvoiceId: number,
  amount?: number,
): Promise<void> {
  const token = tokenStore.getAccess();
  const csrf = readCsrfCookie();
  const body: Record<string, unknown> = { from_invoice_id: fromInvoiceId, to_invoice_id: toInvoiceId };
  if (amount != null) body.amount = amount;
  const res = await fetch(`${API_BASE}/payments/${id}/reallocate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: { message?: string } | string };
    const msg = typeof err.error === 'object' ? err.error?.message : (err.error as string);
    throw new Error(msg || 'Failed to reallocate payment');
  }
}

export async function reassignPayment(id: number, newClientId: number): Promise<void> {
  const token = tokenStore.getAccess();
  const csrf = readCsrfCookie();
  const res = await fetch(`${API_BASE}/payments/${id}/reassign`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
    },
    body: JSON.stringify({ new_client_id: newClientId }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: { message?: string } | string };
    const msg = typeof err.error === 'object' ? err.error?.message : (err.error as string);
    throw new Error(msg || 'Failed to reassign payment');
  }
}

export async function unapplyPayment(id: number, invoiceId: number): Promise<void> {
  const token = tokenStore.getAccess();
  const csrf = readCsrfCookie();
  const res = await fetch(`${API_BASE}/payments/${id}/unapply`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
    },
    body: JSON.stringify({ invoice_id: invoiceId }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: { message?: string } | string };
    const msg = typeof err.error === 'object' ? err.error?.message : (err.error as string);
    throw new Error(msg || 'Failed to un-apply payment');
  }
}

export async function sendReceipt(paymentId: number): Promise<{ to: string }> {
  const token = tokenStore.getAccess();
  const csrf = readCsrfCookie();
  const res = await fetch(`${API_BASE}/payments/${paymentId}/send-receipt`, {
    method: 'POST',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error || 'Failed to send receipt');
  return body as { to: string };
}

export async function downloadReceipt(paymentId: number): Promise<void> {
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

// ---------------------------------------------------------------------------
// Modal styles (internal — not exported)
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
const actionBtnBase: React.CSSProperties = {
  padding: '3px 9px', border: 'none', borderRadius: 5,
  cursor: 'pointer', fontSize: '0.75rem', fontWeight: 600,
};
// Compact icon-only variant: fixed square, label shown via title on hover.
const iconBtn: React.CSSProperties = {
  width: 28, height: 28, padding: 0, border: 'none', borderRadius: 5,
  cursor: 'pointer', fontSize: '0.9rem', fontWeight: 600,
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  lineHeight: 1,
};

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
    reference_number: payment.reference_number || '',
    status: payment.status,
  });

  const mutation = useMutation({
    mutationFn: () => updatePayment(payment.id, {
      amount: parseFloat(form.amount),
      currency: form.currency,
      payment_method: form.payment_method,
      reference_number: form.reference_number,
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
              <option key={m} value={m}>{m.replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase())}</option>
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
            value={form.reference_number}
            onChange={e => setField('reference_number', e.target.value)}
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
// Allocate Modal
// ---------------------------------------------------------------------------

interface AllocateModalProps {
  payment: Payment;
  onClose: () => void;
  onAllocated: () => void;
}

function AllocateModal({ payment, onClose, onAllocated }: AllocateModalProps) {
  const [invoiceId, setInvoiceId] = useState('');
  const [amount, setAmount] = useState('');

  const { data: allocs = [], isLoading: loadingAllocs } = useQuery({
    queryKey: ['payment-allocs', payment.id],
    queryFn: () => fetchAllocations(payment.id),
  });

  const totalAllocated = allocs.reduce((sum, a) => sum + parseFloat(a.amount), 0);
  const unallocatedBalance = parseFloat(payment.amount) - totalAllocated;
  const isFullyAllocated = !loadingAllocs && unallocatedBalance <= 0;

  useEffect(() => {
    if (!loadingAllocs) {
      setAmount(unallocatedBalance > 0 ? String(Math.round(unallocatedBalance * 100) / 100) : '0');
    }
  }, [loadingAllocs, unallocatedBalance]);

  const { data: allInvoices = [], isLoading: loadingInvoices } = useQuery({
    queryKey: ['client-invoices', payment.client_id],
    queryFn: () => fetchAllInvoicesForClient(payment.client_id),
  });

  const applicableInvoices = allInvoices.filter(
    inv => !NON_PAYABLE_STATUSES.has(inv.status ?? ''),
  );

  const mutation = useMutation({
    mutationFn: () => allocatePayment(payment.id, Number(invoiceId), parseFloat(amount)),
    onSuccess: () => { onAllocated(); onClose(); },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!invoiceId || isFullyAllocated) return;
    if (!amount || isNaN(parseFloat(amount))) return;
    mutation.mutate();
  }

  return (
    <div style={overlay} role="dialog" aria-modal="true" aria-label="Allocate Payment">
      <div style={{ ...modalBox, maxHeight: '90vh', overflowY: 'auto' }}>
        <h3 style={{ margin: '0 0 0.25rem' }}>Allocate Payment #{payment.id}</h3>
        <p style={{ margin: '0 0 1rem', fontSize: '0.82rem', color: '#6b7280' }}>
          Apply this payment to an open invoice. Excludes paid, void, cancelled, and draft invoices.
        </p>

        {loadingAllocs && (
          <p style={{ fontSize: '0.82rem', color: '#9ca3af' }}>Computing unallocated balance…</p>
        )}

        {!loadingAllocs && (
          <div style={{
            background: isFullyAllocated ? '#fef3c7' : '#d1fae5',
            color: isFullyAllocated ? '#92400e' : '#065f46',
            padding: '8px 12px', borderRadius: 6, marginBottom: '1rem', fontSize: '0.85rem',
          }}>
            {isFullyAllocated
              ? 'Fully allocated — this payment has no remaining balance to apply.'
              : `Unallocated balance: ${fmtAmount(String(unallocatedBalance), payment.currency)}`}
          </div>
        )}

        {mutation.isError && (
          <div style={errorBox}>{(mutation.error as Error).message}</div>
        )}

        <form onSubmit={handleSubmit}>
          <label style={labelStyle}>Invoice *</label>
          <select
            style={inputStyle}
            value={invoiceId}
            onChange={e => setInvoiceId(e.target.value)}
            disabled={loadingInvoices || isFullyAllocated}
            required
          >
            <option value="">— select invoice —</option>
            {applicableInvoices.map(inv => (
              <option key={inv.id} value={inv.id}>
                {inv.invoice_number || `#${inv.id}`} — {fmtAmount(inv.total, payment.currency)}
              </option>
            ))}
          </select>
          {loadingInvoices && (
            <p style={{ fontSize: '0.78rem', color: '#9ca3af', margin: '4px 0 0' }}>
              Loading invoices…
            </p>
          )}
          {!loadingInvoices && applicableInvoices.length === 0 && (
            <p style={{ fontSize: '0.78rem', color: '#9ca3af', margin: '4px 0 0' }}>
              No applicable invoices for this client.
            </p>
          )}

          <label style={labelStyle}>Amount *</label>
          <input
            type="number" step="0.01" min="0.01"
            style={inputStyle}
            value={amount}
            onChange={e => setAmount(e.target.value)}
            disabled={isFullyAllocated}
            required
          />

          <div style={{ display: 'flex', gap: 8, marginTop: '1.25rem', justifyContent: 'flex-end' }}>
            <button type="button" onClick={onClose} style={cancelBtn}>Cancel</button>
            <button
              type="submit"
              style={{ ...submitBtn, ...(isFullyAllocated ? { opacity: 0.5, cursor: 'not-allowed' } : {}) }}
              disabled={mutation.isPending || isFullyAllocated || !invoiceId}
            >
              {mutation.isPending ? 'Allocating…' : isFullyAllocated ? 'Fully Allocated' : 'Allocate'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Reallocate Modal
// ---------------------------------------------------------------------------

interface ReallocateModalProps {
  payment: Payment;
  onClose: () => void;
  onReallocated: () => void;
}

function ReallocateModal({ payment, onClose, onReallocated }: ReallocateModalProps) {
  const [fromInvoiceId, setFromInvoiceId] = useState('');
  const [toInvoiceId, setToInvoiceId] = useState('');
  const [amount, setAmount] = useState(payment.amount);

  const { data: allocs = [], isLoading: loadingAllocs } = useQuery({
    queryKey: ['payment-allocs', payment.id],
    queryFn: () => fetchAllocations(payment.id),
  });

  const { data: clientInvoices = [], isLoading: loadingInvoices } = useQuery({
    queryKey: ['client-invoices', payment.client_id],
    queryFn: () => fetchAllInvoicesForClient(payment.client_id),
  });

  function handleFromChange(invoiceId: string) {
    setFromInvoiceId(invoiceId);
    const alloc = allocs.find(a => a.invoice_id === Number(invoiceId));
    if (alloc) setAmount(alloc.amount);
  }

  const mutation = useMutation({
    mutationFn: () => reallocatePayment(
      payment.id,
      Number(fromInvoiceId),
      Number(toInvoiceId),
      parseFloat(amount),
    ),
    onSuccess: () => { onReallocated(); onClose(); },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!fromInvoiceId || !toInvoiceId) return;
    mutation.mutate();
  }

  return (
    <div style={overlay} role="dialog" aria-modal="true" aria-label="Reallocate Payment">
      <div style={{ ...modalBox, maxHeight: '90vh', overflowY: 'auto' }}>
        <h3 style={{ margin: '0 0 0.25rem' }}>Reallocate Payment #{payment.id}</h3>
        <p style={{ margin: '0 0 1rem', fontSize: '0.82rem', color: '#6b7280' }}>
          Move this payment's allocation from one invoice to another (same client only).
        </p>
        {mutation.isError && (
          <div style={errorBox}>{(mutation.error as Error).message}</div>
        )}
        <form onSubmit={handleSubmit}>
          <label style={labelStyle}>From Invoice (current allocation) *</label>
          <select
            style={inputStyle}
            value={fromInvoiceId}
            onChange={e => handleFromChange(e.target.value)}
            disabled={loadingAllocs}
            required
          >
            <option value="">— select allocation —</option>
            {allocs.map(a => (
              <option key={a.id} value={a.invoice_id}>
                Invoice #{a.invoice_id} — {fmtAmount(a.amount, payment.currency)}
              </option>
            ))}
          </select>
          {!loadingAllocs && allocs.length === 0 && (
            <p style={{ fontSize: '0.78rem', color: '#9ca3af', margin: '4px 0 0' }}>
              No current allocations for this payment.
            </p>
          )}

          <label style={labelStyle}>To Invoice *</label>
          <select
            style={inputStyle}
            value={toInvoiceId}
            onChange={e => setToInvoiceId(e.target.value)}
            disabled={loadingInvoices}
            required
          >
            <option value="">— select target invoice —</option>
            {clientInvoices
              .filter(inv => String(inv.id) !== fromInvoiceId)
              .map(inv => (
                <option key={inv.id} value={inv.id}>
                  {inv.invoice_number || `#${inv.id}`} — {fmtAmount(inv.total, payment.currency)}
                </option>
              ))}
          </select>

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
            <button
              type="submit"
              style={submitBtn}
              disabled={mutation.isPending || !fromInvoiceId || !toInvoiceId}
            >
              {mutation.isPending ? 'Moving…' : 'Reallocate'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Reassign Modal
// ---------------------------------------------------------------------------

interface ReassignModalProps {
  payment: Payment;
  clients: Client[];
  onClose: () => void;
  onReassigned: () => void;
}

function ReassignModal({ payment, clients, onClose, onReassigned }: ReassignModalProps) {
  const [newClientId, setNewClientId] = useState('');

  const { data: allocs = [], isLoading: loadingAllocs } = useQuery({
    queryKey: ['payment-allocs', payment.id],
    queryFn: () => fetchAllocations(payment.id),
  });

  const isBlocked = allocs.length > 0;

  const mutation = useMutation({
    mutationFn: () => reassignPayment(payment.id, Number(newClientId)),
    onSuccess: () => { onReassigned(); onClose(); },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!newClientId || isBlocked) return;
    mutation.mutate();
  }

  return (
    <div style={overlay} role="dialog" aria-modal="true" aria-label="Reassign Payment">
      <div style={{ ...modalBox, maxHeight: '90vh', overflowY: 'auto' }}>
        <h3 style={{ margin: '0 0 0.25rem' }}>Reassign Payment #{payment.id}</h3>
        <p style={{ margin: '0 0 1rem', fontSize: '0.82rem', color: '#6b7280' }}>
          Move this payment to a different client. The payment must be unallocated first.
        </p>

        {loadingAllocs && (
          <p style={{ fontSize: '0.82rem', color: '#9ca3af' }}>Checking allocations…</p>
        )}

        {!loadingAllocs && isBlocked && (
          <div style={{ background: '#fef3c7', color: '#92400e', padding: '10px 12px', borderRadius: 6, marginBottom: '1rem', fontSize: '0.85rem' }}>
            This payment is applied to {allocs.length} invoice{allocs.length !== 1 ? 's' : ''}.
            Un-apply it from all invoices before reassigning.
          </div>
        )}

        {mutation.isError && (
          <div style={errorBox}>{(mutation.error as Error).message}</div>
        )}

        <form onSubmit={handleSubmit}>
          <label style={labelStyle}>New Client *</label>
          <select
            style={inputStyle}
            value={newClientId}
            onChange={e => setNewClientId(e.target.value)}
            disabled={isBlocked}
            required
          >
            <option value="">— select client —</option>
            {clients
              .filter(c => c.id !== payment.client_id)
              .map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
          </select>

          <div style={{ display: 'flex', gap: 8, marginTop: '1.25rem', justifyContent: 'flex-end' }}>
            <button type="button" onClick={onClose} style={cancelBtn}>Cancel</button>
            <button
              type="submit"
              style={{ ...submitBtn, ...(isBlocked ? { opacity: 0.5, cursor: 'not-allowed' } : {}) }}
              disabled={mutation.isPending || isBlocked || !newClientId}
            >
              {mutation.isPending ? 'Reassigning…' : 'Reassign'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Un-apply Modal
// ---------------------------------------------------------------------------

interface UnapplyModalProps {
  payment: Payment;
  onClose: () => void;
  onUnapplied: () => void;
}

function UnapplyModal({ payment, onClose, onUnapplied }: UnapplyModalProps) {
  const { data: allocs = [], isLoading } = useQuery({
    queryKey: ['payment-allocs', payment.id],
    queryFn: () => fetchAllocations(payment.id),
  });

  const mutation = useMutation({
    mutationFn: (invoiceId: number) => unapplyPayment(payment.id, invoiceId),
    onSuccess: () => { onUnapplied(); },
  });

  return (
    <div style={overlay} role="dialog" aria-modal="true" aria-label="Un-apply Payment">
      <div style={{ ...modalBox, maxHeight: '90vh', overflowY: 'auto' }}>
        <h3 style={{ margin: '0 0 0.25rem' }}>Un-apply Payment #{payment.id}</h3>
        <p style={{ margin: '0 0 1rem', fontSize: '0.82rem', color: '#6b7280' }}>
          Remove this payment from a specific invoice. The payment credit stays on the client account as an unallocated balance.
        </p>

        {isLoading && (
          <p style={{ fontSize: '0.82rem', color: '#9ca3af' }}>Loading allocations…</p>
        )}

        {!isLoading && allocs.length === 0 && (
          <p style={{ fontSize: '0.85rem', color: '#6b7280' }}>
            This payment has no live allocations.
          </p>
        )}

        {!isLoading && allocs.length > 0 && (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem', marginBottom: '1rem' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #e5e7eb', color: '#6b7280', textAlign: 'left' }}>
                <th style={{ padding: '6px 8px' }}>Invoice #</th>
                <th style={{ padding: '6px 8px', textAlign: 'right' }}>Amount</th>
                <th style={{ padding: '6px 8px' }}></th>
              </tr>
            </thead>
            <tbody>
              {allocs.map(a => (
                <tr key={a.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                  <td style={{ padding: '6px 8px', color: '#374151' }}>#{a.invoice_id}</td>
                  <td style={{ padding: '6px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {fmtAmount(a.amount, payment.currency)}
                  </td>
                  <td style={{ padding: '6px 8px' }}>
                    <button
                      style={{ ...actionBtnBase, background: '#fee2e2', color: '#991b1b', fontSize: '0.8rem' }}
                      onClick={() => mutation.mutate(a.invoice_id)}
                      disabled={mutation.isPending && mutation.variables === a.invoice_id}
                    >
                      {mutation.isPending && mutation.variables === a.invoice_id ? '…' : 'Un-apply'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {mutation.isError && (
          <div style={errorBox}>{(mutation.error as Error).message}</div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '0.5rem' }}>
          <button type="button" onClick={onClose} style={cancelBtn}>Close</button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// PaymentActionButtons — the main export
// ---------------------------------------------------------------------------
// Renders the row of action buttons (PDF, Receipt, Allocate, Reallocate,
// Un-apply, Reassign, Edit, Delete) and owns the modals + toast for each.
//
// Props:
//   payment   — REST-shaped payment object
//   onChanged — called after any successful mutation; parent should
//               invalidate/refetch its own query (e.g. ['payments'] or
//               ['payment-detail-gql', id])
//   onDeleted — optional; if provided, called after delete succeeds
//               (PaymentDetail passes navigate('/payments') here)
// ---------------------------------------------------------------------------

export interface PaymentActionButtonsProps {
  payment: Payment;
  onChanged: () => void;
  onDeleted?: () => void;
}

export function PaymentActionButtons({ payment, onChanged, onDeleted }: PaymentActionButtonsProps) {
  const [editOpen, setEditOpen] = useState(false);
  const [allocateOpen, setAllocateOpen] = useState(false);
  const [reallocateOpen, setReallocateOpen] = useState(false);
  const [reassignOpen, setReassignOpen] = useState(false);
  const [unapplyOpen, setUnapplyOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [sendingReceipt, setSendingReceipt] = useState(false);
  const [toast, setToast] = useState('');
  const qc = useQueryClient();

  // Clients only needed when Reassign modal is open; same query key as the
  // eager fetch in PaymentList, so the cache is shared across all rows.
  const { data: clients = [] } = useQuery({
    queryKey: ['clients-slim'],
    queryFn: fetchClients,
    enabled: reassignOpen,
  });

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(''), 4000);
  }

  const sendReceiptMut = useMutation({
    mutationFn: () => sendReceipt(payment.id),
    onMutate: () => setSendingReceipt(true),
    onSuccess: (res) => { showToast(`Receipt sent to ${res.to}`); setSendingReceipt(false); },
    onError: (err: Error) => { showToast(`Error: ${err.message}`); setSendingReceipt(false); },
  });

  const deleteMut = useMutation({
    mutationFn: () => deletePayment(payment.id),
    onSuccess: () => {
      showToast('Payment deleted');
      setDeleteOpen(false);
      onChanged();
      onDeleted?.();
    },
    onError: (err: Error) => { showToast(`Error: ${err.message}`); setDeleteOpen(false); },
  });

  async function handleDownloadReceipt() {
    try { await downloadReceipt(payment.id); }
    catch (err) { showToast(`Error: ${err instanceof Error ? err.message : 'Failed to download receipt'}`); }
  }

  return (
    <>
      {/* ── Action buttons (icon-only; hover for label) ── */}
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
        <button
          style={{ ...iconBtn, background: '#dbeafe', color: '#1e40af' }}
          onClick={handleDownloadReceipt}
          title="Download receipt PDF"
          aria-label="Download receipt PDF"
        >
          🧾
        </button>
        <button
          style={{ ...iconBtn, background: '#fef3c7', color: '#92400e' }}
          onClick={() => sendReceiptMut.mutate()}
          disabled={sendingReceipt}
          title="Send receipt email to client"
          aria-label="Send receipt email to client"
        >
          {sendingReceipt ? '…' : '📧'}
        </button>
        <button
          style={{ ...iconBtn, background: '#e0f2fe', color: '#075985' }}
          onClick={() => setAllocateOpen(true)}
          title="Allocate payment to an invoice"
          aria-label="Allocate payment to an invoice"
        >
          ➕
        </button>
        <button
          style={{ ...iconBtn, background: '#ede9fe', color: '#5b21b6' }}
          onClick={() => setReallocateOpen(true)}
          title="Move allocation from one invoice to another (same client)"
          aria-label="Reallocate payment"
        >
          ↔
        </button>
        <button
          style={{ ...iconBtn, background: '#fee2e2', color: '#991b1b' }}
          onClick={() => setUnapplyOpen(true)}
          title="Remove this payment from an invoice (keeps credit on account)"
          aria-label="Un-apply payment from an invoice"
        >
          ✕
        </button>
        <button
          style={{ ...iconBtn, background: '#fef9c3', color: '#854d0e' }}
          onClick={() => setReassignOpen(true)}
          title="Reassign payment to a different client (unallocated only)"
          aria-label="Reassign payment to a different client"
        >
          ↗
        </button>
        <button
          style={{ ...iconBtn, background: '#f3f4f6', color: '#374151' }}
          onClick={() => setEditOpen(true)}
          title="Edit payment"
          aria-label="Edit payment"
        >
          ✏️
        </button>
        <button
          style={{ ...iconBtn, background: '#fee2e2', color: '#991b1b' }}
          onClick={() => setDeleteOpen(true)}
          title="Delete payment"
          aria-label="Delete payment"
        >
          🗑
        </button>
      </div>

      {/* ── Modals ── */}
      {editOpen && (
        <EditPaymentModal
          payment={payment}
          onClose={() => setEditOpen(false)}
          onSaved={() => { onChanged(); showToast('Payment updated'); }}
        />
      )}
      {allocateOpen && (
        <AllocateModal
          payment={payment}
          onClose={() => setAllocateOpen(false)}
          onAllocated={() => {
            qc.invalidateQueries({ queryKey: ['payment-allocs', payment.id] });
            qc.invalidateQueries({ queryKey: ['client-invoices', payment.client_id] });
            onChanged();
            showToast('Payment allocated');
          }}
        />
      )}
      {reallocateOpen && (
        <ReallocateModal
          payment={payment}
          onClose={() => setReallocateOpen(false)}
          onReallocated={() => {
            qc.invalidateQueries({ queryKey: ['payment-allocs', payment.id] });
            onChanged();
            showToast('Payment reallocated');
          }}
        />
      )}
      {unapplyOpen && (
        <UnapplyModal
          payment={payment}
          onClose={() => setUnapplyOpen(false)}
          onUnapplied={() => {
            qc.invalidateQueries({ queryKey: ['payment-allocs', payment.id] });
            onChanged();
            showToast('Payment un-applied from invoice');
          }}
        />
      )}
      {reassignOpen && (
        <ReassignModal
          payment={payment}
          clients={clients}
          onClose={() => setReassignOpen(false)}
          onReassigned={() => {
            qc.invalidateQueries({ queryKey: ['payment-allocs', payment.id] });
            onChanged();
            showToast('Payment reassigned to new client');
          }}
        />
      )}

      {/* ── Delete confirmation ── */}
      {deleteOpen && (
        <div style={overlay} role="alertdialog" aria-modal="true" aria-label="Delete Payment">
          <div style={modalBox}>
            <h3 style={{ margin: '0 0 0.75rem' }}>Delete Payment #{payment.id}?</h3>
            <p style={{ margin: '0 0 1.25rem', color: '#4b5563', fontSize: '0.9rem' }}>
              This will permanently remove payment of{' '}
              {fmtAmount(payment.amount, payment.currency)}. This action cannot be undone.
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button type="button" onClick={() => setDeleteOpen(false)} style={cancelBtn}>
                Cancel
              </button>
              <button
                type="button"
                onClick={() => deleteMut.mutate()}
                disabled={deleteMut.isPending}
                style={{ ...submitBtn, background: '#dc2626' }}
              >
                {deleteMut.isPending ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Toast ── */}
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
    </>
  );
}
