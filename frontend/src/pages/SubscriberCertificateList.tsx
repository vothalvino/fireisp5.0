// =============================================================================
// FireISP 5.0 — Subscriber Certificate List
// =============================================================================
// Page at /subscriber-certificates. Lists EAP-TLS subscriber certificates
// registered in FireISP (§3.1 item 6).
//
// NOTE: FireISP is a metadata registry only — it does NOT generate or sign
// certificates. Certificates are issued by an external CA (easy-rsa, step-ca,
// HashiCorp Vault PKI, or a commercial CA). Only metadata (CN, serial,
// fingerprint, validity dates) is stored here.
//
// Features:
//   • List view with status badges and expiry highlighting
//   • Issue (create) new certificate metadata record
//   • Revoke an active certificate
// =============================================================================

import { useState, type CSSProperties, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { tokenStore } from '@/api/client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SubscriberCertificate {
  id: number;
  organization_id: number | null;
  radius_account_id: number | null;
  client_id: number | null;
  common_name: string;
  serial_number: string;
  fingerprint_sha256: string;
  valid_from: string;
  valid_until: string;
  status: 'active' | 'revoked' | 'expired';
  revoked_at: string | null;
  revocation_reason: string | null;
  created_at: string;
}

interface CertListResponse {
  data: SubscriberCertificate[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

interface CreateCertPayload {
  common_name: string;
  serial_number: string;
  fingerprint_sha256: string;
  valid_from: string;
  valid_until: string;
  radius_account_id?: number;
  client_id?: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PAGE_SIZE = 50;
const API_BASE = '/api/v1';
const EXPIRY_WARN_DAYS = 30;

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = tokenStore.getAccess();
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error || `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

async function fetchCerts(page: number): Promise<CertListResponse> {
  return apiFetch<CertListResponse>(`/subscriber-certificates?page=${page}&limit=${PAGE_SIZE}`);
}

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; color: string }> = {
    active: { bg: '#d1fae5', color: '#065f46' },
    expired: { bg: '#fee2e2', color: '#991b1b' },
    revoked: { bg: '#f3f4f6', color: '#6b7280' },
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

function expiryWarning(validUntil: string, status: string): string | null {
  if (status !== 'active') return null;
  const daysLeft = Math.floor((new Date(validUntil).getTime() - Date.now()) / 86400000);
  if (daysLeft < 0) return 'Expired';
  if (daysLeft <= EXPIRY_WARN_DAYS) return `Expires in ${daysLeft}d`;
  return null;
}

function fmtDate(iso: string): string {
  return iso ? new Date(iso).toLocaleDateString() : '—';
}

// ---------------------------------------------------------------------------
// Issue form modal
// ---------------------------------------------------------------------------

interface IssueFormProps {
  onClose: () => void;
  onSuccess: () => void;
}

function IssueForm({ onClose, onSuccess }: IssueFormProps) {
  const [form, setForm] = useState<CreateCertPayload>({
    common_name: '',
    serial_number: '',
    fingerprint_sha256: '',
    valid_from: '',
    valid_until: '',
  });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (form.fingerprint_sha256.length !== 64) {
      setError('fingerprint_sha256 must be exactly 64 hex characters');
      return;
    }
    setSaving(true);
    try {
      await apiFetch('/subscriber-certificates', {
        method: 'POST',
        body: JSON.stringify(form),
      });
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create certificate');
    } finally {
      setSaving(false);
    }
  }

  function field(label: string, key: keyof CreateCertPayload, type = 'text', required = false) {
    return (
      <div style={s.field}>
        <label style={s.label}>{label}{required && ' *'}</label>
        <input
          type={type}
          value={String(form[key] ?? '')}
          onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
          style={s.input}
          required={required}
        />
      </div>
    );
  }

  return (
    <div style={s.overlay}>
      <div style={s.dialog}>
        <h3 style={s.dialogTitle}>Register Certificate</h3>
        <p style={s.note}>
          FireISP is a metadata registry only — it does not generate or sign certificates.
          Issue the certificate from your CA (easy-rsa, step-ca, etc.) and paste the
          metadata below.
        </p>
        <form onSubmit={handleSubmit}>
          {field('Common Name (CN)', 'common_name', 'text', true)}
          {field('Serial Number', 'serial_number', 'text', true)}
          {field('SHA-256 Fingerprint (64 hex chars)', 'fingerprint_sha256', 'text', true)}
          {field('Valid From', 'valid_from', 'datetime-local', true)}
          {field('Valid Until', 'valid_until', 'datetime-local', true)}
          {field('RADIUS Account ID (optional)', 'radius_account_id')}
          {field('Client ID (optional)', 'client_id')}
          {error && <p style={s.errorText}>{error}</p>}
          <div style={s.dialogActions}>
            <button type="button" onClick={onClose} style={s.cancelBtn} disabled={saving}>Cancel</button>
            <button type="submit" style={s.confirmBtn} disabled={saving}>
              {saving ? 'Saving…' : 'Register'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SubscriberCertificateList() {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [showIssue, setShowIssue] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<SubscriberCertificate | null>(null);
  const [revokeReason, setRevokeReason] = useState('');
  const [revokeError, setRevokeError] = useState('');
  const [revoking, setRevoking] = useState(false);

  const { data, isLoading, error } = useQuery<CertListResponse>({
    queryKey: ['subscriber-certificates', page],
    queryFn: () => fetchCerts(page),
  });

  const certs = data?.data ?? [];
  const total = data?.meta?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  async function handleRevoke() {
    if (!revokeTarget) return;
    setRevoking(true);
    setRevokeError('');
    try {
      await apiFetch(`/subscriber-certificates/${revokeTarget.id}/revoke`, {
        method: 'POST',
        body: JSON.stringify({ revocation_reason: revokeReason }),
      });
      qc.invalidateQueries({ queryKey: ['subscriber-certificates'] });
      setRevokeTarget(null);
      setRevokeReason('');
    } catch (err) {
      setRevokeError(err instanceof Error ? err.message : 'Revocation failed');
    } finally {
      setRevoking(false);
    }
  }

  return (
    <div style={s.page}>
      <div style={s.header}>
        <h1 style={s.title}>Subscriber Certificates</h1>
        <button onClick={() => setShowIssue(true)} style={s.issueBtn}>
          + Register Certificate
        </button>
      </div>

      <p style={s.subtitle}>
        EAP-TLS subscriber certificate registry. FireISP stores certificate metadata only —
        certificates are issued and signed by your external CA.
      </p>

      {isLoading && <p style={s.loading}>Loading…</p>}
      {error && <p style={s.errorText}>Failed to load certificates.</p>}

      {!isLoading && certs.length === 0 && (
        <p style={s.empty}>No subscriber certificates registered. Use the button above to register a certificate.</p>
      )}

      {certs.length > 0 && (
        <div style={s.tableWrap}>
          <table style={s.table}>
            <thead>
              <tr>
                <th style={s.th}>Common Name</th>
                <th style={s.th}>Serial</th>
                <th style={s.th}>Valid From</th>
                <th style={s.th}>Valid Until</th>
                <th style={s.th}>Status</th>
                <th style={s.th}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {certs.map(cert => {
                const warn = expiryWarning(cert.valid_until, cert.status);
                return (
                  <tr key={cert.id} style={s.tr}>
                    <td style={s.td}>{cert.common_name}</td>
                    <td style={{ ...s.td, fontFamily: 'monospace', fontSize: '0.78rem' }}>
                      {cert.serial_number}
                    </td>
                    <td style={s.td}>{fmtDate(cert.valid_from)}</td>
                    <td style={s.td}>
                      {fmtDate(cert.valid_until)}
                      {warn && (
                        <span style={{ marginLeft: 6, color: '#c0392b', fontSize: '0.75rem', fontWeight: 600 }}>
                          {warn}
                        </span>
                      )}
                    </td>
                    <td style={s.td}><StatusBadge status={cert.status} /></td>
                    <td style={s.td}>
                      {cert.status === 'active' && (
                        <button
                          onClick={() => { setRevokeTarget(cert); setRevokeError(''); setRevokeReason(''); }}
                          style={s.revokeBtn}
                        >
                          Revoke
                        </button>
                      )}
                      {cert.status === 'revoked' && cert.revocation_reason && (
                        <span style={{ fontSize: '0.75rem', color: '#6b7280' }}>
                          {cert.revocation_reason}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 && (
        <div style={s.pagination}>
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1} style={s.pageBtn}>
            Prev
          </button>
          <span style={s.pageInfo}>Page {page} / {totalPages} ({total} total)</span>
          <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages} style={s.pageBtn}>
            Next
          </button>
        </div>
      )}

      {showIssue && (
        <IssueForm
          onClose={() => setShowIssue(false)}
          onSuccess={() => {
            setShowIssue(false);
            qc.invalidateQueries({ queryKey: ['subscriber-certificates'] });
          }}
        />
      )}

      {revokeTarget && (
        <div style={s.overlay}>
          <div style={s.dialog}>
            <h3 style={s.dialogTitle}>Revoke Certificate</h3>
            <p style={s.dialogBody}>
              Revoke certificate for <strong>{revokeTarget.common_name}</strong>?
              <br />Serial: <code>{revokeTarget.serial_number}</code>
            </p>
            <div style={s.field}>
              <label style={s.label}>Reason (optional)</label>
              <input
                type="text"
                value={revokeReason}
                onChange={e => setRevokeReason(e.target.value)}
                style={s.input}
                placeholder="e.g. Key compromised"
              />
            </div>
            {revokeError && <p style={s.errorText}>{revokeError}</p>}
            <div style={s.dialogActions}>
              <button onClick={() => setRevokeTarget(null)} style={s.cancelBtn} disabled={revoking}>Cancel</button>
              <button onClick={handleRevoke} style={{ ...s.confirmBtn, background: '#dc2626' }} disabled={revoking}>
                {revoking ? 'Revoking…' : 'Revoke'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const s: Record<string, CSSProperties> = {
  page: { padding: '1.5rem', fontFamily: 'var(--font-sans)', fontSize: '0.9rem' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' },
  title: { margin: 0, fontSize: '1.4rem' },
  subtitle: { margin: '0 0 1.25rem', color: 'var(--text-muted)', fontSize: '0.82rem' },
  issueBtn: {
    padding: '7px 16px', background: 'var(--accent)', color: '#fff',
    border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: '0.85rem',
  },
  loading: { color: 'var(--text-faint)', fontStyle: 'italic' },
  empty: { color: 'var(--text-faint)', fontStyle: 'italic', marginTop: '2rem', textAlign: 'center' },
  tableWrap: { overflowX: 'auto', background: 'var(--bg-card)', borderRadius: 8, boxShadow: '0 0 0 1px var(--border)' },
  table: { width: '100%', borderCollapse: 'collapse' },
  th: { padding: '0.65rem 0.9rem', background: '#f0f2f8', borderBottom: '2px solid #e0e3ef', textAlign: 'left', fontWeight: 600, fontSize: '0.82rem', whiteSpace: 'nowrap' },
  tr: {},
  td: { padding: '0.6rem 0.9rem', borderBottom: '1px solid #f0f2f8', verticalAlign: 'middle' },
  revokeBtn: {
    padding: '3px 10px', background: 'transparent', border: '1px solid #dc2626', color: '#dc2626',
    borderRadius: 4, cursor: 'pointer', fontSize: '0.75rem',
  },
  pagination: { display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '1rem', marginTop: '1rem' },
  pageBtn: { padding: '6px 14px', background: 'var(--bg-subtle)', border: '1px solid var(--border)', borderRadius: 4, cursor: 'pointer', fontSize: '0.85rem' },
  pageInfo: { color: 'var(--text-muted)', fontSize: '0.85rem' },
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  dialog: { background: 'var(--bg-card)', borderRadius: 8, padding: '1.5rem 2rem', width: 480, maxWidth: '92vw', boxShadow: '0 8px 32px rgba(0,0,0,.2)' },
  dialogTitle: { margin: '0 0 0.75rem', fontSize: '1.1rem' },
  dialogBody: { margin: '0 0 1rem', lineHeight: 1.5 },
  note: { margin: '0 0 1rem', fontSize: '0.8rem', color: 'var(--text-muted)', lineHeight: 1.4, background: '#f9fafb', padding: '0.6rem 0.8rem', borderRadius: 4, borderLeft: '3px solid var(--accent)' },
  dialogActions: { display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '1rem' },
  cancelBtn: { padding: '7px 16px', background: 'var(--bg-subtle)', border: '1px solid var(--border)', borderRadius: 4, cursor: 'pointer', fontSize: '0.85rem' },
  confirmBtn: { padding: '7px 16px', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: '0.85rem' },
  field: { marginBottom: '0.9rem' },
  label: { display: 'block', fontSize: '0.78rem', fontWeight: 600, marginBottom: 4, color: 'var(--text-secondary)' },
  input: { width: '100%', boxSizing: 'border-box', padding: '7px 10px', border: '1px solid var(--input-border)', borderRadius: 4, fontSize: '0.85rem' },
  errorText: { color: '#c0392b', fontSize: '0.82rem', margin: '0 0 0.5rem' },
};
