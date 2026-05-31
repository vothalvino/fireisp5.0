// =============================================================================
// FireISP 5.0 — PAC Provider Viewer
// =============================================================================
// Read-only page at /pac-providers. Lists the PAC (Proveedor Autorizado de
// Certificación) configurations registered for the organization with their
// vendor, environment, endpoint and status. PAC credentials are encrypted at
// rest and managed through a dedicated secure flow, so this page is a
// visibility view and exposes no create/edit/delete actions.
// =============================================================================

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import { styles, capitalize, fmtDate } from './crudStyles';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PacProvider {
  id: number;
  provider_name: string;
  label: string | null;
  environment: string;
  api_url: string | null;
  is_default: number | boolean;
  status: string;
  last_stamp_at: string | null;
}

interface PacResponse {
  data: PacProvider[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

const DEFAULT_PAGE_SIZE = 50;

// ---------------------------------------------------------------------------
// Fetch helper
// ---------------------------------------------------------------------------

async function fetchProviders(page: number): Promise<PacResponse> {
  const query = { page, limit: DEFAULT_PAGE_SIZE };
  const res = await api.GET('/pac-providers', { params: { query: query as never } });
  if (res.error) throw new Error('Failed to load PAC providers');
  return res.data as unknown as PacResponse;
}

// ---------------------------------------------------------------------------
// Badges
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; color: string }> = {
    active: { bg: '#d1fae5', color: '#065f46' },
    inactive: { bg: '#f3f4f6', color: '#374151' },
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

function EnvBadge({ env }: { env: string }) {
  const isProd = env === 'production';
  return (
    <span
      style={{
        background: isProd ? '#fee2e2' : '#dbeafe',
        color: isProd ? '#991b1b' : '#1e40af',
        padding: '2px 8px',
        borderRadius: 12,
        fontSize: '0.72rem',
        fontWeight: 600,
        textTransform: 'capitalize',
      }}
    >
      {env}
    </span>
  );
}

// ---------------------------------------------------------------------------
// PacProviderList component
// ---------------------------------------------------------------------------

export function PacProviderList() {
  const [page, setPage] = useState(1);

  const providersQ = useQuery({
    queryKey: ['pac-providers', page],
    queryFn: () => fetchProviders(page),
  });

  const providers = providersQ.data?.data ?? [];
  const meta = providersQ.data?.meta;
  const totalPages = meta?.totalPages ?? 1;

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.pageTitle}>🧾 PAC Providers</h1>
        {meta && <span style={styles.countBadge}>{meta.total} total</span>}
      </div>

      <div style={styles.tableCard}>
        {providersQ.isLoading ? (
          <p style={styles.msg}>Loading…</p>
        ) : providersQ.error ? (
          <p style={styles.msgError}>Failed to load PAC providers.</p>
        ) : providers.length === 0 ? (
          <p style={styles.msg}>No PAC providers configured.</p>
        ) : (
          <>
            <div style={{ overflowX: 'auto' }}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    {['ID', 'Provider', 'Label', 'Environment', 'API URL', 'Default', 'Status', 'Last Stamp'].map(
                      h => <th key={h} style={styles.th}>{h}</th>,
                    )}
                  </tr>
                </thead>
                <tbody>
                  {providers.map(p => (
                    <tr key={p.id} style={styles.tr}>
                      <td style={styles.td}>#{p.id}</td>
                      <td style={{ ...styles.td, fontWeight: 500, textTransform: 'capitalize' }}>
                        {p.provider_name?.replace(/_/g, ' ')}
                      </td>
                      <td style={styles.td}>{p.label ?? '—'}</td>
                      <td style={styles.td}><EnvBadge env={p.environment} /></td>
                      <td style={{ ...styles.td, maxWidth: 280, overflowWrap: 'anywhere', fontFamily: 'monospace', fontSize: '0.78rem' }}>
                        {p.api_url ?? '—'}
                      </td>
                      <td style={styles.td}>{p.is_default ? '⭐' : '—'}</td>
                      <td style={styles.td}><StatusBadge status={p.status} /></td>
                      <td style={{ ...styles.td, whiteSpace: 'nowrap' }}>{p.last_stamp_at ? fmtDate(p.last_stamp_at) : '—'}</td>
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

      <p style={{ ...styles.msg, textAlign: 'left', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
        {capitalize('pac credentials are managed through the secure configuration flow.')}
      </p>
    </div>
  );
}
