// =============================================================================
// FireISP 5.0 — Client List
// =============================================================================
// Searchable, paginated table of all clients with full CRUD:
//   • "New Client" button → create modal
//   • Per-row Edit → update modal (PUT /clients/:id)
//   • Per-row Delete (soft-delete) with confirmation (DELETE /clients/:id)
//   • "Show archived" toggle reveals soft-deleted clients with a Restore action
//     (POST /clients/:id/restore)
// Links to /clients/:id for the detail view.
// =============================================================================

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { useAuth } from '@/auth/AuthContext';
import { can } from '@/auth/permissions';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Client {
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
  client_type: string;
  status: string;
  tax_id: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip_code: string | null;
  country: string | null;
  locale: string | null;
  deleted_at: string | null;
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

async function fetchClients(
  page: number,
  search: string,
  includeDeleted: boolean,
): Promise<ClientsResponse> {
  const baseQuery: Record<string, string | number> = { page, limit: PAGE_SIZE };
  if (includeDeleted) baseQuery.include_deleted = 'true';

  if (!search) {
    const res = await api.GET('/clients', { params: { query: baseQuery as never } });
    if (res.error) throw new Error('Failed to load clients');
    return res.data as unknown as ClientsResponse;
  }
  // Fetch a large page then filter client-side by name/email/city.
  // The backend list endpoint supports only exact-match column filters, not
  // LIKE/full-text search, so client-side filtering is necessary here.
  // The limit of 500 covers typical single-ISP deployments; if the client
  // base grows larger, server-side search should be added to the API.
  const largeQuery: Record<string, string | number> = { page: 1, limit: 500 };
  if (includeDeleted) largeQuery.include_deleted = 'true';
  const res = await api.GET('/clients', { params: { query: largeQuery as never } });
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
// Mutations
// ---------------------------------------------------------------------------

interface ClientFormBody {
  name: string;
  email?: string;
  phone?: string;
  client_type?: string;
  status?: string;
  tax_id?: string;
  address?: string;
  city?: string;
  state?: string;
  zip_code?: string;
  country?: string;
  locale?: string;
}

async function createClient(body: ClientFormBody): Promise<void> {
  const { error } = await api.POST('/clients', { body: body as never });
  if (error) throw new Error(extractError(error, 'Failed to create client'));
}

async function updateClient(id: number, body: ClientFormBody): Promise<void> {
  const { error } = await api.PUT('/clients/{id}', {
    params: { path: { id } },
    body: body as never,
  });
  if (error) throw new Error(extractError(error, 'Failed to update client'));
}

async function deleteClient(id: number): Promise<void> {
  const { error } = await api.DELETE('/clients/{id}', { params: { path: { id } } });
  if (error) throw new Error(extractError(error, 'Failed to delete client'));
}

async function restoreClient(id: number): Promise<void> {
  const { error } = await api.POST('/clients/{id}/restore', { params: { path: { id } } });
  if (error) throw new Error(extractError(error, 'Failed to restore client'));
}

function extractError(err: unknown, fallback: string): string {
  const e = err as { error?: { message?: string }; message?: string };
  return e?.error?.message || e?.message || fallback;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CLIENT_TYPES = ['residential', 'business', 'government', 'wholesale'];
const STATUSES = ['active', 'inactive', 'suspended'];
const LOCALES = ['global', 'MX'];

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
// Create / Edit modal
// ---------------------------------------------------------------------------

interface ClientFormModalProps {
  mode: 'create' | 'edit';
  initial?: Client;
  onClose: () => void;
  onSaved: () => void;
}

function ClientFormModal({ mode, initial, onClose, onSaved }: ClientFormModalProps) {
  const [form, setForm] = useState<ClientFormBody>({
    name: initial?.name ?? '',
    email: initial?.email ?? '',
    phone: initial?.phone ?? '',
    client_type: initial?.client_type ?? 'residential',
    status: initial?.status ?? 'active',
    tax_id: initial?.tax_id ?? '',
    address: initial?.address ?? '',
    city: initial?.city ?? '',
    state: initial?.state ?? '',
    zip_code: initial?.zip_code ?? '',
    country: initial?.country ?? '',
    locale: initial?.locale ?? 'global',
  });
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: (body: ClientFormBody) =>
      mode === 'create' ? createClient(body) : updateClient(initial!.id, body),
    onSuccess: () => {
      onSaved();
      onClose();
    },
    onError: (err: unknown) =>
      setError(err instanceof Error ? err.message : 'Failed to save client'),
  });

  function set<K extends keyof ClientFormBody>(key: K, value: ClientFormBody[K]) {
    setForm(prev => ({ ...prev, [key]: value }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) {
      setError('Name is required.');
      return;
    }
    // Drop empty optional strings so they are not sent as "" (which can fail
    // email/enum validation). Always send name; keep selects.
    const body: ClientFormBody = { name: form.name.trim() };
    (
      ['email', 'phone', 'tax_id', 'address', 'city', 'state', 'zip_code', 'country'] as const
    ).forEach(k => {
      const v = (form[k] ?? '').trim();
      if (v) body[k] = v;
    });
    body.client_type = form.client_type;
    body.status = form.status;
    body.locale = form.locale;
    setError('');
    mutation.mutate(body);
  }

  const title = mode === 'create' ? 'New Client' : `Edit ${initial?.name ?? 'Client'}`;

  return (
    <div style={overlay} role="dialog" aria-modal="true" aria-label={title}>
      <div style={{ ...modalBox, width: 540, maxHeight: '90vh', overflowY: 'auto' }}>
        <h3 style={{ margin: '0 0 1rem' }}>{title}</h3>
        {error && <div style={errorBox}>{error}</div>}
        <form onSubmit={handleSubmit}>
          <label style={labelStyle}>Name *</label>
          <input
            style={inputStyle}
            type="text"
            value={form.name}
            onChange={e => set('name', e.target.value)}
            required
            autoFocus
          />

          <div style={twoCol}>
            <div>
              <label style={labelStyle}>Email</label>
              <input style={inputStyle} type="email" value={form.email} onChange={e => set('email', e.target.value)} />
            </div>
            <div>
              <label style={labelStyle}>Phone</label>
              <input style={inputStyle} type="text" value={form.phone} onChange={e => set('phone', e.target.value)} />
            </div>
          </div>

          <div style={twoCol}>
            <div>
              <label style={labelStyle}>Type</label>
              <select style={inputStyle} value={form.client_type} onChange={e => set('client_type', e.target.value)}>
                {CLIENT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Status</label>
              <select style={inputStyle} value={form.status} onChange={e => set('status', e.target.value)}>
                {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>

          <div style={twoCol}>
            <div>
              <label style={labelStyle}>Tax ID</label>
              <input style={inputStyle} type="text" value={form.tax_id} onChange={e => set('tax_id', e.target.value)} />
            </div>
            <div>
              <label style={labelStyle}>Locale</label>
              <select style={inputStyle} value={form.locale} onChange={e => set('locale', e.target.value)}>
                {LOCALES.map(l => <option key={l} value={l}>{l}</option>)}
              </select>
            </div>
          </div>

          <label style={labelStyle}>Address</label>
          <input style={inputStyle} type="text" value={form.address} onChange={e => set('address', e.target.value)} />

          <div style={threeCol}>
            <div>
              <label style={labelStyle}>City</label>
              <input style={inputStyle} type="text" value={form.city} onChange={e => set('city', e.target.value)} />
            </div>
            <div>
              <label style={labelStyle}>State</label>
              <input style={inputStyle} type="text" value={form.state} onChange={e => set('state', e.target.value)} />
            </div>
            <div>
              <label style={labelStyle}>ZIP</label>
              <input style={inputStyle} type="text" value={form.zip_code} onChange={e => set('zip_code', e.target.value)} />
            </div>
          </div>

          <label style={labelStyle}>Country (ISO-2)</label>
          <input
            style={inputStyle}
            type="text"
            maxLength={2}
            placeholder="MX"
            value={form.country}
            onChange={e => set('country', e.target.value.toUpperCase())}
          />

          <div style={{ display: 'flex', gap: 8, marginTop: '1.25rem', justifyContent: 'flex-end' }}>
            <button type="button" onClick={onClose} style={cancelBtn}>Cancel</button>
            <button type="submit" style={submitBtn} disabled={mutation.isPending}>
              {mutation.isPending ? 'Saving…' : mode === 'create' ? 'Create' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Delete confirmation modal
// ---------------------------------------------------------------------------

interface DeleteModalProps {
  client: Client;
  onClose: () => void;
  onDeleted: () => void;
}

function DeleteClientModal({ client, onClose, onDeleted }: DeleteModalProps) {
  const [error, setError] = useState('');
  const mutation = useMutation({
    mutationFn: () => deleteClient(client.id),
    onSuccess: () => { onDeleted(); onClose(); },
    onError: (err: unknown) => setError(err instanceof Error ? err.message : 'Failed to delete client'),
  });

  return (
    <div style={overlay} role="dialog" aria-modal="true" aria-label="Delete Client">
      <div style={modalBox}>
        <h3 style={{ margin: '0 0 0.75rem' }}>Archive client?</h3>
        {error && <div style={errorBox}>{error}</div>}
        <p style={{ fontSize: '0.88rem', color: 'var(--text-secondary)', marginTop: 0 }}>
          <strong>{client.name}</strong> will be archived (soft-deleted). You can restore it
          later from the “Show archived” view.
        </p>
        <div style={{ display: 'flex', gap: 8, marginTop: '1rem', justifyContent: 'flex-end' }}>
          <button type="button" onClick={onClose} style={cancelBtn}>Cancel</button>
          <button type="button" onClick={() => mutation.mutate()} style={dangerBtn} disabled={mutation.isPending}>
            {mutation.isPending ? 'Archiving…' : 'Archive'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ClientList() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [editClient, setEditClient] = useState<Client | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Client | null>(null);

  const canCreate = can(user?.role, 'clients.create');
  const canUpdate = can(user?.role, 'clients.update');
  const canDelete = can(user?.role, 'clients.delete');

  const { data, isLoading, error } = useQuery({
    queryKey: ['clients', page, search, showArchived],
    queryFn: () => fetchClients(page, search, showArchived),
  });

  const restoreMutation = useMutation({
    mutationFn: (id: number) => restoreClient(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['clients'] }),
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

  const refresh = () => qc.invalidateQueries({ queryKey: ['clients'] });

  const clients = data?.data ?? [];
  const meta = data?.meta;

  return (
    <div style={styles.page}>
      {/* Header */}
      <div style={styles.header}>
        <h1 style={styles.pageTitle}>👥 Clients</h1>
        {meta && <span style={styles.countBadge}>{meta.total} total</span>}
        <div style={{ flex: 1 }} />
        {canCreate && (
          <button type="button" style={styles.btnPrimary} onClick={() => setShowCreate(true)}>
            + New Client
          </button>
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
        <label style={styles.archivedToggle}>
          <input
            type="checkbox"
            checked={showArchived}
            onChange={e => { setShowArchived(e.target.checked); setPage(1); }}
          />
          Show archived
        </label>
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
                  {clients.map(c => {
                    const archived = Boolean(c.deleted_at);
                    return (
                      <tr key={c.id} style={styles.tr}>
                        <td style={{ ...styles.td, fontWeight: 600 }}>
                          <Link to={`/clients/${c.id}`} style={styles.nameLink}>
                            {c.name}
                          </Link>
                          {archived && <span style={styles.archivedBadge}>archived</span>}
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
                        <td style={{ ...styles.td, whiteSpace: 'nowrap' }}>
                          {archived ? (
                            canDelete && (
                              <button
                                type="button"
                                style={styles.actionBtn}
                                disabled={restoreMutation.isPending}
                                onClick={() => restoreMutation.mutate(c.id)}
                              >
                                Restore
                              </button>
                            )
                          ) : (
                            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                              {canUpdate && (
                                <button type="button" style={styles.actionBtn} onClick={() => setEditClient(c)}>
                                  Edit
                                </button>
                              )}
                              {canDelete && (
                                <button
                                  type="button"
                                  style={{ ...styles.actionBtn, ...styles.actionBtnDanger }}
                                  onClick={() => setDeleteTarget(c)}
                                >
                                  Archive
                                </button>
                              )}
                              <Link to={`/clients/${c.id}`} style={styles.viewLink}>
                                View →
                              </Link>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
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

      {/* Modals */}
      {showCreate && (
        <ClientFormModal mode="create" onClose={() => setShowCreate(false)} onSaved={refresh} />
      )}
      {editClient && (
        <ClientFormModal
          mode="edit"
          initial={editClient}
          onClose={() => setEditClient(null)}
          onSaved={refresh}
        />
      )}
      {deleteTarget && (
        <DeleteClientModal
          client={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onDeleted={refresh}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const overlay: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
};
const modalBox: React.CSSProperties = {
  background: 'var(--bg-card)', borderRadius: 10, padding: '1.5rem',
  width: 420, maxWidth: '92vw', boxShadow: '0 8px 32px rgba(0,0,0,.18)',
};
const errorBox: React.CSSProperties = {
  background: '#fee2e2', color: '#991b1b', padding: '8px 12px',
  borderRadius: 6, marginBottom: '0.75rem', fontSize: '0.85rem',
};
const labelStyle: React.CSSProperties = {
  display: 'block', fontWeight: 600, fontSize: '0.8rem',
  color: 'var(--text-secondary)', marginBottom: 4, marginTop: 12,
};
const inputStyle: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', padding: '7px 10px',
  border: '1px solid var(--input-border)', borderRadius: 6, fontSize: '0.875rem',
};
const twoCol: React.CSSProperties = {
  display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10,
};
const threeCol: React.CSSProperties = {
  display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10,
};
const submitBtn: React.CSSProperties = {
  background: '#e25822', color: '#fff', border: 'none',
  padding: '7px 18px', borderRadius: 6, cursor: 'pointer',
  fontWeight: 600, fontSize: '0.875rem',
};
const cancelBtn: React.CSSProperties = {
  background: 'var(--bg-card)', color: 'var(--text-secondary)', border: '1px solid var(--border-strong)',
  padding: '7px 18px', borderRadius: 6, cursor: 'pointer',
  fontWeight: 600, fontSize: '0.875rem',
};
const dangerBtn: React.CSSProperties = {
  background: '#dc2626', color: '#fff', border: 'none',
  padding: '7px 18px', borderRadius: 6, cursor: 'pointer',
  fontWeight: 600, fontSize: '0.875rem',
};

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
    alignItems: 'center',
    flexWrap: 'wrap' as const,
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
  archivedToggle: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    fontSize: '0.82rem',
    color: 'var(--text-muted)',
    cursor: 'pointer',
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
  archivedBadge: {
    marginLeft: 8,
    background: '#fee2e2',
    color: '#991b1b',
    padding: '1px 7px',
    borderRadius: 10,
    fontSize: '0.68rem',
    fontWeight: 600,
  },
  viewLink: {
    color: '#e25822',
    textDecoration: 'none',
    fontWeight: 600,
    fontSize: '0.82rem',
    whiteSpace: 'nowrap' as const,
  },
  actionBtn: {
    padding: '3px 10px',
    border: '1px solid var(--border-strong)',
    borderRadius: 5,
    background: 'var(--bg-card)',
    cursor: 'pointer',
    fontSize: '0.78rem',
    fontWeight: 600,
    color: 'var(--text-secondary)',
  },
  actionBtnDanger: {
    color: '#b91c1c',
    borderColor: '#fca5a5',
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
