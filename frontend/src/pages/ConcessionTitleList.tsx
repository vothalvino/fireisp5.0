// =============================================================================
// FireISP 5.0 — Concession Title Viewer
// =============================================================================
// Read-only page at /concession-titles. Lists the IFT/CRT concession titles
// (official authorizations to provide telecom services) with their type,
// regulatory body, validity window and lifecycle status. The model fillable
// list, validation schema and table columns are not yet aligned for create /
// edit, so this is a visibility/list view and exposes no mutations.
// =============================================================================

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import { styles } from './crudStyles';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ConcessionTitle {
  id: number;
  title_number: string;
  concession_type: string | null;
  regulatory_body: string | null;
  granted_date: string | null;
  expiration_date: string | null;
  status: string;
}

interface ConcessionTitleResponse {
  data: ConcessionTitle[];
  meta: { total: number; page: number; limit: number; totalPages?: number };
}

const DEFAULT_PAGE_SIZE = 50;

// ---------------------------------------------------------------------------
// Fetch helper
// ---------------------------------------------------------------------------

async function fetchConcessionTitles(page: number): Promise<ConcessionTitleResponse> {
  const query = { page, limit: DEFAULT_PAGE_SIZE };
  const res = await api.GET('/concession-titles', { params: { query: query as never } });
  if (res.error) throw new Error('Failed to load concession titles');
  return res.data as unknown as ConcessionTitleResponse;
}

// ---------------------------------------------------------------------------
// Badges
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; color: string }> = {
    active: { bg: '#d1fae5', color: '#065f46' },
    expired: { bg: '#fee2e2', color: '#991b1b' },
    revoked: { bg: '#fee2e2', color: '#991b1b' },
    pending_renewal: { bg: '#fef3c7', color: '#92400e' },
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
      {status.replace(/_/g, ' ')}
    </span>
  );
}

// ---------------------------------------------------------------------------
// ConcessionTitleList component
// ---------------------------------------------------------------------------

export function ConcessionTitleList() {
  const [page, setPage] = useState(1);

  const titlesQ = useQuery({
    queryKey: ['concession-titles', page],
    queryFn: () => fetchConcessionTitles(page),
  });

  const titles = titlesQ.data?.data ?? [];
  const meta = titlesQ.data?.meta;
  const totalPages = meta?.totalPages ?? (meta ? Math.max(1, Math.ceil(meta.total / meta.limit)) : 1);

  const fmtDate = (d: string | null) => (d ? d.slice(0, 10) : '—');

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.pageTitle}>📑 Concession Titles</h1>
        {meta && <span style={styles.countBadge}>{meta.total} total</span>}
      </div>

      <div style={styles.tableCard}>
        {titlesQ.isLoading ? (
          <p style={styles.msg}>Loading…</p>
        ) : titlesQ.error ? (
          <p style={styles.msgError}>Failed to load concession titles.</p>
        ) : titles.length === 0 ? (
          <p style={styles.msg}>No concession titles registered.</p>
        ) : (
          <>
            <div style={{ overflowX: 'auto' }}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    {['ID', 'Title Number', 'Type', 'Regulator', 'Granted', 'Expires', 'Status'].map(
                      h => <th key={h} style={styles.th}>{h}</th>,
                    )}
                  </tr>
                </thead>
                <tbody>
                  {titles.map(t => (
                    <tr key={t.id} style={styles.tr}>
                      <td style={styles.td}>#{t.id}</td>
                      <td style={{ ...styles.td, fontWeight: 500 }}>{t.title_number}</td>
                      <td style={{ ...styles.td, textTransform: 'capitalize' }}>
                        {t.concession_type ? t.concession_type.replace(/_/g, ' ') : '—'}
                      </td>
                      <td style={styles.td}>{t.regulatory_body ?? '—'}</td>
                      <td style={styles.td}>{fmtDate(t.granted_date)}</td>
                      <td style={styles.td}>{fmtDate(t.expiration_date)}</td>
                      <td style={styles.td}><StatusBadge status={t.status} /></td>
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
