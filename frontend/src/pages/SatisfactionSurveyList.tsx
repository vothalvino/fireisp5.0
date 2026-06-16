// =============================================================================
// FireISP 5.0 — Satisfaction Surveys (NPS / CSAT) — §1.3
// =============================================================================
// Survey list with aggregate NPS score and CSAT average. CSAT surveys are
// dispatched automatically when tickets are resolved; NPS campaigns and manual
// surveys are created here. Responses received off-platform (phone, in person)
// are recorded via the Respond action.
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
import { ClientPicker } from '@/components/ClientPicker';

interface Survey {
  id: number;
  client_id: number;
  client_name?: string | null;
  ticket_id: number | null;
  survey_type: string;
  channel: string;
  status: string;
  score: number | null;
  comment: string | null;
  sent_at: string | null;
  responded_at: string | null;
  created_at: string;
}

interface SurveysResponse {
  data: Survey[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

interface SurveyMetrics {
  nps: { sent: number; responses: number; promoters: number; passives: number; detractors: number; score: number | null };
  csat: { sent: number; responses: number; satisfied: number; average: number | null; satisfaction_pct: number | null };
}

async function fetchSurveys(): Promise<SurveysResponse> {
  const res = await api.GET('/satisfaction-surveys', {
    params: { query: { limit: 200, order_by: 'created_at', order: 'DESC' } as never },
  });
  if (res.error) throw new Error('Failed to load surveys');
  return res.data as unknown as SurveysResponse;
}

async function fetchMetrics(): Promise<SurveyMetrics> {
  const res = await api.GET('/satisfaction-surveys/metrics');
  if (res.error) throw new Error('Failed to load survey metrics');
  return (res.data as unknown as { data: SurveyMetrics }).data;
}

function MetricCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div style={{
      padding: '0.75rem 1rem', borderRadius: 8, minWidth: 150,
      background: 'var(--surface-2, #f1f5f9)', border: '1px solid var(--border)',
    }}>
      <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{label}</div>
      <div style={{ fontSize: '1.4rem', fontWeight: 700 }}>{value}</div>
      {hint && <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>{hint}</div>}
    </div>
  );
}

function NewSurveyModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ client_id: '', ticket_id: '', survey_type: 'nps', channel: 'email' });
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = {
        client_id: Number(form.client_id),
        survey_type: form.survey_type,
        channel: form.channel,
      };
      if (form.ticket_id) body.ticket_id = Number(form.ticket_id);
      const { error } = await api.POST('/satisfaction-surveys', { body: body as never });
      if (error) throw new Error(extractApiError(error, 'Failed to create survey'));
    },
    onSuccess: () => { onSaved(); onClose(); },
    onError: (err: unknown) => setError(err instanceof Error ? err.message : 'Failed to create survey'),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.client_id) { setError('Client ID is required.'); return; }
    setError('');
    mutation.mutate();
  }

  return (
    <div style={overlay} role="dialog" aria-modal="true" aria-label="New Survey">
      <div style={{ ...modalBox, width: 420 }}>
        <h3 style={{ margin: '0 0 1rem' }}>New Survey</h3>
        {error && <div style={errorBox}>{error}</div>}
        <form onSubmit={handleSubmit}>
          <ClientPicker
            value={form.client_id ? Number(form.client_id) : ''}
            onChange={(id) => setForm(p => ({ ...p, client_id: id ? String(id) : '' }))}
          />

          <label style={labelStyle}>Ticket ID</label>
          <input style={inputStyle} type="number" min={1} value={form.ticket_id}
            onChange={e => setForm(p => ({ ...p, ticket_id: e.target.value }))} />

          <label style={labelStyle}>Type</label>
          <select style={inputStyle} value={form.survey_type}
            onChange={e => setForm(p => ({ ...p, survey_type: e.target.value }))}>
            <option value="nps">NPS (0-10)</option>
            <option value="csat">CSAT (1-5)</option>
          </select>

          <label style={labelStyle}>Channel</label>
          <select style={inputStyle} value={form.channel}
            onChange={e => setForm(p => ({ ...p, channel: e.target.value }))}>
            {['email', 'sms', 'portal', 'in_person'].map(c => <option key={c} value={c}>{c}</option>)}
          </select>

          <div style={{ display: 'flex', gap: 8, marginTop: '1.25rem', justifyContent: 'flex-end' }}>
            <button type="button" onClick={onClose} style={cancelBtn}>Cancel</button>
            <button type="submit" style={submitBtn} disabled={mutation.isPending}>
              {mutation.isPending ? 'Saving…' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function RespondModal({ survey, onClose, onSaved }: { survey: Survey; onClose: () => void; onSaved: () => void }) {
  const isNps = survey.survey_type === 'nps';
  const [score, setScore] = useState('');
  const [comment, setComment] = useState('');
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = { score: Number(score) };
      if (comment.trim()) body.comment = comment.trim();
      const { error } = await api.POST('/satisfaction-surveys/{id}/respond', {
        params: { path: { id: survey.id } },
        body: body as never,
      });
      if (error) throw new Error(extractApiError(error, 'Failed to record response'));
    },
    onSuccess: () => { onSaved(); onClose(); },
    onError: (err: unknown) => setError(err instanceof Error ? err.message : 'Failed to record response'),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (score === '') { setError('Score is required.'); return; }
    setError('');
    mutation.mutate();
  }

  return (
    <div style={overlay} role="dialog" aria-modal="true" aria-label="Record Response">
      <div style={{ ...modalBox, width: 420 }}>
        <h3 style={{ margin: '0 0 1rem' }}>Record Response — Survey #{survey.id}</h3>
        {error && <div style={errorBox}>{error}</div>}
        <form onSubmit={handleSubmit}>
          <label style={labelStyle}>Score * ({isNps ? '0-10' : '1-5'})</label>
          <input style={inputStyle} type="number" min={isNps ? 0 : 1} max={isNps ? 10 : 5} value={score} autoFocus
            onChange={e => setScore(e.target.value)} required />

          <label style={labelStyle}>Comment</label>
          <textarea style={{ ...inputStyle, minHeight: 70 }} value={comment}
            onChange={e => setComment(e.target.value)} />

          <div style={{ display: 'flex', gap: 8, marginTop: '1.25rem', justifyContent: 'flex-end' }}>
            <button type="button" onClick={onClose} style={cancelBtn}>Cancel</button>
            <button type="submit" style={submitBtn} disabled={mutation.isPending}>
              {mutation.isPending ? 'Saving…' : 'Save response'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function SatisfactionSurveyList() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [respondTo, setRespondTo] = useState<Survey | null>(null);

  const canCreate = can(user?.role, 'surveys.create');
  const canUpdate = can(user?.role, 'surveys.update');

  const { data, isLoading, error } = useQuery({ queryKey: ['satisfaction-surveys'], queryFn: fetchSurveys });
  const { data: metrics } = useQuery({ queryKey: ['satisfaction-surveys', 'metrics'], queryFn: fetchMetrics });

  const sendMutation = useMutation({
    mutationFn: async (id: number) => {
      const { error: e } = await api.POST('/satisfaction-surveys/{id}/send', { params: { path: { id } } });
      if (e) throw new Error(extractApiError(e, 'Failed to send survey'));
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['satisfaction-surveys'] }),
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ['satisfaction-surveys'] });

  return (
    <div style={{ padding: '1.5rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
        <h2 style={{ margin: 0 }}>Satisfaction Surveys</h2>
        {canCreate && (
          <button type="button" style={submitBtn} onClick={() => setShowCreate(true)}>+ New Survey</button>
        )}
      </div>

      <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginTop: 0 }}>
        CSAT surveys are sent automatically when tickets are resolved. NPS surveys can be sent manually.
      </p>

      {metrics && (
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', margin: '0.5rem 0 1.25rem' }}>
          <MetricCard label="NPS score" value={metrics.nps.score === null ? '—' : String(metrics.nps.score)}
            hint={`${metrics.nps.responses}/${metrics.nps.sent} responses`} />
          <MetricCard label="CSAT average" value={metrics.csat.average === null ? '—' : `${metrics.csat.average}/5`}
            hint={`${metrics.csat.responses}/${metrics.csat.sent} responses`} />
          <MetricCard label="CSAT satisfaction" value={metrics.csat.satisfaction_pct === null ? '—' : `${metrics.csat.satisfaction_pct}%`}
            hint="responses scoring 4-5" />
        </div>
      )}

      {isLoading && <p>Loading…</p>}
      {error && <div style={errorBox}>{(error as Error).message}</div>}

      {data && (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border-strong)' }}>
              <th style={{ padding: '8px' }}>ID</th>
              <th style={{ padding: '8px' }}>Client</th>
              <th style={{ padding: '8px' }}>Ticket</th>
              <th style={{ padding: '8px' }}>Type</th>
              <th style={{ padding: '8px' }}>Channel</th>
              <th style={{ padding: '8px' }}>Status</th>
              <th style={{ padding: '8px', textAlign: 'right' }}>Score</th>
              <th style={{ padding: '8px', textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {data.data.length === 0 && (
              <tr><td colSpan={8} style={{ padding: '1rem', color: 'var(--text-secondary)' }}>No surveys yet.</td></tr>
            )}
            {data.data.map(s => (
              <tr key={s.id} style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={{ padding: '8px' }}>#{s.id}</td>
                <td style={{ padding: '8px' }}>{s.client_name || `#${s.client_id}`}</td>
                <td style={{ padding: '8px' }}>{s.ticket_id ? `#${s.ticket_id}` : '—'}</td>
                <td style={{ padding: '8px', textTransform: 'uppercase' }}>{s.survey_type}</td>
                <td style={{ padding: '8px' }}>{s.channel.replace('_', ' ')}</td>
                <td style={{ padding: '8px', textTransform: 'capitalize' }}>{s.status}</td>
                <td style={{ padding: '8px', textAlign: 'right', fontFamily: 'monospace' }}>{s.score ?? '—'}</td>
                <td style={{ padding: '8px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                  {canCreate && s.status === 'pending' && (
                    <button type="button" style={{ ...submitBtn, padding: '4px 10px', marginRight: 6 }}
                      disabled={sendMutation.isPending}
                      onClick={() => sendMutation.mutate(s.id)}>Send</button>
                  )}
                  {canUpdate && s.status !== 'responded' && (
                    <button type="button" style={{ ...cancelBtn, padding: '4px 10px' }}
                      onClick={() => setRespondTo(s)}>Respond</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {showCreate && <NewSurveyModal onClose={() => setShowCreate(false)} onSaved={refresh} />}
      {respondTo && <RespondModal survey={respondTo} onClose={() => setRespondTo(null)} onSaved={refresh} />}
    </div>
  );
}
