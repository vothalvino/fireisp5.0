// =============================================================================
// FireISP 5.0 — CSD Certificate Viewer
// =============================================================================
// Read-only page at /csd-certificates. Lists the SAT CSD (Certificado de Sello
// Digital) certificates registered for the organization with their RFC,
// validity window and lifecycle status, highlighting certificates that are
// expired or close to expiry. Certificates are provisioned through a dedicated
// upload/parsing flow (PEM + encrypted private key), so this page is a
// visibility view and exposes no create/edit/delete actions.
// =============================================================================

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import { styles, capitalize, fmtDate } from './crudStyles';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CsdCertificate {
  id: number;
  rfc: string;
  certificate_number: string | null;
  valid_from: string | null;
  valid_to: string | null;
  is_active: number | boolean;
  status: string;
}

interface CsdResponse {
  data: CsdCertificate[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

const DEFAULT_PAGE_SIZE = 50;
const EXPIRY_WARN_DAYS = 30;

// ---------------------------------------------------------------------------
// Fetch helper
// ---------------------------------------------------------------------------

async function fetchCertificates(page: number): Promise<CsdResponse> {
  const query = { page, limit: DEFAULT_PAGE_SIZE };
  const res = await api.GET('/csd-certificates', { params: { query: query as never } });
  if (res.error) throw new Error('Failed to load CSD certificates');
  return res.data as unknown as CsdResponse;
}

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; color: string }> = {
    active: { bg: '#d1fae5', color: '#065f46' },
    expired: { bg: '#fee2e2', color: '#991b1b' },
    revoked: { bg: '#f3f4f6', color: '#374151' },
  };
  const s = map[status] ?? { bg: '#f3f4f6', color: '#374151' };
  return (
    <span
      style={{
        background: s.bg,
        color: s.color,
        padding: '2px 8px',
        borderRadius: 12,
        fontSize: '0.72rem',
        fontWeight: 600,
        textTransform: 'capitalize',
      }}
    >
      {status}
    </span>
  );
}

function expiryNote(validTo: string | null): { label: string; color: string } | null {
  if (!validTo) return null;
  const end = new Date(validTo).getTime();
  if (Number.isNaN(end)) return null;
  const days = Math.ceil((end - Date.now()) / (1000 * 60 * 60 * 24));
  if (days < 0) return { label: 'Expired', color: '#991b1b' };
  if (days <= EXPIRY_WARN_DAYS) return { label: `${days}d left`, color: '#92400e' };
  return null;
}

// ---------------------------------------------------------------------------
// CsdCertificateList component
// ---------------------------------------------------------------------------

export function CsdCertificateList() {
  const [page, setPage] = useState(1);

  const certsQ = useQuery({
    queryKey: ['csd-certificates', page],
    queryFn: () => fetchCertificates(page),
  });

  const certs = certsQ.data?.data ?? [];
  const meta = certsQ.data?.meta;
  const totalPages = meta?.totalPages ?? 1;

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.pageTitle}>📜 CSD Certificates</h1>
        {meta && <span style={styles.countBadge}>{meta.total} total</span>}
      </div>

      <div style={styles.tableCard}>
        {certsQ.isLoading ? (
          <p style={styles.msg}>Loading…</p>
        ) : certsQ.error ? (
          <p style={styles.msgError}>Failed to load CSD certificates.</p>
        ) : certs.length === 0 ? (
          <p style={styles.msg}>No CSD certificates registered.</p>
        ) : (
          <>
            <div style={{ overflowX: 'auto' }}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    {['ID', 'RFC', 'Certificate #', 'Valid From', 'Valid To', 'Active', 'Status'].map(
                      h => <th key={h} style={styles.th}>{h}</th>,
                    )}
                  </tr>
                </thead>
                <tbody>
                  {certs.map(c => {
                    const note = expiryNote(c.valid_to);
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

      <p style={{ ...styles.msg, textAlign: 'left', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
        {capitalize('certificates are provisioned through the CSD upload flow.')}
      </p>
    </div>
  );
}
