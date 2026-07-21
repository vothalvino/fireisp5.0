// =============================================================================
// FireISP 5.0 — CSD Certificates (upload + lifecycle)
// =============================================================================
// Page at /csd-certificates. Lists the SAT CSD (Certificado de Sello Digital)
// certificates for the organization, uploads new ones (raw .cer/.key +
// passphrase — parsed and validated SERVER-side), activates a certificate for
// signing (zero-downtime renewal: siblings deactivate atomically), and warns
// ahead of expiry. A CSD lasts 4 years and cannot be extended — the
// replacement comes from SAT (CertiSAT) and is uploaded here.
// =============================================================================

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, authedFetch } from '@/api/client';
import { styles, fmtDate } from './crudStyles';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CsdCertificate {
  id: number;
  rfc: string;
  certificate_number: string | null;
  issuer_name?: string | null;
  valid_from: string | null;
  valid_to: string | null;
  is_active: number | boolean;
  status: string;
}

interface CsdResponse {
  data: CsdCertificate[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

const API_BASE = '/api/v1';
const DEFAULT_PAGE_SIZE = 50;
const EXPIRY_WARN_DAYS = 60;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function fetchCertificates(page: number): Promise<CsdResponse> {
  const query = { page, limit: DEFAULT_PAGE_SIZE };
  const res = await api.GET('/csd-certificates', { params: { query: query as never } });
  if (res.error) throw new Error('Failed to load CSD certificates');
  return res.data as unknown as CsdResponse;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result || '');
      resolve(url.slice(url.indexOf(',') + 1)); // strip data:...;base64,
    };
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.readAsDataURL(file);
  });
}

function daysLeft(validTo: string | null): number | null {
  if (!validTo) return null;
  const end = new Date(validTo).getTime();
  if (Number.isNaN(end)) return null;
  return Math.ceil((end - Date.now()) / (1000 * 60 * 60 * 24));
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; color: string }> = {
    active: { bg: '#d1fae5', color: '#065f46' },
    expired: { bg: '#fee2e2', color: '#991b1b' },
    revoked: { bg: '#f3f4f6', color: '#374151' },
  };
  const s = map[status] ?? { bg: '#f3f4f6', color: '#374151' };
  return (
    <span style={{ background: s.bg, color: s.color, padding: '2px 8px', borderRadius: 12, fontSize: '0.72rem', fontWeight: 600, textTransform: 'capitalize' }}>
      {status}
    </span>
  );
}

function expiryNote(validTo: string | null): { label: string; color: string } | null {
  const days = daysLeft(validTo);
  if (days === null) return null;
  if (days < 0) return { label: 'Expired', color: '#991b1b' };
  if (days <= EXPIRY_WARN_DAYS) return { label: `${days}d left`, color: days <= 7 ? '#991b1b' : '#92400e' };
  return null;
}

// ---------------------------------------------------------------------------
// CsdCertificateList component
// ---------------------------------------------------------------------------

export function CsdCertificateList() {
  const [page, setPage] = useState(1);
  const [cerFile, setCerFile] = useState<File | null>(null);
  const [keyFile, setKeyFile] = useState<File | null>(null);
  const [passphrase, setPassphrase] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [formOk, setFormOk] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const certsQ = useQuery({
    queryKey: ['csd-certificates', page],
    queryFn: () => fetchCertificates(page),
  });

  const uploadM = useMutation({
    mutationFn: async () => {
      if (!cerFile || !keyFile || !passphrase) throw new Error('Select the .cer and .key files and enter the key passphrase.');
      const [cer_b64, key_b64] = await Promise.all([fileToBase64(cerFile), fileToBase64(keyFile)]);
      const res = await authedFetch(`${API_BASE}/csd-certificates`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cer_b64, key_b64, passphrase }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error?.message || 'Upload failed');
      return json as { data: CsdCertificate & { is_test_certificate?: boolean } };
    },
    onSuccess: (r) => {
      setFormOk(
        `Certificate ${r.data.certificate_number} uploaded${r.data.is_test_certificate ? ' (SAT TEST certificate — sandbox only)' : ''}.`
        + (r.data.is_active ? ' It is now the active signing certificate.' : ' Activate it when ready to switch.'),
      );
      setFormError(null);
      setCerFile(null); setKeyFile(null); setPassphrase('');
      queryClient.invalidateQueries({ queryKey: ['csd-certificates'] });
    },
    onError: (e: Error) => { setFormError(e.message); setFormOk(null); },
  });

  const activateM = useMutation({
    mutationFn: async (id: number) => {
      const res = await authedFetch(`${API_BASE}/csd-certificates/${id}/activate`, { method: 'POST' });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json?.error?.message || 'Activation failed');
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['csd-certificates'] }),
    onError: (e: Error) => { setFormError(e.message); setFormOk(null); },
  });

  const certs = certsQ.data?.data ?? [];
  const meta = certsQ.data?.meta;
  const totalPages = meta?.totalPages ?? 1;

  // Banner: the ACTIVE certificate is inside the warning window (or missing).
  const active = certs.find(c => c.is_active && c.status === 'active');
  const activeDays = active ? daysLeft(active.valid_to) : null;
  const banner = !certsQ.isLoading && certs.length > 0 && (
    !active
      ? { color: '#991b1b', bg: '#fee2e2', text: 'No active CSD — stamping cannot sign. Upload and activate a certificate.' }
      : activeDays !== null && activeDays <= EXPIRY_WARN_DAYS
        ? {
          color: activeDays <= 7 ? '#991b1b' : '#92400e',
          bg: activeDays <= 7 ? '#fee2e2' : '#fef3c7',
          text: `The active CSD expires in ${activeDays} days (${active.valid_to ? fmtDate(active.valid_to) : ''}). `
              + 'Request its replacement from SAT (CertiSAT with your e.firma), upload it here and activate it — the switch has no downtime.',
        }
        : null
  );

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.pageTitle}>📜 CSD Certificates</h1>
        {meta && <span style={styles.countBadge}>{meta.total} total</span>}
      </div>

      {banner && (
        <div style={{ background: banner.bg, color: banner.color, padding: '10px 14px', borderRadius: 8, marginBottom: 14, fontSize: '0.85rem', fontWeight: 500 }}>
          ⚠️ {banner.text}
        </div>
      )}

      {/* Upload */}
      <div style={{ ...styles.tableCard, marginBottom: 16, padding: 16 }}>
        <h3 style={{ margin: '0 0 10px', fontSize: '0.95rem' }}>Upload a CSD (.cer + .key)</h3>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <label style={{ fontSize: '0.8rem' }}>
            .cer{' '}
            <input type="file" accept=".cer" onChange={e => setCerFile(e.target.files?.[0] ?? null)} />
          </label>
          <label style={{ fontSize: '0.8rem' }}>
            .key{' '}
            <input type="file" accept=".key" onChange={e => setKeyFile(e.target.files?.[0] ?? null)} />
          </label>
          <input
            type="password"
            placeholder="Key passphrase"
            value={passphrase}
            onChange={e => setPassphrase(e.target.value)}
            style={{ padding: '6px 10px', border: '1px solid var(--border, #d1d5db)', borderRadius: 6, fontSize: '0.85rem' }}
          />
          <button
            style={styles.pageBtn}
            disabled={uploadM.isPending || !cerFile || !keyFile || !passphrase}
            onClick={() => uploadM.mutate()}
          >
            {uploadM.isPending ? 'Validating…' : 'Upload'}
          </button>
        </div>
        <p style={{ margin: '8px 0 0', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
          The files are validated server-side: the pair must match, the passphrase must open the key, and the
          RFC must equal the organization&apos;s fiscal RFC. The private key is stored encrypted.
        </p>
        {formError && <p style={{ ...styles.msgError, textAlign: 'left', marginTop: 8 }}>{formError}</p>}
        {formOk && <p style={{ ...styles.msg, textAlign: 'left', marginTop: 8, color: '#065f46' }}>{formOk}</p>}
      </div>

      <div style={styles.tableCard}>
        {certsQ.isLoading ? (
          <p style={styles.msg}>Loading…</p>
        ) : certsQ.error ? (
          <p style={styles.msgError}>Failed to load CSD certificates.</p>
        ) : certs.length === 0 ? (
          <p style={styles.msg}>No CSD certificates registered — upload the organization&apos;s .cer/.key above.</p>
        ) : (
          <>
            <div style={{ overflowX: 'auto' }}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    {['ID', 'RFC', 'Certificate #', 'Valid From', 'Valid To', 'Active', 'Status', ''].map(
                      (h, i) => <th key={i} style={styles.th}>{h}</th>,
                    )}
                  </tr>
                </thead>
                <tbody>
                  {certs.map(c => {
                    const note = expiryNote(c.valid_to);
                    const activatable = !c.is_active && c.status === 'active' && (daysLeft(c.valid_to) ?? -1) > 0;
                    return (
                      <tr key={c.id} style={styles.tr}>
                        <td style={styles.td}>#{c.id}</td>
                        <td style={{ ...styles.td, fontWeight: 500 }}>{c.rfc}</td>
                        <td style={{ ...styles.td, fontFamily: 'monospace' }}>{c.certificate_number ?? '—'}</td>
                        <td style={{ ...styles.td, whiteSpace: 'nowrap' }}>{c.valid_from ? fmtDate(c.valid_from) : '—'}</td>
                        <td style={{ ...styles.td, whiteSpace: 'nowrap' }}>
                          {c.valid_to ? fmtDate(c.valid_to) : '—'}
                          {note && (
                            <span style={{ marginLeft: 6, color: note.color, fontWeight: 600, fontSize: '0.72rem' }}>
                              {note.label}
                            </span>
                          )}
                        </td>
                        <td style={styles.td}>{c.is_active ? '✅' : '—'}</td>
                        <td style={styles.td}><StatusBadge status={c.status} /></td>
                        <td style={styles.td}>
                          {activatable && (
                            <button
                              style={{ ...styles.pageBtn, fontSize: '0.75rem' }}
                              disabled={activateM.isPending}
                              onClick={() => activateM.mutate(c.id)}
                            >
                              Activate
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
                <button
                  style={styles.pageBtn}
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                >
                  Next →
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
