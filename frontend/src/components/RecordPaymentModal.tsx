// =============================================================================
// FireISP 5.0 — Record Payment Modal (client-scoped)
// =============================================================================
// A focused "record a payment for THIS client" modal used from the client
// detail page. The client is locked (passed in), so there is no client picker.
// Mirrors the GenerateInvoiceModal pattern (lockedClientId + lockedClientName).
//
// Optionally allocates the payment to one of the client's open invoices.
// Sends `reference_number` (the actual DB column) — the /payments list modal
// historically sent `reference`, which the schema drops.
// =============================================================================

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, tokenStore } from '@/api/client';
import {
  overlay, modalBox, errorBox, labelStyle, inputStyle, submitBtn, cancelBtn,
} from '@/components/ClientFormModal';

const API_BASE = '/api/v1';
const PAYMENT_METHODS = ['cash', 'check', 'credit_card', 'debit_card', 'bank_transfer', 'other'];
const STATUSES = ['completed', 'pending', 'failed', 'refunded', 'cancelled'];

interface OpenInvoice { id: number; invoice_number: string | null; total: string; currency: string; status: string; }

function fmtAmount(amount: string | null | undefined, currency: string): string {
  if (!amount) return '—';
  const num = parseFloat(amount);
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency: currency || 'MXN' }).format(num);
}

// "Open" = not yet settled. Invoices are created as 'issued' and become
// 'overdue' — there is no 'sent' state in normal use — so filter client-side
// rather than by an exact status= query (which would match nothing).
const OPEN_STATUSES = ['issued', 'overdue', 'sent'];

async function fetchOpenInvoices(clientId: number): Promise<OpenInvoice[]> {
  const res = await api.GET('/invoices', {
    params: { query: { client_id: clientId, limit: 100 } as never },
  });
  if (res.error) return [];
  const rows = (res.data as unknown as { data: OpenInvoice[] }).data ?? [];
  return rows.filter(inv => OPEN_STATUSES.includes(inv.status));
}

interface CreatePaymentBody {
  client_id: number;
  amount: number;
  currency: string;
  payment_method: string;
  payment_date: string;
  status: string;
  reference_number?: string;
}

function authHeaders(): Record<string, string> {
  const token = tokenStore.getAccess();
  return { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
}

async function createPaymentReq(body: CreatePaymentBody): Promise<number> {
  const res = await fetch(`${API_BASE}/payments`, { method: 'POST', headers: authHeaders(), body: JSON.stringify(body) });
  if (!res.ok) {
    const e = (await res.json().catch(() => ({}))) as { error?: { message?: string } | string };
    const msg = e.error;
    throw new Error(typeof msg === 'string' ? msg : (msg?.message || 'Failed to record payment'));
  }
  const { data } = await res.json() as { data: { id: number } };
  return data.id;
}

async function allocatePaymentReq(paymentId: number, invoiceId: number, amount: number): Promise<void> {
  const res = await fetch(`${API_BASE}/payments/${paymentId}/allocate`, {
    method: 'POST', headers: authHeaders(), body: JSON.stringify({ invoice_id: invoiceId, amount }),
  });
  if (!res.ok) throw new Error('Payment was recorded, but applying it to the invoice failed — allocate it from the Payments page.');
}

export interface RecordPaymentModalProps {
  lockedClientId: number;
  lockedClientName?: string;
  onClose: () => void;
  onRecorded: () => void;
}

export function RecordPaymentModal({ lockedClientId, lockedClientName, onClose, onRecorded }: RecordPaymentModalProps) {
  const TODAY = new Date().toISOString().split('T')[0];
  const [form, setForm] = useState({
    amount: '', currency: 'MXN', payment_method: 'cash', status: 'completed',
    payment_date: TODAY, reference: '',
  });
  const [invoiceId, setInvoiceId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [createdId, setCreatedId] = useState<number | null>(null);

  const { data: openInvoices = [], isLoading: loadingInvoices } = useQuery({
    queryKey: ['client-open-invoices', lockedClientId],
    queryFn: () => fetchOpenInvoices(lockedClientId),
  });

  const setField = (k: keyof typeof form, v: string) => setForm(prev => ({ ...prev, [k]: v }));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.amount || isNaN(parseFloat(form.amount)) || parseFloat(form.amount) <= 0) {
      setError('Please enter a valid amount greater than zero.'); return;
    }
    const amount = parseFloat(form.amount);
    setSubmitting(true);
    setError('');
    // Reuse an already-created payment on retry so a failed allocation can never
    // create a duplicate payment.
    let pid = createdId;
    try {
      if (pid == null) {
        pid = await createPaymentReq({
          client_id: lockedClientId,
          amount,
          currency: form.currency,
          payment_method: form.payment_method,
          payment_date: form.payment_date,
          status: form.status,
          ...(form.reference.trim() ? { reference_number: form.reference.trim() } : {}),
        });
        setCreatedId(pid);
      }
      if (invoiceId) {
        await allocatePaymentReq(pid, Number(invoiceId), amount);
      }
      onRecorded();
      onClose();
    } catch (err) {
      if (pid != null) onRecorded(); // payment already saved — refresh so it shows in the list
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
          <label style={labelStyle}>Client</label>
          <input style={{ ...inputStyle, background: 'var(--bg-body)', color: 'var(--text-muted)' }}
            value={lockedClientName ?? `Client #${lockedClientId}`} disabled />

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 12px' }}>
            <div>
              <label style={labelStyle}>Amount *</label>
              <input type="number" step="0.01" min="0.01" style={inputStyle}
                value={form.amount} onChange={e => setField('amount', e.target.value)} required />
            </div>
            <div>
              <label style={labelStyle}>Currency</label>
              <input type="text" maxLength={3} style={inputStyle}
                value={form.currency} onChange={e => setField('currency', e.target.value.toUpperCase())} required />
            </div>
          </div>

          <label style={labelStyle}>Payment Method</label>
          <select style={inputStyle} value={form.payment_method} onChange={e => setField('payment_method', e.target.value)}>
            {PAYMENT_METHODS.map(m => <option key={m} value={m}>{m.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}</option>)}
          </select>

          <label style={labelStyle}>Status</label>
          <select style={inputStyle} value={form.status} onChange={e => setField('status', e.target.value)}>
            {STATUSES.map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
          </select>

          <label style={labelStyle}>Payment Date</label>
          <input type="date" style={inputStyle} value={form.payment_date} onChange={e => setField('payment_date', e.target.value)} required />

          <label style={labelStyle}>Reference / Folio (optional)</label>
          <input type="text" style={inputStyle} value={form.reference} onChange={e => setField('reference', e.target.value)}
            placeholder="e.g. transfer ID, check number" />

          <label style={labelStyle}>Apply to Invoice (optional)</label>
          <select style={inputStyle} value={invoiceId} onChange={e => setInvoiceId(e.target.value)} disabled={loadingInvoices}>
            <option value="">— no allocation —</option>
            {openInvoices.map(inv => (
              <option key={inv.id} value={inv.id}>
                {inv.invoice_number || `#${inv.id}`} — {fmtAmount(inv.total, inv.currency)}
              </option>
            ))}
          </select>
          {!loadingInvoices && openInvoices.length === 0 && (
            <p style={{ fontSize: '0.78rem', color: '#9ca3af', margin: '4px 0 0' }}>No open invoices for this client.</p>
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
