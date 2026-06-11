// =============================================================================
// FireISP 5.0 — Poller Node Management (§6.4)
// =============================================================================
// Page at /poller-nodes. Lists poller nodes with status filter, paginated
// table, create/edit modal, and delete confirmation.
// =============================================================================

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';
import { styles, modalStyles, RequiredMark, capitalize } from './crudStyles';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PollerNode {
  id: number;
  node_identifier: string;
  name: string;
  status: string;
  api_url: string | null;
  max_concurrent_polls: number;
  current_queue_depth: number;
  avg_poll_duration_ms: number | null;
  last_heartbeat_at: string | null;
}

interface PollerNodesResponse {
  data: PollerNode[];
  meta: { total: number; page: number; limit: number };
}

interface PollerNodeBody {
  node_identifier: string;
  name: string;
  status?: string;
  api_url?: string | null;
  max_concurrent_polls?: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PAGE_SIZE = 25;
const STATUSES = ['active', 'draining', 'maintenance', 'offline'];

// ---------------------------------------------------------------------------
// Fetch / mutate helpers
// ---------------------------------------------------------------------------

async function fetchNodes(page: number, statusFilter: string): Promise<PollerNodesResponse> {
  const query: Record<string, string | number> = { page, limit: PAGE_SIZE };
  if (statusFilter) query.status = statusFilter;
  const res = await api.GET('/poller-nodes' as never, { params: { query: query as never } } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to load poller nodes');
  return (res as { data: unknown }).data as unknown as PollerNodesResponse;
}

async function createNode(body: PollerNodeBody): Promise<void> {
  const res = await api.POST('/poller-nodes' as never, { body: body as never } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to create poller node');
}

async function updateNode(id: number, body: Partial<PollerNodeBody>): Promise<void> {
  const res = await api.PUT('/poller-nodes/{id}' as never, { params: { path: { id } }, body: body as never } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to update poller node');
}

async function deleteNode(id: number): Promise<void> {
  const res = await api.DELETE('/poller-nodes/{id}' as never, { params: { path: { id } } } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to delete poller node');
}

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, { bg: string; color: string }> = {
    active:      { bg: '#d1fae5', color: '#065f46' },
    draining:    { bg: '#fef9c3', color: '#854d0e' },
    maintenance: { bg: '#fef3c7', color: '#92400e' },
    offline:     { bg: '#fee2e2', color: '#991b1b' },
  };
  const c = colors[status] ?? { bg: '#f3f4f6', color: '#374151' };
  return (
    <span style={{ background: c.bg, color: c.color, padding: '2px 8px', borderRadius: 12, fontSize: '0.72rem', fontWeight: 600, textTransform: 'capitalize' }}>
      {status}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Poller node form modal
// ---------------------------------------------------------------------------

interface NodeFormProps {
  initial: Partial<PollerNode>;
  onSave: (body: PollerNodeBody) => void;
  onClose: () => void;
  saving: boolean;
  editMode: boolean;
}

function NodeForm({ initial, onSave, onClose, saving, editMode }: NodeFormProps) {
  const { t } = useTranslation();
  const [nodeIdentifier, setNodeIdentifier] = useState(initial.node_identifier ?? '');
  const [name, setName] = useState(initial.name ?? '');
  const [status, setStatus] = useState(initial.status ?? 'active');
  const [apiUrl, setApiUrl] = useState(initial.api_url ?? '');
  const [maxConcurrent, setMaxConcurrent] = useState(String(initial.max_concurrent_polls ?? 10));

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const body: PollerNodeBody = { node_identifier: nodeIdentifier, name, status };
    if (apiUrl) body.api_url = apiUrl;
    const mc = parseInt(maxConcurrent, 10);
    if (!Number.isNaN(mc)) body.max_concurrent_polls = mc;
    onSave(body);
  }

  const inp: React.CSSProperties = { ...modalStyles.input, width: '100%', boxSizing: 'border-box' as const };

  return (
    <div style={modalStyles.backdrop} onClick={onClose}>
      <div style={{ ...modalStyles.panel, maxWidth: 520 }} onClick={e => e.stopPropagation()}>
        <div style={modalStyles.header}>
          <h3 style={modalStyles.title}>{editMode ? t('poller_nodes.edit', 'Edit Poller Node') : t('poller_nodes.new', 'New Poller Node')}</h3>
          <button style={modalStyles.closeBtn} onClick={onClose} aria-label="Close">x</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: '0.75rem' }}>
            <label style={modalStyles.label}>{t('poller_nodes.node_identifier', 'Node Identifier')}<RequiredMark /></label>
            <input style={inp} value={nodeIdentifier} onChange={e => setNodeIdentifier(e.target.value)} required disabled={editMode} />
          </div>

          <div style={{ marginBottom: '0.75rem' }}>
            <label style={modalStyles.label}>{t('poller_nodes.name', 'Name')}<RequiredMark /></label>
            <input style={inp} value={name} onChange={e => setName(e.target.value)} required />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
            <div>
              <label style={modalStyles.label}>{t('poller_nodes.status', 'Status')}</label>
              <select style={inp} value={status} onChange={e => setStatus(e.target.value)}>
                {STATUSES.map(s => <option key={s} value={s}>{capitalize(s)}</option>)}
              </select>
            </div>
            <div>
              <label style={modalStyles.label}>{t('poller_nodes.max_concurrent_polls', 'Max Concurrent Polls')}</label>
              <input style={inp} type="number" min={1} max={1000} value={maxConcurrent} onChange={e => setMaxConcurrent(e.target.value)} />
            </div>
          </div>

          <div style={{ marginBottom: '1rem' }}>
            <label style={modalStyles.label}>{t('poller_nodes.api_url', 'API URL')}</label>
            <input style={inp} value={apiUrl} onChange={e => setApiUrl(e.target.value)} placeholder="https://poller.example.com" />
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

export function PollerNodeList() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('active');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<PollerNode | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null);

  const nodesQ = useQuery({
    queryKey: ['poller-nodes', page, statusFilter],
    queryFn: () => fetchNodes(page, statusFilter),
  });

  const nodes = nodesQ.data?.data ?? [];
  const meta = nodesQ.data?.meta;

  function showMsg(type: 'ok' | 'err', msg: string) {
    setFeedback({ type, msg });
    setTimeout(() => setFeedback(null), 4000);
  }

  const createMut = useMutation({
    mutationFn: createNode,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['poller-nodes'] });
      setShowForm(false);
      showMsg('ok', t('poller_nodes.create_success', 'Poller node created.'));
    },
    onError: () => showMsg('err', t('poller_nodes.create_error', 'Failed to create poller node.')),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, body }: { id: number; body: Partial<PollerNodeBody> }) => updateNode(id, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['poller-nodes'] });
      setEditing(null);
      showMsg('ok', t('poller_nodes.update_success', 'Poller node updated.'));
    },
    onError: () => showMsg('err', t('poller_nodes.update_error', 'Failed to update poller node.')),
  });

  const deleteMut = useMutation({
    mutationFn: deleteNode,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['poller-nodes'] });
      setDeleteConfirm(null);
      showMsg('ok', t('poller_nodes.delete_success', 'Poller node deleted.'));
    },
    onError: () => showMsg('err', t('poller_nodes.delete_error', 'Failed to delete poller node.')),
  });

  const totalPages = meta ? Math.ceil(meta.total / PAGE_SIZE) : 1;

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.pageTitle}>{t('poller_nodes.title', 'Poller Nodes')}</h1>
        {meta && <span style={styles.countBadge}>{meta.total} total</span>}
        <button style={{ ...styles.btnPrimary, marginLeft: 'auto' }} onClick={() => setShowForm(true)}>
          + {t('poller_nodes.new', 'New Poller Node')}
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
        {nodesQ.isLoading ? (
          <p style={styles.msg}>Loading...</p>
        ) : nodesQ.error ? (
          <p style={styles.msgError}>{t('poller_nodes.error', 'Failed to load poller nodes.')}</p>
        ) : nodes.length === 0 ? (
          <p style={styles.msg}>{t('poller_nodes.empty', 'No poller nodes found.')}</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>{t('poller_nodes.node_identifier', 'Node Identifier')}</th>
                  <th style={styles.th}>{t('poller_nodes.name', 'Name')}</th>
                  <th style={styles.th}>{t('poller_nodes.status', 'Status')}</th>
                  <th style={styles.th}>{t('poller_nodes.queue_depth', 'Queue Depth')}</th>
                  <th style={styles.th}>{t('poller_nodes.avg_poll_duration', 'Avg Duration (ms)')}</th>
                  <th style={styles.th}>{t('poller_nodes.last_heartbeat', 'Last Heartbeat')}</th>
                  <th style={styles.th}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {nodes.map(n => (
                  <tr key={n.id} style={styles.tr}>
                    <td style={styles.td}><code>{n.node_identifier}</code></td>
                    <td style={styles.td}><strong>{n.name}</strong></td>
                    <td style={styles.td}><StatusBadge status={n.status} /></td>
                    <td style={styles.td}>{n.current_queue_depth}</td>
                    <td style={styles.td}>{n.avg_poll_duration_ms ?? '—'}</td>
                    <td style={styles.td}>{n.last_heartbeat_at ? new Date(n.last_heartbeat_at).toLocaleString() : '—'}</td>
                    <td style={styles.td}>
                      <button style={{ ...styles.btnSecondary, fontSize: '0.78rem', padding: '0.25rem 0.6rem', marginRight: 4 }} onClick={() => setEditing(n)}>Edit</button>
                      <button style={{ ...styles.btnDanger, fontSize: '0.78rem', padding: '0.25rem 0.6rem' }} onClick={() => setDeleteConfirm(n.id)}>Delete</button>
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
        <NodeForm
          initial={{}}
          onSave={body => createMut.mutate(body)}
          onClose={() => setShowForm(false)}
          saving={createMut.isPending}
          editMode={false}
        />
      )}

      {editing && (
        <NodeForm
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
            <p style={{ marginBottom: '1.5rem' }}>{t('poller_nodes.delete_confirm', 'Delete this poller node?')}</p>
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
