// =============================================================================
// FireISP 5.0 — CFDI Management
// =============================================================================
// Page at /cfdi. Shows all CFDI documents for the org with:
//   • Filtering by status and type (I=Ingreso, E=Egreso, P=Pago)
//   • Paginated table with UUID, RFC, amounts, status
//   • Per-row actions: Stamp (timbrar), Cancel, Download XML, Download PDF
//   • Cancel modal with SAT reason codes and optional replacement UUID
// =============================================================================

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { authedFetch, tokenStore } from '@/api/client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CfdiDocument {
  id: number;
  uuid: string | null;
  serie: string | null;
  folio: string | null;
  tipo_comprobante: string | null;
  stamp_date: string | null;
  emisor_rfc: string | null;
  emisor_nombre: string | null;
  receptor_rfc: string | null;
  receptor_nombre: string | null;
  subtotal: string;
  total: string;
  moneda: string | null;
  status: string;
  cancelled_at: string | null;
  created_at: string;
}

interface CfdiListResponse {
  data: CfdiDocument[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

// ---------------------------------------------------------------------------
// Fetch / action helpers
// ---------------------------------------------------------------------------

const PAGE_SIZE = 25;
const API_BASE = '/api/v1';

function authHeaders(): Record<string, string> {
  const token = tokenStore.getAccess();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function fetchCfdi(page: number, statusFilter: string, typeFilter: string): Promise<CfdiListResponse> {
  const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
  if (statusFilter) params.set('status', statusFilter);
  if (typeFilter) params.set('tipo_comprobante', typeFilter);
  const res = await fetch(`${API_BASE}/cfdi-documents?${params}`, { headers: authHeaders() });
  if (!res.ok) throw new Error('Failed to load CFDI documents');
  return res.json() as Promise<CfdiListResponse>;
}

async function stampCfdi(id: number): Promise<void> {
  const res = await authedFetch(`${API_BASE}/cfdi/stamp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cfdi_document_id: id }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: { message?: string } };
    throw new Error(body.error?.message ?? 'Failed to stamp CFDI');
  }
}

async function cancelCfdi(id: number, reason: string, replacementUuid?: string): Promise<void> {
  const body: Record<string, unknown> = { cfdi_document_id: id, reason };
  if (replacementUuid) body.replacement_uuid = replacementUuid;
  const res = await authedFetch(`${API_BASE}/cfdi/cancel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const resBody = await res.json().catch(() => ({})) as { error?: { message?: string } };
    throw new Error(resBody.error?.message ?? 'Failed to cancel CFDI');
  }
}

function downloadFile(url: string, filename: string) {
  const token = tokenStore.getAccess();
  fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
    .then(res => {
      if (!res.ok) throw new Error(`Download failed (${res.status})`);
      return res.blob();
    })
    .then(blob => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.click();
      URL.revokeObjectURL(a.href);
    })
    .catch(err => {
      alert(err instanceof Error ? err.message : 'Download failed');
    });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmt(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('es-MX', {
    year: 'numeric', month: 'short', day: 'numeric',
  });
}

function fmtAmount(amount: string | null | undefined, currency: string | null): string {
  if (!amount) return '—';
  const num = parseFloat(amount);
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency: currency || 'MXN' }).format(num);
}

function tipoLabel(tipo: string | null): string {
  const map: Record<string, string> = { I: 'Ingreso', E: 'Egreso', T: 'Traslado', N: 'Nómina', P: 'Pago' };
  return tipo ? (map[tipo] ?? tipo) : '—';
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; color: string }> = {
    draft:       { bg: '#f3f4f6', color: '#6b7280' },
    generated:   { bg: '#ede9fe', color: '#5b21b6' },
    stamped:     { bg: '#d1fae5', color: '#065f46' },
    cancelled:   { bg: '#fee2e2', color: '#991b1b' },
    pending:     { bg: '#fef3c7', color: '#92400e' },
  };
  const s = map[status] ?? { bg: '#f3f4f6', color: '#374151' };
  return (
    <span style={{
      background: s.bg, color: s.color,
      padding: '2px 8px', borderRadius: 12,
      fontSize: '0.72rem', fontWeight: 600, textTransform: 'capitalize',
    }}>
      {status}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Cancel Modal
// ---------------------------------------------------------------------------

const CANCEL_REASONS = [
  { code: '01', label: '01 — Comprobante emitido con errores con relación' },
  { code: '02', label: '02 — Comprobante emitido con errores sin relación' },
  { code: '03', label: '03 — No se llevó a cabo la operación' },
  { code: '04', label: '04 — Operación nominativa relacionada en CFDI global' },
];

interface CancelModalProps {
  doc: CfdiDocument;
  onClose: () => void;
  onCancelled: () => void;
}

function CancelModal({ doc, onClose, onCancelled }: CancelModalProps) {
  const [reason, setReason] = useState('02');
  const [replacementUuid, setReplacementUuid] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      await cancelCfdi(doc.id, reason, reason === '01' ? replacementUuid : undefined);
      onCancelled();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to cancel CFDI');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={overlay}>
      <div style={modalBox}>
        <h3 style={{ margin: '0 0 0.25rem' }}>Cancel CFDI</h3>
        <p style={{ margin: '0 0 1rem', color: '#6b7280', fontSize: '0.8rem' }}>
          UUID: {doc.uuid ?? `#${doc.id}`}
        </p>
        {error && <div style={errorBox}>{error}</div>}
        <form onSubmit={handleSubmit}>
          <label style={labelStyle}>Cancellation reason (SAT)</label>
          <select
            style={inputStyle}
            value={reason}
            onChange={e => setReason(e.target.value)}
            required
          >
            {CANCEL_REASONS.map(r => (
              <option key={r.code} value={r.code}>{r.label}</option>
            ))}
          </select>

          {reason === '01' && (
            <>
              <label style={labelStyle}>Replacement UUID (required for reason 01)</label>
              <input
                style={inputStyle}
                type="text"
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                value={replacementUuid}
                onChange={e => setReplacementUuid(e.target.value)}
                required
              />
            </>
          )}

          <div style={{ display: 'flex', gap: 8, marginTop: '1rem', justifyContent: 'flex-end' }}>
            <button type="button" onClick={onClose} style={cancelBtn} disabled={submitting}>Dismiss</button>
            <button type="submit" style={dangerBtn} disabled={submitting}>
              {submitting ? 'Cancelling…' : 'Cancel CFDI'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stamp confirmation modal
// ---------------------------------------------------------------------------

interface StampModalProps {
  doc: CfdiDocument;
  onClose: () => void;
  onStamped: () => void;
}

function StampModal({ doc, onClose, onStamped }: StampModalProps) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  async function handleConfirm() {
    setSubmitting(true);
    setError('');
    try {
      await stampCfdi(doc.id);
      onStamped();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to stamp CFDI');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={overlay}>
      <div style={modalBox}>
        <h3 style={{ margin: '0 0 0.25rem' }}>Stamp (Timbrar) CFDI</h3>
        <p style={{ margin: '0 0 1rem', color: '#6b7280', fontSize: '0.8rem' }}>
          Document #{doc.id} — {doc.serie ?? ''}{doc.folio ? ` Folio ${doc.folio}` : ''}<br />
          Receptor: {doc.receptor_rfc ?? '—'} — {doc.receptor_nombre ?? '—'}<br />
          Total: {fmtAmount(doc.total, doc.moneda)}
        </p>
        <p style={{ fontSize: '0.85rem', color: '#374151' }}>
          This will submit the document to the PAC for digital stamping (timbrado). Once stamped, the UUID cannot change.
        </p>
        {error && <div style={errorBox}>{error}</div>}
        <div style={{ display: 'flex', gap: 8, marginTop: '1rem', justifyContent: 'flex-end' }}>
          <button type="button" onClick={onClose} style={cancelBtn} disabled={submitting}>Cancel</button>
          <button type="button" onClick={handleConfirm} style={submitBtn} disabled={submitting}>
            {submitting ? 'Stamping…' : 'Stamp now'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

const STATUS_OPTIONS = ['', 'draft', 'generated', 'stamped', 'cancelled', 'pending'];
const TYPE_OPTIONS   = ['', 'I', 'E', 'P', 'T', 'N'];

export function CfdiList() {
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [stampTarget, setStampTarget] = useState<CfdiDocument | null>(null);
  const [cancelTarget, setCancelTarget] = useState<CfdiDocument | null>(null);
  const qc = useQueryClient();

  const { data, isLoading, isError } = useQuery({
    queryKey: ['cfdi', page, statusFilter, typeFilter],
    queryFn: () => fetchCfdi(page, statusFilter, typeFilter),
    placeholderData: prev => prev,
  });

  function refresh() {
    void qc.invalidateQueries({ queryKey: ['cfdi'] });
  }

  function handleFilterChange(newStatus: string) {
    setStatusFilter(newStatus);
    setPage(1);
  }

  function handleTypeChange(newType: string) {
    setTypeFilter(newType);
    setPage(1);
  }

  const totalPages = data?.meta?.totalPages ?? 1;
  const total = data?.meta?.total ?? 0;

  return (
    <div style={{ padding: '1.5rem' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: '1rem' }}>
        <h1 style={{ margin: 0, fontSize: '1.4rem', fontWeight: 700 }}>🧾 CFDI Management</h1>
      </div>

      {/* Filters row */}
      <div style={{ display: 'flex', gap: 16, marginBottom: '0.75rem', flexWrap: 'wrap', alignItems: 'flex-start' }}>
        {/* Status filter */}
        <div>
          <span style={{ fontSize: '0.75rem', color: '#6b7280', marginBottom: 4, display: 'block' }}>Status</span>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {STATUS_OPTIONS.map(s => (
              <button
                key={s || 'all'}
                onClick={() => handleFilterChange(s)}
                style={{
                  padding: '3px 10px', borderRadius: 20, border: '1px solid #d1d5db',
                  background: statusFilter === s ? 'var(--accent)' : '#fff',
                  color: statusFilter === s ? '#fff' : '#374151',
                  cursor: 'pointer', fontSize: '0.78rem', fontWeight: 500,
                }}
              >
                {s || 'All'}
              </button>
            ))}
          </div>
        </div>

        {/* Type filter */}
        <div>
          <span style={{ fontSize: '0.75rem', color: '#6b7280', marginBottom: 4, display: 'block' }}>Type</span>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {TYPE_OPTIONS.map(t => (
              <button
                key={t || 'all'}
                onClick={() => handleTypeChange(t)}
                style={{
                  padding: '3px 10px', borderRadius: 20, border: '1px solid #d1d5db',
                  background: typeFilter === t ? 'var(--accent)' : '#fff',
                  color: typeFilter === t ? '#fff' : '#374151',
                  cursor: 'pointer', fontSize: '0.78rem', fontWeight: 500,
                }}
              >
                {t ? tipoLabel(t) : 'All'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Table */}
      {isLoading && <p style={{ color: '#888' }}>Loading…</p>}
      {isError && <p style={{ color: 'var(--accent)' }}>Failed to load CFDI documents.</p>}
      {data && (
        <>
          <div style={{ background: '#fff', borderRadius: 8, boxShadow: '0 0 0 1px var(--border)', overflow: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.855rem' }}>
              <thead>
                <tr style={{ background: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
                  {['UUID / ID', 'Type', 'Receptor', 'Total', 'Date', 'Status', 'Actions'].map(h => (
                    <th key={h} style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600, color: '#374151', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.data.length === 0 && (
                  <tr>
                    <td colSpan={7} style={{ padding: '2rem', textAlign: 'center', color: '#9ca3af' }}>
                      No CFDI documents found.
                    </td>
                  </tr>
                )}
                {data.data.map((doc, idx) => (
                  <tr key={doc.id} style={{ borderBottom: '1px solid #f3f4f6', background: idx % 2 === 0 ? '#fff' : '#fafafa' }}>
                    {/* UUID / ID */}
                    <td style={{ padding: '9px 12px', fontFamily: 'monospace', fontSize: '0.78rem' }}>
                      {doc.uuid
                        ? <span title={doc.uuid}>{doc.uuid.substring(0, 8)}…</span>
                        : <span style={{ color: '#9ca3af' }}>#{doc.id}</span>
                      }
                    </td>

                    {/* Type */}
                    <td style={{ padding: '9px 12px', whiteSpace: 'nowrap' }}>
                      <span style={{
                        background: '#f3f4f6', color: '#374151',
                        padding: '2px 7px', borderRadius: 10, fontSize: '0.75rem', fontWeight: 600,
                      }}>
                        {tipoLabel(doc.tipo_comprobante)}
                      </span>
                    </td>

                    {/* Receptor */}
                    <td style={{ padding: '9px 12px' }}>
                      <div style={{ fontWeight: 500 }}>{doc.receptor_rfc ?? '—'}</div>
                      {doc.receptor_nombre && (
                        <div style={{ fontSize: '0.77rem', color: '#6b7280', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {doc.receptor_nombre}
                        </div>
                      )}
                    </td>

                    {/* Total */}
                    <td style={{ padding: '9px 12px', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                      {fmtAmount(doc.total, doc.moneda)}
                    </td>

                    {/* Date */}
                    <td style={{ padding: '9px 12px', color: '#6b7280', whiteSpace: 'nowrap' }}>
                      {fmt(doc.stamp_date || doc.created_at)}
                    </td>

                    {/* Status */}
                    <td style={{ padding: '9px 12px' }}>
                      <StatusBadge status={doc.status} />
                    </td>

                    {/* Actions */}
                    <td style={{ padding: '9px 12px' }}>
                      <div style={{ display: 'flex', gap: 5, flexWrap: 'nowrap' }}>
                        {/* Stamp — only available for draft/generated docs without UUID */}
                        {(doc.status === 'draft' || doc.status === 'generated') && !doc.uuid && (
                          <button
                            onClick={() => setStampTarget(doc)}
                            style={actionBtn}
                            title="Stamp (timbrar) this CFDI with the PAC"
                          >
                            📤 Stamp
                          </button>
                        )}

                        {/* Cancel — only for stamped docs */}
                        {doc.status === 'stamped' && (
                          <button
                            onClick={() => setCancelTarget(doc)}
                            style={{ ...actionBtn, color: '#991b1b', borderColor: '#fca5a5' }}
                            title="Request cancellation via SAT/PAC"
                          >
                            ✕ Cancel
                          </button>
                        )}

                        {/* Download XML */}
                        {doc.uuid && (
                          <button
                            onClick={() => downloadFile(
                              `${API_BASE}/cfdi/${doc.id}/xml`,
                              `CFDI-${doc.uuid}.xml`,
                            )}
                            style={actionBtn}
                            title="Download XML"
                          >
                            ↓ XML
                          </button>
                        )}

                        {/* Download PDF */}
                        <button
                          onClick={() => downloadFile(
                            `${API_BASE}/cfdi/${doc.id}/pdf`,
                            `CFDI-${doc.uuid ?? doc.id}.pdf`,
                          )}
                          style={actionBtn}
                          title="Download PDF"
                        >
                          ↓ PDF
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '0.75rem', fontSize: '0.8rem', color: '#6b7280' }}>
            <span>{total} document{total !== 1 ? 's' : ''}</span>
            <div style={{ display: 'flex', gap: 6 }}>
              <button style={pageBtn} disabled={page <= 1} onClick={() => setPage(p => p - 1)}>← Prev</button>
              <span style={{ padding: '4px 8px' }}>Page {page} / {totalPages}</span>
              <button style={pageBtn} disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>Next →</button>
            </div>
          </div>
        </>
      )}

      {/* Stamp modal */}
      {stampTarget && (
        <StampModal
          doc={stampTarget}
          onClose={() => setStampTarget(null)}
          onStamped={refresh}
        />
      )}

      {/* Cancel modal */}
      {cancelTarget && (
        <CancelModal
          doc={cancelTarget}
          onClose={() => setCancelTarget(null)}
          onCancelled={refresh}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared styles
// ---------------------------------------------------------------------------

const overlay: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
};
const modalBox: React.CSSProperties = {
  background: '#fff', borderRadius: 10, padding: '1.5rem',
  width: 460, maxWidth: '92vw', boxShadow: '0 8px 32px rgba(0,0,0,.18)',
};
const errorBox: React.CSSProperties = {
  background: '#fee2e2', color: '#991b1b', padding: '8px 12px',
  borderRadius: 6, marginBottom: '0.75rem', fontSize: '0.85rem',
};
const labelStyle: React.CSSProperties = {
  display: 'block', fontWeight: 600, fontSize: '0.8rem',
  color: '#374151', marginBottom: 4, marginTop: 12,
};
const inputStyle: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', padding: '7px 10px',
  border: '1px solid #d1d5db', borderRadius: 6, fontSize: '0.875rem',
};
const submitBtn: React.CSSProperties = {
  background: 'var(--accent)', color: '#fff', border: 'none',
  padding: '7px 18px', borderRadius: 6, cursor: 'pointer',
  fontWeight: 600, fontSize: '0.875rem',
};
const dangerBtn: React.CSSProperties = {
  background: '#dc2626', color: '#fff', border: 'none',
  padding: '7px 18px', borderRadius: 6, cursor: 'pointer',
  fontWeight: 600, fontSize: '0.875rem',
};
const cancelBtn: React.CSSProperties = {
  background: '#fff', color: '#374151', border: '1px solid #d1d5db',
  padding: '7px 18px', borderRadius: 6, cursor: 'pointer',
  fontWeight: 600, fontSize: '0.875rem',
};
const actionBtn: React.CSSProperties = {
  background: '#fff', color: '#374151', border: '1px solid #d1d5db',
  padding: '3px 9px', borderRadius: 5, cursor: 'pointer',
  fontSize: '0.78rem', fontWeight: 500, whiteSpace: 'nowrap',
};
const pageBtn: React.CSSProperties = {
  padding: '4px 10px', border: '1px solid #d1d5db', borderRadius: 4,
  background: '#fff', cursor: 'pointer', fontSize: '0.8rem',
};
