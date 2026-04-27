// =============================================================================
// FireISP 5.0 — Client List
// =============================================================================
// Searchable, paginated table of all clients.
// Links to /clients/:id for the detail view.
// =============================================================================

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Client {
  id: number;
  name: string;
  email: string;
  phone: string | null;
  client_type: string;
  status: string;
  city: string | null;
  state: string | null;
  country: string | null;
  created_at: string;
}

interface ClientsResponse {
  data: Client[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

// ---------------------------------------------------------------------------
// Fetch
// ---------------------------------------------------------------------------

const PAGE_SIZE = 20;

async function fetchClients(page: number, search: string): Promise<ClientsResponse> {
  const params: Record<string, string | number> = { page, limit: PAGE_SIZE };
  if (!search) {
    const res = await api.GET('/clients', { params: { query: params as never } });
    if (res.error) throw new Error('Failed to load clients');
    return res.data as unknown as ClientsResponse;
  }
  // Fetch a large page then filter client-side by name/email/city.
  // The backend list endpoint supports only exact-match column filters, not
  // LIKE/full-text search, so client-side filtering is necessary here.
  // The limit of 500 covers typical single-ISP deployments; if the client
  // base grows larger, server-side search should be added to the API.
  const res = await api.GET('/clients', {
    params: { query: { page: 1, limit: 500 } as never },
  });
  if (res.error) throw new Error('Failed to load clients');
  const all = res.data as unknown as ClientsResponse;
  const term = search.toLowerCase();
  const filtered = all.data.filter(
    c =>
      c.name.toLowerCase().includes(term) ||
      (c.email || '').toLowerCase().includes(term) ||
      (c.city || '').toLowerCase().includes(term),
  );
  return {
    data: filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    meta: {
      total: filtered.length,
      page,
      limit: PAGE_SIZE,
      totalPages: Math.ceil(filtered.length / PAGE_SIZE),
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function statusBadge(status: string) {
  const map: Record<string, { bg: string; color: string }> = {
    active:    { bg: '#d1fae5', color: '#065f46' },
    suspended: { bg: '#fef3c7', color: '#92400e' },
    inactive:  { bg: '#f3f4f6', color: '#6b7280' },
    cancelled: { bg: '#fee2e2', color: '#991b1b' },
  };
  const style = map[status] ?? { bg: '#f3f4f6', color: '#374151' };
  return (
    <span
      style={{
        background: style.bg,
        color: style.color,
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

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ClientList() {
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');

  const { data, isLoading, error } = useQuery({
    queryKey: ['clients', page, search],
    queryFn: () => fetchClients(page, search),
  });

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setPage(1);
    setSearch(searchInput.trim());
  }

  function handleClear() {
    setSearchInput('');
    setSearch('');
    setPage(1);
  }

  const clients = data?.data ?? [];
  const meta = data?.meta;

  return (
    <div style={styles.page}>
      {/* Header */}
      <div style={styles.header}>
        <h1 style={styles.pageTitle}>👥 Clients</h1>
        {meta && (
          <span style={styles.countBadge}>{meta.total} total</span>
        )}
      </div>

      {/* Search bar */}
      <form onSubmit={handleSearch} style={styles.searchRow}>
        <input
          style={styles.searchInput}
          type="text"
          placeholder="Search by name, email or city…"
          value={searchInput}
          onChange={e => setSearchInput(e.target.value)}
        />
        <button type="submit" style={styles.btnPrimary}>Search</button>
        {search && (
          <button type="button" onClick={handleClear} style={styles.btnSecondary}>
            Clear
          </button>
        )}
      </form>

      {/* Table */}
      <div style={styles.tableCard}>
        {isLoading ? (
          <p style={styles.msg}>Loading…</p>
        ) : error ? (
          <p style={styles.msgError}>Failed to load clients.</p>
        ) : clients.length === 0 ? (
          <p style={styles.msg}>No clients found.</p>
        ) : (
          <>
            <div style={{ overflowX: 'auto' }}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    {['Name', 'Email', 'Phone', 'Type', 'Location', 'Status', ''].map(h => (
                      <th key={h} style={styles.th}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {clients.map(c => (
                    <tr key={c.id} style={styles.tr}>
                      <td style={{ ...styles.td, fontWeight: 600 }}>
                        <Link to={`/clients/${c.id}`} style={styles.nameLink}>
                          {c.name}
                        </Link>
                      </td>
                      <td style={styles.td}>{c.email || '—'}</td>
                      <td style={styles.td}>{c.phone || '—'}</td>
                      <td style={{ ...styles.td, textTransform: 'capitalize' }}>
                        {c.client_type || '—'}
                      </td>
                      <td style={styles.td}>
                        {[c.city, c.state].filter(Boolean).join(', ') || '—'}
                      </td>
                      <td style={styles.td}>{statusBadge(c.status)}</td>
                      <td style={styles.td}>
                        <Link to={`/clients/${c.id}`} style={styles.viewLink}>
                          View →
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {meta && meta.totalPages > 1 && (
              <div style={styles.pagination}>
                <button
                  style={styles.pageBtn}
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                >
                  ← Prev
                </button>
                <span style={styles.pageInfo}>
                  Page {page} of {meta.totalPages}
                </span>
                <button
                  style={styles.pageBtn}
                  onClick={() => setPage(p => Math.min(meta.totalPages, p + 1))}
                  disabled={page === meta.totalPages}
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

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = {
  page: {
    padding: '2rem',
    fontFamily: 'system-ui, sans-serif',
    maxWidth: 1200,
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.75rem',
    marginBottom: '1.25rem',
  },
  pageTitle: { margin: 0, color: 'var(--text-primary)', fontSize: '1.5rem', fontWeight: 700 },
  countBadge: {
    background: '#e0e7ff',
    color: '#3730a3',
    padding: '2px 10px',
    borderRadius: 12,
    fontSize: '0.78rem',
    fontWeight: 600,
  },
  searchRow: {
    display: 'flex',
    gap: '0.5rem',
    marginBottom: '1rem',
  },
  searchInput: {
    flex: 1,
    maxWidth: 380,
    padding: '0.5rem 0.75rem',
    border: '1px solid var(--input-border)',
    borderRadius: 6,
    fontSize: '0.9rem',
    outline: 'none',
  },
  btnPrimary: {
    padding: '0.5rem 1rem',
    background: '#e25822',
    color: '#fff',
    border: 'none',
    borderRadius: 6,
    cursor: 'pointer',
    fontSize: '0.85rem',
    fontWeight: 600,
  },
  btnSecondary: {
    padding: '0.5rem 1rem',
    background: 'transparent',
    color: 'var(--text-muted)',
    border: '1px solid var(--border-strong)',
    borderRadius: 6,
    cursor: 'pointer',
    fontSize: '0.85rem',
  },
  tableCard: {
    background: 'var(--bg-card)',
    borderRadius: 8,
    boxShadow: '0 1px 3px rgba(0,0,0,.08)',
    padding: '0.5rem 0',
  },
  table: { width: '100%', borderCollapse: 'collapse' as const, fontSize: '0.85rem' },
  th: {
    padding: '0.6rem 0.75rem',
    textAlign: 'left' as const,
    color: 'var(--text-muted)',
    fontSize: '0.75rem',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.04em',
    borderBottom: '2px solid var(--border-subtle)',
    whiteSpace: 'nowrap' as const,
  },
  tr: { borderBottom: '1px solid var(--border-subtle)' },
  td: { padding: '0.65rem 0.75rem', color: 'var(--text-secondary)', verticalAlign: 'middle' as const },
  nameLink: {
    color: '#1d4ed8',
    textDecoration: 'none',
    fontWeight: 600,
  },
  viewLink: {
    color: '#e25822',
    textDecoration: 'none',
    fontWeight: 600,
    fontSize: '0.82rem',
    whiteSpace: 'nowrap' as const,
  },
  msg: { padding: '2rem 1.5rem', color: 'var(--text-muted)', fontStyle: 'italic' as const, margin: 0 },
  msgError: { padding: '2rem 1.5rem', color: '#ef4444', margin: 0 },
  pagination: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.75rem',
    padding: '0.75rem 1rem',
    borderTop: '1px solid var(--border-subtle)',
    marginTop: 4,
  },
  pageBtn: {
    padding: '0.35rem 0.85rem',
    border: '1px solid var(--border-strong)',
    borderRadius: 5,
    background: 'var(--bg-card)',
    cursor: 'pointer',
    fontSize: '0.82rem',
    color: 'var(--text-secondary)',
  },
  pageInfo: { color: 'var(--text-muted)', fontSize: '0.82rem' },
};
