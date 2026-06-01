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
import { api } from '@/api/client';
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
}

function ConfirmDialog({ message, onConfirm, onCancel }: ConfirmDialogProps) {
  return (
    <div style={modalStyles.backdrop} onClick={onCancel}>
      <div
        style={{ ...modalStyles.panel, maxWidth: 380 }}
        onClick={e => e.stopPropagation()}
        role="alertdialog"
        aria-label="Confirm action"
      >
        <p style={{ margin: '0 0 1.25rem', fontSize: '0.95rem', color: 'var(--text-primary)' }}>{message}</p>
        <div style={modalStyles.actions}>
          <button onClick={onCancel} style={styles.btnSecondary}>No, go back</button>
          <button onClick={onConfirm} style={styles.btnDanger}>Yes, confirm</button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ScheduledTaskList component
// ---------------------------------------------------------------------------

export function ScheduledTaskList() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [showNew, setShowNew] = useState(false);
  const [editTask, setEditTask] = useState<ScheduledTask | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);

  const tasksQ = useQuery({
    queryKey: ['scheduled-tasks', page],
    queryFn: () => fetchTasks(page),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteTask(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['scheduled-tasks'] }),
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
        <button style={{ ...styles.btnPrimary, marginLeft: 'auto' }} onClick={() => setShowNew(true)}>
          + New Task
        </button>
      </div>

      {deleteMutation.isError && (
        <p style={{ color: '#ef4444', marginBottom: '0.75rem', fontSize: '0.85rem' }}>
          Action failed. Please try again.
        </p>
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
                  {tasks.map(t => (
                    <tr key={t.id} style={styles.tr}>
                      <td style={styles.td}>#{t.id}</td>
                      <td style={{ ...styles.td, fontWeight: 500 }}>{t.task_name}</td>
                      <td style={styles.td}>{t.task_type.replace(/_/g, ' ')}</td>
                      <td style={{ ...styles.td, fontFamily: 'monospace' }}>{t.cron_expression ?? '—'}</td>
                      <td style={{ ...styles.td, textTransform: 'capitalize' }}>{t.priority}</td>
                      <td style={styles.td}>{t.is_enabled ? '✅' : '⏸'}</td>
                      <td style={styles.td}>
                        {t.last_run_at ? fmtDate(t.last_run_at) : '—'} <StatusBadge status={t.last_status} />
                      </td>
                      <td style={{ ...styles.td, whiteSpace: 'nowrap' }}>
                        <button style={styles.actionBtn} onClick={() => setEditTask(t)} title="Edit this task">
                          ✏️ Edit
                        </button>
                        <button
                          style={{ ...styles.actionBtn, color: '#991b1b' }}
                          onClick={() => setDeleteId(t.id)}
                          title="Delete this task"
                        >
                          🗑 Delete
                        </button>
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
    </div>
  );
}
