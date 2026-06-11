// =============================================================================
// FireISP 5.0 — DHCP Server Management
// =============================================================================
// Standalone page at /dhcp-servers. Lists DHCP servers with a status filter,
// paginated table, "New DHCP Server" create modal, and per-row Edit and Delete.
// =============================================================================

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';
import { styles, modalStyles, RequiredMark, capitalize } from './crudStyles';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DhcpServer {
  id: number;
  name: string;
  server_type: string;
  host: string;
  port: number;
  api_url: string | null;
  api_token: string | null;
  status: string;
  notes: string | null;
}

interface DhcpServersResponse {
  data: DhcpServer[];
  meta: { total: number; page: number; limit: number };
}

interface DhcpServerBody {
  name: string;
  server_type?: string;
  host: string;
  port?: number;
  api_url?: string;
  api_token?: string;
  status?: string;
  notes?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PAGE_SIZE = 25;
const STATUSES = ['active', 'inactive'];
const SERVER_TYPES = ['kea', 'mikrotik'];

// ---------------------------------------------------------------------------
// Fetch / mutate helpers
// ---------------------------------------------------------------------------

async function fetchServers(page: number, statusFilter: string): Promise<DhcpServersResponse> {
  const query: Record<string, string | number> = { page, limit: PAGE_SIZE };
  if (statusFilter) query.status = statusFilter;
  const res = await api.GET('/dhcp-servers' as never, { params: { query: query as never } } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to load DHCP servers');
  return (res as { data: unknown }).data as unknown as DhcpServersResponse;
}

async function createServer(body: DhcpServerBody): Promise<void> {
  const res = await api.POST('/dhcp-servers' as never, { body: body as never } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to create DHCP server');
}

async function updateServer(id: number, body: Partial<DhcpServerBody>): Promise<void> {
  const res = await api.PUT('/dhcp-servers/{id}' as never, { params: { path: { id } }, body: body as never } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to update DHCP server');
}

async function deleteServer(id: number): Promise<void> {
  const res = await api.DELETE('/dhcp-servers/{id}' as never, { params: { path: { id } } } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to delete DHCP server');
}

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, { bg: string; color: string }> = {
    active: { bg: '#d1fae5', color: '#065f46' },
    inactive: { bg: '#fef3c7', color: '#92400e' },
  };
  const c = colors[status] ?? { bg: '#f3f4f6', color: '#374151' };
  return (
    <span style={{ background: c.bg, color: c.color, padding: '2px 8px', borderRadius: 12, fontSize: '0.72rem', fontWeight: 600, textTransform: 'capitalize' }}>
      {status}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Server form modal
// ---------------------------------------------------------------------------

interface ServerFormProps {
  initial: Partial<DhcpServer>;
  onSave: (body: DhcpServerBody) => void;
  onClose: () => void;
  saving: boolean;
  editMode: boolean;
}

function ServerForm({ initial, onSave, onClose, saving, editMode }: ServerFormProps) {
  const { t } = useTranslation();
  const [name, setName] = useState(initial.name ?? '');
  const [serverType, setServerType] = useState(initial.server_type ?? 'kea');
  const [host, setHost] = useState(initial.host ?? '');
  const [port, setPort] = useState<string>(initial.port !== undefined ? String(initial.port) : '67');
  const [apiUrl, setApiUrl] = useState(initial.api_url ?? '');
  const [apiToken, setApiToken] = useState(initial.api_token ?? '');
  const [status, setStatus] = useState(initial.status ?? 'active');
  const [notes, setNotes] = useState(initial.notes ?? '');

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const body: DhcpServerBody = { name, host, status };
    if (serverType) body.server_type = serverType;
    if (port) body.port = Number(port);
    if (apiUrl) body.api_url = apiUrl;
    if (apiToken) body.api_token = apiToken;
    if (notes) body.notes = notes;
    onSave(body);
  }

  const inp: React.CSSProperties = { ...modalStyles.input, width: '100%', boxSizing: 'border-box' as const };

  return (
    <div style={modalStyles.backdrop} onClick={onClose}>
      <div style={{ ...modalStyles.panel, maxWidth: 600 }} onClick={e => e.stopPropagation()}>
        <div style={modalStyles.header}>
          <h3 style={modalStyles.title}>{editMode ? t('dhcp_servers.edit', 'Edit DHCP Server') : t('dhcp_servers.new', 'New DHCP Server')}</h3>
          <button style={modalStyles.closeBtn} onClick={onClose} aria-label="Close">x</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: '0.75rem' }}>
            <label style={modalStyles.label}>{t('dhcp_servers.name', 'Name')}<RequiredMark /></label>
            <input style={inp} value={name} onChange={e => setName(e.target.value)} required />
          </div>

          <div style={{ marginBottom: '0.75rem' }}>
            <label style={modalStyles.label}>{t('dhcp_servers.server_type', 'Server Type')}</label>
            <select style={inp} value={serverType} onChange={e => setServerType(e.target.value)}>
              {SERVER_TYPES.map(s => <option key={s} value={s}>{capitalize(s)}</option>)}
            </select>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
            <div>
              <label style={modalStyles.label}>{t('dhcp_servers.host', 'Host')}<RequiredMark /></label>
              <input style={inp} value={host} onChange={e => setHost(e.target.value)} required placeholder="192.168.1.1" />
            </div>
            <div>
              <label style={modalStyles.label}>{t('dhcp_servers.port', 'Port')}</label>
              <input style={inp} type="number" min={1} max={65535} value={port} onChange={e => setPort(e.target.value)} />
            </div>
          </div>

          <div style={{ marginBottom: '0.75rem' }}>
            <label style={modalStyles.label}>{t('dhcp_servers.api_url', 'API URL')}</label>
            <input style={inp} value={apiUrl} onChange={e => setApiUrl(e.target.value)} placeholder="http://host:8000/api" />
          </div>

          <div style={{ marginBottom: '0.75rem' }}>
            <label style={modalStyles.label}>{t('dhcp_servers.api_token', 'API Token')}</label>
            <input style={inp} type="password" value={apiToken} onChange={e => setApiToken(e.target.value)} />
          </div>

          <div style={{ marginBottom: '0.75rem' }}>
            <label style={modalStyles.label}>{t('dhcp_servers.status', 'Status')}</label>
            <select style={inp} value={status} onChange={e => setStatus(e.target.value)}>
              {STATUSES.map(s => <option key={s} value={s}>{capitalize(s)}</option>)}
            </select>
          </div>

          <div style={{ marginBottom: '1rem' }}>
            <label style={modalStyles.label}>{t('dhcp_servers.notes', 'Notes')}</label>
            <textarea style={{ ...inp, minHeight: 64, resize: 'vertical' as const }} value={notes} onChange={e => setNotes(e.target.value)} />
          </div>

          <div style={modalStyles.actions}>
            <button type="button" style={styles.btnSecondary} onClick={onClose}>Cancel</button>
            <button type="submit" style={styles.btnPrimary} disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page component
// ---------------------------------------------------------------------------

export function DhcpServerList() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('active');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<DhcpServer | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null);

  const serversQ = useQuery({
    queryKey: ['dhcp-servers', page, statusFilter],
    queryFn: () => fetchServers(page, statusFilter),
  });

  const servers = serversQ.data?.data ?? [];
  const meta = serversQ.data?.meta;

  function showMsg(type: 'ok' | 'err', msg: string) {
    setFeedback({ type, msg });
    setTimeout(() => setFeedback(null), 4000);
  }

  const createMut = useMutation({
    mutationFn: createServer,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['dhcp-servers'] });
      setShowForm(false);
      showMsg('ok', t('dhcp_servers.create_success', 'DHCP server created.'));
    },
    onError: () => showMsg('err', t('dhcp_servers.create_error', 'Failed to create DHCP server.')),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, body }: { id: number; body: Partial<DhcpServerBody> }) => updateServer(id, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['dhcp-servers'] });
      setEditing(null);
      showMsg('ok', t('dhcp_servers.update_success', 'DHCP server updated.'));
    },
    onError: () => showMsg('err', t('dhcp_servers.update_error', 'Failed to update DHCP server.')),
  });

  const deleteMut = useMutation({
    mutationFn: deleteServer,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['dhcp-servers'] });
      setDeleteConfirm(null);
      showMsg('ok', t('dhcp_servers.delete_success', 'DHCP server deleted.'));
    },
    onError: () => showMsg('err', t('dhcp_servers.delete_error', 'Failed to delete DHCP server.')),
  });

  const totalPages = meta ? Math.ceil(meta.total / PAGE_SIZE) : 1;

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.pageTitle}>{t('dhcp_servers.title', 'DHCP Servers')}</h1>
        {meta && <span style={styles.countBadge}>{meta.total} total</span>}
        <button style={{ ...styles.btnPrimary, marginLeft: 'auto' }} onClick={() => setShowForm(true)}>
          + {t('dhcp_servers.new', 'New DHCP Server')}
        </button>
      </div>

      {feedback && (
        <div style={{ padding: '0.6rem 1rem', borderRadius: 6, marginBottom: '1rem', background: feedback.type === 'ok' ? '#d1fae5' : '#fee2e2', color: feedback.type === 'ok' ? '#065f46' : '#991b1b', fontSize: '0.85rem' }}>
          {feedback.msg}
        </div>
      )}

      <div style={styles.filterRow}>
        <span style={styles.filterLabel}>Status:</span>
        <select style={styles.filterSelect} value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(1); }}>
          <option value="">All</option>
          {STATUSES.map(s => <option key={s} value={s}>{capitalize(s)}</option>)}
        </select>
      </div>

      <div style={styles.tableCard}>
        {serversQ.isLoading ? (
          <p style={styles.msg}>Loading...</p>
        ) : serversQ.error ? (
          <p style={styles.msgError}>{t('dhcp_servers.error', 'Failed to load DHCP servers.')}</p>
        ) : servers.length === 0 ? (
          <p style={styles.msg}>{t('dhcp_servers.empty', 'No DHCP servers found.')}</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>Name</th>
                  <th style={styles.th}>Server Type</th>
                  <th style={styles.th}>Host:Port</th>
                  <th style={styles.th}>Status</th>
                  <th style={styles.th}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {servers.map(s => (
                  <tr key={s.id} style={styles.tr}>
                    <td style={styles.td}><strong>{s.name}</strong></td>
                    <td style={styles.td}>{capitalize(s.server_type)}</td>
                    <td style={styles.tdMono}>{s.host}:{s.port}</td>
                    <td style={styles.td}><StatusBadge status={s.status} /></td>
                    <td style={styles.td}>
                      <button style={{ ...styles.btnSecondary, fontSize: '0.78rem', padding: '0.25rem 0.6rem', marginRight: 4 }} onClick={() => setEditing(s)}>Edit</button>
                      <button style={{ ...styles.btnDanger, fontSize: '0.78rem', padding: '0.25rem 0.6rem' }} onClick={() => setDeleteConfirm(s.id)}>Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {totalPages > 1 && (
        <div style={styles.pagination}>
          <button style={styles.pageBtn} disabled={page <= 1} onClick={() => setPage(p => p - 1)}>&larr; Prev</button>
          <span style={styles.pageInfo}>Page {page} of {totalPages}</span>
          <button style={styles.pageBtn} disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>Next &rarr;</button>
        </div>
      )}

      {showForm && (
        <ServerForm
          initial={{}}
          onSave={body => createMut.mutate(body)}
          onClose={() => setShowForm(false)}
          saving={createMut.isPending}
          editMode={false}
        />
      )}

      {editing && (
        <ServerForm
          initial={editing}
          onSave={body => updateMut.mutate({ id: editing.id, body })}
          onClose={() => setEditing(null)}
          saving={updateMut.isPending}
          editMode={true}
        />
      )}

      {deleteConfirm !== null && (
        <div style={modalStyles.backdrop} onClick={() => setDeleteConfirm(null)}>
          <div style={{ ...modalStyles.panel, maxWidth: 380 }} onClick={e => e.stopPropagation()}>
            <p style={{ marginBottom: '1.5rem' }}>{t('dhcp_servers.delete_confirm', 'Delete this DHCP server?')}</p>
            <div style={modalStyles.actions}>
              <button style={styles.btnSecondary} onClick={() => setDeleteConfirm(null)}>Cancel</button>
              <button style={styles.btnDanger} onClick={() => deleteMut.mutate(deleteConfirm)} disabled={deleteMut.isPending}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
