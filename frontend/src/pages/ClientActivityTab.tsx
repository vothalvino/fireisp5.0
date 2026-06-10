// =============================================================================
// FireISP 5.0 — Client Activity Timeline tab — §1.3
// =============================================================================
// Unified per-client history: manual interactions (calls, visits, chats),
// tickets, payments, emails, and SMS, merged server-side by
// GET /clients/{id}/timeline. Staff can log new interactions from here.
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

interface TimelineEvent {
  event_type: string;
  reference_id: number;
  subtype: string | null;
  title: string | null;
  detail: string | null;
  status: string | null;
  occurred_at: string;
}

const EVENT_ICONS: Record<string, string> = {
  interaction: '📞',
  ticket: '🎫',
  payment: '💳',
  email: '✉️',
  sms: '💬',
};

const INTERACTION_TYPES = ['call', 'email', 'sms', 'visit', 'chat', 'other'];

async function fetchTimeline(clientId: number): Promise<TimelineEvent[]> {
  const res = await api.GET('/clients/{id}/timeline', {
    params: { path: { id: clientId }, query: { limit: 200 } as never },
  });
  if (res.error) throw new Error('Failed to load activity timeline');
  return (res.data as unknown as { data: { events: TimelineEvent[] } }).data.events;
}

function LogInteractionModal({
  clientId,
  onClose,
  onSaved,
}: {
  clientId: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    interaction_type: 'call',
    direction: 'inbound',
    subject: '',
    notes: '',
    duration_minutes: '',
  });
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = {
        client_id: clientId,
        interaction_type: form.interaction_type,
        direction: form.direction,
        subject: form.subject.trim(),
      };
      if (form.notes.trim()) body.notes = form.notes.trim();
      if (form.duration_minutes) body.duration_minutes = Number(form.duration_minutes);
      const { error } = await api.POST('/interactions', { body: body as never });
      if (error) throw new Error(extractApiError(error, 'Failed to log interaction'));
    },
    onSuccess: () => { onSaved(); onClose(); },
    onError: (err: unknown) => setError(err instanceof Error ? err.message : 'Failed to log interaction'),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.subject.trim()) { setError('Subject is required.'); return; }
    setError('');
    mutation.mutate();
  }

  return (
    <div style={overlay} role="dialog" aria-modal="true" aria-label="Log Interaction">
      <div style={{ ...modalBox, width: 440 }}>
        <h3 style={{ margin: '0 0 1rem' }}>Log Interaction</h3>
        {error && <div style={errorBox}>{error}</div>}
        <form onSubmit={handleSubmit}>
          <label style={labelStyle}>Type</label>
          <select style={inputStyle} value={form.interaction_type}
            onChange={e => setForm(p => ({ ...p, interaction_type: e.target.value }))}>
            {INTERACTION_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>

          <label style={labelStyle}>Direction</label>
          <select style={inputStyle} value={form.direction}
            onChange={e => setForm(p => ({ ...p, direction: e.target.value }))}>
            <option value="inbound">inbound</option>
            <option value="outbound">outbound</option>
          </select>

          <label style={labelStyle}>Subject *</label>
          <input style={inputStyle} type="text" value={form.subject} autoFocus
            onChange={e => setForm(p => ({ ...p, subject: e.target.value }))} required />

          <label style={labelStyle}>Notes</label>
          <textarea style={{ ...inputStyle, minHeight: 70 }} value={form.notes}
            onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} />

          <label style={labelStyle}>Duration (minutes)</label>
          <input style={inputStyle} type="number" min={0} value={form.duration_minutes}
            onChange={e => setForm(p => ({ ...p, duration_minutes: e.target.value }))} />

          <div style={{ display: 'flex', gap: 8, marginTop: '1.25rem', justifyContent: 'flex-end' }}>
            <button type="button" onClick={onClose} style={cancelBtn}>Cancel</button>
            <button type="submit" style={submitBtn} disabled={mutation.isPending}>
              {mutation.isPending ? 'Saving…' : 'Log interaction'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function ActivityTimelineTab({ clientId }: { clientId: number }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [showLog, setShowLog] = useState(false);

  const canLog = can(user?.role, 'interactions.create');

  const { data: events, isLoading, error } = useQuery({
    queryKey: ['client-timeline', clientId],
    queryFn: () => fetchTimeline(clientId),
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ['client-timeline', clientId] });

  return (
    <div style={{ padding: '0.75rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
        <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
          Calls, emails, tickets, payments, and visits — newest first.
        </span>
        {canLog && (
          <button type="button" style={{ ...submitBtn, padding: '4px 12px' }} onClick={() => setShowLog(true)}>
            + Log interaction
          </button>
        )}
      </div>

      {isLoading && <p>Loading…</p>}
      {error && <div style={errorBox}>{(error as Error).message}</div>}

      {events && events.length === 0 && (
        <p style={{ color: 'var(--text-secondary)' }}>No activity recorded for this client yet.</p>
      )}

      {events && events.length > 0 && (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {events.map((ev, i) => (
            <li key={`${ev.event_type}-${ev.reference_id}-${i}`} style={{
              display: 'flex', gap: 12, padding: '10px 4px',
              borderBottom: '1px solid var(--border)',
            }}>
              <span style={{ fontSize: '1.1rem' }} aria-hidden>{EVENT_ICONS[ev.event_type] ?? '📌'}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: '0.875rem' }}>
                  {ev.title || `${ev.event_type} #${ev.reference_id}`}
                </div>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                  <span style={{ textTransform: 'capitalize' }}>{ev.event_type}</span>
                  {ev.subtype ? <> · <span style={{ textTransform: 'capitalize' }}>{String(ev.subtype).replace('_', ' ')}</span></> : null}
                  {ev.status ? <> · <span style={{ textTransform: 'capitalize' }}>{ev.status}</span></> : null}
                </div>
                {ev.detail && (
                  <div style={{ fontSize: '0.8rem', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {ev.detail}
                  </div>
                )}
              </div>
              <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                {new Date(ev.occurred_at).toLocaleString()}
              </span>
            </li>
          ))}
        </ul>
      )}

      {showLog && (
        <LogInteractionModal clientId={clientId} onClose={() => setShowLog(false)} onSaved={refresh} />
      )}
    </div>
  );
}
