// =============================================================================
// FireISP 5.0 — Refund Requests (§2.5 Billing+)
// =============================================================================
// Page for managing refund requests:
//   • Table: ID, Client ID, Amount, Reason, Status, Requested By, Created At
//   • Status filter dropdown
//   • "New Refund Request" button
//   • Per-row "Review" button (for requested/under_review, requires refund_requests.review)
//   • Per-row "Process" button (for approved, requires refund_requests.process)
//   • Color-coded status badges
// =============================================================================

import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';
import { useAuth } from '@/auth/AuthContext';
import { can } from '@/auth/permissions';
import { useOrgCurrency } from '@/auth/useOrgCurrency';
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

interface RefundRequest {
  id: number;
  client_id: number;
  amount: string;
  reason: string;
  status: string;
  requested_by: number | null;
  payment_id: number | null;
  invoice_id: number | null;
  review_notes: string | null;
  refund_method: string | null;
  gateway_refund_reference: string | null;
  created_at: string;
}

interface RefundRequestsResponse {
  data: RefundRequest[];
  meta: { total: number; page: number; limit: number; totalPages?: number };
}

const PAGE_SIZE = 25;

const REASONS = ['overcharge', 'duplicate', 'cancellation', 'service_issue', 'other'] as const;
const STATUSES = ['requested', 'under_review', 'approved', 'rejected', 'processed'] as const;
const REFUND_METHODS = ['original_method', 'credit_balance', 'manual'] as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmt(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// refund_requests rows carry no currency column — amounts are in the
// organization's currency, so the caller passes useOrgCurrency().
function fmtAmount(amount: string | null | undefined, currency: string): string {
  if (!amount) return '—';
  const n = parseFloat(amount);
  if (Number.isNaN(n)) return amount;
  return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(n);
}

// ---------------------------------------------------------------------------
// Status Badge
// ---------------------------------------------------------------------------

function RefundStatusBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; color: string }> = {
    requested:    { bg: '#dbeafe', color: '#1e40af' },
    under_review: { bg: '#fef3c7', color: '#92400e' },
    approved:     { bg: '#d1fae5', color: '#065f46' },
    rejected:     { bg: '#fee2e2', color: '#991b1b' },
    processed:    { bg: '#f3f4f6', color: '#374151' },
  };
  const s = map[status] ?? { bg: '#f3f4f6', color: '#374151' };
  return (
    <span style={{ background: s.bg, color: s.color, padding: '2px 8px', borderRadius: 12, fontSize: '0.72rem', fontWeight: 600, textTransform: 'capitalize' }}>
      {status.replace('_', ' ')}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Create Modal
// ---------------------------------------------------------------------------

function CreateRefundModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { t } = useTranslation();
  const [clientId, setClientId] = useState('');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState<typeof REASONS[number]>('overcharge');
  const [paymentId, setPaymentId] = useState('');
  const [invoiceId, setInvoiceId] = useState('');
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = {
        client_id: parseInt(clientId, 10),
        amount: parseFloat(amount),
        reason,
      };
      if (paymentId.trim()) body.payment_id = parseInt(paymentId, 10);
      if (invoiceId.trim()) body.invoice_id = parseInt(invoiceId, 10);
      const { error: e } = await api.POST('/refund-requests' as never, { body: body as never } as never);
      if (e) throw new Error(extractApiError(e, 'Failed to create refund request'));
    },
    onSuccess: () => { onCreated(); onClose(); },
    onError: (err: unknown) => setError(err instanceof Error ? err.message : 'Failed to create refund request'),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!clientId || !amount) { setError('Client ID and Amount are required.'); return; }
    mutation.mutate();
  }

  return (
    <div style={overlay} role="dialog" aria-modal="true" aria-label={t('refundRequests.newRequest')}>
      <div style={{ ...modalBox, width: 480 }}>
        <h3 style={{ margin: '0 0 1rem' }}>{t('refundRequests.newRequest')}</h3>
        {error && <div style={errorBox}>{error}</div>}
        <form onSubmit={handleSubmit}>
          <label style={labelStyle}>{t('refundRequests.form.clientId')} *</label>
          <input style={inputStyle} type="number" min={1} value={clientId} required autoFocus
            onChange={e => setClientId(e.target.value)} />

          <label style={labelStyle}>{t('refundRequests.form.amount')} *</label>
          <input style={inputStyle} type="number" min={0} step={0.01} value={amount} required
            onChange={e => setAmount(e.target.value)} />

          <label style={labelStyle}>{t('refundRequests.form.reason')} *</label>
          <select style={inputStyle} value={reason} onChange={e => setReason(e.target.value as typeof REASONS[number])}>
            {REASONS.map(r => (
              <option key={r} value={r}>{t(`refundRequests.reason.${r}`)}</option>
            ))}
          </select>

          <label style={labelStyle}>{t('refundRequests.form.paymentId')}</label>
          <input style={inputStyle} type="number" min={1} value={paymentId}
            onChange={e => setPaymentId(e.target.value)} />

          <label style={labelStyle}>{t('refundRequests.form.invoiceId')}</label>
          <input style={inputStyle} type="number" min={1} value={invoiceId}
            onChange={e => setInvoiceId(e.target.value)} />

          <div style={{ display: 'flex', gap: 8, marginTop: '1.25rem', justifyContent: 'flex-end' }}>
            <button type="button" onClick={onClose} style={cancelBtn}>{t('common.cancel')}</button>
            <button type="submit" style={submitBtn} disabled={mutation.isPending}>
              {mutation.isPending ? t('common.saving') : t('refundRequests.newRequest')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Review Modal
// ---------------------------------------------------------------------------

function ReviewModal({
  requestId,
  onClose,
  onReviewed,
}: {
  requestId: number;
  onClose: () => void;
  onReviewed: () => void;
}) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<'approved' | 'rejected'>('approved');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: async () => {
      const id = requestId;
      const reviewData = { status, review_notes: notes.trim() || undefined };
      const { error: e } = await api.POST(
        '/refund-requests/{id}/review' as never,
        { params: { path: { id } as never }, body: reviewData as never } as never,
      );
      if (e) throw new Error(extractApiError(e, 'Failed to review request'));
    },
    onSuccess: () => { onReviewed(); onClose(); },
    onError: (err: unknown) => setError(err instanceof Error ? err.message : 'Failed to review request'),
  });

  return (
    <div style={overlay} role="dialog" aria-modal="true" aria-label={t('refundRequests.reviewModal.title')}>
      <div style={{ ...modalBox, width: 440 }}>
        <h3 style={{ margin: '0 0 1rem' }}>{t('refundRequests.reviewModal.title')}</h3>
        {error && <div style={errorBox}>{error}</div>}
        <form onSubmit={e => { e.preventDefault(); setError(''); mutation.mutate(); }}>
          <label style={labelStyle}>{t('refundRequests.reviewModal.status')} *</label>
          <select style={inputStyle} value={status} onChange={e => setStatus(e.target.value as 'approved' | 'rejected')}>
            <option value="approved">{t('refundRequests.status.approved')}</option>
            <option value="rejected">{t('refundRequests.status.rejected')}</option>
          </select>

          <label style={labelStyle}>{t('refundRequests.reviewModal.notes')}</label>
          <textarea style={{ ...inputStyle, height: 80, resize: 'vertical' as const }} value={notes}
            onChange={e => setNotes(e.target.value)} />

          <div style={{ display: 'flex', gap: 8, marginTop: '1.25rem', justifyContent: 'flex-end' }}>
            <button type="button" onClick={onClose} style={cancelBtn}>{t('common.cancel')}</button>
            <button type="submit" style={submitBtn} disabled={mutation.isPending}>
              {mutation.isPending ? t('common.saving') : t('refundRequests.review')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Process Modal
// ---------------------------------------------------------------------------

function ProcessModal({
  requestId,
  onClose,
  onProcessed,
}: {
  requestId: number;
  onClose: () => void;
  onProcessed: () => void;
}) {
  const { t } = useTranslation();
  const [refundMethod, setRefundMethod] = useState<typeof REFUND_METHODS[number]>('original_method');
  const [gatewayRef, setGatewayRef] = useState('');
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: async () => {
      const id = requestId;
      const processData: Record<string, unknown> = { refund_method: refundMethod };
      if (gatewayRef.trim()) processData.gateway_refund_reference = gatewayRef.trim();
      const { error: e } = await api.POST(
        '/refund-requests/{id}/process' as never,
        { params: { path: { id } as never }, body: processData as never } as never,
      );
      if (e) throw new Error(extractApiError(e, 'Failed to process refund'));
    },
    onSuccess: () => { onProcessed(); onClose(); },
    onError: (err: unknown) => setError(err instanceof Error ? err.message : 'Failed to process refund'),
  });

  return (
    <div style={overlay} role="dialog" aria-modal="true" aria-label={t('refundRequests.processModal.title')}>
      <div style={{ ...modalBox, width: 440 }}>
        <h3 style={{ margin: '0 0 1rem' }}>{t('refundRequests.processModal.title')}</h3>
        {error && <div style={errorBox}>{error}</div>}
        <form onSubmit={e => { e.preventDefault(); setError(''); mutation.mutate(); }}>
          <label style={labelStyle}>{t('refundRequests.processModal.method')} *</label>
          <select style={inputStyle} value={refundMethod} onChange={e => setRefundMethod(e.target.value as typeof REFUND_METHODS[number])}>
            {REFUND_METHODS.map(m => (
              <option key={m} value={m}>{t(`refundRequests.processModal.methods.${m}`)}</option>
            ))}
          </select>

          <label style={labelStyle}>{t('refundRequests.processModal.gatewayRef')}</label>
          <input style={inputStyle} type="text" value={gatewayRef}
            onChange={e => setGatewayRef(e.target.value)} />

          <div style={{ display: 'flex', gap: 8, marginTop: '1.25rem', justifyContent: 'flex-end' }}>
            <button type="button" onClick={onClose} style={cancelBtn}>{t('common.cancel')}</button>
            <button type="submit" style={submitBtn} disabled={mutation.isPending}>
              {mutation.isPending ? t('common.saving') : t('refundRequests.process')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// RefundRequestList
// ---------------------------------------------------------------------------

export function RefundRequestList() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const orgCurrency = useOrgCurrency();
  const qc = useQueryClient();

  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [reviewingId, setReviewingId] = useState<number | null>(null);
  const [processingId, setProcessingId] = useState<number | null>(null);

  const canReview = can(user, 'refund_requests.review');
  const canProcess = can(user, 'refund_requests.process');

  const { data, isLoading, isError } = useQuery({
    queryKey: ['refund-requests', page, statusFilter],
    queryFn: async () => {
      const query: Record<string, unknown> = { page, limit: PAGE_SIZE };
      if (statusFilter) query.status = statusFilter;
      const res = await api.GET('/refund-requests' as never, {
        params: { query: query as never },
      } as never);
      if (res.error) throw new Error('Failed to load refund requests');
      return res.data as unknown as RefundRequestsResponse;
    },
  });

  const requests = data?.data ?? [];
  const meta = data?.meta;
  const totalPages = meta?.totalPages ?? (meta ? Math.max(1, Math.ceil(meta.total / meta.limit)) : 1);

  const refresh = () => qc.invalidateQueries({ queryKey: ['refund-requests'] });

  const COLS = [
    t('refundRequests.columns.id'),
    t('refundRequests.columns.clientId'),
    t('refundRequests.columns.amount'),
    t('refundRequests.columns.reason'),
    t('refundRequests.columns.status'),
    t('refundRequests.columns.requestedBy'),
    t('refundRequests.columns.createdAt'),
    '',
  ];

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.pageTitle}>{t('refundRequests.title')}</h1>
        {meta && <span style={styles.countBadge}>{meta.total} total</span>}

        <select
          style={{ ...inputStyle, width: 160, marginLeft: 'auto' }}
          value={statusFilter}
          onChange={e => { setStatusFilter(e.target.value); setPage(1); }}
        >
          <option value="">{t('refundRequests.columns.status')}: All</option>
          {STATUSES.map(s => (
            <option key={s} value={s}>{t(`refundRequests.status.${s}`)}</option>
          ))}
        </select>

        <button type="button" style={styles.btnPrimary} onClick={() => setShowCreate(true)}>
          + {t('refundRequests.newRequest')}
        </button>
      </div>

      <div style={styles.tableCard}>
        {isLoading ? (
          <p style={styles.msg}>{t('common.loading')}</p>
        ) : isError ? (
          <p style={styles.msgError}>Failed to load refund requests.</p>
        ) : requests.length === 0 ? (
          <p style={styles.msg}>No refund requests found.</p>
        ) : (
          <>
            <div style={{ overflowX: 'auto' }}>
              <table style={styles.table}>
                <thead>
                  <tr>{COLS.map((h, i) => <th key={i} style={styles.th}>{h}</th>)}</tr>
                </thead>
                <tbody>
                  {requests.map(req => (
                    <tr key={req.id} style={styles.tr}>
                      <td style={styles.td}>#{req.id}</td>
                      <td style={styles.td}>{req.client_id}</td>
                      <td style={{ ...styles.td, fontVariantNumeric: 'tabular-nums' }}>{fmtAmount(req.amount, orgCurrency)}</td>
                      <td style={styles.td}>{t(`refundRequests.reason.${req.reason}`)}</td>
                      <td style={styles.td}><RefundStatusBadge status={req.status} /></td>
                      <td style={{ ...styles.td, color: '#6b7280' }}>{req.requested_by ?? '—'}</td>
                      <td style={{ ...styles.td, color: '#6b7280' }}>{fmt(req.created_at)}</td>
                      <td style={{ ...styles.td, whiteSpace: 'nowrap' }}>
                        {canReview && (req.status === 'requested' || req.status === 'under_review') && (
                          <button
                            type="button"
                            style={{ padding: '3px 10px', background: '#fef3c7', color: '#92400e', border: 'none', borderRadius: 5, cursor: 'pointer', fontSize: '0.75rem', fontWeight: 600, marginRight: 6 }}
                            onClick={() => setReviewingId(req.id)}
                          >
                            {t('refundRequests.review')}
                          </button>
                        )}
                        {canProcess && req.status === 'approved' && (
                          <button
                            type="button"
                            style={{ padding: '3px 10px', background: '#d1fae5', color: '#065f46', border: 'none', borderRadius: 5, cursor: 'pointer', fontSize: '0.75rem', fontWeight: 600 }}
                            onClick={() => setProcessingId(req.id)}
                          >
                            {t('refundRequests.process')}
                          </button>
                        )}
                      </td>
                    </tr>
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
        <CreateRefundModal onClose={() => setShowCreate(false)} onCreated={refresh} />
      )}
      {reviewingId !== null && (
        <ReviewModal requestId={reviewingId} onClose={() => setReviewingId(null)} onReviewed={refresh} />
      )}
      {processingId !== null && (
        <ProcessModal requestId={processingId} onClose={() => setProcessingId(null)} onProcessed={refresh} />
      )}
    </div>
  );
}
