// =============================================================================
// FireISP 5.0 — Scheduled Task Management
// =============================================================================
// Standalone page at /scheduled-tasks. Lists background/cron tasks with a
// "New Task" create modal plus per-row Edit and Delete. All mutations go
// through the typed `api` client + React Query, invalidating the
// ['scheduled-tasks'] query so the list refreshes automatically.
// =============================================================================

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';
import { useAuth } from '@/auth/AuthContext';
import { can } from '@/auth/permissions';
import { extractApiError } from '@/components/ClientFormModal';
import { styles, modalStyles, RequiredMark, capitalize, fmtDate } from './crudStyles';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ScheduledTask {
  id: number;
  task_name: string;
  task_type: string;
  cron_expression: string | null;
  description: string | null;
  priority: string;
  is_enabled: number | boolean;
  last_run_at: string | null;
  last_status: string | null;
  is_global?: number | boolean;
}

interface TasksResponse {
  data: ScheduledTask[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

interface CreateTaskBody {
  task_name: string;
  task_type: string;
  cron_expression: string;
  description?: string;
  payload?: string;
  priority?: string;
  is_enabled?: boolean;
}

interface UpdateTaskBody {
  task_name?: string;
  cron_expression?: string;
  description?: string;
  payload?: string;
  priority?: string;
  is_enabled?: boolean;
}

interface RunTaskResponse {
  task_name: string;
  result: unknown;
}

type RunOutcome =
  | { kind: 'success'; taskName: string; result: unknown }
  | { kind: 'error'; taskName: string; message: string };

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_PAGE_SIZE = 25;
const TASK_TYPES = [
  'auto_suspend', 'generate_invoice', 'radius_sync', 'populate_revenue_summary',
  'populate_network_health_snapshots', 'csd_expiry_monitor', 'snmp_poll',
  'webhook_delivery', 'email_send',
];
const PRIORITIES = ['low', 'normal', 'high', 'critical'];

// ---------------------------------------------------------------------------
// Fetch / mutate helpers
// ---------------------------------------------------------------------------

async function fetchTasks(page: number): Promise<TasksResponse> {
  const query = { page, limit: DEFAULT_PAGE_SIZE };
  const res = await api.GET('/scheduled-tasks', { params: { query: query as never } });
  if (res.error) throw new Error('Failed to load scheduled tasks');
  return res.data as unknown as TasksResponse;
}

async function createTask(body: CreateTaskBody): Promise<void> {
  const res = await api.POST('/scheduled-tasks', { body: body as never });
  if (res.error) throw new Error('Failed to create scheduled task');
}

async function updateTask(id: number, body: UpdateTaskBody): Promise<void> {
  const res = await api.PUT('/scheduled-tasks/{id}', { params: { path: { id } }, body: body as never });
  if (res.error) throw new Error('Failed to update scheduled task');
}

async function deleteTask(id: number): Promise<void> {
  const res = await api.DELETE('/scheduled-tasks/{id}', { params: { path: { id } } });
  if (res.error) throw new Error('Failed to delete scheduled task');
}

async function runScheduledTask(task: ScheduledTask): Promise<RunTaskResponse> {
  const res = await api.POST('/scheduled-tasks/{id}/run', {
    params: { path: { id: task.id } },
  });
  if (res.error) {
    throw new Error(extractApiError(res.error, 'Failed to run scheduled task'));
  }

  const envelope = res.data as { data?: Partial<RunTaskResponse> } | undefined;
  return {
    task_name: envelope?.data?.task_name ?? task.task_name,
    result: envelope?.data?.result,
  };
}

function formatTaskResult(result: unknown): string | null {
  if (result === null || result === undefined) return null;
  if (typeof result === 'string') return result;
  if (typeof result === 'number' || typeof result === 'boolean') return String(result);
  try {
    return JSON.stringify(result, null, 2);
  } catch {
    return String(result);
  }
}

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: string | null }) {
  if (!status) return <span style={{ color: 'var(--text-muted)' }}>—</span>;
  const map: Record<string, { bg: string; color: string }> = {
    success: { bg: '#d1fae5', color: '#065f46' },
    failed: { bg: '#fee2e2', color: '#991b1b' },
    running: { bg: '#dbeafe', color: '#1e40af' },
    skipped: { bg: '#f3f4f6', color: '#374151' },
    timed_out: { bg: '#fef3c7', color: '#92400e' },
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
      {status.replace(/_/g, ' ')}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Task form modal (create + edit)
// ---------------------------------------------------------------------------

interface TaskModalProps {
  task: ScheduledTask | null;
  onClose: () => void;
  onSaved: () => void;
}

function TaskModal({ task, onClose, onSaved }: TaskModalProps) {
  const isEdit = task !== null;
  const [form, setForm] = useState({
    task_name: task?.task_name ?? '',
    task_type: task?.task_type ?? TASK_TYPES[0],
    cron_expression: task?.cron_expression ?? '',
    description: task?.description ?? '',
    payload: '',
    priority: task?.priority ?? 'normal',
    is_enabled: task ? Boolean(task.is_enabled) : true,
  });
  const [error, setError] = useState('');

  function setField(name: string, value: unknown) {
    setForm(prev => ({ ...prev, [name]: value }));
  }

  const mutation = useMutation({
    mutationFn: () => {
      if (isEdit) {
        const body: UpdateTaskBody = {
          task_name: form.task_name.trim(),
          cron_expression: form.cron_expression.trim(),
          priority: form.priority,
          is_enabled: form.is_enabled,
        };
        if (form.description) body.description = form.description;
        if (form.payload) body.payload = form.payload;
        return updateTask(task.id, body);
      }
      const body: CreateTaskBody = {
        task_name: form.task_name.trim(),
        task_type: form.task_type,
        cron_expression: form.cron_expression.trim(),
        priority: form.priority,
        is_enabled: form.is_enabled,
      };
      if (form.description) body.description = form.description;
      if (form.payload) body.payload = form.payload;
      return createTask(body);
    },
    onSuccess: () => {
      onSaved();
      onClose();
    },
    onError: () => setError('Failed to save scheduled task. Check all fields and try again.'),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.task_name.trim()) {
      setError('Task name is required.');
      return;
    }
    if (!form.cron_expression.trim()) {
      setError('Cron expression is required.');
      return;
    }
    if (form.payload) {
      try {
        JSON.parse(form.payload);
      } catch {
        setError('Payload must be valid JSON.');
        return;
      }
    }
    setError('');
    mutation.mutate();
  }

  return (
    <div style={modalStyles.backdrop} onClick={onClose}>
      <div
        style={modalStyles.panel}
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={isEdit ? `Edit task ${task.task_name}` : 'New scheduled task'}
      >
        <div style={modalStyles.header}>
          <h2 style={modalStyles.title}>{isEdit ? `📝 Edit Task #${task.id}` : '⏰ New Scheduled Task'}</h2>
          <button style={modalStyles.closeBtn} onClick={onClose} aria-label="Close">✕</button>
        </div>

        <form onSubmit={handleSubmit} style={modalStyles.form}>
          <label style={modalStyles.label}>
            Task name <RequiredMark />
            <input
              style={modalStyles.input}
              type="text"
              maxLength={100}
              value={form.task_name}
              onChange={e => setField('task_name', e.target.value)}
              placeholder="e.g. nightly-auto-suspend"
              required
            />
          </label>

          <label style={modalStyles.label}>
            Task type {!isEdit && <RequiredMark />}
            <select
              style={modalStyles.select}
              value={form.task_type}
              onChange={e => setField('task_type', e.target.value)}
              disabled={isEdit}
            >
              {TASK_TYPES.map(tt => (
                <option key={tt} value={tt}>{capitalize(tt.replace(/_/g, ' '))}</option>
              ))}
            </select>
          </label>

          <label style={modalStyles.label}>
            Cron expression <RequiredMark />
            <input
              style={modalStyles.input}
              type="text"
              maxLength={100}
              value={form.cron_expression}
              onChange={e => setField('cron_expression', e.target.value)}
              placeholder="0 2 * * *"
              required
            />
          </label>

          <label style={modalStyles.label}>
            Priority
            <select
              style={modalStyles.select}
              value={form.priority}
              onChange={e => setField('priority', e.target.value)}
            >
              {PRIORITIES.map(p => <option key={p} value={p}>{capitalize(p)}</option>)}
            </select>
          </label>

          <label style={modalStyles.label}>
            Description
            <input
              style={modalStyles.input}
              type="text"
              maxLength={500}
              value={form.description}
              onChange={e => setField('description', e.target.value)}
            />
          </label>

          <label style={modalStyles.label}>
            Payload (JSON)
            <textarea
              style={{ ...modalStyles.input, minHeight: 60, resize: 'vertical', fontFamily: 'monospace' }}
              maxLength={5000}
              value={form.payload}
              onChange={e => setField('payload', e.target.value)}
              placeholder='{"key": "value"}'
            />
          </label>

          <label style={{ ...modalStyles.label, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <input
              type="checkbox"
              checked={form.is_enabled}
              onChange={e => setField('is_enabled', e.target.checked)}
            />
            Enabled
          </label>

          {error && <p style={modalStyles.error}>{error}</p>}

          <div style={modalStyles.actions}>
            <button type="button" onClick={onClose} style={styles.btnSecondary} disabled={mutation.isPending}>
              Cancel
            </button>
            <button type="submit" style={styles.btnPrimary} disabled={mutation.isPending}>
              {mutation.isPending ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Task'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Confirm dialog
// ---------------------------------------------------------------------------

interface ConfirmDialogProps {
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
  confirmLabel?: string;
  cancelLabel?: string;
  ariaLabel?: string;
  busy?: boolean;
  destructive?: boolean;
}

function ConfirmDialog({
  message,
  onConfirm,
  onCancel,
  confirmLabel = 'Yes, confirm',
  cancelLabel = 'No, go back',
  ariaLabel = 'Confirm action',
  busy = false,
  destructive = true,
}: ConfirmDialogProps) {
  return (
    <div style={modalStyles.backdrop} onClick={() => { if (!busy) onCancel(); }}>
      <div
        style={{ ...modalStyles.panel, maxWidth: 380 }}
        onClick={e => e.stopPropagation()}
        role="alertdialog"
        aria-label={ariaLabel}
        aria-busy={busy}
      >
        <p style={{ margin: '0 0 1.25rem', fontSize: '0.95rem', color: 'var(--text-primary)' }}>{message}</p>
        <div style={{ ...modalStyles.actions, flexWrap: 'wrap' }}>
          <button type="button" onClick={onCancel} style={styles.btnSecondary} disabled={busy}>
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            style={destructive ? styles.btnDanger : styles.btnPrimary}
            disabled={busy}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ScheduledTaskList component
// ---------------------------------------------------------------------------

export function ScheduledTaskList() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [showNew, setShowNew] = useState(false);
  const [editTask, setEditTask] = useState<ScheduledTask | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [runCandidate, setRunCandidate] = useState<ScheduledTask | null>(null);
  const [runOutcome, setRunOutcome] = useState<RunOutcome | null>(null);

  // task_name selects executable backend handlers. Even an org-owned row can
  // name an install-wide retention/backup/DR handler, so every executable
  // mutation (manual run or schedule CRUD) is an install-operator action.
  const canRun = can(user, 'scheduled_tasks.update') && user?.is_install_operator === true;
  const canCreate = can(user, 'scheduled_tasks.create') && user?.is_install_operator === true;
  const canUpdate = can(user, 'scheduled_tasks.update') && user?.is_install_operator === true;
  const canDelete = can(user, 'scheduled_tasks.delete') && user?.is_install_operator === true;

  const tasksQ = useQuery({
    queryKey: ['scheduled-tasks', page],
    queryFn: () => fetchTasks(page),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteTask(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['scheduled-tasks'] }),
  });

  const runMutation = useMutation({
    mutationFn: (task: ScheduledTask) => runScheduledTask(task),
    onSuccess: (data) => {
      setRunOutcome({ kind: 'success', taskName: data.task_name, result: data.result });
      setRunCandidate(null);
      queryClient.invalidateQueries({ queryKey: ['scheduled-tasks'] });
    },
    onError: (error: Error, task) => {
      setRunOutcome({ kind: 'error', taskName: task.task_name, message: error.message });
      setRunCandidate(null);
    },
  });

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ['scheduled-tasks'] });
  }

  const tasks = tasksQ.data?.data ?? [];
  const meta = tasksQ.data?.meta;

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.pageTitle}>⏰ Scheduled Tasks</h1>
        {meta && <span style={styles.countBadge}>{meta.total} total</span>}
        {canCreate && (
          <button style={{ ...styles.btnPrimary, marginLeft: 'auto' }} onClick={() => setShowNew(true)}>
            + New Task
          </button>
        )}
      </div>

      {deleteMutation.isError && (
        <p style={{ color: '#ef4444', marginBottom: '0.75rem', fontSize: '0.85rem' }}>
          Action failed. Please try again.
        </p>
      )}

      {runOutcome && (
        <div
          role={runOutcome.kind === 'success' ? 'status' : 'alert'}
          aria-live={runOutcome.kind === 'success' ? 'polite' : 'assertive'}
          style={{
            border: `1px solid ${runOutcome.kind === 'success' ? '#86efac' : 'var(--danger-border)'}`,
            background: runOutcome.kind === 'success' ? '#f0fdf4' : 'var(--danger-soft)',
            color: runOutcome.kind === 'success' ? '#166534' : 'var(--danger)',
            borderRadius: 6,
            padding: '0.75rem 1rem',
            marginBottom: '0.75rem',
            fontSize: '0.85rem',
            overflowWrap: 'anywhere',
          }}
        >
          <strong>
            {runOutcome.kind === 'success'
              ? t('scheduledTasksPage.runSuccess', { name: runOutcome.taskName })
              : t('scheduledTasksPage.runError', { name: runOutcome.taskName, message: runOutcome.message })}
          </strong>
          {runOutcome.kind === 'success' && formatTaskResult(runOutcome.result) && (
            <details style={{ marginTop: '0.5rem' }}>
              <summary style={{ cursor: 'pointer', fontWeight: 600 }}>
                {t('scheduledTasksPage.runResult')}
              </summary>
              <pre style={{
                margin: '0.5rem 0 0',
                maxHeight: 240,
                overflow: 'auto',
                whiteSpace: 'pre-wrap',
                overflowWrap: 'anywhere',
                fontFamily: 'var(--font-mono)',
                fontSize: '0.78rem',
              }}>
                {formatTaskResult(runOutcome.result)}
              </pre>
            </details>
          )}
        </div>
      )}

      <div style={styles.tableCard}>
        {tasksQ.isLoading ? (
          <p style={styles.msg}>Loading…</p>
        ) : tasksQ.error ? (
          <p style={styles.msgError}>Failed to load scheduled tasks.</p>
        ) : tasks.length === 0 ? (
          <p style={styles.msg}>No scheduled tasks found.</p>
        ) : (
          <>
            <div style={{ overflowX: 'auto' }}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    {['ID', 'Task', 'Type', 'Cron', 'Priority', 'Enabled', 'Last Run', 'Actions'].map(
                      h => <th key={h} style={styles.th}>{h}</th>,
                    )}
                  </tr>
                </thead>
                <tbody>
                  {tasks.map(task => (
                    <tr key={task.id} style={styles.tr}>
                      <td style={styles.td}>#{task.id}</td>
                      <td style={{ ...styles.td, fontWeight: 500 }}>{task.task_name}</td>
                      <td style={styles.td}>{task.task_type.replace(/_/g, ' ')}</td>
                      <td style={{ ...styles.td, fontFamily: 'monospace' }}>{task.cron_expression ?? '—'}</td>
                      <td style={{ ...styles.td, textTransform: 'capitalize' }}>{task.priority}</td>
                      <td style={styles.td}>{task.is_enabled ? '✅' : '⏸'}</td>
                      <td style={styles.td}>
                        {task.last_run_at ? fmtDate(task.last_run_at) : '—'} <StatusBadge status={task.last_status} />
                      </td>
                      <td style={styles.td}>
                        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.25rem', minWidth: 210 }}>
                          {canRun && (
                            <button
                              type="button"
                              style={{ ...styles.actionBtn, minHeight: 40, padding: '0.35rem 0.5rem' }}
                              onClick={() => {
                                setRunOutcome(null);
                                runMutation.reset();
                                setRunCandidate(task);
                              }}
                              disabled={runMutation.isPending}
                              title={t('scheduledTasksPage.runTitle')}
                            >
                              {runMutation.isPending && runCandidate?.id === task.id
                                ? t('scheduledTasksPage.running')
                                : t('scheduledTasksPage.runNow')}
                            </button>
                          )}
                          {canUpdate && !task.is_global && (
                            <button style={styles.actionBtn} onClick={() => setEditTask(task)} title="Edit this task">
                              ✏️ Edit
                            </button>
                          )}
                          {canDelete && !task.is_global && (
                            <button
                              style={{ ...styles.actionBtn, color: '#991b1b' }}
                              onClick={() => setDeleteId(task.id)}
                              title="Delete this task"
                            >
                              🗑 Delete
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {meta && meta.totalPages > 1 && (
              <div style={styles.pagination}>
                <button style={styles.pageBtn} onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>
                  ← Prev
                </button>
                <span style={styles.pageInfo}>Page {page} of {meta.totalPages}</span>
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

      {showNew && (
        <TaskModal task={null} onClose={() => setShowNew(false)} onSaved={invalidate} />
      )}
      {editTask && (
        <TaskModal task={editTask} onClose={() => setEditTask(null)} onSaved={invalidate} />
      )}

      {deleteId !== null && (
        <ConfirmDialog
          message="Delete this scheduled task? It will stop running."
          onConfirm={() => {
            deleteMutation.mutate(deleteId);
            setDeleteId(null);
          }}
          onCancel={() => setDeleteId(null)}
        />
      )}

      {runCandidate && (
        <ConfirmDialog
          ariaLabel={t('scheduledTasksPage.runTitle')}
          message={t(runCandidate.is_global
            ? 'scheduledTasksPage.runConfirmGlobal'
            : 'scheduledTasksPage.runConfirm', { name: runCandidate.task_name })}
          confirmLabel={runMutation.isPending
            ? t('scheduledTasksPage.running')
            : t('scheduledTasksPage.runConfirmButton')}
          cancelLabel={t('common.cancel')}
          busy={runMutation.isPending}
          destructive={false}
          onConfirm={() => runMutation.mutate(runCandidate)}
          onCancel={() => {
            runMutation.reset();
            setRunCandidate(null);
          }}
        />
      )}
    </div>
  );
}
