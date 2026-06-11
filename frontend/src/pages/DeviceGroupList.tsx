// =============================================================================
// FireISP 5.0 — Device Group Management
// =============================================================================
// Standalone page at /device-groups. Lists device groups with a status filter,
// paginated table, "New Device Group" create modal, and per-row Edit and Delete.
// =============================================================================

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';
import { styles, modalStyles, RequiredMark, capitalize } from './crudStyles';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DeviceGroup {
  id: number;
  name: string;
  description: string | null;
  group_type: string;
  color: string | null;
  status: string;
}

interface DeviceGroupsResponse {
  data: DeviceGroup[];
  meta: { total: number; page: number; limit: number };
}

interface DeviceGroupBody {
  name: string;
  description?: string;
  group_type?: string;
  color?: string;
  status?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PAGE_SIZE = 25;
const STATUSES = ['active', 'inactive'];
const GROUP_TYPES = ['type', 'location', 'region', 'olt', 'custom'];

// ---------------------------------------------------------------------------
// Fetch / mutate helpers
// ---------------------------------------------------------------------------

async function fetchGroups(page: number, statusFilter: string): Promise<DeviceGroupsResponse> {
  const query: Record<string, string | number> = { page, limit: PAGE_SIZE };
  if (statusFilter) query.status = statusFilter;
  const res = await api.GET('/device-groups' as never, { params: { query: query as never } } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to load device groups');
  return (res as { data: unknown }).data as unknown as DeviceGroupsResponse;
}

async function createGroup(body: DeviceGroupBody): Promise<void> {
  const res = await api.POST('/device-groups' as never, { body: body as never } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to create device group');
}

async function updateGroup(id: number, body: Partial<DeviceGroupBody>): Promise<void> {
  const res = await api.PUT('/device-groups/{id}' as never, { params: { path: { id } }, body: body as never } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to update device group');
}

async function deleteGroup(id: number): Promise<void> {
  const res = await api.DELETE('/device-groups/{id}' as never, { params: { path: { id } } } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to delete device group');
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
// Device group form modal
// ---------------------------------------------------------------------------

interface GroupFormProps {
  initial: Partial<DeviceGroup>;
  onSave: (body: DeviceGroupBody) => void;
  onClose: () => void;
  saving: boolean;
  editMode: boolean;
}

function GroupForm({ initial, onSave, onClose, saving, editMode }: GroupFormProps) {
  const { t } = useTranslation();
  const [name, setName] = useState(initial.name ?? '');
  const [description, setDescription] = useState(initial.description ?? '');
  const [groupType, setGroupType] = useState(initial.group_type ?? 'custom');
  const [color, setColor] = useState(initial.color ?? '');
  const [status, setStatus] = useState(initial.status ?? 'active');

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const body: DeviceGroupBody = { name, status };
    if (description) body.description = description;
    if (groupType) body.group_type = groupType;
    if (color) body.color = color;
    onSave(body);
  }

  const inp: React.CSSProperties = { ...modalStyles.input, width: '100%', boxSizing: 'border-box' as const };

  return (
    <div style={modalStyles.backdrop} onClick={onClose}>
      <div style={{ ...modalStyles.panel, maxWidth: 520 }} onClick={e => e.stopPropagation()}>
        <div style={modalStyles.header}>
          <h3 style={modalStyles.title}>{editMode ? t('device_groups.edit', 'Edit Device Group') : t('device_groups.new', 'New Device Group')}</h3>
          <button style={modalStyles.closeBtn} onClick={onClose} aria-label="Close">x</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: '0.75rem' }}>
            <label style={modalStyles.label}>{t('device_groups.name', 'Name')}<RequiredMark /></label>
            <input style={inp} value={name} onChange={e => setName(e.target.value)} required />
          </div>

          <div style={{ marginBottom: '0.75rem' }}>
            <label style={modalStyles.label}>{t('device_groups.description', 'Description')}</label>
            <textarea style={{ ...inp, minHeight: 64, resize: 'vertical' as const }} value={description} onChange={e => setDescription(e.target.value)} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
            <div>
              <label style={modalStyles.label}>{t('device_groups.group_type', 'Group Type')}</label>
              <select style={inp} value={groupType} onChange={e => setGroupType(e.target.value)}>
                {GROUP_TYPES.map(gt => <option key={gt} value={gt}>{capitalize(gt)}</option>)}
              </select>
            </div>
            <div>
              <label style={modalStyles.label}>{t('device_groups.color', 'Color')}</label>
              <input style={inp} value={color} onChange={e => setColor(e.target.value)} placeholder="#3b82f6" />
            </div>
          </div>

          <div style={{ marginBottom: '1rem' }}>
            <label style={modalStyles.label}>{t('device_groups.status', 'Status')}</label>
            <select style={inp} value={status} onChange={e => setStatus(e.target.value)}>
              {STATUSES.map(s => <option key={s} value={s}>{capitalize(s)}</option>)}
            </select>
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

export function DeviceGroupList() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('active');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<DeviceGroup | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null);

  const groupsQ = useQuery({
    queryKey: ['device-groups', page, statusFilter],
    queryFn: () => fetchGroups(page, statusFilter),
  });

  const groups = groupsQ.data?.data ?? [];
  const meta = groupsQ.data?.meta;

  function showMsg(type: 'ok' | 'err', msg: string) {
    setFeedback({ type, msg });
    setTimeout(() => setFeedback(null), 4000);
  }

  const createMut = useMutation({
    mutationFn: createGroup,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['device-groups'] });
      setShowForm(false);
      showMsg('ok', t('device_groups.create_success', 'Device group created.'));
    },
    onError: () => showMsg('err', t('device_groups.create_error', 'Failed to create device group.')),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, body }: { id: number; body: Partial<DeviceGroupBody> }) => updateGroup(id, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['device-groups'] });
      setEditing(null);
      showMsg('ok', t('device_groups.update_success', 'Device group updated.'));
    },
    onError: () => showMsg('err', t('device_groups.update_error', 'Failed to update device group.')),
  });

  const deleteMut = useMutation({
    mutationFn: deleteGroup,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['device-groups'] });
      setDeleteConfirm(null);
      showMsg('ok', t('device_groups.delete_success', 'Device group deleted.'));
    },
    onError: () => showMsg('err', t('device_groups.delete_error', 'Failed to delete device group.')),
  });

  const totalPages = meta ? Math.ceil(meta.total / PAGE_SIZE) : 1;

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.pageTitle}>{t('device_groups.title', 'Device Groups')}</h1>
        {meta && <span style={styles.countBadge}>{meta.total} total</span>}
        <button style={{ ...styles.btnPrimary, marginLeft: 'auto' }} onClick={() => setShowForm(true)}>
          + {t('device_groups.new', 'New Device Group')}
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
        {groupsQ.isLoading ? (
          <p style={styles.msg}>Loading...</p>
        ) : groupsQ.error ? (
          <p style={styles.msgError}>{t('device_groups.error', 'Failed to load device groups.')}</p>
        ) : groups.length === 0 ? (
          <p style={styles.msg}>{t('device_groups.empty', 'No device groups found.')}</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>Name</th>
                  <th style={styles.th}>Group Type</th>
                  <th style={styles.th}>Description</th>
                  <th style={styles.th}>Color</th>
                  <th style={styles.th}>Status</th>
                  <th style={styles.th}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {groups.map(g => (
                  <tr key={g.id} style={styles.tr}>
                    <td style={styles.td}><strong>{g.name}</strong></td>
                    <td style={styles.td}>{capitalize(g.group_type)}</td>
                    <td style={styles.td}>{g.description ?? '—'}</td>
                    <td style={styles.td}>
                      {g.color ? (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ display: 'inline-block', width: 14, height: 14, borderRadius: 3, background: g.color, border: '1px solid #d1d5db' }} />
                          {g.color}
                        </span>
                      ) : '—'}
                    </td>
                    <td style={styles.td}><StatusBadge status={g.status} /></td>
                    <td style={styles.td}>
                      <button style={{ ...styles.btnSecondary, fontSize: '0.78rem', padding: '0.25rem 0.6rem', marginRight: 4 }} onClick={() => setEditing(g)}>Edit</button>
                      <button style={{ ...styles.btnDanger, fontSize: '0.78rem', padding: '0.25rem 0.6rem' }} onClick={() => setDeleteConfirm(g.id)}>Delete</button>
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
        <GroupForm
          initial={{}}
          onSave={body => createMut.mutate(body)}
          onClose={() => setShowForm(false)}
          saving={createMut.isPending}
          editMode={false}
        />
      )}

      {editing && (
        <GroupForm
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
            <p style={{ marginBottom: '1.5rem' }}>{t('device_groups.delete_confirm', 'Delete this device group?')}</p>
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
