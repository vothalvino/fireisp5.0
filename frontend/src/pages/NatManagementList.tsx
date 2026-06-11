// =============================================================================
// FireISP 5.0 — NAT / CGNAT Pool Management
// =============================================================================
// Standalone page at /nat-management. Lists NAT pools with a status filter,
// paginated table, "New NAT Pool" create modal, and per-row Edit and Delete.
// =============================================================================

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';
import { styles, modalStyles, RequiredMark, capitalize } from './crudStyles';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface NatPool {
  id: number;
  name: string;
  nat_type: string;
  external_ip_start: string;
  external_ip_end: string;
  internal_subnet: string | null;
  port_range_start: number | null;
  port_range_end: number | null;
  max_ports_per_subscriber: number;
  status: string;
  notes: string | null;
}

interface NatPoolsResponse {
  data: NatPool[];
  meta: { total: number; page: number; limit: number };
}

interface NatPoolBody {
  name: string;
  nat_type?: string;
  external_ip_start: string;
  external_ip_end: string;
  internal_subnet?: string;
  port_range_start?: number;
  port_range_end?: number;
  max_ports_per_subscriber?: number;
  status?: string;
  notes?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PAGE_SIZE = 25;
const STATUSES = ['active', 'inactive'];
const NAT_TYPES = ['cgnat', '1to1', 'pat'];

// ---------------------------------------------------------------------------
// Fetch / mutate helpers
// ---------------------------------------------------------------------------

async function fetchPools(page: number, statusFilter: string): Promise<NatPoolsResponse> {
  const query: Record<string, string | number> = { page, limit: PAGE_SIZE };
  if (statusFilter) query.status = statusFilter;
  const res = await api.GET('/nat-pools' as never, { params: { query: query as never } } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to load NAT pools');
  return (res as { data: unknown }).data as unknown as NatPoolsResponse;
}

async function createPool(body: NatPoolBody): Promise<void> {
  const res = await api.POST('/nat-pools' as never, { body: body as never } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to create NAT pool');
}

async function updatePool(id: number, body: Partial<NatPoolBody>): Promise<void> {
  const res = await api.PUT('/nat-pools/{id}' as never, { params: { path: { id } }, body: body as never } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to update NAT pool');
}

async function deletePool(id: number): Promise<void> {
  const res = await api.DELETE('/nat-pools/{id}' as never, { params: { path: { id } } } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to delete NAT pool');
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
// Pool form modal
// ---------------------------------------------------------------------------

interface PoolFormProps {
  initial: Partial<NatPool>;
  onSave: (body: NatPoolBody) => void;
  onClose: () => void;
  saving: boolean;
  editMode: boolean;
}

function PoolForm({ initial, onSave, onClose, saving, editMode }: PoolFormProps) {
  const { t } = useTranslation();
  const [name, setName] = useState(initial.name ?? '');
  const [natType, setNatType] = useState(initial.nat_type ?? 'cgnat');
  const [externalIpStart, setExternalIpStart] = useState(initial.external_ip_start ?? '');
  const [externalIpEnd, setExternalIpEnd] = useState(initial.external_ip_end ?? '');
  const [internalSubnet, setInternalSubnet] = useState(initial.internal_subnet ?? '');
  const [portRangeStart, setPortRangeStart] = useState<string>(
    initial.port_range_start !== null && initial.port_range_start !== undefined ? String(initial.port_range_start) : '',
  );
  const [portRangeEnd, setPortRangeEnd] = useState<string>(
    initial.port_range_end !== null && initial.port_range_end !== undefined ? String(initial.port_range_end) : '',
  );
  const [maxPorts, setMaxPorts] = useState<string>(
    initial.max_ports_per_subscriber !== undefined ? String(initial.max_ports_per_subscriber) : '1000',
  );
  const [status, setStatus] = useState(initial.status ?? 'active');
  const [notes, setNotes] = useState(initial.notes ?? '');

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const body: NatPoolBody = { name, external_ip_start: externalIpStart, external_ip_end: externalIpEnd, status };
    if (natType) body.nat_type = natType;
    if (internalSubnet) body.internal_subnet = internalSubnet;
    if (portRangeStart) body.port_range_start = Number(portRangeStart);
    if (portRangeEnd) body.port_range_end = Number(portRangeEnd);
    if (maxPorts) body.max_ports_per_subscriber = Number(maxPorts);
    if (notes) body.notes = notes;
    onSave(body);
  }

  const inp: React.CSSProperties = { ...modalStyles.input, width: '100%', boxSizing: 'border-box' as const };

  return (
    <div style={modalStyles.backdrop} onClick={onClose}>
      <div style={{ ...modalStyles.panel, maxWidth: 600 }} onClick={e => e.stopPropagation()}>
        <div style={modalStyles.header}>
          <h3 style={modalStyles.title}>{editMode ? t('nat_management.edit', 'Edit NAT Pool') : t('nat_management.new', 'New NAT Pool')}</h3>
          <button style={modalStyles.closeBtn} onClick={onClose} aria-label="Close">x</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: '0.75rem' }}>
            <label style={modalStyles.label}>{t('nat_management.name', 'Name')}<RequiredMark /></label>
            <input style={inp} value={name} onChange={e => setName(e.target.value)} required />
          </div>

          <div style={{ marginBottom: '0.75rem' }}>
            <label style={modalStyles.label}>{t('nat_management.nat_type', 'NAT Type')}</label>
            <select style={inp} value={natType} onChange={e => setNatType(e.target.value)}>
              {NAT_TYPES.map(n => <option key={n} value={n}>{n.toUpperCase()}</option>)}
            </select>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
            <div>
              <label style={modalStyles.label}>{t('nat_management.external_ip_start', 'External IP Start')}<RequiredMark /></label>
              <input style={inp} value={externalIpStart} onChange={e => setExternalIpStart(e.target.value)} required placeholder="203.0.113.1" />
            </div>
            <div>
              <label style={modalStyles.label}>{t('nat_management.external_ip_end', 'External IP End')}<RequiredMark /></label>
              <input style={inp} value={externalIpEnd} onChange={e => setExternalIpEnd(e.target.value)} required placeholder="203.0.113.254" />
            </div>
          </div>

          <div style={{ marginBottom: '0.75rem' }}>
            <label style={modalStyles.label}>{t('nat_management.internal_subnet', 'Internal Subnet')}</label>
            <input style={inp} value={internalSubnet} onChange={e => setInternalSubnet(e.target.value)} placeholder="100.64.0.0/10" />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
            <div>
              <label style={modalStyles.label}>Port Range Start</label>
              <input style={inp} type="number" min={1} max={65535} value={portRangeStart} onChange={e => setPortRangeStart(e.target.value)} placeholder="1024" />
            </div>
            <div>
              <label style={modalStyles.label}>Port Range End</label>
              <input style={inp} type="number" min={1} max={65535} value={portRangeEnd} onChange={e => setPortRangeEnd(e.target.value)} placeholder="65535" />
            </div>
          </div>

          <div style={{ marginBottom: '0.75rem' }}>
            <label style={modalStyles.label}>{t('nat_management.max_ports', 'Max Ports/Subscriber')}</label>
            <input style={inp} type="number" min={1} value={maxPorts} onChange={e => setMaxPorts(e.target.value)} />
          </div>

          <div style={{ marginBottom: '0.75rem' }}>
            <label style={modalStyles.label}>{t('nat_management.status', 'Status')}</label>
            <select style={inp} value={status} onChange={e => setStatus(e.target.value)}>
              {STATUSES.map(s => <option key={s} value={s}>{capitalize(s)}</option>)}
            </select>
          </div>

          <div style={{ marginBottom: '1rem' }}>
            <label style={modalStyles.label}>{t('nat_management.notes', 'Notes')}</label>
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

export function NatManagementList() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('active');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<NatPool | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null);

  const poolsQ = useQuery({
    queryKey: ['nat-pools', page, statusFilter],
    queryFn: () => fetchPools(page, statusFilter),
  });

  const pools = poolsQ.data?.data ?? [];
  const meta = poolsQ.data?.meta;

  function showMsg(type: 'ok' | 'err', msg: string) {
    setFeedback({ type, msg });
    setTimeout(() => setFeedback(null), 4000);
  }

  const createMut = useMutation({
    mutationFn: createPool,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['nat-pools'] });
      setShowForm(false);
      showMsg('ok', t('nat_management.create_success', 'NAT pool created.'));
    },
    onError: () => showMsg('err', t('nat_management.create_error', 'Failed to create NAT pool.')),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, body }: { id: number; body: Partial<NatPoolBody> }) => updatePool(id, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['nat-pools'] });
      setEditing(null);
      showMsg('ok', t('nat_management.update_success', 'NAT pool updated.'));
    },
    onError: () => showMsg('err', t('nat_management.update_error', 'Failed to update NAT pool.')),
  });

  const deleteMut = useMutation({
    mutationFn: deletePool,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['nat-pools'] });
      setDeleteConfirm(null);
      showMsg('ok', t('nat_management.delete_success', 'NAT pool deleted.'));
    },
    onError: () => showMsg('err', t('nat_management.delete_error', 'Failed to delete NAT pool.')),
  });

  const totalPages = meta ? Math.ceil(meta.total / PAGE_SIZE) : 1;

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.pageTitle}>{t('nat_management.title', 'NAT / CGNAT Management')}</h1>
        {meta && <span style={styles.countBadge}>{meta.total} total</span>}
        <button style={{ ...styles.btnPrimary, marginLeft: 'auto' }} onClick={() => setShowForm(true)}>
          + {t('nat_management.new', 'New NAT Pool')}
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
        {poolsQ.isLoading ? (
          <p style={styles.msg}>Loading...</p>
        ) : poolsQ.error ? (
          <p style={styles.msgError}>{t('nat_management.error', 'Failed to load NAT pools.')}</p>
        ) : pools.length === 0 ? (
          <p style={styles.msg}>{t('nat_management.empty', 'No NAT pools found.')}</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>Name</th>
                  <th style={styles.th}>NAT Type</th>
                  <th style={styles.th}>External IPs</th>
                  <th style={styles.th}>Max Ports/Sub</th>
                  <th style={styles.th}>Status</th>
                  <th style={styles.th}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {pools.map(p => (
                  <tr key={p.id} style={styles.tr}>
                    <td style={styles.td}><strong>{p.name}</strong></td>
                    <td style={styles.td}>{p.nat_type.toUpperCase()}</td>
                    <td style={styles.tdMono}>{p.external_ip_start} — {p.external_ip_end}</td>
                    <td style={styles.td}>{p.max_ports_per_subscriber}</td>
                    <td style={styles.td}><StatusBadge status={p.status} /></td>
                    <td style={styles.td}>
                      <button style={{ ...styles.btnSecondary, fontSize: '0.78rem', padding: '0.25rem 0.6rem', marginRight: 4 }} onClick={() => setEditing(p)}>Edit</button>
                      <button style={{ ...styles.btnDanger, fontSize: '0.78rem', padding: '0.25rem 0.6rem' }} onClick={() => setDeleteConfirm(p.id)}>Delete</button>
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
        <PoolForm
          initial={{}}
          onSave={body => createMut.mutate(body)}
          onClose={() => setShowForm(false)}
          saving={createMut.isPending}
          editMode={false}
        />
      )}

      {editing && (
        <PoolForm
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
            <p style={{ marginBottom: '1.5rem' }}>{t('nat_management.delete_confirm', 'Delete this NAT pool?')}</p>
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
