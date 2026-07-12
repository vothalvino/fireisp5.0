// =============================================================================
// FireISP 5.0 — Chargebacks (§2.5 Billing+)
// =============================================================================
// Page for chargeback management:
//   • Table: ID, Payment ID, Gateway, Gateway Dispute ID, Amount, Currency,
//     Status, Due By, Created At
//   • Status filter dropdown
//   • Due-by date highlighting (red if past due and status is received/evidence_submitted)
//   • "Manual Chargeback" button (requires chargebacks.create)
//   • Per-row "Update" button (requires chargebacks.update)
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

interface Chargeback {
  id: number;
  payment_id: number | null;
  gateway: string | null;
  gateway_dispute_id: string | null;
  amount: string;
  currency: string;
  status: string;
  due_by: string | null;
  reason_code: string | null;
  outcome_notes: string | null;
  created_at: string;
}

interface ChargebacksResponse {
  data: Chargeback[];
  meta: { total: number; page: number; limit: number; totalPages?: number };
}

const PAGE_SIZE = 25;
const CHARGEBACK_STATUSES = ['received', 'evidence_submitted', 'won', 'lost', 'accepted'] as const;
const OVERDUE_STATUSES = new Set(['received', 'evidence_submitted']);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmt(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function fmtDatetime(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function fmtAmount(amount: string | null | undefined): string {
  if (!amount) return '—';
  const n = parseFloat(amount);
  if (Number.isNaN(n)) return amount;
  return new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

function isPastDue(dueBy: string | null): boolean {
  if (!dueBy) return false;
  return new Date(dueBy) < new Date();
}

// ---------------------------------------------------------------------------
// Status Badge
// ---------------------------------------------------------------------------

function ChargebackStatusBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; color: string }> = {
    received:           { bg: '#dbeafe', color: '#1e40af' },
    evidence_submitted: { bg: '#fef3c7', color: '#92400e' },
    won:                { bg: '#d1fae5', color: '#065f46' },
    lost:               { bg: '#fee2e2', color: '#991b1b' },
    accepted:           { bg: '#f3f4f6', color: '#374151' },
  };
  const s = map[status] ?? { bg: '#f3f4f6', color: '#374151' };
  return (
    <span style={{ background: s.bg, color: s.color, padding: '2px 8px', borderRadius: 12, fontSize: '0.72rem', fontWeight: 600 }}>
      {status.replace('_', ' ')}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Create Chargeback Modal
// ---------------------------------------------------------------------------

function CreateChargebackModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { t } = useTranslation();
  const [paymentId, setPaymentId] = useState('');
  const [gateway, setGateway] = useState('');
  const [gatewayDisputeId, setGatewayDisputeId] = useState('');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [reasonCode, setReasonCode] = useState('');
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = {
        amount: parseFloat(amount),
        currency: currency.trim() || 'USD',
      };
      if (paymentId.trim()) body.payment_id = parseInt(paymentId, 10);
      if (gateway.trim()) body.gateway = gateway.trim();
      if (gatewayDisputeId.trim()) body.gateway_dispute_id = gatewayDisputeId.trim();
      if (reasonCode.trim()) body.reason_code = reasonCode.trim();
      const { error: e } = await api.POST('/chargebacks' as never, { body: body as never } as never);
      if (e) throw new Error(extractApiError(e, 'Failed to create chargeback'));
    },
    onSuccess: () => { onCreated(); onClose(); },
    onError: (err: unknown) => setError(err instanceof Error ? err.message : 'Failed to create chargeback'),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!amount) { setError('Amount is required.'); return; }
    mutation.mutate();
  }

  return (
    <div style={overlay} role="dialog" aria-modal="true" aria-label={t('chargebacks.newChargeback')}>
      <div style={{ ...modalBox, width: 480 }}>
        <h3 style={{ margin: '0 0 1rem' }}>{t('chargebacks.newChargeback')}</h3>
        {error && <div style={errorBox}>{error}</div>}
        <form onSubmit={handleSubmit}>
          <label style={labelStyle}>{t('chargebacks.form.paymentId')}</label>
          <input style={inputStyle} type="number" min={1} value={paymentId} autoFocus
            onChange={e => setPaymentId(e.target.value)} />

          <label style={labelStyle}>{t('chargebacks.form.gateway')}</label>
          <input style={inputStyle} type="text" value={gateway}
            onChange={e => setGateway(e.target.value)} />

          <label style={labelStyle}>{t('chargebacks.form.gatewayDisputeId')}</label>
          <input style={inputStyle} type="text" value={gatewayDisputeId}
            onChange={e => setGatewayDisputeId(e.target.value)} />

          <label style={labelStyle}>{t('chargebacks.form.amount')} *</label>
          <input style={inputStyle} type="number" min={0} step={0.01} value={amount} required
            onChange={e => setAmount(e.target.value)} />

          <label style={labelStyle}>{t('chargebacks.form.currency')}</label>
          <input style={inputStyle} type="text" maxLength={3} value={currency}
            onChange={e => setCurrency(e.target.value.toUpperCase())} />

          <label style={labelStyle}>{t('chargebacks.form.reasonCode')}</label>
          <input style={inputStyle} type="text" value={reasonCode}
            onChange={e => setReasonCode(e.target.value)} />

          <div style={{ display: 'flex', gap: 8, marginTop: '1.25rem', justifyContent: 'flex-end' }}>
            <button type="button" onClick={onClose} style={cancelBtn}>{t('common.cancel')}</button>
            <button type="submit" style={submitBtn} disabled={mutation.isPending}>
              {mutation.isPending ? t('common.saving') : t('chargebacks.newChargeback')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Update Chargeback Modal
// ---------------------------------------------------------------------------

function UpdateChargebackModal({
  chargeback,
  onClose,
  onUpdated,
}: {
  chargeback: Chargeback;
  onClose: () => void;
  onUpdated: () => void;
}) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<typeof CHARGEBACK_STATUSES[number]>(
    (chargeback.status as typeof CHARGEBACK_STATUSES[number]) ?? 'received',
  );
  const [outcomeNotes, setOutcomeNotes] = useState(chargeback.outcome_notes ?? '');
  const [dueBy, setDueBy] = useState(
    chargeback.due_by ? chargeback.due_by.slice(0, 10) : '',
  );
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: async () => {
      const id = chargeback.id;
      const body: Record<string, unknown> = { status };
      if (outcomeNotes.trim()) body.outcome_notes = outcomeNotes.trim();
      if (dueBy) body.due_by = dueBy;
      const { error: e } = await api.PUT(
        '/chargebacks/{id}' as never,
        { params: { path: { id } as never }, body: body as never } as never,
      );
      if (e) throw new Error(extractApiError(e, 'Failed to update chargeback'));
    },
    onSuccess: () => { onUpdated(); onClose(); },
    onError: (err: unknown) => setError(err instanceof Error ? err.message : 'Failed to update chargeback'),
  });

  return (
    <div style={overlay} role="dialog" aria-modal="true" aria-label={t('chargebacks.updateModal.title')}>
      <div style={{ ...modalBox, width: 440 }}>
        <h3 style={{ margin: '0 0 1rem' }}>{t('chargebacks.updateModal.title')}</h3>
        {error && <div style={errorBox}>{error}</div>}
        <form onSubmit={e => { e.preventDefault(); setError(''); mutation.mutate(); }}>
          <label style={labelStyle}>{t('chargebacks.updateModal.status')} *</label>
          <select style={inputStyle} value={status} onChange={e => setStatus(e.target.value as typeof CHARGEBACK_STATUSES[number])}>
            {CHARGEBACK_STATUSES.map(s => (
              <option key={s} value={s}>{t(`chargebacks.status.${s}`)}</option>
            ))}
          </select>

          <label style={labelStyle}>{t('chargebacks.updateModal.outcomeNotes')}</label>
          <textarea style={{ ...inputStyle, height: 80, resize: 'vertical' as const }} value={outcomeNotes}
            onChange={e => setOutcomeNotes(e.target.value)} />

          <label style={labelStyle}>{t('chargebacks.updateModal.dueBy')}</label>
          <input style={inputStyle} type="date" value={dueBy}
            onChange={e => setDueBy(e.target.value)} />

          <div style={{ display: 'flex', gap: 8, marginTop: '1.25rem', justifyContent: 'flex-end' }}>
            <button type="button" onClick={onClose} style={cancelBtn}>{t('common.cancel')}</button>
            <button type="submit" style={submitBtn} disabled={mutation.isPending}>
              {mutation.isPending ? t('common.saving') : t('chargebacks.update')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ChargebackList
// ---------------------------------------------------------------------------

export function ChargebackList() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const qc = useQueryClient();

  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [updatingItem, setUpdatingItem] = useState<Chargeback | null>(null);

  const canCreate = can(user, 'chargebacks.create');
  const canUpdate = can(user, 'chargebacks.update');

  const { data, isLoading, isError } = useQuery({
    queryKey: ['chargebacks', page, statusFilter],
    queryFn: async () => {
      const query: Record<string, unknown> = { page, limit: PAGE_SIZE };
      if (statusFilter) query.status = statusFilter;
      const res = await api.GET('/chargebacks' as never, {
        params: { query: query as never },
      } as never);
      if (res.error) throw new Error('Failed to load chargebacks');
      return res.data as unknown as ChargebacksResponse;
    },
  });

  const chargebacks = data?.data ?? [];
  const meta = data?.meta;
  const totalPages = meta?.totalPages ?? (meta ? Math.max(1, Math.ceil(meta.total / meta.limit)) : 1);

  const refresh = () => qc.invalidateQueries({ queryKey: ['chargebacks'] });

  const COLS = [
    t('chargebacks.columns.id'),
    t('chargebacks.columns.paymentId'),
    t('chargebacks.columns.gateway'),
    t('chargebacks.columns.gatewayDisputeId'),
    t('chargebacks.columns.amount'),
    t('chargebacks.columns.currency'),
    t('chargebacks.columns.status'),
    t('chargebacks.columns.dueBy'),
    t('chargebacks.columns.createdAt'),
    '',
  ];

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.pageTitle}>{t('chargebacks.title')}</h1>
        {meta && <span style={styles.countBadge}>{meta.total} total</span>}

        <select
          style={{ ...inputStyle, width: 200, marginLeft: 'auto' }}
          value={statusFilter}
          onChange={e => { setStatusFilter(e.target.value); setPage(1); }}
        >
          <option value="">{t('chargebacks.columns.status')}: All</option>
          {CHARGEBACK_STATUSES.map(s => (
            <option key={s} value={s}>{t(`chargebacks.status.${s}`)}</option>
          ))}
        </select>

        {canCreate && (
          <button type="button" style={styles.btnPrimary} onClick={() => setShowCreate(true)}>
            + {t('chargebacks.newChargeback')}
          </button>
        )}
      </div>

      <div style={styles.tableCard}>
        {isLoading ? (
          <p style={styles.msg}>{t('common.loading')}</p>
        ) : isError ? (
          <p style={styles.msgError}>Failed to load chargebacks.</p>
        ) : chargebacks.length === 0 ? (
          <p style={styles.msg}>No chargebacks found.</p>
        ) : (
          <>
            <div style={{ overflowX: 'auto' }}>
              <table style={styles.table}>
                <thead>
                  <tr>{COLS.map((h, i) => <th key={i} style={styles.th}>{h}</th>)}</tr>
                </thead>
                <tbody>
                  {chargebacks.map(cb => {
                    const overdue = OVERDUE_STATUSES.has(cb.status) && isPastDue(cb.due_by);
                    return (
                      <tr key={cb.id} style={styles.tr}>
                        <td style={styles.td}>#{cb.id}</td>
                        <td style={{ ...styles.td, color: '#6b7280' }}>{cb.payment_id ?? '—'}</td>
                        <td style={{ ...styles.td, color: '#6b7280' }}>{cb.gateway || '—'}</td>
                        <td style={{ ...styles.td, color: '#6b7280', fontFamily: 'monospace', fontSize: '0.78rem' }}>
                          {cb.gateway_dispute_id || '—'}
                        </td>
                        <td style={{ ...styles.td, fontVariantNumeric: 'tabular-nums' }}>{fmtAmount(cb.amount)}</td>
                        <td style={styles.td}>{cb.currency}</td>
                        <td style={styles.td}><ChargebackStatusBadge status={cb.status} /></td>
                        <td style={{ ...styles.td, color: overdue ? '#991b1b' : '#6b7280', fontWeight: overdue ? 700 : 400 }}>
                          {fmt(cb.due_by)}
                        </td>
                        <td style={{ ...styles.td, color: '#6b7280' }}>{fmtDatetime(cb.created_at)}</td>
                        <td style={{ ...styles.td, whiteSpace: 'nowrap' }}>
                          {canUpdate && (
                            <button
                              type="button"
                              style={{ padding: '3px 10px', background: '#fef3c7', color: '#92400e', border: 'none', borderRadius: 5, cursor: 'pointer', fontSize: '0.75rem', fontWeight: 600 }}
                              onClick={() => setUpdatingItem(cb)}
                            >
                              {t('chargebacks.update')}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
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
        <CreateChargebackModal onClose={() => setShowCreate(false)} onCreated={refresh} />
      )}
      {updatingItem !== null && (
        <UpdateChargebackModal
          chargeback={updatingItem}
          onClose={() => setUpdatingItem(null)}
          onUpdated={refresh}
        />
      )}
    </div>
  );
}
