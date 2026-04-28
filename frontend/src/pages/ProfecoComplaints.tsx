// =============================================================================
// FireISP 5.0 — PROFECO Complaints Page (P3.12)
// =============================================================================
// Lists PROFECO (Procuraduría Federal del Consumidor) consumer complaints with
// filtering by status and category, plus a CSV/JSON export button.
// =============================================================================

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, tokenStore } from '@/api/client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ProfecoComplaint {
  id: number;
  organization_id: number;
  ticket_id: number | null;
  client_id: number | null;
  folio_profeco: string | null;
  consumer_name: string;
  consumer_email: string | null;
  consumer_phone: string | null;
  service_type: string;
  category: string;
  description: string;
  resolution_requested: string | null;
  company_response: string | null;
  status: string;
  reported_at: string;
  resolved_at: string | null;
  submitted_by: number | null;
  created_at: string;
}

interface ComplaintsResponse {
  data: ProfecoComplaint[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

interface CreateComplaintBody {
  consumer_name: string;
  description: string;
  folio_profeco?: string;
  consumer_email?: string;
  consumer_phone?: string;
  service_type?: string;
  category?: string;
  resolution_requested?: string;
  status?: string;
  reported_at?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PAGE_SIZE = 25;
const API_BASE  = '/api/v1';

const SERVICE_TYPES = ['internet', 'telefonia', 'television', 'paquete'] as const;
const CATEGORIES    = [
  'facturacion', 'calidad_servicio', 'contrato',
  'suspension_indebida', 'cobros_no_autorizados', 'atencion_cliente', 'otro',
] as const;
const STATUSES = ['recibida', 'en_tramite', 'resuelta', 'archivada'] as const;

// ---------------------------------------------------------------------------
// Data helpers
// ---------------------------------------------------------------------------

async function fetchComplaints(
  page: number,
  statusFilter: string,
  categoryFilter: string,
): Promise<ComplaintsResponse> {
  const query: Record<string, string | number> = { page, limit: PAGE_SIZE };
  if (statusFilter)   query.status   = statusFilter;
  if (categoryFilter) query.category = categoryFilter;
  const res = await api.GET('/profeco-complaints' as never, {
    params: { query: query as never },
  } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to load complaints');
  return res.data as unknown as ComplaintsResponse;
}

async function createComplaint(body: CreateComplaintBody): Promise<ProfecoComplaint> {
  const token = tokenStore.getAccess();
  const res = await fetch(`${API_BASE}/profeco-complaints`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    credentials: 'include',
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error('Failed to create complaint');
  const json = await res.json() as { data: ProfecoComplaint };
  return json.data;
}

function buildExportUrl(format: 'json' | 'csv', statusFilter: string): string {
  const params = new URLSearchParams({ format });
  if (statusFilter) params.set('status', statusFilter);
  return `${API_BASE}/profeco-complaints/export?${params.toString()}`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ProfecoComplaints() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const [page, setPage]           = useState(1);
  const [statusFilter, setStatus] = useState('');
  const [catFilter, setCat]       = useState('');
  const [showModal, setShowModal] = useState(false);

  // Form state
  const [form, setForm] = useState<CreateComplaintBody>({
    consumer_name: '',
    description:   '',
    service_type:  'internet',
    category:      'otro',
    status:        'recibida',
  });
  const [formError, setFormError] = useState('');

  const { data, isLoading, isError } = useQuery({
    queryKey: ['profeco-complaints', page, statusFilter, catFilter],
    queryFn:  () => fetchComplaints(page, statusFilter, catFilter),
  });

  const mutation = useMutation({
    mutationFn: createComplaint,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['profeco-complaints'] });
      setShowModal(false);
      setForm({ consumer_name: '', description: '', service_type: 'internet', category: 'otro', status: 'recibida' });
      setFormError('');
    },
    onError: () => setFormError(t('profecoComplaints.errorCreate')),
  });

  const handleExport = (format: 'json' | 'csv') => {
    const url = buildExportUrl(format, statusFilter);
    window.location.href = url;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.consumer_name.trim() || !form.description.trim()) {
      setFormError(t('profecoComplaints.errorRequired'));
      return;
    }
    mutation.mutate(form);
  };

  const styles = {
    page:        { padding: '24px', background: 'var(--bg-body)', minHeight: '100vh' } as const,
    header:      { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' } as const,
    title:       { fontSize: '24px', fontWeight: 700, color: 'var(--text-primary)', margin: 0 } as const,
    actions:     { display: 'flex', gap: '8px' } as const,
    btn:         { padding: '8px 16px', borderRadius: '6px', border: 'none', cursor: 'pointer', fontSize: '14px', fontWeight: 500 } as const,
    btnPrimary:  { background: '#3b82f6', color: '#fff' } as const,
    btnSuccess:  { background: '#10b981', color: '#fff' } as const,
    btnSecondary:{ background: 'var(--bg-subtle)', color: 'var(--text-primary)', border: '1px solid var(--border)' } as const,
    filters:     { display: 'flex', gap: '12px', marginBottom: '16px', flexWrap: 'wrap' as const },
    select:      { padding: '8px 12px', borderRadius: '6px', border: '1px solid var(--input-border)', background: 'var(--input-bg)', color: 'var(--text-primary)', fontSize: '14px' } as const,
    table:       { width: '100%', borderCollapse: 'collapse' as const, background: 'var(--bg-card)', borderRadius: '8px', overflow: 'hidden' },
    th:          { padding: '12px 16px', textAlign: 'left' as const, background: 'var(--bg-subtle)', color: 'var(--text-secondary)', fontSize: '12px', fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '0.05em' },
    td:          { padding: '12px 16px', borderTop: '1px solid var(--border)', color: 'var(--text-primary)', fontSize: '14px' } as const,
    badge:       (status: string) => ({
      display: 'inline-block', padding: '2px 8px', borderRadius: '9999px', fontSize: '12px', fontWeight: 500,
      background: status === 'resuelta' ? '#d1fae5' : status === 'en_tramite' ? '#fef9c3' : status === 'archivada' ? '#f3f4f6' : '#dbeafe',
      color:      status === 'resuelta' ? '#065f46' : status === 'en_tramite' ? '#854d0e' : status === 'archivada' ? '#6b7280' : '#1e40af',
    }),
    modal:       { position: 'fixed' as const, inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
    modalBox:    { background: 'var(--bg-card)', borderRadius: '12px', padding: '28px', width: '560px', maxWidth: '95vw', maxHeight: '90vh', overflowY: 'auto' as const },
    label:       { display: 'block', fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px' } as const,
    input:       { width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid var(--input-border)', background: 'var(--input-bg)', color: 'var(--text-primary)', fontSize: '14px', boxSizing: 'border-box' as const },
    textarea:    { width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid var(--input-border)', background: 'var(--input-bg)', color: 'var(--text-primary)', fontSize: '14px', resize: 'vertical' as const, minHeight: '80px', boxSizing: 'border-box' as const },
    fieldGroup:  { marginBottom: '16px' } as const,
    errorMsg:    { color: '#ef4444', fontSize: '13px', marginTop: '8px' } as const,
    modalFooter: { display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '20px' } as const,
    pagination:  { display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '12px', marginTop: '16px' } as const,
  };

  const totalPages = data?.meta?.totalPages ?? 1;

  return (
    <div style={styles.page}>
      {/* Header */}
      <div style={styles.header}>
        <h1 style={styles.title}>{t('profecoComplaints.title')}</h1>
        <div style={styles.actions}>
          <button style={{ ...styles.btn, ...styles.btnSuccess }} onClick={() => handleExport('csv')}>
            {t('profecoComplaints.exportCsv')}
          </button>
          <button style={{ ...styles.btn, ...styles.btnSecondary }} onClick={() => handleExport('json')}>
            {t('profecoComplaints.exportJson')}
          </button>
          <button style={{ ...styles.btn, ...styles.btnPrimary }} onClick={() => setShowModal(true)}>
            {t('profecoComplaints.newComplaint')}
          </button>
        </div>
      </div>

      {/* Filters */}
      <div style={styles.filters}>
        <select
          style={styles.select}
          value={statusFilter}
          onChange={e => { setStatus(e.target.value); setPage(1); }}
          aria-label={t('profecoComplaints.filterStatus')}
        >
          <option value="">{t('profecoComplaints.allStatuses')}</option>
          {STATUSES.map(s => (
            <option key={s} value={s}>{t(`profecoComplaints.status.${s}`)}</option>
          ))}
        </select>

        <select
          style={styles.select}
          value={catFilter}
          onChange={e => { setCat(e.target.value); setPage(1); }}
          aria-label={t('profecoComplaints.filterCategory')}
        >
          <option value="">{t('profecoComplaints.allCategories')}</option>
          {CATEGORIES.map(c => (
            <option key={c} value={c}>{t(`profecoComplaints.category.${c}`)}</option>
          ))}
        </select>
      </div>

      {/* Table */}
      {isLoading && <p style={{ color: 'var(--text-muted)' }}>{t('profecoComplaints.loading')}</p>}
      {isError   && <p style={{ color: '#ef4444' }}>{t('profecoComplaints.error')}</p>}

      {!isLoading && !isError && (
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>{t('profecoComplaints.table.folio')}</th>
              <th style={styles.th}>{t('profecoComplaints.table.consumer')}</th>
              <th style={styles.th}>{t('profecoComplaints.table.serviceType')}</th>
              <th style={styles.th}>{t('profecoComplaints.table.category')}</th>
              <th style={styles.th}>{t('profecoComplaints.table.status')}</th>
              <th style={styles.th}>{t('profecoComplaints.table.reportedAt')}</th>
            </tr>
          </thead>
          <tbody>
            {data?.data.map(complaint => (
              <tr key={complaint.id}>
                <td style={styles.td}>{complaint.folio_profeco || '—'}</td>
                <td style={styles.td}>{complaint.consumer_name}</td>
                <td style={styles.td}>{t(`profecoComplaints.serviceType.${complaint.service_type}`)}</td>
                <td style={styles.td}>{t(`profecoComplaints.category.${complaint.category}`)}</td>
                <td style={styles.td}>
                  <span style={styles.badge(complaint.status)}>
                    {t(`profecoComplaints.status.${complaint.status}`)}
                  </span>
                </td>
                <td style={styles.td}>
                  {complaint.reported_at ? new Date(complaint.reported_at).toLocaleDateString() : '—'}
                </td>
              </tr>
            ))}
            {data?.data.length === 0 && (
              <tr>
                <td colSpan={6} style={{ ...styles.td, textAlign: 'center', color: 'var(--text-muted)' }}>
                  {t('profecoComplaints.noComplaints')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={styles.pagination}>
          <button
            style={{ ...styles.btn, ...styles.btnSecondary }}
            disabled={page <= 1}
            onClick={() => setPage(p => Math.max(1, p - 1))}
          >
            ←
          </button>
          <span style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>
            {page} / {totalPages}
          </span>
          <button
            style={{ ...styles.btn, ...styles.btnSecondary }}
            disabled={page >= totalPages}
            onClick={() => setPage(p => p + 1)}
          >
            →
          </button>
        </div>
      )}

      {/* New Complaint Modal */}
      {showModal && (
        <div style={styles.modal} role="dialog" aria-modal="true" aria-label={t('profecoComplaints.newComplaint')}>
          <div style={styles.modalBox}>
            <h2 style={{ ...styles.title, fontSize: '18px', marginBottom: '20px' }}>
              {t('profecoComplaints.newComplaint')}
            </h2>

            <form onSubmit={handleSubmit}>
              <div style={styles.fieldGroup}>
                <label style={styles.label}>{t('profecoComplaints.form.consumerName')} *</label>
                <input
                  style={styles.input}
                  value={form.consumer_name}
                  onChange={e => setForm(f => ({ ...f, consumer_name: e.target.value }))}
                  required
                />
              </div>

              <div style={styles.fieldGroup}>
                <label style={styles.label}>{t('profecoComplaints.form.folioProfeco')}</label>
                <input
                  style={styles.input}
                  value={form.folio_profeco ?? ''}
                  onChange={e => setForm(f => ({ ...f, folio_profeco: e.target.value }))}
                  placeholder="CONCILIANET-2026-XXXX"
                />
              </div>

              <div style={{ display: 'flex', gap: '12px' }}>
                <div style={{ ...styles.fieldGroup, flex: 1 }}>
                  <label style={styles.label}>{t('profecoComplaints.form.serviceType')}</label>
                  <select
                    style={styles.input}
                    value={form.service_type}
                    onChange={e => setForm(f => ({ ...f, service_type: e.target.value }))}
                  >
                    {SERVICE_TYPES.map(s => (
                      <option key={s} value={s}>{t(`profecoComplaints.serviceType.${s}`)}</option>
                    ))}
                  </select>
                </div>
                <div style={{ ...styles.fieldGroup, flex: 1 }}>
                  <label style={styles.label}>{t('profecoComplaints.form.category')}</label>
                  <select
                    style={styles.input}
                    value={form.category}
                    onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
                  >
                    {CATEGORIES.map(c => (
                      <option key={c} value={c}>{t(`profecoComplaints.category.${c}`)}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div style={styles.fieldGroup}>
                <label style={styles.label}>{t('profecoComplaints.form.description')} *</label>
                <textarea
                  style={styles.textarea}
                  value={form.description}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  required
                />
              </div>

              <div style={styles.fieldGroup}>
                <label style={styles.label}>{t('profecoComplaints.form.resolutionRequested')}</label>
                <textarea
                  style={styles.textarea}
                  value={form.resolution_requested ?? ''}
                  onChange={e => setForm(f => ({ ...f, resolution_requested: e.target.value }))}
                />
              </div>

              {formError && <p style={styles.errorMsg}>{formError}</p>}

              <div style={styles.modalFooter}>
                <button
                  type="button"
                  style={{ ...styles.btn, ...styles.btnSecondary }}
                  onClick={() => { setShowModal(false); setFormError(''); }}
                >
                  {t('common.cancel')}
                </button>
                <button
                  type="submit"
                  style={{ ...styles.btn, ...styles.btnPrimary }}
                  disabled={mutation.isPending}
                >
                  {mutation.isPending ? t('common.saving') : t('common.save')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
