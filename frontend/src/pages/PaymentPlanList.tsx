// =============================================================================
// FireISP 5.0 — Payment Plan List (§1.3 Billing+)
// =============================================================================
// CRUD page for payment plans. A payment plan lets a client pay a total in
// recurring installments (weekly / biweekly / monthly).
//   • Table: all plans for the org (paginated)
//   • "New Plan" button (requires payment_plans.create)
//   • Row expand: inline installment schedule with per-installment "Pay" button
//   • Status badges for plan status and installment status
// =============================================================================

import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';
import { useAuth } from '@/auth/AuthContext';
import { can } from '@/auth/permissions';
import { styles } from './crudStyles';
import {
  extractApiError,
  overlay,
  modalBox,
  errorBox,
  labelStyle,
  inputStyle,
  submitBtn,
  cancelBtn,
} from '@/components/ClientFormModal';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PaymentPlan {
  id: number;
  client_id: number;
  invoice_id: number | null;
  total_amount: string;
  installment_count: number;
  frequency: string;
  status: string;
  notes: string | null;
  created_at: string;
}

interface PaymentPlanResponse {
  data: PaymentPlan[];
  meta: { total: number; page: number; limit: number; totalPages?: number };
}

interface Installment {
  sequence_number: number;
  amount: string;
  due_date: string;
  status: string;
  paid_at: string | null;
}

interface PlanDetail {
  id: number;
  client_id: number;
  total_amount: string;
  installment_count: number;
  frequency: string;
  status: string;
  installments: Installment[];
}

interface CreatePlanBody {
  client_id: number;
  invoice_id?: number;
  total_amount: number;
  installment_count: number;
  frequency: string;
  notes?: string;
}

const PAGE_SIZE = 25;
const FREQUENCIES = ['weekly', 'biweekly', 'monthly'] as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmt(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function fmtAmount(amount: string | null | undefined): string {
  if (!amount) return '—';
  const n = parseFloat(amount);
  if (Number.isNaN(n)) return amount;
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'MXN' }).format(n);
}

// ---------------------------------------------------------------------------
// Badges
// ---------------------------------------------------------------------------

function PlanStatusBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; color: string }> = {
    active:    { bg: '#d1fae5', color: '#065f46' },
    completed: { bg: '#dbeafe', color: '#1e40af' },
    defaulted: { bg: '#fee2e2', color: '#991b1b' },
    cancelled: { bg: '#f3f4f6', color: '#374151' },
  };
  const s = map[status] ?? { bg: '#f3f4f6', color: '#374151' };
  return (
    <span style={{ background: s.bg, color: s.color, padding: '2px 8px', borderRadius: 12, fontSize: '0.72rem', fontWeight: 600, textTransform: 'capitalize' }}>
      {status}
    </span>
  );
}

function InstStatusBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; color: string }> = {
    pending: { bg: '#fef3c7', color: '#92400e' },
    paid:    { bg: '#d1fae5', color: '#065f46' },
    overdue: { bg: '#fee2e2', color: '#991b1b' },
  };
  const s = map[status] ?? { bg: '#f3f4f6', color: '#374151' };
  return (
    <span style={{ background: s.bg, color: s.color, padding: '2px 8px', borderRadius: 12, fontSize: '0.72rem', fontWeight: 600, textTransform: 'capitalize' }}>
      {status}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Create Plan Modal
// ---------------------------------------------------------------------------

function CreatePlanModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslation();
  const [form, setForm] = useState({
    client_id: '',
    invoice_id: '',
    total_amount: '',
    installment_count: '3',
    frequency: 'monthly' as string,
    notes: '',
  });
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: async (body: CreatePlanBody) => {
      const { error: e } = await api.POST('/payment-plans' as never, { body: body as never } as never);
      if (e) throw new Error(extractApiError(e, 'Failed to create plan'));
    },
    onSuccess: () => { onSaved(); onClose(); },
    onError: (err: unknown) => setError(err instanceof Error ? err.message : 'Failed to create plan'),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.client_id) { setError('Client ID is required.'); return; }
    const total = parseFloat(form.total_amount);
    if (!form.total_amount || Number.isNaN(total) || total <= 0) { setError('Valid total amount is required.'); return; }
    const count = parseInt(form.installment_count, 10);
    if (!count || count < 1) { setError('Installment count must be at least 1.'); return; }
    setError('');
    const body: CreatePlanBody = {
      client_id: Number(form.client_id),
      total_amount: total,
      installment_count: count,
      frequency: form.frequency,
    };
    if (form.invoice_id) body.invoice_id = Number(form.invoice_id);
    if (form.notes.trim()) body.notes = form.notes.trim();
    mutation.mutate(body);
  }

  return (
    <div style={overlay} role="dialog" aria-modal="true" aria-label={t('paymentPlans.newPlan')}>
      <div style={{ ...modalBox, width: 500, maxHeight: '90vh', overflowY: 'auto' }}>
        <h3 style={{ margin: '0 0 1rem' }}>{t('paymentPlans.newPlan')}</h3>
        {error && <div style={errorBox}>{error}</div>}
        <form onSubmit={handleSubmit}>
          <label style={labelStyle}>{t('paymentPlans.form.clientId')} *</label>
          <input style={inputStyle} type="number" min={1} value={form.client_id} required autoFocus
            onChange={e => setForm(p => ({ ...p, client_id: e.target.value }))} />

          <label style={labelStyle}>{t('paymentPlans.form.invoiceId')}</label>
          <input style={inputStyle} type="number" min={1} value={form.invoice_id}
            onChange={e => setForm(p => ({ ...p, invoice_id: e.target.value }))} />

          <label style={labelStyle}>{t('paymentPlans.form.totalAmount')} *</label>
          <input style={inputStyle} type="number" min={0.01} step={0.01} value={form.total_amount} required
            onChange={e => setForm(p => ({ ...p, total_amount: e.target.value }))} />

          <label style={labelStyle}>{t('paymentPlans.form.installmentCount')} *</label>
          <input style={inputStyle} type="number" min={1} value={form.installment_count} required
            onChange={e => setForm(p => ({ ...p, installment_count: e.target.value }))} />

          <label style={labelStyle}>{t('paymentPlans.form.frequency')}</label>
          <select style={inputStyle} value={form.frequency}
            onChange={e => setForm(p => ({ ...p, frequency: e.target.value }))}>
            {FREQUENCIES.map(f => <option key={f} value={f}>{f}</option>)}
          </select>

          <label style={labelStyle}>{t('paymentPlans.form.notes')}</label>
          <input style={inputStyle} type="text" value={form.notes}
            onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} />

          <div style={{ display: 'flex', gap: 8, marginTop: '1.25rem', justifyContent: 'flex-end' }}>
            <button type="button" onClick={onClose} style={cancelBtn}>{t('common.cancel')}</button>
            <button type="submit" style={submitBtn} disabled={mutation.isPending}>
              {mutation.isPending ? t('common.saving') : t('common.save')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pay Installment Modal
// ---------------------------------------------------------------------------

function PayInstallmentModal({
  planId,
  seq,
  onClose,
  onPaid,
}: {
  planId: number;
  seq: number;
  onClose: () => void;
  onPaid: () => void;
}) {
  const { t } = useTranslation();
  const [paymentId, setPaymentId] = useState('');
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: async () => {
      const { error: e } = await api.POST(
        '/payment-plans/{id}/installments/{seq}/pay' as never,
        { params: { path: { id: planId, seq } }, body: { payment_id: Number(paymentId) } as never } as never,
      );
      if (e) throw new Error(extractApiError(e, 'Failed to pay installment'));
    },
    onSuccess: () => { onPaid(); onClose(); },
    onError: (err: unknown) => setError(err instanceof Error ? err.message : 'Failed to pay installment'),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!paymentId) { setError('Payment ID is required.'); return; }
    setError('');
    mutation.mutate();
  }

  return (
    <div style={overlay} role="dialog" aria-modal="true" aria-label={t('paymentPlans.pay')}>
      <div style={{ ...modalBox, width: 380 }}>
        <h3 style={{ margin: '0 0 1rem' }}>{t('paymentPlans.pay')}</h3>
        {error && <div style={errorBox}>{error}</div>}
        <form onSubmit={handleSubmit}>
          <label style={labelStyle}>{t('paymentPlans.form.paymentId')} *</label>
          <input style={inputStyle} type="number" min={1} value={paymentId} required autoFocus
            onChange={e => setPaymentId(e.target.value)} />
          <div style={{ display: 'flex', gap: 8, marginTop: '1.25rem', justifyContent: 'flex-end' }}>
            <button type="button" onClick={onClose} style={cancelBtn}>{t('common.cancel')}</button>
            <button type="submit" style={submitBtn} disabled={mutation.isPending}>
              {mutation.isPending ? t('common.saving') : t('paymentPlans.pay')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Installment Schedule (inline expand)
// ---------------------------------------------------------------------------

function InstallmentScheduleRow({
  planId,
  colSpan,
}: {
  planId: number;
  colSpan: number;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [paySeq, setPaySeq] = useState<number | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['payment-plan-detail', planId],
    queryFn: async () => {
      const res = await api.GET('/payment-plans/{id}' as never, { params: { path: { id: planId } } } as never);
      if (res.error) throw new Error('Failed to load plan');
      return (res.data as { data: PlanDetail }).data;
    },
  });

  const installments = data?.installments ?? [];

  return (
    <>
      <tr>
        <td colSpan={colSpan} style={{ padding: '8px 20px 12px', background: '#f8faff' }}>
          {isLoading && <p style={{ margin: 0, fontSize: '0.82rem', color: '#9ca3af' }}>{t('common.loading')}</p>}
          {error && <p style={{ margin: 0, fontSize: '0.82rem', color: '#991b1b' }}>Failed to load schedule.</p>}
          {!isLoading && !error && (
            <>
              <p style={{ margin: '0 0 8px', fontSize: '0.82rem', fontWeight: 600, color: '#374151' }}>
                {t('paymentPlans.schedule')}
              </p>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                <thead>
                  <tr>
                    {['#', t('paymentPlans.columns.installments'), 'Due Date', t('paymentPlans.columns.status'), 'Paid At', ''].map((h, i) => (
                      <th key={i} style={{ textAlign: 'left', padding: '4px 8px', color: '#6b7280', fontWeight: 600 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {installments.length === 0 && (
                    <tr><td colSpan={6} style={{ padding: '8px', color: '#9ca3af' }}>No installments.</td></tr>
                  )}
                  {installments.map(inst => (
                    <tr key={inst.sequence_number} style={{ borderBottom: '1px solid #e5e7eb' }}>
                      <td style={{ padding: '4px 8px' }}>{inst.sequence_number}</td>
                      <td style={{ padding: '4px 8px', fontVariantNumeric: 'tabular-nums' }}>{fmtAmount(inst.amount)}</td>
                      <td style={{ padding: '4px 8px' }}>{fmt(inst.due_date)}</td>
                      <td style={{ padding: '4px 8px' }}><InstStatusBadge status={inst.status} /></td>
                      <td style={{ padding: '4px 8px', color: '#9ca3af' }}>{fmt(inst.paid_at)}</td>
                      <td style={{ padding: '4px 8px' }}>
                        {(inst.status === 'pending' || inst.status === 'overdue') && (
                          <button
                            type="button"
                            style={{ padding: '3px 10px', background: '#d1fae5', color: '#065f46', border: 'none', borderRadius: 5, cursor: 'pointer', fontSize: '0.75rem', fontWeight: 600 }}
                            onClick={() => setPaySeq(inst.sequence_number)}
                          >
                            {t('paymentPlans.pay')}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </td>
      </tr>
      {paySeq !== null && (
        <PayInstallmentModal
          planId={planId}
          seq={paySeq}
          onClose={() => setPaySeq(null)}
          onPaid={() => qc.invalidateQueries({ queryKey: ['payment-plan-detail', planId] })}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// PaymentPlanList
// ---------------------------------------------------------------------------

export function PaymentPlanList() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [showCreate, setShowCreate] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const canCreate = can(user?.role, 'payment_plans.create');

  const { data, isLoading, isError } = useQuery({
    queryKey: ['payment-plans', page],
    queryFn: async () => {
      const res = await api.GET('/payment-plans' as never, {
        params: { query: { page, limit: PAGE_SIZE } as never },
      } as never);
      if (res.error) throw new Error('Failed to load payment plans');
      return res.data as unknown as PaymentPlanResponse;
    },
  });

  const plans = data?.data ?? [];
  const meta = data?.meta;
  const totalPages = meta?.totalPages ?? (meta ? Math.max(1, Math.ceil(meta.total / meta.limit)) : 1);

  const refresh = () => qc.invalidateQueries({ queryKey: ['payment-plans'] });

  const COLS = [
    t('paymentPlans.columns.id'),
    t('paymentPlans.columns.client'),
    t('paymentPlans.columns.total'),
    t('paymentPlans.columns.installments'),
    t('paymentPlans.columns.frequency'),
    t('paymentPlans.columns.status'),
    t('paymentPlans.columns.createdAt'),
    '',
  ];

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.pageTitle}>{t('paymentPlans.title')}</h1>
        {meta && <span style={styles.countBadge}>{meta.total} total</span>}
        {canCreate && (
          <button type="button" style={{ ...styles.btnPrimary, marginLeft: 'auto' }}
            onClick={() => setShowCreate(true)}>
            + {t('paymentPlans.newPlan')}
          </button>
        )}
      </div>

      <div style={styles.tableCard}>
        {isLoading ? (
          <p style={styles.msg}>{t('common.loading')}</p>
        ) : isError ? (
          <p style={styles.msgError}>Failed to load payment plans.</p>
        ) : plans.length === 0 ? (
          <p style={styles.msg}>No payment plans found.</p>
        ) : (
          <>
            <div style={{ overflowX: 'auto' }}>
              <table style={styles.table}>
                <thead>
                  <tr>{COLS.map(h => <th key={h} style={styles.th}>{h}</th>)}</tr>
                </thead>
                <tbody>
                  {plans.map(plan => (
                    <React.Fragment key={plan.id}>
                      <tr
                        style={{ ...styles.tr, cursor: 'pointer' }}
                        onClick={() => setExpandedId(expandedId === plan.id ? null : plan.id)}
                      >
                        <td style={styles.td}>#{plan.id}</td>
                        <td style={styles.td}>{plan.client_id}</td>
                        <td style={{ ...styles.td, fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                          {fmtAmount(plan.total_amount)}
                        </td>
                        <td style={styles.td}>{plan.installment_count}</td>
                        <td style={{ ...styles.td, textTransform: 'capitalize' }}>{plan.frequency}</td>
                        <td style={styles.td}><PlanStatusBadge status={plan.status} /></td>
                        <td style={{ ...styles.td, color: '#6b7280' }}>{fmt(plan.created_at)}</td>
                        <td style={styles.td}>
                          <span style={{ fontSize: '0.75rem', color: '#9ca3af' }}>
                            {expandedId === plan.id ? '▲' : '▼'}
                          </span>
                        </td>
                      </tr>
                      {expandedId === plan.id && (
                        <InstallmentScheduleRow planId={plan.id} colSpan={COLS.length} />
                      )}
                    </React.Fragment>
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
                <button style={styles.pageBtn} onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>
                  Next →
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {showCreate && (
        <CreatePlanModal onClose={() => setShowCreate(false)} onSaved={refresh} />
      )}
    </div>
  );
}
