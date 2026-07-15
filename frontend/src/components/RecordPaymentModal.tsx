// =============================================================================
// FireISP 5.0 — Record Payment Modal (shared)
// =============================================================================
// The single "record a payment" flow used by ClientDetail, InvoiceDetail, and
// PaymentList — see PR brief "payment waterfall". Three entry points, one
// component (mirrors GenerateInvoiceModal's lockedClientId pattern):
//
//   • ClientDetail   — lockedClientId + lockedClientName (client fixed, no picker)
//   • InvoiceDetail  — lockedClientId + lockedInvoiceId (that one invoice starts
//                       checked in the checklist; other open invoices are still
//                       listed, unchecked)
//   • PaymentList    — neither locked; the modal fetches its own client list and
//                       shows a picker (same self-fetch pattern as GenerateInvoiceModal)
//
// UX (the brief's design, followed exactly):
//   1. Once a client is known (locked or picked) its pending invoices load
//      automatically into a checklist — all checked by default.
//   2. The amount auto-fills with the SUM of the checked invoices' balance_due,
//      recomputed on every check/uncheck. The amount stays editable at any
//      time; editing it never unchecks anything — a short amount just gets
//      applied FIFO (oldest→newest) and covers fewer invoices; a longer one
//      leaves the excess as unallocated client credit (hinted in the UI).
//   3. Submit creates the payment, then — if at least one invoice is checked —
//      makes ONE atomic call to POST /payments/:id/allocate-auto with the
//      checked invoice_ids (still applied oldest→newest server-side even if
//      the checked set is a narrowed subset). No client → no invoices → no
//      allocate-auto call: the payment simply records as unallocated credit
//      (today's existing behaviour, unchanged).
//   4. A success panel lists which invoices were paid in full / partially paid
//      and any remaining credit, before closing.
// =============================================================================

import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, authedFetch } from '@/api/client';
import {
  overlay, modalBox, errorBox, labelStyle, inputStyle, submitBtn, cancelBtn,
} from '@/components/ClientFormModal';

const API_BASE = '/api/v1';
// Must match the backend payment_method enum exactly (src/middleware/schemas/payments.js
// + the DB ENUM, database/schema.sql) — a value here that isn't accepted
// there 422s on submit with no client-side warning.
const PAYMENT_METHODS = [
  'cash', 'check', 'card', 'transfer', 'online',
  'credit_card', 'debit_card', 'bank_transfer',
  'oxxo_pay', 'spei', 'codi', 'convenience_store',
  'digital_wallet', 'other',
];
const STATUSES = ['completed', 'pending', 'failed', 'refunded', 'cancelled'];

interface Client { id: number; name: string; }

interface OpenInvoice {
  id: number;
  invoice_number: string | null;
  issue_date: string;
  total: string;
  currency: string;
  status: string;
  balance_due: string;
}

interface AllocationResult {
  id: number;
  invoice_id: number;
  invoice_number: string | null;
  amount: number;
  fully_paid: boolean;
}

interface AllocateAutoResult {
  allocations: AllocationResult[];
  remaining_credit: number;
}

function fmtAmount(amount: string | number | null | undefined, currency: string): string {
  if (amount === null || amount === undefined || amount === '') return '—';
  const num = typeof amount === 'number' ? amount : parseFloat(amount);
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency: currency || 'MXN' }).format(num);
}

function fmtDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('es-MX', { year: 'numeric', month: 'short', day: 'numeric' });
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

async function fetchClients(): Promise<Client[]> {
  const res = await api.GET('/clients', { params: { query: { limit: 500 } as never } });
  if (res.error) throw new Error('Failed to load clients');
  return (res.data as unknown as { data: Client[] }).data ?? [];
}

async function fetchOpenInvoices(clientId: number): Promise<OpenInvoice[]> {
  const res = await api.GET('/clients/{id}/open-invoices', { params: { path: { id: clientId } } });
  // Throw instead of returning [] — a swallowed failure renders exactly like
  // "this client has no open invoices", and the payment would then silently
  // record as unallocated credit instead of paying the intended invoices.
  if (res.error) throw new Error('Failed to load open invoices');
  return (res.data as unknown as { data: OpenInvoice[] }).data ?? [];
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

async function createPaymentReq(body: CreatePaymentBody): Promise<number> {
  const res = await authedFetch(`${API_BASE}/payments`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  if (!res.ok) {
    const e = (await res.json().catch(() => ({}))) as { error?: { message?: string } | string };
    const msg = e.error;
    throw new Error(typeof msg === 'string' ? msg : (msg?.message || 'Failed to record payment'));
  }
  const { data } = await res.json() as { data: { id: number } };
  return data.id;
}

async function allocateAutoReq(paymentId: number, invoiceIds: number[]): Promise<AllocateAutoResult> {
  const res = await authedFetch(`${API_BASE}/payments/${paymentId}/allocate-auto`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ invoice_ids: invoiceIds }),
  });
  if (!res.ok) {
    const e = (await res.json().catch(() => ({}))) as { error?: { message?: string } | string };
    const msg = e.error;
    throw new Error(typeof msg === 'string' ? msg : (msg?.message || 'Payment was recorded, but applying it to the invoice(s) failed — allocate it from the Payments page.'));
  }
  const { data } = await res.json() as { data: AllocateAutoResult };
  return data;
}

export interface RecordPaymentModalProps {
  /** Pre-select + lock the client (e.g. opened from a client's or invoice's page). */
  lockedClientId?: number;
  /** Display name for the locked client (the clients list isn't fetched when locked). */
  lockedClientName?: string;
  /** Pre-check exactly this invoice in the checklist (other open invoices stay listed, unchecked) — the InvoiceDetail entry point. */
  lockedInvoiceId?: number;
  onClose: () => void;
  onRecorded: () => void;
}

export function RecordPaymentModal({
  lockedClientId, lockedClientName, lockedInvoiceId, onClose, onRecorded,
}: RecordPaymentModalProps) {
  const { t } = useTranslation();
  const TODAY = new Date().toISOString().split('T')[0];

  const [clientId, setClientId] = useState(lockedClientId ? String(lockedClientId) : '');
  const [form, setForm] = useState({
    amount: '', currency: 'MXN', payment_method: 'cash', status: 'completed',
    payment_date: TODAY, reference: '',
  });
  const [checkedIds, setCheckedIds] = useState<Set<number>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [createdId, setCreatedId] = useState<number | null>(null);
  const [result, setResult] = useState<AllocateAutoResult | null>(null);
  const [step, setStep] = useState<'form' | 'success'>('form');

  const numericClientId = clientId ? Number(clientId) : null;

  // Self-fetch data. Client list only needed when the client isn't locked
  // (same pattern as GenerateInvoiceModal — callers just render the modal).
  const { data: clients = [], isError: clientsError } = useQuery({
    queryKey: ['clients-slim'], queryFn: fetchClients, enabled: !lockedClientId,
  });
  const { data: openInvoices = [], isLoading: loadingInvoices, isError: invoicesError, refetch: refetchInvoices } = useQuery({
    queryKey: ['client-open-invoices', numericClientId],
    queryFn: () => fetchOpenInvoices(numericClientId!),
    enabled: numericClientId != null,
  });

  // Once a payment row exists (create succeeded but applying it failed), its
  // amount/client/etc. are persisted — editing them here would silently
  // diverge the form from the saved payment (the retry only re-attempts the
  // allocation, it never re-sends the money fields).
  const paymentLocked = createdId != null;

  const setField = (k: keyof typeof form, v: string) => setForm(prev => ({ ...prev, [k]: v }));

  // Prime the checklist + auto-filled amount exactly once per client — not on
  // every render, and not again after the user has started editing (a second
  // pass here would clobber a manual edit the moment the query refetches).
  const primedForClient = useRef<number | null>(null);
  useEffect(() => {
    if (numericClientId == null || loadingInvoices) return;
    // Don't mark this client primed on a failed fetch — a later successful
    // refetch must still get its one priming pass.
    if (invoicesError) return;
    if (primedForClient.current === numericClientId) return;
    primedForClient.current = numericClientId;

    const defaultChecked = lockedInvoiceId != null
      ? new Set(openInvoices.filter(inv => inv.id === lockedInvoiceId).map(inv => inv.id))
      : new Set(openInvoices.map(inv => inv.id));
    setCheckedIds(defaultChecked);

    const sum = openInvoices
      .filter(inv => defaultChecked.has(inv.id))
      .reduce((s, inv) => s + Number(inv.balance_due), 0);
    if (sum > 0) setField('amount', String(round2(sum)));

    // Carry the invoice currency over when we know exactly which one (locked
    // invoice, or the client's invoices all share one) — a small UX nicety,
    // not load-bearing (the field stays editable either way).
    const firstCurrency = openInvoices[0]?.currency;
    if (firstCurrency) setField('currency', firstCurrency);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [numericClientId, loadingInvoices, invoicesError, openInvoices, lockedInvoiceId]);

  function toggleInvoice(id: number) {
    const next = new Set(checkedIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    setCheckedIds(next);
    const sum = openInvoices.filter(inv => next.has(inv.id)).reduce((s, inv) => s + Number(inv.balance_due), 0);
    setField('amount', sum > 0 ? String(round2(sum)) : '0');
  }

  const checkedTotal = useMemo(
    () => openInvoices.filter(inv => checkedIds.has(inv.id)).reduce((s, inv) => s + Number(inv.balance_due), 0),
    [openInvoices, checkedIds],
  );
  const amountNum = parseFloat(form.amount);
  const showExcessHint = !isNaN(amountNum) && checkedTotal > 0 && round2(amountNum) > round2(checkedTotal);

  function selectClient(id: string) {
    setClientId(id);
    // Reset — the primer effect re-populates once the new client's invoices load.
    setCheckedIds(new Set());
    setField('amount', '');
    primedForClient.current = null;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!numericClientId) { setError(t('recordPayment.selectClientError')); return; }
    if (!form.amount || isNaN(parseFloat(form.amount)) || parseFloat(form.amount) <= 0) {
      setError(t('recordPayment.invalidAmount')); return;
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
          client_id: numericClientId,
          amount,
          currency: form.currency,
          payment_method: form.payment_method,
          payment_date: form.payment_date,
          status: form.status,
          ...(form.reference.trim() ? { reference_number: form.reference.trim() } : {}),
        });
        setCreatedId(pid);
      }
      if (checkedIds.size > 0) {
        const allocResult = await allocateAutoReq(pid, [...checkedIds]);
        setResult(allocResult);
      } else {
        setResult(null);
      }
      setStep('success');
    } catch (err) {
      if (pid != null) onRecorded(); // payment already saved — refresh so it shows in the list
      setError(err instanceof Error ? err.message : 'Failed to record payment');
    } finally {
      setSubmitting(false);
    }
  }

  function finish() {
    onRecorded();
    onClose();
  }

  if (step === 'success') {
    return (
      <div style={overlay} role="dialog" aria-modal="true" aria-label={t('recordPayment.title')}>
        <div style={{ ...modalBox, maxHeight: '90vh', overflowY: 'auto' }}>
          <h3 style={{ margin: '0 0 1rem' }}>{t('recordPayment.successTitle')}</h3>
          {result && result.allocations.length > 0 && (
            <ul style={{ margin: '0 0 1rem', padding: 0, listStyle: 'none' }}>
              {result.allocations.map(a => (
                <li key={a.id} style={{
                  display: 'flex', justifyContent: 'space-between', padding: '6px 0',
                  borderBottom: '1px solid var(--border-strong)', fontSize: '0.85rem',
                }}>
                  <span>{a.invoice_number || `#${a.invoice_id}`}</span>
                  <span>
                    {fmtAmount(a.amount, form.currency)} —{' '}
                    {a.fully_paid ? t('recordPayment.paidInFull') : t('recordPayment.partiallyPaid')}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {result && result.remaining_credit > 0 && (
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', margin: '0 0 1rem' }}>
              {t('recordPayment.remainingCredit', { amount: fmtAmount(result.remaining_credit, form.currency) })}
            </p>
          )}
          {(!result || result.allocations.length === 0) && (
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', margin: '0 0 1rem' }}>
              {t('recordPayment.recordedAsCredit')}
            </p>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button type="button" onClick={finish} style={submitBtn}>{t('recordPayment.done')}</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={overlay} role="dialog" aria-modal="true" aria-label={t('recordPayment.title')}>
      <div style={{ ...modalBox, width: 520, maxHeight: '90vh', overflowY: 'auto' }}>
        <h3 style={{ margin: '0 0 1rem' }}>{t('recordPayment.title')}</h3>
        {error && <div style={errorBox}>{error}</div>}
        {!lockedClientId && clientsError && (
          <div style={errorBox}>{t('recordPayment.loadClientsError')}</div>
        )}
        <form onSubmit={handleSubmit}>
          <label style={labelStyle}>{t('recordPayment.client')}</label>
          {lockedClientId ? (
            <input style={{ ...inputStyle, background: 'var(--bg-body)', color: 'var(--text-muted)' }}
              value={lockedClientName ?? `Client #${lockedClientId}`} disabled />
          ) : (
            <select style={inputStyle} value={clientId} onChange={e => selectClient(e.target.value)} required disabled={paymentLocked}>
              <option value="">{t('recordPayment.selectClient')}</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          )}
          {paymentLocked && (
            <div style={{ ...errorBox, background: 'var(--bg-body)', color: 'var(--text-secondary)' }}>
              {t('recordPayment.paymentAlreadyRecorded')}
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 12px' }}>
            <div>
              <label style={labelStyle}>{t('recordPayment.amount')} *</label>
              <input type="number" step="0.01" min="0.01" style={inputStyle}
                value={form.amount} onChange={e => setField('amount', e.target.value)} required disabled={paymentLocked} />
              {showExcessHint && (
                <p style={{ fontSize: '0.74rem', color: 'var(--text-secondary)', margin: '4px 0 0' }}>
                  {t('recordPayment.excessCreditHint')}
                </p>
              )}
            </div>
            <div>
              <label style={labelStyle}>{t('recordPayment.currency')}</label>
              <input type="text" maxLength={3} style={inputStyle}
                value={form.currency} onChange={e => setField('currency', e.target.value.toUpperCase())} required disabled={paymentLocked} />
            </div>
          </div>

          <label style={labelStyle}>{t('recordPayment.paymentMethod')}</label>
          <select style={inputStyle} value={form.payment_method} onChange={e => setField('payment_method', e.target.value)} disabled={paymentLocked}>
            {PAYMENT_METHODS.map(m => <option key={m} value={m}>{t(`paymentMethods.${m}`)}</option>)}
          </select>

          <label style={labelStyle}>{t('recordPayment.status')}</label>
          <select style={inputStyle} value={form.status} onChange={e => setField('status', e.target.value)} disabled={paymentLocked}>
            {STATUSES.map(s => <option key={s} value={s}>{t(`recordPayment.statusValues.${s}`)}</option>)}
          </select>

          <label style={labelStyle}>{t('recordPayment.paymentDate')}</label>
          <input type="date" style={inputStyle} value={form.payment_date} onChange={e => setField('payment_date', e.target.value)} required disabled={paymentLocked} />

          <label style={labelStyle}>{t('recordPayment.reference')}</label>
          <input type="text" style={inputStyle} value={form.reference} onChange={e => setField('reference', e.target.value)}
            placeholder={t('recordPayment.referencePlaceholder')} disabled={paymentLocked} />

          <label style={labelStyle}>{t('recordPayment.invoicesHeading')}</label>
          {numericClientId == null && (
            <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', margin: '4px 0 0' }}>
              {t('recordPayment.selectClientFirst')}
            </p>
          )}
          {numericClientId != null && loadingInvoices && (
            <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', margin: '4px 0 0' }}>
              {t('recordPayment.loadingInvoices')}
            </p>
          )}
          {numericClientId != null && !loadingInvoices && invoicesError && (
            <p style={{ fontSize: '0.78rem', color: 'var(--danger, #c0392b)', margin: '4px 0 0' }}>
              {t('recordPayment.loadInvoicesError')}{' '}
              <button type="button" onClick={() => refetchInvoices()}
                style={{ background: 'none', border: 'none', padding: 0, color: 'inherit', textDecoration: 'underline', cursor: 'pointer', font: 'inherit' }}>
                {t('recordPayment.retryLoadInvoices')}
              </button>
            </p>
          )}
          {numericClientId != null && !loadingInvoices && !invoicesError && openInvoices.length === 0 && (
            <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', margin: '4px 0 0' }}>
              {t('recordPayment.noOpenInvoices')}
            </p>
          )}
          {numericClientId != null && !loadingInvoices && openInvoices.length > 0 && (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem', marginTop: 6 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-strong)', color: 'var(--text-secondary)', textAlign: 'left' }}>
                  <th style={{ padding: '4px 6px', width: 24 }} />
                  <th style={{ padding: '4px 6px' }}>{t('recordPayment.table.invoice')}</th>
                  <th style={{ padding: '4px 6px' }}>{t('recordPayment.table.issueDate')}</th>
                  <th style={{ padding: '4px 6px', textAlign: 'right' }}>{t('recordPayment.table.total')}</th>
                  <th style={{ padding: '4px 6px', textAlign: 'right' }}>{t('recordPayment.table.balanceDue')}</th>
                </tr>
              </thead>
              <tbody>
                {openInvoices.map(inv => (
                  <tr key={inv.id} style={{ borderBottom: '1px solid var(--border-strong)' }}>
                    <td style={{ padding: '4px 6px' }}>
                      <input
                        type="checkbox"
                        checked={checkedIds.has(inv.id)}
                        onChange={() => toggleInvoice(inv.id)}
                        aria-label={inv.invoice_number || `#${inv.id}`}
                      />
                    </td>
                    <td style={{ padding: '4px 6px' }}>{inv.invoice_number || `#${inv.id}`}</td>
                    <td style={{ padding: '4px 6px' }}>{fmtDate(inv.issue_date)}</td>
                    <td style={{ padding: '4px 6px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {fmtAmount(inv.total, inv.currency)}
                    </td>
                    <td style={{ padding: '4px 6px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {fmtAmount(inv.balance_due, inv.currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <div style={{ display: 'flex', gap: 8, marginTop: '1.25rem', justifyContent: 'flex-end' }}>
            <button type="button" onClick={onClose} style={cancelBtn}>{t('recordPayment.cancel')}</button>
            <button type="submit" style={submitBtn} disabled={submitting}>
              {submitting ? t('recordPayment.submitting') : (paymentLocked ? t('recordPayment.retryApply') : t('recordPayment.submit'))}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
