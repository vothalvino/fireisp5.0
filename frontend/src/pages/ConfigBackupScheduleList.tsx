// =============================================================================
// FireISP 5.0 — Config Backup Schedule Management — §6.6
// =============================================================================

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';
import { styles, modalStyles, RequiredMark } from './crudStyles';

interface ConfigBackupSchedule {
  id: number;
  schedule_name: string;
  device_id: number | null;
  cron_expression: string;
  is_enabled: number;
  last_run_at: string | null;
  last_status: string | null;
}

interface ConfigBackupSchedulesResponse {
  data: ConfigBackupSchedule[];
  meta: { total: number; page: number; limit: number };
}

interface ScheduleBody {
  schedule_name: string;
  device_id?: number;
  cron_expression?: string;
  is_enabled?: boolean;
}

const PAGE_SIZE = 25;

async function fetchSchedules(page: number): Promise<ConfigBackupSchedulesResponse> {
  const res = await api.GET('/config-backup-schedules' as never, { params: { query: { page, limit: PAGE_SIZE } as never } } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to load backup schedules');
  return (res as { data: unknown }).data as unknown as ConfigBackupSchedulesResponse;
}

async function createSchedule(body: ScheduleBody): Promise<void> {
  const res = await api.POST('/config-backup-schedules' as never, { body: body as never } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to create backup schedule');
}

async function updateSchedule(id: number, body: Partial<ScheduleBody>): Promise<void> {
  const res = await api.PUT('/config-backup-schedules/{id}' as never, { params: { path: { id } }, body: body as never } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to update backup schedule');
}

async function deleteSchedule(id: number): Promise<void> {
  const res = await api.DELETE('/config-backup-schedules/{id}' as never, { params: { path: { id } } } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to delete backup schedule');
}

interface ScheduleFormProps {
  initial: Partial<ConfigBackupSchedule>;
  onSave: (body: ScheduleBody) => void;
  onClose: () => void;
  saving: boolean;
  editMode: boolean;
}

function ScheduleForm({ initial, onSave, onClose, saving, editMode }: ScheduleFormProps) {
  const { t } = useTranslation();
  const [scheduleName, setScheduleName] = useState(initial.schedule_name ?? '');
  const [deviceId, setDeviceId] = useState(initial.device_id ? String(initial.device_id) : '');
  const [cronExpression, setCronExpression] = useState(initial.cron_expression ?? '0 2 * * *');
  const [isEnabled, setIsEnabled] = useState(initial.is_enabled !== 0);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const body: ScheduleBody = { schedule_name: scheduleName, cron_expression: cronExpression, is_enabled: isEnabled };
    if (deviceId) body.device_id = Number(deviceId);
    onSave(body);
  }

  const inp: React.CSSProperties = { ...modalStyles.input, width: '100%', boxSizing: 'border-box' as const };

  return (
    <div style={modalStyles.backdrop} onClick={onClose}>
      <div style={{ ...modalStyles.panel, maxWidth: 480 }} onClick={e => e.stopPropagation()}>
        <div style={modalStyles.header}>
          <h3 style={modalStyles.title}>{editMode ? t('config_backup_schedules.edit') : t('config_backup_schedules.new')}</h3>
          <button style={modalStyles.closeBtn} onClick={onClose} aria-label="Close">x</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: '0.75rem' }}>
            <label style={modalStyles.label}>{t('config_backup_schedules.schedule_name')}<RequiredMark /></label>
            <input style={inp} value={scheduleName} onChange={e => setScheduleName(e.target.value)} required />
          </div>
          <div style={{ marginBottom: '0.75rem' }}>
            <label style={modalStyles.label}>{t('config_backup_schedules.device_id')}</label>
            <input style={inp} type="number" min="1" value={deviceId} onChange={e => setDeviceId(e.target.value)} placeholder="Device ID (optional)" />
          </div>
          <div style={{ marginBottom: '0.75rem' }}>
            <label style={modalStyles.label}>{t('config_backup_schedules.cron_expression')}</label>
            <input style={inp} value={cronExpression} onChange={e => setCronExpression(e.target.value)} placeholder="0 2 * * *" />
          </div>
          <div style={{ marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: 8 }}>
            <input type="checkbox" id="is_enabled_sched" checked={isEnabled} onChange={e => setIsEnabled(e.target.checked)} />
            <label htmlFor="is_enabled_sched" style={{ cursor: 'pointer' }}>{t('config_backup_schedules.is_enabled')}</label>
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

export function ConfigBackupScheduleList() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<ConfigBackupSchedule | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null);

  const schedulesQ = useQuery({
    queryKey: ['config-backup-schedules', page],
    queryFn: () => fetchSchedules(page),
  });

  const schedules = schedulesQ.data?.data ?? [];
  const meta = schedulesQ.data?.meta;

  function showMsg(type: 'ok' | 'err', msg: string) {
    setFeedback({ type, msg });
    setTimeout(() => setFeedback(null), 4000);
  }

  const createMut = useMutation({
    mutationFn: createSchedule,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['config-backup-schedules'] }); setShowForm(false); showMsg('ok', t('config_backup_schedules.create_success')); },
    onError: () => showMsg('err', t('config_backup_schedules.create_error')),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, body }: { id: number; body: Partial<ScheduleBody> }) => updateSchedule(id, body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['config-backup-schedules'] }); setEditing(null); showMsg('ok', t('config_backup_schedules.update_success')); },
    onError: () => showMsg('err', t('config_backup_schedules.update_error')),
  });

  const deleteMut = useMutation({
    mutationFn: deleteSchedule,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['config-backup-schedules'] }); setDeleteConfirm(null); showMsg('ok', t('config_backup_schedules.delete_success')); },
    onError: () => showMsg('err', t('config_backup_schedules.delete_error')),
  });

  const totalPages = meta ? Math.ceil(meta.total / PAGE_SIZE) : 1;

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.pageTitle}>{t('config_backup_schedules.title')}</h1>
        {meta && <span style={styles.countBadge}>{meta.total} total</span>}
        <button style={{ ...styles.btnPrimary, marginLeft: 'auto' }} onClick={() => setShowForm(true)}>
          + {t('config_backup_schedules.new')}
        </button>
      </div>

      {feedback && (
        <div style={{ padding: '0.6rem 1rem', borderRadius: 6, marginBottom: '1rem', background: feedback.type === 'ok' ? '#d1fae5' : '#fee2e2', color: feedback.type === 'ok' ? '#065f46' : '#991b1b', fontSize: '0.85rem' }}>
          {feedback.msg}
        </div>
      )}

      <div style={styles.tableCard}>
        {schedulesQ.isLoading ? (
          <p style={styles.msg}>Loading...</p>
        ) : schedulesQ.error ? (
          <p style={styles.msgError}>{t('config_backup_schedules.error')}</p>
        ) : schedules.length === 0 ? (
          <p style={styles.msg}>{t('config_backup_schedules.empty')}</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={styles.table}>
              <thead>
                <tr>
                  {['Name', 'Device', 'Cron', 'Enabled', 'Last Run', 'Last Status', 'Actions'].map(h => <th key={h} style={styles.th}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {schedules.map(s => (
                  <tr key={s.id} style={styles.tr}>
                    <td style={styles.td}><strong>{s.schedule_name}</strong></td>
                    <td style={styles.td}>{s.device_id ?? '—'}</td>
                    <td style={styles.td}><code style={{ fontSize: '0.8rem' }}>{s.cron_expression}</code></td>
                    <td style={styles.td}>{s.is_enabled ? 'Yes' : 'No'}</td>
                    <td style={styles.td}>{s.last_run_at ? new Date(s.last_run_at).toLocaleString() : '—'}</td>
                    <td style={styles.td}>{s.last_status ?? '—'}</td>
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

      {showForm && <ScheduleForm initial={{}} onSave={body => createMut.mutate(body)} onClose={() => setShowForm(false)} saving={createMut.isPending} editMode={false} />}
      {editing && <ScheduleForm initial={editing} onSave={body => updateMut.mutate({ id: editing.id, body })} onClose={() => setEditing(null)} saving={updateMut.isPending} editMode={true} />}

      {deleteConfirm !== null && (
        <div style={modalStyles.backdrop} onClick={() => setDeleteConfirm(null)}>
          <div style={{ ...modalStyles.panel, maxWidth: 380 }} onClick={e => e.stopPropagation()}>
            <p style={{ marginBottom: '1.5rem' }}>{t('config_backup_schedules.delete_confirm')}</p>
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
