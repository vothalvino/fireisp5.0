// =============================================================================
// FireISP 5.0 — Maintenance Window Management
// =============================================================================

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';
import { styles, modalStyles, RequiredMark, capitalize } from './crudStyles';

interface MaintenanceWindow {
  id: number;
  name: string;
  description: string | null;
  device_id: number | null;
  site_id: number | null;
  starts_at: string;
  ends_at: string;
  is_recurring: boolean;
  status: string;
}

interface WindowsResponse {
  data: MaintenanceWindow[];
  meta: { total: number; page: number; limit: number };
}

interface WindowBody {
  name: string;
  description?: string;
  device_id?: number;
  site_id?: number;
  starts_at: string;
  ends_at: string;
  is_recurring?: boolean;
  recurrence_cron?: string;
  recurrence_duration_minutes?: number;
  status?: string;
}

const PAGE_SIZE = 25;
const STATUSES = ['scheduled', 'active', 'completed', 'cancelled'];

async function fetchWindows(page: number): Promise<WindowsResponse> {
  const res = await api.GET('/alerts/maintenance-windows' as never, { params: { query: { page, limit: PAGE_SIZE } as never } } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to load maintenance windows');
  return (res as { data: unknown }).data as unknown as WindowsResponse;
}

async function createWindow(body: WindowBody): Promise<void> {
  const res = await api.POST('/alerts/maintenance-windows' as never, { body: body as never } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to create maintenance window');
}

async function updateWindow(id: number, body: Partial<WindowBody>): Promise<void> {
  const res = await api.PUT('/alerts/maintenance-windows/{id}' as never, { params: { path: { id } }, body: body as never } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to update maintenance window');
}

async function deleteWindow(id: number): Promise<void> {
  const res = await api.DELETE('/alerts/maintenance-windows/{id}' as never, { params: { path: { id } } } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to delete maintenance window');
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, { bg: string; color: string }> = {
    active:    { bg: '#d1fae5', color: '#065f46' },
    scheduled: { bg: '#dbeafe', color: '#1e40af' },
    completed: { bg: '#f3f4f6', color: '#374151' },
    cancelled: { bg: '#fee2e2', color: '#991b1b' },
  };
  const c = colors[status] ?? { bg: '#f3f4f6', color: '#374151' };
  return (
    <span style={{ background: c.bg, color: c.color, padding: '2px 8px', borderRadius: 12, fontSize: '0.72rem', fontWeight: 600, textTransform: 'capitalize' }}>
      {status}
    </span>
  );
}

interface WindowFormProps {
  initial: Partial<MaintenanceWindow>;
  onSave: (body: WindowBody) => void;
  onClose: () => void;
  saving: boolean;
  editMode: boolean;
}

function WindowForm({ initial, onSave, onClose, saving, editMode }: WindowFormProps) {
  const { t } = useTranslation();
  const [name, setName] = useState(initial.name ?? '');
  const [description, setDescription] = useState(initial.description ?? '');
  const [startsAt, setStartsAt] = useState(initial.starts_at ? initial.starts_at.slice(0, 16) : '');
  const [endsAt, setEndsAt] = useState(initial.ends_at ? initial.ends_at.slice(0, 16) : '');
  const [status, setStatus] = useState(initial.status ?? 'scheduled');

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const body: WindowBody = { name, starts_at: startsAt, ends_at: endsAt, status };
    if (description) body.description = description;
    onSave(body);
  }

  const inp: React.CSSProperties = { ...modalStyles.input, width: '100%', boxSizing: 'border-box' as const };

  return (
    <div style={modalStyles.backdrop} onClick={onClose}>
      <div style={{ ...modalStyles.panel, maxWidth: 520 }} onClick={e => e.stopPropagation()}>
        <div style={modalStyles.header}>
          <h3 style={modalStyles.title}>{editMode ? t('maintenance_windows.edit', 'Edit Maintenance Window') : t('maintenance_windows.new', 'New Maintenance Window')}</h3>
          <button style={modalStyles.closeBtn} onClick={onClose} aria-label="Close">x</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: '0.75rem' }}>
            <label style={modalStyles.label}>{t('maintenance_windows.name', 'Window Name')}<RequiredMark /></label>
            <input style={inp} value={name} onChange={e => setName(e.target.value)} required />
          </div>
          <div style={{ marginBottom: '0.75rem' }}>
            <label style={modalStyles.label}>{t('maintenance_windows.description', 'Description')}</label>
            <textarea style={{ ...inp, minHeight: 64, resize: 'vertical' as const }} value={description} onChange={e => setDescription(e.target.value)} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
            <div>
              <label style={modalStyles.label}>{t('maintenance_windows.starts_at', 'Starts At')}<RequiredMark /></label>
              <input type="datetime-local" style={inp} value={startsAt} onChange={e => setStartsAt(e.target.value)} required />
            </div>
            <div>
              <label style={modalStyles.label}>{t('maintenance_windows.ends_at', 'Ends At')}<RequiredMark /></label>
              <input type="datetime-local" style={inp} value={endsAt} onChange={e => setEndsAt(e.target.value)} required />
            </div>
          </div>
          <div style={{ marginBottom: '1rem' }}>
            <label style={modalStyles.label}>{t('maintenance_windows.status', 'Status')}</label>
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

export function MaintenanceWindowList() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<MaintenanceWindow | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null);

  const windowsQ = useQuery({
    queryKey: ['maintenance-windows', page],
    queryFn: () => fetchWindows(page),
  });

  const windows = windowsQ.data?.data ?? [];
  const meta = windowsQ.data?.meta;

  function showMsg(type: 'ok' | 'err', msg: string) {
    setFeedback({ type, msg });
    setTimeout(() => setFeedback(null), 4000);
  }

  const createMut = useMutation({
    mutationFn: createWindow,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['maintenance-windows'] }); setShowForm(false); showMsg('ok', t('maintenance_windows.create_success', 'Maintenance window created.')); },
    onError: () => showMsg('err', t('maintenance_windows.create_error', 'Failed to create maintenance window.')),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, body }: { id: number; body: Partial<WindowBody> }) => updateWindow(id, body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['maintenance-windows'] }); setEditing(null); showMsg('ok', t('maintenance_windows.update_success', 'Maintenance window updated.')); },
    onError: () => showMsg('err', t('maintenance_windows.update_error', 'Failed to update maintenance window.')),
  });

  const deleteMut = useMutation({
    mutationFn: deleteWindow,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['maintenance-windows'] }); setDeleteConfirm(null); showMsg('ok', t('maintenance_windows.delete_success', 'Maintenance window deleted.')); },
    onError: () => showMsg('err', t('maintenance_windows.delete_error', 'Failed to delete maintenance window.')),
  });

  const totalPages = meta ? Math.ceil(meta.total / PAGE_SIZE) : 1;

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.pageTitle}>{t('maintenance_windows.title', 'Maintenance Windows')}</h1>
        {meta && <span style={styles.countBadge}>{meta.total} total</span>}
        <button style={{ ...styles.btnPrimary, marginLeft: 'auto' }} onClick={() => setShowForm(true)}>
          + {t('maintenance_windows.new', 'New Maintenance Window')}
        </button>
      </div>

      {feedback && (
        <div style={{ padding: '0.6rem 1rem', borderRadius: 6, marginBottom: '1rem', background: feedback.type === 'ok' ? '#d1fae5' : '#fee2e2', color: feedback.type === 'ok' ? '#065f46' : '#991b1b', fontSize: '0.85rem' }}>
          {feedback.msg}
        </div>
      )}

      <div style={styles.tableCard}>
        {windowsQ.isLoading ? (
          <p style={styles.msg}>Loading...</p>
        ) : windowsQ.error ? (
          <p style={styles.msgError}>{t('maintenance_windows.error', 'Failed to load maintenance windows.')}</p>
        ) : windows.length === 0 ? (
          <p style={styles.msg}>{t('maintenance_windows.empty', 'No maintenance windows found.')}</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>Name</th>
                  <th style={styles.th}>Starts At</th>
                  <th style={styles.th}>Ends At</th>
                  <th style={styles.th}>Status</th>
                  <th style={styles.th}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {windows.map(w => (
                  <tr key={w.id} style={styles.tr}>
                    <td style={styles.td}><strong>{w.name}</strong></td>
                    <td style={styles.td}>{w.starts_at}</td>
                    <td style={styles.td}>{w.ends_at}</td>
                    <td style={styles.td}><StatusBadge status={w.status} /></td>
                    <td style={styles.td}>
                      <button style={{ ...styles.btnSecondary, fontSize: '0.78rem', padding: '0.25rem 0.6rem', marginRight: 4 }} onClick={() => setEditing(w)}>Edit</button>
                      <button style={{ ...styles.btnDanger, fontSize: '0.78rem', padding: '0.25rem 0.6rem' }} onClick={() => setDeleteConfirm(w.id)}>Delete</button>
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
        <WindowForm initial={{}} onSave={body => createMut.mutate(body)} onClose={() => setShowForm(false)} saving={createMut.isPending} editMode={false} />
      )}
      {editing && (
        <WindowForm initial={editing} onSave={body => updateMut.mutate({ id: editing.id, body })} onClose={() => setEditing(null)} saving={updateMut.isPending} editMode={true} />
      )}
      {deleteConfirm !== null && (
        <div style={modalStyles.backdrop} onClick={() => setDeleteConfirm(null)}>
          <div style={{ ...modalStyles.panel, maxWidth: 380 }} onClick={e => e.stopPropagation()}>
            <p style={{ marginBottom: '1.5rem' }}>{t('maintenance_windows.delete_confirm', 'Delete this maintenance window?')}</p>
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
