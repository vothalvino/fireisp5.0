// =============================================================================
// FireISP 5.0 — Billing Disputes (§2.5 Billing+)
// =============================================================================
// Page for tracking billing disputes:
//   • Table: ID, Client ID, Type, Status, Description (truncated), Opened By, Created At
//   • Status filter dropdown
//   • "New Dispute" button
//   • Per-row "Transition" button (requires billing_disputes.update)
//   • Per-row "Evidence" button → inline evidence panel with upload
// =============================================================================

import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, tokenStore } from '@/api/client';
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

interface BillingDispute {
  id: number;
  client_id: number;
  type: string;
  status: string;
  description: string;
  opened_by: number | null;
  invoice_id: number | null;
  payment_id: number | null;
  resolution_notes: string | null;
  created_at: string;
}

interface DisputesResponse {
  data: BillingDispute[];
  meta: { total: number; page: number; limit: number; totalPages?: number };
}

interface EvidenceFile {
  id: number;
  dispute_id: number;
  filename: string;
  note: string | null;
  uploaded_by: number | null;
  created_at: string;
}

const PAGE_SIZE = 25;
const DISPUTE_TYPES = ['billing_error', 'service_quality', 'unauthorized_charge', 'other'] as const;
const DISPUTE_STATUSES = ['open', 'investigating', 'resolved_favor_client', 'resolved_favor_company', 'escalated'] as const;

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

function truncate(str: string, max: number): string {
  if (str.length <= max) return str;
  return str.slice(0, max) + '…';
}

// ---------------------------------------------------------------------------
// Status Badge
// ---------------------------------------------------------------------------

function DisputeStatusBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; color: string }> = {
    open:                     { bg: '#dbeafe', color: '#1e40af' },
    investigating:            { bg: '#fef3c7', color: '#92400e' },
    resolved_favor_client:    { bg: '#d1fae5', color: '#065f46' },
    resolved_favor_company:   { bg: '#ede9fe', color: '#5b21b6' },
    escalated:                { bg: '#fee2e2', color: '#991b1b' },
  };
  const s = map[status] ?? { bg: '#f3f4f6', color: '#374151' };
  return (
    <span style={{ background: s.bg, color: s.color, padding: '2px 8px', borderRadius: 12, fontSize: '0.72rem', fontWeight: 600 }}>
      {status.replace(/_/g, ' ')}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Create Dispute Modal
// ---------------------------------------------------------------------------

function CreateDisputeModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { t } = useTranslation();
  const [clientId, setClientId] = useState('');
  const [type, setType] = useState<typeof DISPUTE_TYPES[number]>('billing_error');
  const [description, setDescription] = useState('');
  const [invoiceId, setInvoiceId] = useState('');
  const [paymentId, setPaymentId] = useState('');
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = {
        client_id: parseInt(clientId, 10),
        type,
        description: description.trim(),
      };
      if (invoiceId.trim()) body.invoice_id = parseInt(invoiceId, 10);
      if (paymentId.trim()) body.payment_id = parseInt(paymentId, 10);
      const { error: e } = await api.POST('/billing-disputes' as never, { body: body as never } as never);
      if (e) throw new Error(extractApiError(e, 'Failed to create dispute'));
    },
    onSuccess: () => { onCreated(); onClose(); },
    onError: (err: unknown) => setError(err instanceof Error ? err.message : 'Failed to create dispute'),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!clientId || !description.trim()) { setError('Client ID and Description are required.'); return; }
    mutation.mutate();
  }

  return (
    <div style={overlay} role="dialog" aria-modal="true" aria-label={t('billingDisputes.newDispute')}>
      <div style={{ ...modalBox, width: 500 }}>
        <h3 style={{ margin: '0 0 1rem' }}>{t('billingDisputes.newDispute')}</h3>
        {error && <div style={errorBox}>{error}</div>}
        <form onSubmit={handleSubmit}>
          <label style={labelStyle}>{t('billingDisputes.form.clientId')} *</label>
          <input style={inputStyle} type="number" min={1} value={clientId} required autoFocus
            onChange={e => setClientId(e.target.value)} />

          <label style={labelStyle}>{t('billingDisputes.form.type')} *</label>
          <select style={inputStyle} value={type} onChange={e => setType(e.target.value as typeof DISPUTE_TYPES[number])}>
            {DISPUTE_TYPES.map(dt => (
              <option key={dt} value={dt}>{t(`billingDisputes.type.${dt}`)}</option>
            ))}
          </select>

          <label style={labelStyle}>{t('billingDisputes.form.description')} *</label>
          <textarea style={{ ...inputStyle, height: 100, resize: 'vertical' as const }} value={description} required
            onChange={e => setDescription(e.target.value)} />

          <label style={labelStyle}>{t('billingDisputes.form.invoiceId')}</label>
          <input style={inputStyle} type="number" min={1} value={invoiceId}
            onChange={e => setInvoiceId(e.target.value)} />

          <label style={labelStyle}>{t('billingDisputes.form.paymentId')}</label>
          <input style={inputStyle} type="number" min={1} value={paymentId}
            onChange={e => setPaymentId(e.target.value)} />

          <div style={{ display: 'flex', gap: 8, marginTop: '1.25rem', justifyContent: 'flex-end' }}>
            <button type="button" onClick={onClose} style={cancelBtn}>{t('common.cancel')}</button>
            <button type="submit" style={submitBtn} disabled={mutation.isPending}>
              {mutation.isPending ? t('common.saving') : t('billingDisputes.newDispute')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Transition Modal
// ---------------------------------------------------------------------------

function TransitionModal({
  disputeId,
  onClose,
  onTransitioned,
}: {
  disputeId: number;
  onClose: () => void;
  onTransitioned: () => void;
}) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<typeof DISPUTE_STATUSES[number]>('investigating');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: async () => {
      const id = disputeId;
      const tData: Record<string, unknown> = { status };
      if (notes.trim()) tData.resolution_notes = notes.trim();
      const { error: e } = await api.POST(
        '/billing-disputes/{id}/transition' as never,
        { params: { path: { id } as never }, body: tData as never } as never,
      );
      if (e) throw new Error(extractApiError(e, 'Failed to transition dispute'));
    },
    onSuccess: () => { onTransitioned(); onClose(); },
    onError: (err: unknown) => setError(err instanceof Error ? err.message : 'Failed to transition dispute'),
  });

  return (
    <div style={overlay} role="dialog" aria-modal="true" aria-label={t('billingDisputes.transitionModal.title')}>
      <div style={{ ...modalBox, width: 440 }}>
        <h3 style={{ margin: '0 0 1rem' }}>{t('billingDisputes.transitionModal.title')}</h3>
        {error && <div style={errorBox}>{error}</div>}
        <form onSubmit={e => { e.preventDefault(); setError(''); mutation.mutate(); }}>
          <label style={labelStyle}>{t('billingDisputes.transitionModal.status')} *</label>
          <select style={inputStyle} value={status} onChange={e => setStatus(e.target.value as typeof DISPUTE_STATUSES[number])}>
            {DISPUTE_STATUSES.map(s => (
              <option key={s} value={s}>{t(`billingDisputes.status.${s}`)}</option>
            ))}
          </select>

          <label style={labelStyle}>{t('billingDisputes.transitionModal.notes')}</label>
          <textarea style={{ ...inputStyle, height: 80, resize: 'vertical' as const }} value={notes}
            onChange={e => setNotes(e.target.value)} />

          <div style={{ display: 'flex', gap: 8, marginTop: '1.25rem', justifyContent: 'flex-end' }}>
            <button type="button" onClick={onClose} style={cancelBtn}>{t('common.cancel')}</button>
            <button type="submit" style={submitBtn} disabled={mutation.isPending}>
              {mutation.isPending ? t('common.saving') : t('billingDisputes.transition')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Evidence Panel (inline)
// ---------------------------------------------------------------------------

function EvidencePanel({ disputeId, colSpan }: { disputeId: number; colSpan: number }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState('');
  const [uploadError, setUploadError] = useState('');
  const [uploading, setUploading] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ['dispute-evidence', disputeId],
    queryFn: async () => {
      const id = disputeId;
      const res = await api.GET(
        '/billing-disputes/{id}/evidence' as never,
        { params: { path: { id } as never } } as never,
      );
      if (res.error) throw new Error('Failed to load evidence');
      return (res.data as { data: EvidenceFile[] }).data;
    },
  });

  const files = data ?? [];

  async function handleUpload() {
    if (!file) return;
    setUploadError('');
    setUploading(true);
    try {
      const token = tokenStore.getAccess();
      const fd = new FormData();
      fd.append('file', file);
      if (note.trim()) fd.append('note', note.trim());
      const res = await fetch(`/api/v1/billing-disputes/${disputeId}/evidence`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: fd,
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
        throw new Error(body.error?.message ?? 'Upload failed');
      }
      setFile(null);
      setNote('');
      qc.invalidateQueries({ queryKey: ['dispute-evidence', disputeId] });
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  }

  return (
    <tr>
      <td colSpan={colSpan} style={{ padding: '8px 20px 14px', background: '#f8faff' }}>
        {isLoading && <p style={{ margin: 0, fontSize: '0.82rem', color: '#9ca3af' }}>{t('common.loading')}</p>}
        {error && <p style={{ margin: 0, fontSize: '0.82rem', color: '#991b1b' }}>Failed to load evidence.</p>}
        {!isLoading && !error && (
          <>
            <p style={{ margin: '0 0 8px', fontSize: '0.82rem', fontWeight: 600, color: '#374151' }}>
              {t('billingDisputes.evidencePanel.title')}
            </p>

            {/* File list */}
            {files.length === 0 ? (
              <p style={{ margin: '0 0 10px', fontSize: '0.8rem', color: '#9ca3af' }}>{t('billingDisputes.evidencePanel.noFiles')}</p>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem', marginBottom: 10 }}>
                <thead>
                  <tr>
                    {['ID', 'Filename', 'Note', 'Uploaded At', ''].map(h => (
                      <th key={h} style={{ textAlign: 'left', padding: '3px 8px', color: '#6b7280', fontWeight: 600 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {files.map(f => (
                    <tr key={f.id} style={{ borderBottom: '1px solid #e5e7eb' }}>
                      <td style={{ padding: '3px 8px' }}>#{f.id}</td>
                      <td style={{ padding: '3px 8px' }}>{f.filename}</td>
                      <td style={{ padding: '3px 8px', color: '#6b7280' }}>{f.note || '—'}</td>
                      <td style={{ padding: '3px 8px', color: '#9ca3af' }}>{fmt(f.created_at)}</td>
                      <td style={{ padding: '3px 8px' }}>
                        <a
                          href={`/api/v1/billing-disputes/${disputeId}/evidence/${f.id}/download`}
                          style={{ color: '#2563eb', fontSize: '0.75rem', fontWeight: 600 }}
                        >
                          {t('billingDisputes.evidencePanel.download')}
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {/* Upload form */}
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' as const }}>
              <div>
                <label style={{ ...labelStyle, fontSize: '0.78rem' }}>{t('billingDisputes.evidencePanel.chooseFile')}</label>
                <input
                  type="file"
                  style={{ fontSize: '0.8rem' }}
                  onChange={e => setFile(e.target.files?.[0] ?? null)}
                />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ ...labelStyle, fontSize: '0.78rem' }}>{t('billingDisputes.evidencePanel.note')}</label>
                <input
                  style={{ ...inputStyle, padding: '4px 8px', fontSize: '0.8rem' }}
                  type="text"
                  value={note}
                  onChange={e => setNote(e.target.value)}
                />
              </div>
              <button
                type="button"
                onClick={handleUpload}
                disabled={!file || uploading}
                style={{ ...submitBtn, padding: '5px 12px', fontSize: '0.8rem' }}
              >
                {uploading ? t('common.saving') : t('billingDisputes.evidencePanel.upload')}
              </button>
            </div>
            {uploadError && <p style={{ margin: '6px 0 0', fontSize: '0.8rem', color: '#991b1b' }}>{uploadError}</p>}
          </>
        )}
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// BillingDisputeList
// ---------------------------------------------------------------------------

export function BillingDisputeList() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const qc = useQueryClient();

  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [transitioningId, setTransitioningId] = useState<number | null>(null);
  const [evidenceId, setEvidenceId] = useState<number | null>(null);

  const canUpdate = can(user?.role, 'billing_disputes.update');

  const { data, isLoading, isError } = useQuery({
    queryKey: ['billing-disputes', page, statusFilter],
    queryFn: async () => {
      const query: Record<string, unknown> = { page, limit: PAGE_SIZE };
      if (statusFilter) query.status = statusFilter;
      const res = await api.GET('/billing-disputes' as never, {
        params: { query: query as never },
      } as never);
      if (res.error) throw new Error('Failed to load billing disputes');
      return res.data as unknown as DisputesResponse;
    },
  });

  const disputes = data?.data ?? [];
  const meta = data?.meta;
  const totalPages = meta?.totalPages ?? (meta ? Math.max(1, Math.ceil(meta.total / meta.limit)) : 1);

  const refresh = () => qc.invalidateQueries({ queryKey: ['billing-disputes'] });

  const COLS = [
    t('billingDisputes.columns.id'),
    t('billingDisputes.columns.clientId'),
    t('billingDisputes.columns.type'),
    t('billingDisputes.columns.status'),
    t('billingDisputes.columns.description'),
    t('billingDisputes.columns.openedBy'),
    t('billingDisputes.columns.createdAt'),
    '',
  ];

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.pageTitle}>{t('billingDisputes.title')}</h1>
        {meta && <span style={styles.countBadge}>{meta.total} total</span>}

        <select
          style={{ ...inputStyle, width: 200, marginLeft: 'auto' }}
          value={statusFilter}
          onChange={e => { setStatusFilter(e.target.value); setPage(1); }}
        >
          <option value="">{t('billingDisputes.columns.status')}: All</option>
          {DISPUTE_STATUSES.map(s => (
            <option key={s} value={s}>{t(`billingDisputes.status.${s}`)}</option>
          ))}
        </select>

        <button type="button" style={styles.btnPrimary} onClick={() => setShowCreate(true)}>
          + {t('billingDisputes.newDispute')}
        </button>
      </div>

      <div style={styles.tableCard}>
        {isLoading ? (
          <p style={styles.msg}>{t('common.loading')}</p>
        ) : isError ? (
          <p style={styles.msgError}>Failed to load billing disputes.</p>
        ) : disputes.length === 0 ? (
          <p style={styles.msg}>No billing disputes found.</p>
        ) : (
          <>
            <div style={{ overflowX: 'auto' }}>
              <table style={styles.table}>
                <thead>
                  <tr>{COLS.map((h, i) => <th key={i} style={styles.th}>{h}</th>)}</tr>
                </thead>
                <tbody>
                  {disputes.map(dispute => (
                    <React.Fragment key={dispute.id}>
                      <tr style={styles.tr}>
                        <td style={styles.td}>#{dispute.id}</td>
                        <td style={styles.td}>{dispute.client_id}</td>
                        <td style={styles.td}>{t(`billingDisputes.type.${dispute.type}`)}</td>
                        <td style={styles.td}><DisputeStatusBadge status={dispute.status} /></td>
                        <td style={{ ...styles.td, maxWidth: 240, color: '#374151' }} title={dispute.description}>
                          {truncate(dispute.description, 60)}
                        </td>
                        <td style={{ ...styles.td, color: '#6b7280' }}>{dispute.opened_by ?? '—'}</td>
                        <td style={{ ...styles.td, color: '#6b7280' }}>{fmt(dispute.created_at)}</td>
                        <td style={{ ...styles.td, whiteSpace: 'nowrap' }}>
                          {canUpdate && (
                            <button
                              type="button"
                              style={{ padding: '3px 10px', background: '#fef3c7', color: '#92400e', border: 'none', borderRadius: 5, cursor: 'pointer', fontSize: '0.75rem', fontWeight: 600, marginRight: 6 }}
                              onClick={() => setTransitioningId(dispute.id)}
                            >
                              {t('billingDisputes.transition')}
                            </button>
                          )}
                          <button
                            type="button"
                            style={{ padding: '3px 10px', background: '#ede9fe', color: '#5b21b6', border: 'none', borderRadius: 5, cursor: 'pointer', fontSize: '0.75rem', fontWeight: 600 }}
                            onClick={() => setEvidenceId(evidenceId === dispute.id ? null : dispute.id)}
                          >
                            {t('billingDisputes.evidence')}
                          </button>
                        </td>
                      </tr>
                      {evidenceId === dispute.id && (
                        <EvidencePanel disputeId={dispute.id} colSpan={COLS.length} />
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
        <CreateDisputeModal onClose={() => setShowCreate(false)} onCreated={refresh} />
      )}
      {transitioningId !== null && (
        <TransitionModal
          disputeId={transitioningId}
          onClose={() => setTransitioningId(null)}
          onTransitioned={refresh}
        />
      )}
    </div>
  );
}
