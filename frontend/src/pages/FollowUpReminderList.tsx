// =============================================================================
// FireISP 5.0 — Follow-up Reminders — §1.3
// =============================================================================
// CRUD for client follow-up reminders. Due reminders are notified automatically
// by the `follow_up_reminders` scheduled task; this page is the work queue.
// =============================================================================

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { useAuth } from '@/auth/AuthContext';
import { can } from '@/auth/permissions';
import {
  extractApiError,
  overlay,
  modalBox,
  errorBox,
  labelStyle,
  inputStyle,
  submitBtn,
  cancelBtn,
} from '@/components/ClientFormModal';

interface FollowUpReminder {
  id: number;
  client_id: number;
  ticket_id: number | null;
  assigned_to: number | null;
  title: string;
  notes: string | null;
  priority: string;
  status: string;
  due_at: string;
  notified_at: string | null;
  completed_at: string | null;
  created_at: string;
}

interface RemindersResponse {
  data: FollowUpReminder[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

interface ReminderFormBody {
  client_id: number;
  title: string;
  due_at: string;
  priority: string;
  notes?: string;
  ticket_id?: number;
}

const PRIORITIES = ['low', 'medium', 'high'];
const STATUSES = ['pending', 'completed', 'cancelled'];

// datetime-local gives "YYYY-MM-DDTHH:mm" — normalise to a MySQL DATETIME literal.
function toSqlDatetime(value: string): string {
  return value.replace('T', ' ') + (value.length === 16 ? ':00' : '');
}

async function fetchReminders(status: string): Promise<RemindersResponse> {
  const query: Record<string, unknown> = { limit: 200, order_by: 'due_at', order: 'ASC' };
  if (status) query.status = status;
  const res = await api.GET('/follow-up-reminders', { params: { query: query as never } });
  if (res.error) throw new Error('Failed to load follow-up reminders');
  return res.data as unknown as RemindersResponse;
}

function ReminderFormModal({
  mode,
  initial,
  onClose,
  onSaved,
}: {
  mode: 'create' | 'edit';
  initial?: FollowUpReminder;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    client_id: initial?.client_id ? String(initial.client_id) : '',
    title: initial?.title ?? '',
    due_at: initial?.due_at ? initial.due_at.slice(0, 16).replace(' ', 'T') : '',
    priority: initial?.priority ?? 'medium',
    notes: initial?.notes ?? '',
    ticket_id: initial?.ticket_id ? String(initial.ticket_id) : '',
  });
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: async (body: ReminderFormBody) => {
      if (mode === 'create') {
        const { error } = await api.POST('/follow-up-reminders', { body: body as never });
        if (error) throw new Error(extractApiError(error, 'Failed to create reminder'));
      } else {
        const { error } = await api.PUT('/follow-up-reminders/{id}', {
          params: { path: { id: initial!.id } },
          body: body as never,
        });
        if (error) throw new Error(extractApiError(error, 'Failed to update reminder'));
      }
    },
    onSuccess: () => { onSaved(); onClose(); },
    onError: (err: unknown) => setError(err instanceof Error ? err.message : 'Failed to save reminder'),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.client_id || !form.title.trim() || !form.due_at) {
      setError('Client ID, title, and due date are required.');
      return;
    }
    const body: ReminderFormBody = {
      client_id: Number(form.client_id),
      title: form.title.trim(),
      due_at: toSqlDatetime(form.due_at),
      priority: form.priority,
    };
    if (form.notes.trim()) body.notes = form.notes.trim();
    if (form.ticket_id) body.ticket_id = Number(form.ticket_id);
    setError('');
    mutation.mutate(body);
  }

  const title = mode === 'create' ? 'New Follow-up' : `Edit "${initial?.title ?? 'Follow-up'}"`;
  return (
    <div style={overlay} role="dialog" aria-modal="true" aria-label={title}>
      <div style={{ ...modalBox, width: 480, maxHeight: '90vh', overflowY: 'auto' }}>
        <h3 style={{ margin: '0 0 1rem' }}>{title}</h3>
        {error && <div style={errorBox}>{error}</div>}
        <form onSubmit={handleSubmit}>
          <label style={labelStyle}>Client ID *</label>
          <input style={inputStyle} type="number" min={1} value={form.client_id} autoFocus
            onChange={e => setForm(p => ({ ...p, client_id: e.target.value }))} required />

          <label style={labelStyle}>Title *</label>
          <input style={inputStyle} type="text" value={form.title}
            onChange={e => setForm(p => ({ ...p, title: e.target.value }))} required />

          <label style={labelStyle}>Due *</label>
          <input style={inputStyle} type="datetime-local" value={form.due_at}
            onChange={e => setForm(p => ({ ...p, due_at: e.target.value }))} required />

          <label style={labelStyle}>Priority</label>
          <select style={inputStyle} value={form.priority}
            onChange={e => setForm(p => ({ ...p, priority: e.target.value }))}>
            {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
          </select>

          <label style={labelStyle}>Ticket ID</label>
          <input style={inputStyle} type="number" min={1} value={form.ticket_id}
            onChange={e => setForm(p => ({ ...p, ticket_id: e.target.value }))} />

          <label style={labelStyle}>Notes</label>
          <textarea style={{ ...inputStyle, minHeight: 70 }} value={form.notes}
            onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} />

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

export function FollowUpReminderList() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState('pending');
  const [showCreate, setShowCreate] = useState(false);
  const [editReminder, setEditReminder] = useState<FollowUpReminder | null>(null);

  const canCreate = can(user?.role, 'follow_ups.create');
  const canUpdate = can(user?.role, 'follow_ups.update');

  const { data, isLoading, error } = useQuery({
    queryKey: ['follow-up-reminders', statusFilter],
    queryFn: () => fetchReminders(statusFilter),
  });

  const completeMutation = useMutation({
    mutationFn: async (id: number) => {
      const { error: e } = await api.POST('/follow-up-reminders/{id}/complete', {
        params: { path: { id } },
      });
      if (e) throw new Error(extractApiError(e, 'Failed to complete reminder'));
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['follow-up-reminders'] }),
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ['follow-up-reminders'] });
  const now = Date.now();

  return (
    <div style={{ padding: '1.5rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
        <h2 style={{ margin: 0 }}>Follow-up Reminders</h2>
        {canCreate && (
          <button type="button" style={submitBtn} onClick={() => setShowCreate(true)}>+ New Follow-up</button>
        )}
      </div>

      <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginTop: 0 }}>
        Schedule follow-ups with clients. Assignees are notified automatically when a reminder comes due.
      </p>

      <div style={{ margin: '0.5rem 0 1rem' }}>
        <select style={{ ...inputStyle, width: 200, marginBottom: 0 }} value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)} aria-label="Filter by status">
          <option value="">All statuses</option>
          {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      {isLoading && <p>Loading…</p>}
      {error && <div style={errorBox}>{(error as Error).message}</div>}

      {data && (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border-strong)' }}>
              <th style={{ padding: '8px' }}>Title</th>
              <th style={{ padding: '8px' }}>Client</th>
              <th style={{ padding: '8px' }}>Priority</th>
              <th style={{ padding: '8px' }}>Status</th>
              <th style={{ padding: '8px' }}>Due</th>
              <th style={{ padding: '8px', textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {data.data.length === 0 && (
              <tr><td colSpan={6} style={{ padding: '1rem', color: 'var(--text-secondary)' }}>No follow-ups yet.</td></tr>
            )}
            {data.data.map(r => {
              const overdue = r.status === 'pending' && new Date(r.due_at).getTime() < now;
              return (
                <tr key={r.id} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '8px', fontWeight: 600 }}>{r.title}</td>
                  <td style={{ padding: '8px' }}>#{r.client_id}</td>
                  <td style={{ padding: '8px', textTransform: 'capitalize' }}>{r.priority}</td>
                  <td style={{ padding: '8px', textTransform: 'capitalize' }}>{r.status}</td>
                  <td style={{ padding: '8px', color: overdue ? 'var(--danger, #dc2626)' : undefined }}>
                    {new Date(r.due_at).toLocaleString()}{overdue ? ' ⚠️' : ''}
                  </td>
                  <td style={{ padding: '8px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {canUpdate && r.status === 'pending' && (
                      <>
                        <button type="button" style={{ ...cancelBtn, padding: '4px 10px', marginRight: 6 }}
                          onClick={() => setEditReminder(r)}>Edit</button>
                        <button type="button" style={{ ...submitBtn, padding: '4px 10px' }}
                          disabled={completeMutation.isPending}
                          onClick={() => completeMutation.mutate(r.id)}>Complete</button>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {showCreate && (
        <ReminderFormModal mode="create" onClose={() => setShowCreate(false)} onSaved={refresh} />
      )}
      {editReminder && (
        <ReminderFormModal mode="edit" initial={editReminder} onClose={() => setEditReminder(null)} onSaved={refresh} />
      )}
    </div>
  );
}
