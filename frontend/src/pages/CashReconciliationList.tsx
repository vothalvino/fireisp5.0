// =============================================================================
// FireISP 5.0 — Cash Reconciliation (§1.3 Billing+)
// =============================================================================
// Page for managing cash reconciliation sessions:
//   • Table: all sessions with agent, status, opened/closed dates, expected /
//     counted totals, variance
//   • "Open Session" button (requires cash_reconciliation.create)
//   • Row expand: cash payments included in the session
//   • Close button (requires cash_reconciliation.update): enter counted total
//   • Approve button (requires cash_reconciliation.approve): for closed sessions
//   • Variance coloring: green = 0/positive, red = negative
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

interface ReconciliationSession {
  id: number;
  user_id: number;
  status: string;
  opened_at: string;
  closed_at: string | null;
  expected_total: string | null;
  counted_total: string | null;
  variance: string | null;
  notes: string | null;
}

interface SessionsResponse {
  data: ReconciliationSession[];
  meta: { total: number; page: number; limit: number; totalPages?: number };
}

interface CashPayment {
  id: number;
  client_id: number;
  amount: string;
  payment_date: string | null;
  reference: string | null;
}

interface SessionDetail {
  id: number;
  payments: CashPayment[];
}

const PAGE_SIZE = 25;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmt(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
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

function SessionStatusBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; color: string }> = {
    open:     { bg: '#dbeafe', color: '#1e40af' },
    closed:   { bg: '#fef3c7', color: '#92400e' },
    approved: { bg: '#d1fae5', color: '#065f46' },
    disputed: { bg: '#fee2e2', color: '#991b1b' },
  };
  const s = map[status] ?? { bg: '#f3f4f6', color: '#374151' };
  return (
    <span style={{ background: s.bg, color: s.color, padding: '2px 8px', borderRadius: 12, fontSize: '0.72rem', fontWeight: 600, textTransform: 'capitalize' }}>
      {status}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Open Session Modal
// ---------------------------------------------------------------------------

function OpenSessionModal({ onClose, onOpened }: { onClose: () => void; onOpened: () => void }) {
  const { t } = useTranslation();
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: async () => {
      const body = notes.trim() ? { notes: notes.trim() } : {};
      const { error: e } = await api.POST('/cash-reconciliation/sessions' as never, { body: body as never } as never);
      if (e) throw new Error(extractApiError(e, 'Failed to open session'));
    },
    onSuccess: () => { onOpened(); onClose(); },
    onError: (err: unknown) => setError(err instanceof Error ? err.message : 'Failed to open session'),
  });

  return (
    <div style={overlay} role="dialog" aria-modal="true" aria-label={t('cashReconciliation.openSession')}>
      <div style={{ ...modalBox, width: 420 }}>
        <h3 style={{ margin: '0 0 1rem' }}>{t('cashReconciliation.openSession')}</h3>
        {error && <div style={errorBox}>{error}</div>}
        <form onSubmit={e => { e.preventDefault(); setError(''); mutation.mutate(); }}>
          <label style={labelStyle}>{t('cashReconciliation.notes')}</label>
          <input style={inputStyle} type="text" value={notes} autoFocus
            onChange={e => setNotes(e.target.value)}
            placeholder="Optional notes for this session" />
          <div style={{ display: 'flex', gap: 8, marginTop: '1.25rem', justifyContent: 'flex-end' }}>
            <button type="button" onClick={onClose} style={cancelBtn}>{t('common.cancel')}</button>
            <button type="submit" style={submitBtn} disabled={mutation.isPending}>
              {mutation.isPending ? t('common.saving') : t('cashReconciliation.openSession')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Close Session Modal
// ---------------------------------------------------------------------------

function CloseSessionModal({
  sessionId,
  onClose,
  onClosed,
}: {
  sessionId: number;
  onClose: () => void;
  onClosed: () => void;
}) {
  const { t } = useTranslation();
  const [countedTotal, setCountedTotal] = useState('');
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: async () => {
      const { error: e } = await api.POST(
        '/cash-reconciliation/sessions/{id}/close' as never,
        { params: { path: { id: sessionId } }, body: { counted_total: parseFloat(countedTotal) } as never } as never,
      );
      if (e) throw new Error(extractApiError(e, 'Failed to close session'));
    },
    onSuccess: () => { onClosed(); onClose(); },
    onError: (err: unknown) => setError(err instanceof Error ? err.message : 'Failed to close session'),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const n = parseFloat(countedTotal);
    if (!countedTotal || Number.isNaN(n)) { setError('Enter a valid counted total.'); return; }
    setError('');
    mutation.mutate();
  }

  return (
    <div style={overlay} role="dialog" aria-modal="true" aria-label={t('cashReconciliation.close')}>
      <div style={{ ...modalBox, width: 400 }}>
        <h3 style={{ margin: '0 0 1rem' }}>{t('cashReconciliation.close')}</h3>
        {error && <div style={errorBox}>{error}</div>}
        <form onSubmit={handleSubmit}>
          <label style={labelStyle}>{t('cashReconciliation.countedTotal')} *</label>
          <input style={inputStyle} type="number" min={0} step={0.01} value={countedTotal} required autoFocus
            onChange={e => setCountedTotal(e.target.value)} />
          <div style={{ display: 'flex', gap: 8, marginTop: '1.25rem', justifyContent: 'flex-end' }}>
            <button type="button" onClick={onClose} style={cancelBtn}>{t('common.cancel')}</button>
            <button type="submit" style={submitBtn} disabled={mutation.isPending}>
              {mutation.isPending ? t('common.saving') : t('cashReconciliation.close')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Cash Payments (inline expand)
// ---------------------------------------------------------------------------

function CashPaymentsRow({ sessionId, colSpan }: { sessionId: number; colSpan: number }) {
  const { t } = useTranslation();

  const { data, isLoading, error } = useQuery({
    queryKey: ['cash-session-detail', sessionId],
    queryFn: async () => {
      const res = await api.GET(
        '/cash-reconciliation/sessions/{id}' as never,
        { params: { path: { id: sessionId } } } as never,
      );
      if (res.error) throw new Error('Failed to load session detail');
      return (res.data as { data: SessionDetail }).data;
    },
  });

  const payments = data?.payments ?? [];

  return (
    <tr>
      <td colSpan={colSpan} style={{ padding: '8px 20px 12px', background: '#f8faff' }}>
        {isLoading && <p style={{ margin: 0, fontSize: '0.82rem', color: '#9ca3af' }}>{t('common.loading')}</p>}
        {error && <p style={{ margin: 0, fontSize: '0.82rem', color: '#991b1b' }}>Failed to load payments.</p>}
        {!isLoading && !error && (
          <>
            <p style={{ margin: '0 0 8px', fontSize: '0.82rem', fontWeight: 600, color: '#374151' }}>
              {t('cashReconciliation.cashPayments')}
            </p>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
              <thead>
                <tr>
                  {['ID', 'Client ID', 'Amount', 'Date', 'Reference'].map(h => (
                    <th key={h} style={{ textAlign: 'left', padding: '4px 8px', color: '#6b7280', fontWeight: 600 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {payments.length === 0 && (
                  <tr><td colSpan={5} style={{ padding: '8px', color: '#9ca3af' }}>No cash payments in this session.</td></tr>
                )}
                {payments.map(p => (
                  <tr key={p.id} style={{ borderBottom: '1px solid #e5e7eb' }}>
                    <td style={{ padding: '4px 8px' }}>#{p.id}</td>
                    <td style={{ padding: '4px 8px' }}>{p.client_id}</td>
                    <td style={{ padding: '4px 8px', fontVariantNumeric: 'tabular-nums' }}>{fmtAmount(p.amount)}</td>
                    <td style={{ padding: '4px 8px', color: '#9ca3af' }}>{fmt(p.payment_date)}</td>
                    <td style={{ padding: '4px 8px', color: '#9ca3af' }}>{p.reference || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// CashReconciliationList
// ---------------------------------------------------------------------------

export function CashReconciliationList() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [showOpen, setShowOpen] = useState(false);
  const [closingId, setClosingId] = useState<number | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const canCreate = can(user?.role, 'cash_reconciliation.create');
  const canUpdate = can(user?.role, 'cash_reconciliation.update');
  const canApprove = can(user?.role, 'cash_reconciliation.approve');

  const approveMutation = useMutation({
    mutationFn: async (id: number) => {
      const { error: e } = await api.POST(
        '/cash-reconciliation/sessions/{id}/approve' as never,
        { params: { path: { id } }, body: {} as never } as never,
      );
      if (e) throw new Error(extractApiError(e, 'Failed to approve session'));
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cash-sessions'] }),
  });

  const { data, isLoading, isError } = useQuery({
    queryKey: ['cash-sessions', page],
    queryFn: async () => {
      const res = await api.GET('/cash-reconciliation/sessions' as never, {
        params: { query: { page, limit: PAGE_SIZE } as never },
      } as never);
      if (res.error) throw new Error('Failed to load sessions');
      return res.data as unknown as SessionsResponse;
    },
  });

  const sessions = data?.data ?? [];
  const meta = data?.meta;
  const totalPages = meta?.totalPages ?? (meta ? Math.max(1, Math.ceil(meta.total / meta.limit)) : 1);

  const refresh = () => qc.invalidateQueries({ queryKey: ['cash-sessions'] });

  const COLS = [
    t('cashReconciliation.columns.id'),
    t('cashReconciliation.columns.agent'),
    t('cashReconciliation.columns.status'),
    t('cashReconciliation.columns.openedAt'),
    t('cashReconciliation.columns.closedAt'),
    t('cashReconciliation.columns.expected'),
    t('cashReconciliation.columns.counted'),
    t('cashReconciliation.columns.variance'),
    '',
  ];

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.pageTitle}>{t('cashReconciliation.title')}</h1>
        {meta && <span style={styles.countBadge}>{meta.total} total</span>}
        {canCreate && (
          <button type="button" style={{ ...styles.btnPrimary, marginLeft: 'auto' }}
            onClick={() => setShowOpen(true)}>
            + {t('cashReconciliation.openSession')}
          </button>
        )}
      </div>

      <div style={styles.tableCard}>
        {isLoading ? (
          <p style={styles.msg}>{t('common.loading')}</p>
        ) : isError ? (
          <p style={styles.msgError}>Failed to load reconciliation sessions.</p>
        ) : sessions.length === 0 ? (
          <p style={styles.msg}>No sessions found.</p>
        ) : (
          <>
            <div style={{ overflowX: 'auto' }}>
              <table style={styles.table}>
                <thead>
                  <tr>{COLS.map((h, i) => <th key={i} style={styles.th}>{h}</th>)}</tr>
                </thead>
                <tbody>
                  {sessions.map(session => {
                    const variance = session.variance != null ? parseFloat(session.variance) : null;
                    const varianceColor = variance == null ? '#374151' : variance < 0 ? '#991b1b' : '#065f46';

                    return (
                      <React.Fragment key={session.id}>
                        <tr
                          style={{ ...styles.tr, cursor: 'pointer' }}
                          onClick={() => setExpandedId(expandedId === session.id ? null : session.id)}
                        >
                          <td style={styles.td}>#{session.id}</td>
                          <td style={styles.td}>{session.user_id}</td>
                          <td style={styles.td}><SessionStatusBadge status={session.status} /></td>
                          <td style={{ ...styles.td, color: '#6b7280' }}>{fmt(session.opened_at)}</td>
                          <td style={{ ...styles.td, color: '#6b7280' }}>{fmt(session.closed_at)}</td>
                          <td style={{ ...styles.td, fontVariantNumeric: 'tabular-nums' }}>{fmtAmount(session.expected_total)}</td>
                          <td style={{ ...styles.td, fontVariantNumeric: 'tabular-nums' }}>{fmtAmount(session.counted_total)}</td>
                          <td style={{ ...styles.td, fontVariantNumeric: 'tabular-nums', fontWeight: 600, color: varianceColor }}>
                            {variance != null ? fmtAmount(session.variance) : '—'}
                          </td>
                          <td style={{ ...styles.td, whiteSpace: 'nowrap' }} onClick={e => e.stopPropagation()}>
                            {canUpdate && session.status === 'open' && (
                              <button
                                type="button"
                                style={{ padding: '3px 10px', background: '#fef3c7', color: '#92400e', border: 'none', borderRadius: 5, cursor: 'pointer', fontSize: '0.75rem', fontWeight: 600, marginRight: 6 }}
                                onClick={() => setClosingId(session.id)}
                              >
                                {t('cashReconciliation.close')}
                              </button>
                            )}
                            {canApprove && session.status === 'closed' && (
                              <button
                                type="button"
                                style={{ padding: '3px 10px', background: '#d1fae5', color: '#065f46', border: 'none', borderRadius: 5, cursor: 'pointer', fontSize: '0.75rem', fontWeight: 600 }}
                                disabled={approveMutation.isPending}
                                onClick={() => approveMutation.mutate(session.id)}
                              >
                                {t('cashReconciliation.approve')}
                              </button>
                            )}
                          </td>
                        </tr>
                        {expandedId === session.id && (
                          <CashPaymentsRow sessionId={session.id} colSpan={COLS.length} />
                        )}
                      </React.Fragment>
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

      {showOpen && (
        <OpenSessionModal onClose={() => setShowOpen(false)} onOpened={refresh} />
      )}
      {closingId !== null && (
        <CloseSessionModal
          sessionId={closingId}
          onClose={() => setClosingId(null)}
          onClosed={refresh}
        />
      )}
    </div>
  );
}
