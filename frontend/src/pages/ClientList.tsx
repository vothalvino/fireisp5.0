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

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';
import { useAuth } from '@/auth/AuthContext';
import { can } from '@/auth/permissions';
import {
  ClientFormModal,
  extractApiError,
  overlay,
  modalBox,
  errorBox,
  cancelBtn,
  dangerBtn,
} from '@/components/ClientFormModal';
import { useTableSort, SortableTh } from '@/components/SortableTh';
import { Pagination } from '@/components/Pagination';

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
  client_group_id: number | null;
  client_group_name: string | null;
  deleted_at: string | null;
  created_at: string;
}

interface ClientsResponse {
  data: Client[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

interface ClientGroupOption {
  id: number;
  name: string;
}

// ---------------------------------------------------------------------------
// Fetch
// ---------------------------------------------------------------------------

// Single server-side call. The backend supports free-text ?search= (partial
// name/email/phone, exact numeric id) and a ?client_group_id= filter, returning
// { data, meta }, so no client-side filtering / large-fetch is needed.
async function fetchClients(
  page: number,
  pageSize: number,
  search: string,
  includeDeleted: boolean,
  groupId: number | null,
  orderBy: string,
  order: string,
): Promise<ClientsResponse> {
  const query = {
    page,
    limit: pageSize,
    order_by: orderBy,
    order,
    ...(search ? { search } : {}),
    ...(groupId ? { client_group_id: groupId } : {}),
    ...(includeDeleted ? { include_deleted: 'true' } : {}),
  };
  const res = await api.GET('/clients', { params: { query: query as never } });
  if (res.error) throw new Error('clientList.error');
  return res.data as unknown as ClientsResponse;
}

// Account-group options for the filter dropdown + per-row group name resolution.
// Reuses the ['client-groups-options'] cache shared with ClientProfileTabs.
async function fetchClientGroupOptions(): Promise<ClientGroupOption[]> {
  const res = await api.GET('/client-groups', { params: { query: { limit: 200 } as never } });
  if (res.error) throw new Error('clientList.error');
  return (res.data as unknown as { data: ClientGroupOption[] }).data;
}

// ---------------------------------------------------------------------------
// Mutations (list-specific: delete + restore)
// ---------------------------------------------------------------------------

async function deleteClient(id: number): Promise<void> {
  const { error } = await api.DELETE('/clients/{id}', { params: { path: { id } } });
  if (error) throw new Error(extractApiError(error, 'clientList.error'));
}

async function restoreClient(id: number): Promise<void> {
  const { error } = await api.POST('/clients/{id}/restore', { params: { path: { id } } });
  if (error) throw new Error(extractApiError(error, 'clientList.error'));
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
// Delete confirmation modal
// ---------------------------------------------------------------------------

interface DeleteModalProps {
  client: Client;
  onClose: () => void;
  onDeleted: () => void;
}

function DeleteClientModal({ client, onClose, onDeleted }: DeleteModalProps) {
  const { t } = useTranslation();
  const [error, setError] = useState('');
  const mutation = useMutation({
    mutationFn: () => deleteClient(client.id),
    onSuccess: () => { onDeleted(); onClose(); },
    onError: (err: unknown) => setError(err instanceof Error ? err.message : t('clientList.error')),
  });

  return (
    <div style={overlay} role="dialog" aria-modal="true" aria-label="Delete Client">
      <div style={modalBox}>
        <h3 style={{ margin: '0 0 0.75rem' }}>{t('clientList.archive')}?</h3>
        {error && <div style={errorBox}>{error}</div>}
        <p style={{ fontSize: '0.88rem', color: 'var(--text-secondary)', marginTop: 0 }}>
          <strong>{client.name}</strong> will be archived (soft-deleted). You can restore it
          later from the "Show archived" view.
        </p>
        <div style={{ display: 'flex', gap: 8, marginTop: '1rem', justifyContent: 'flex-end' }}>
          <button type="button" onClick={onClose} style={cancelBtn}>{t('common.cancel')}</button>
          <button type="button" onClick={() => mutation.mutate()} style={dangerBtn} disabled={mutation.isPending}>
            {mutation.isPending ? t('clientList.archiving') : t('clientList.archive')}
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
  const { t } = useTranslation();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [groupId, setGroupId] = useState<number | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [editClient, setEditClient] = useState<Client | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Client | null>(null);
  const sort = useTableSort('created_at', 'DESC');

  useEffect(() => { setPage(1); }, [sort.sortBy, sort.sortDir]);

  const canCreate = can(user, 'clients.create');
  const canUpdate = can(user, 'clients.update');
  const canDelete = can(user, 'clients.delete');

  const { data: groupOptions } = useQuery({
    queryKey: ['client-groups-options'],
    queryFn: fetchClientGroupOptions,
  });

  const { data, isLoading, error } = useQuery({
    queryKey: ['clients', page, pageSize, search, showArchived, groupId, sort.sortBy, sort.sortDir],
    queryFn: () => fetchClients(page, pageSize, search, showArchived, groupId, sort.order_by, sort.order),
  });

  const groupName = (id: number | null) =>
    id == null ? '—' : (groupOptions ?? []).find(g => g.id === id)?.name ?? '—';

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
        <h1 style={styles.pageTitle}>👥 {t('clientList.title')}</h1>
        {meta && <span style={styles.countBadge}>{meta.total} total</span>}
        <div style={{ flex: 1 }} />
        {canCreate && (
          <button type="button" style={styles.btnPrimary} onClick={() => setShowCreate(true)}>
            {t('clientList.newClient')}
          </button>
        )}
      </div>

      {/* Search bar */}
      <form onSubmit={handleSearch} style={styles.searchRow}>
        <input
          style={styles.searchInput}
          type="text"
          placeholder={t('clientList.searchPlaceholder')}
          value={searchInput}
          onChange={e => setSearchInput(e.target.value)}
        />
        <button type="submit" style={styles.btnPrimary}>{t('clientList.searchBtn')}</button>
        {search && (
          <button type="button" onClick={handleClear} style={styles.btnSecondary}>
            {t('clientList.clearBtn')}
          </button>
        )}
        <select
          style={styles.groupSelect}
          value={groupId ?? ''}
          onChange={e => { setGroupId(e.target.value ? Number(e.target.value) : null); setPage(1); }}
          aria-label={t('clientList.groupFilter')}
        >
          <option value="">{t('clientList.allGroups')}</option>
          {(groupOptions ?? []).map(g => (
            <option key={g.id} value={g.id}>{g.name}</option>
          ))}
        </select>
        <label style={styles.archivedToggle}>
          <input
            type="checkbox"
            checked={showArchived}
            onChange={e => { setShowArchived(e.target.checked); setPage(1); }}
          />
          {t('clientList.showArchived')}
        </label>
      </form>

      {/* Table */}
      <div style={styles.tableCard}>
        {isLoading ? (
          <p style={styles.msg}>{t('clientList.loading')}</p>
        ) : error ? (
          <p style={styles.msgError}>{t('clientList.error')}</p>
        ) : clients.length === 0 ? (
          <p style={styles.msg}>{t('clientList.noClients')}</p>
        ) : (
          <>
            <div style={{ overflowX: 'auto' }}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    <SortableTh label={t('clientList.table.id')} col="id" sort={sort} style={styles.th} />
                    <SortableTh label={t('clientList.table.name')} col="name" sort={sort} style={styles.th} />
                    <SortableTh label={t('clientList.table.email')} col="email" sort={sort} style={styles.th} />
                    <th style={styles.th}>{t('clientList.table.phone')}</th>
                    <SortableTh label={t('clientList.table.type')} col="client_type" sort={sort} style={styles.th} />
                    {/* location is a composite of city+state — non-sortable (derived display) */}
                    <th style={styles.th}>{t('clientList.table.location')}</th>
                    {/* group name comes from a LEFT JOIN on client_groups — non-sortable by name */}
                    <th style={styles.th}>{t('clientList.table.group')}</th>
                    <SortableTh label={t('clientList.table.status')} col="status" sort={sort} style={styles.th} />
                    <th style={styles.th} />
                  </tr>
                </thead>
                <tbody>
                  {clients.map(c => {
                    const archived = Boolean(c.deleted_at);
                    return (
                      <tr key={c.id} style={styles.tr}>
                        <td style={{ ...styles.td, color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
                          {c.id}
                        </td>
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
                        <td style={styles.td}>{c.client_group_name || groupName(c.client_group_id)}</td>
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
                                {t('clientList.restore')}
                              </button>
                            )
                          ) : (
                            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                              {canUpdate && (
                                <button type="button" style={styles.actionBtn} onClick={() => setEditClient(c)}>
                                  {t('common.edit')}
                                </button>
                              )}
                              {canDelete && (
                                <button
                                  type="button"
                                  style={{ ...styles.actionBtn, ...styles.actionBtnDanger }}
                                  onClick={() => setDeleteTarget(c)}
                                >
                                  {t('clientList.archive')}
                                </button>
                              )}
                              <Link to={`/clients/${c.id}`} style={styles.viewLink}>
                                {t('clientList.view')}
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
            <Pagination
              page={page}
              totalPages={meta?.totalPages ?? 1}
              total={meta?.total}
              pageSize={pageSize}
              onPageChange={setPage}
              onPageSizeChange={(size) => { setPageSize(size); setPage(1); }}
            />
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

const styles = {
  page: {
    padding: '2rem',
    fontFamily: 'var(--font-sans)',
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
    background: 'var(--accent-soft)',
    color: 'var(--accent)',
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
  groupSelect: {
    padding: '0.5rem 0.6rem',
    border: '1px solid var(--input-border)',
    borderRadius: 6,
    fontSize: '0.85rem',
    background: 'var(--bg-card)',
    color: 'var(--text-secondary)',
    cursor: 'pointer',
    maxWidth: 220,
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
    background: 'var(--accent)',
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
    boxShadow: '0 0 0 1px var(--border)',
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
    color: 'var(--link)',
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
    color: 'var(--accent)',
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
