// =============================================================================
// FireISP 5.0 — Billing Adjustments (§2.5 Billing+)
// =============================================================================
// Read-mostly billing reports page for manual adjustments:
//   • Table: ID, Client ID, Entity Type, Entity ID, Adjustment Type,
//     Amount Delta, Reason, Approved By, Created By, Created At
//   • "Manual Adjustment" button (requires billing_adjustments.create)
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

interface BillingAdjustment {
  id: number;
  client_id: number;
  entity_type: string;
  entity_id: number;
  adjustment_type: string;
  amount_delta: string;
  reason: string;
  approved_by: number | null;
  created_by: number | null;
  created_at: string;
}

interface AdjustmentsResponse {
  data: BillingAdjustment[];
  meta: { total: number; page: number; limit: number; totalPages?: number };
}

const PAGE_SIZE = 25;
const ENTITY_TYPES = ['invoice', 'payment', 'credit_note', 'balance'] as const;
const ADJUSTMENT_TYPES = ['late_fee_waiver', 'discount', 'correction', 'write_off', 'other'] as const;

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

function fmtDelta(delta: string | null | undefined): string {
  if (!delta) return '—';
  const n = parseFloat(delta);
  if (Number.isNaN(n)) return delta;
  const formatted = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(n));
  return n < 0 ? `-${formatted}` : `+${formatted}`;
}

// ---------------------------------------------------------------------------
// Create Adjustment Modal
// ---------------------------------------------------------------------------

function CreateAdjustmentModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { t } = useTranslation();
  const [clientId, setClientId] = useState('');
  const [entityType, setEntityType] = useState<typeof ENTITY_TYPES[number]>('invoice');
  const [entityId, setEntityId] = useState('');
  const [adjustmentType, setAdjustmentType] = useState<typeof ADJUSTMENT_TYPES[number]>('correction');
  const [amountDelta, setAmountDelta] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = {
        client_id: parseInt(clientId, 10),
        entity_type: entityType,
        entity_id: parseInt(entityId, 10),
        adjustment_type: adjustmentType,
        amount_delta: parseFloat(amountDelta),
        reason: reason.trim(),
      };
      const { error: e } = await api.POST('/billing-adjustments' as never, { body: body as never } as never);
      if (e) throw new Error(extractApiError(e, 'Failed to create adjustment'));
    },
    onSuccess: () => { onCreated(); onClose(); },
    onError: (err: unknown) => setError(err instanceof Error ? err.message : 'Failed to create adjustment'),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!clientId || !entityId || !amountDelta || !reason.trim()) {
      setError('Client ID, Entity ID, Amount Delta, and Reason are required.');
      return;
    }
    mutation.mutate();
  }

  return (
    <div style={overlay} role="dialog" aria-modal="true" aria-label={t('billingAdjustments.newAdjustment')}>
      <div style={{ ...modalBox, width: 500 }}>
        <h3 style={{ margin: '0 0 1rem' }}>{t('billingAdjustments.newAdjustment')}</h3>
        {error && <div style={errorBox}>{error}</div>}
        <form onSubmit={handleSubmit}>
          <label style={labelStyle}>{t('billingAdjustments.form.clientId')} *</label>
          <input style={inputStyle} type="number" min={1} value={clientId} required autoFocus
            onChange={e => setClientId(e.target.value)} />

          <label style={labelStyle}>{t('billingAdjustments.form.entityType')} *</label>
          <select style={inputStyle} value={entityType} onChange={e => setEntityType(e.target.value as typeof ENTITY_TYPES[number])}>
            {ENTITY_TYPES.map(et => (
              <option key={et} value={et}>{t(`billingAdjustments.entityType.${et}`)}</option>
            ))}
          </select>

          <label style={labelStyle}>{t('billingAdjustments.form.entityId')} *</label>
          <input style={inputStyle} type="number" min={1} value={entityId} required
            onChange={e => setEntityId(e.target.value)} />

          <label style={labelStyle}>{t('billingAdjustments.form.adjustmentType')} *</label>
          <select style={inputStyle} value={adjustmentType} onChange={e => setAdjustmentType(e.target.value as typeof ADJUSTMENT_TYPES[number])}>
            {ADJUSTMENT_TYPES.map(at => (
              <option key={at} value={at}>{t(`billingAdjustments.adjustmentType.${at}`)}</option>
            ))}
          </select>

          <label style={labelStyle}>{t('billingAdjustments.form.amountDelta')} *</label>
          <input style={inputStyle} type="number" step={0.01} value={amountDelta} required
            onChange={e => setAmountDelta(e.target.value)}
            placeholder="Use negative for deductions (e.g. -10.00)" />

          <label style={labelStyle}>{t('billingAdjustments.form.reason')} *</label>
          <textarea style={{ ...inputStyle, height: 80, resize: 'vertical' as const }} value={reason} required
            onChange={e => setReason(e.target.value)} />

          <div style={{ display: 'flex', gap: 8, marginTop: '1.25rem', justifyContent: 'flex-end' }}>
            <button type="button" onClick={onClose} style={cancelBtn}>{t('common.cancel')}</button>
            <button type="submit" style={submitBtn} disabled={mutation.isPending}>
              {mutation.isPending ? t('common.saving') : t('billingAdjustments.newAdjustment')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// BillingAdjustmentList
// ---------------------------------------------------------------------------

export function BillingAdjustmentList() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const qc = useQueryClient();

  const [page, setPage] = useState(1);
  const [showCreate, setShowCreate] = useState(false);

  const canCreate = can(user, 'billing_adjustments.create');

  const { data, isLoading, isError } = useQuery({
    queryKey: ['billing-adjustments', page],
    queryFn: async () => {
      const res = await api.GET('/billing-adjustments' as never, {
        params: { query: { page, limit: PAGE_SIZE } as never },
      } as never);
      if (res.error) throw new Error('Failed to load billing adjustments');
      return res.data as unknown as AdjustmentsResponse;
    },
  });

  const adjustments = data?.data ?? [];
  const meta = data?.meta;
  const totalPages = meta?.totalPages ?? (meta ? Math.max(1, Math.ceil(meta.total / meta.limit)) : 1);

  const refresh = () => qc.invalidateQueries({ queryKey: ['billing-adjustments'] });

  const COLS = [
    t('billingAdjustments.columns.id'),
    t('billingAdjustments.columns.clientId'),
    t('billingAdjustments.columns.entityType'),
    t('billingAdjustments.columns.entityId'),
    t('billingAdjustments.columns.adjustmentType'),
    t('billingAdjustments.columns.amountDelta'),
    t('billingAdjustments.columns.reason'),
    t('billingAdjustments.columns.approvedBy'),
    t('billingAdjustments.columns.createdAt'),
  ];

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.pageTitle}>{t('billingAdjustments.title')}</h1>
        {meta && <span style={styles.countBadge}>{meta.total} total</span>}

        {canCreate && (
          <button type="button" style={{ ...styles.btnPrimary, marginLeft: 'auto' }} onClick={() => setShowCreate(true)}>
            + {t('billingAdjustments.newAdjustment')}
          </button>
        )}
      </div>

      <div style={styles.tableCard}>
        {isLoading ? (
          <p style={styles.msg}>{t('common.loading')}</p>
        ) : isError ? (
          <p style={styles.msgError}>Failed to load billing adjustments.</p>
        ) : adjustments.length === 0 ? (
          <p style={styles.msg}>No billing adjustments found.</p>
        ) : (
          <>
            <div style={{ overflowX: 'auto' }}>
              <table style={styles.table}>
                <thead>
                  <tr>{COLS.map((h, i) => <th key={i} style={styles.th}>{h}</th>)}</tr>
                </thead>
                <tbody>
                  {adjustments.map(adj => {
                    const delta = parseFloat(adj.amount_delta);
                    const deltaColor = Number.isNaN(delta) ? '#374151' : delta < 0 ? '#991b1b' : '#065f46';
                    return (
                      <tr key={adj.id} style={styles.tr}>
                        <td style={styles.td}>#{adj.id}</td>
                        <td style={styles.td}>{adj.client_id}</td>
                        <td style={styles.td}>{t(`billingAdjustments.entityType.${adj.entity_type}`)}</td>
                        <td style={styles.td}>#{adj.entity_id}</td>
                        <td style={styles.td}>{t(`billingAdjustments.adjustmentType.${adj.adjustment_type}`)}</td>
                        <td style={{ ...styles.td, fontVariantNumeric: 'tabular-nums', fontWeight: 600, color: deltaColor }}>
                          {fmtDelta(adj.amount_delta)}
                        </td>
                        <td style={{ ...styles.td, maxWidth: 200, color: '#374151' }} title={adj.reason}>
                          {adj.reason.length > 50 ? adj.reason.slice(0, 50) + '…' : adj.reason}
                        </td>
                        <td style={{ ...styles.td, color: '#6b7280' }}>{adj.approved_by ?? '—'}</td>
                        <td style={{ ...styles.td, color: '#6b7280' }}>{fmt(adj.created_at)}</td>
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
        <CreateAdjustmentModal onClose={() => setShowCreate(false)} onCreated={refresh} />
      )}
    </div>
  );
}
