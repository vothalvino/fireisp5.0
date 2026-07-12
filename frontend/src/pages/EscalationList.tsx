// =============================================================================
// FireISP 5.0 — Ticket Escalations — §1.3
// =============================================================================
// Escalation management for unresolved tickets: candidate queue (tickets open
// too long with no escalation), escalation list with acknowledge / resolve
// actions. Stale tickets are also auto-escalated hourly by the
// `auto_escalate_tickets` scheduled task.
// =============================================================================

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { Pagination } from '@/components/Pagination';
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

interface Escalation {
  id: number;
  ticket_id: number;
  level: number;
  escalated_by: number | null;
  escalated_to: number | null;
  reason: string;
  status: string;
  acknowledged_at: string | null;
  resolved_at: string | null;
  created_at: string;
}

interface EscalationsResponse {
  data: Escalation[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

interface Candidate {
  id: number;
  subject: string;
  priority: string;
  status: string;
  client_id: number;
  client_name: string;
  hours_open: number;
}

async function fetchEscalations(page: number, pageSize: number): Promise<EscalationsResponse> {
  const res = await api.GET('/escalations', {
    params: { query: { page, limit: pageSize, order_by: 'created_at', order: 'DESC' } as never },
  });
  if (res.error) throw new Error('Failed to load escalations');
  return res.data as unknown as EscalationsResponse;
}

async function fetchCandidates(): Promise<Candidate[]> {
  const res = await api.GET('/escalations/candidates');
  if (res.error) throw new Error('Failed to load escalation candidates');
  return (res.data as unknown as { data: Candidate[] }).data;
}

function EscalateModal({
  ticketId,
  onClose,
  onSaved,
}: {
  ticketId: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [reason, setReason] = useState('');
  const [escalatedTo, setEscalatedTo] = useState('');
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = { ticket_id: ticketId, reason: reason.trim() };
      if (escalatedTo) body.escalated_to = Number(escalatedTo);
      const { error } = await api.POST('/escalations', { body: body as never });
      if (error) throw new Error(extractApiError(error, 'Failed to escalate ticket'));
    },
    onSuccess: () => { onSaved(); onClose(); },
    onError: (err: unknown) => setError(err instanceof Error ? err.message : 'Failed to escalate ticket'),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!reason.trim()) { setError('Reason is required.'); return; }
    setError('');
    mutation.mutate();
  }

  return (
    <div style={overlay} role="dialog" aria-modal="true" aria-label="Escalate Ticket">
      <div style={{ ...modalBox, width: 440 }}>
        <h3 style={{ margin: '0 0 1rem' }}>Escalate Ticket #{ticketId}</h3>
        {error && <div style={errorBox}>{error}</div>}
        <form onSubmit={handleSubmit}>
          <label style={labelStyle}>Reason *</label>
          <textarea style={{ ...inputStyle, minHeight: 70 }} value={reason} autoFocus
            onChange={e => setReason(e.target.value)} required />

          <label style={labelStyle}>Escalate to (user ID)</label>
          <input style={inputStyle} type="number" min={1} value={escalatedTo}
            onChange={e => setEscalatedTo(e.target.value)} />

          <div style={{ display: 'flex', gap: 8, marginTop: '1.25rem', justifyContent: 'flex-end' }}>
            <button type="button" onClick={onClose} style={cancelBtn}>Cancel</button>
            <button type="submit" style={submitBtn} disabled={mutation.isPending}>
              {mutation.isPending ? 'Escalating…' : 'Escalate'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function EscalationList() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [escalateTicketId, setEscalateTicketId] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const canCreate = can(user, 'escalations.create');
  const canUpdate = can(user, 'escalations.update');

  const { data, isLoading, error } = useQuery({
    queryKey: ['escalations', page, pageSize],
    queryFn: () => fetchEscalations(page, pageSize),
  });
  const { data: candidates } = useQuery({ queryKey: ['escalations', 'candidates'], queryFn: fetchCandidates });

  const transitionMutation = useMutation({
    mutationFn: async ({ id, status }: { id: number; status: 'acknowledged' | 'resolved' }) => {
      const { error: e } = await api.POST('/escalations/{id}/transition', {
        params: { path: { id } },
        body: { status } as never,
      });
      if (e) throw new Error(extractApiError(e, 'Failed to update escalation'));
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['escalations'] }),
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ['escalations'] });

  return (
    <div style={{ padding: '1.5rem' }}>
      <h2 style={{ margin: '0 0 0.25rem' }}>Escalations</h2>
      <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginTop: 0 }}>
        Manage escalations for unresolved tickets. Stale tickets are auto-escalated after 48 hours.
      </p>

      {candidates && candidates.length > 0 && (
        <div style={{ margin: '1rem 0 1.5rem' }}>
          <h3 style={{ margin: '0 0 0.5rem', fontSize: '1rem' }}>⚠️ Needs attention ({candidates.length})</h3>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border-strong)' }}>
                <th style={{ padding: '8px' }}>Ticket</th>
                <th style={{ padding: '8px' }}>Client</th>
                <th style={{ padding: '8px' }}>Priority</th>
                <th style={{ padding: '8px', textAlign: 'right' }}>Hours open</th>
                <th style={{ padding: '8px', textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {candidates.map(c => (
                <tr key={c.id} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '8px' }}>
                    <Link to={`/tickets/${c.id}`}>#{c.id}</Link> {c.subject}
                  </td>
                  <td style={{ padding: '8px' }}>{c.client_name}</td>
                  <td style={{ padding: '8px', textTransform: 'capitalize' }}>{c.priority}</td>
                  <td style={{ padding: '8px', textAlign: 'right', fontFamily: 'monospace' }}>{c.hours_open}</td>
                  <td style={{ padding: '8px', textAlign: 'right' }}>
                    {canCreate && (
                      <button type="button" style={{ ...submitBtn, padding: '4px 10px' }}
                        onClick={() => setEscalateTicketId(c.id)}>Escalate</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {isLoading && <p>Loading…</p>}
      {error && <div style={errorBox}>{(error as Error).message}</div>}

      {data && (
        <>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border-strong)' }}>
              <th style={{ padding: '8px' }}>Ticket</th>
              <th style={{ padding: '8px' }}>Level</th>
              <th style={{ padding: '8px' }}>Reason</th>
              <th style={{ padding: '8px' }}>Status</th>
              <th style={{ padding: '8px' }}>Escalated</th>
              <th style={{ padding: '8px', textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {data.data.length === 0 && (
              <tr><td colSpan={6} style={{ padding: '1rem', color: 'var(--text-secondary)' }}>No escalations yet.</td></tr>
            )}
            {data.data.map(e => (
              <tr key={e.id} style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={{ padding: '8px' }}><Link to={`/tickets/${e.ticket_id}`}>#{e.ticket_id}</Link></td>
                <td style={{ padding: '8px' }}>
                  <span style={{
                    padding: '2px 8px', borderRadius: 6, fontSize: '0.8rem', fontWeight: 700,
                    background: e.level >= 3 ? '#fee2e2' : e.level === 2 ? '#fef3c7' : 'var(--surface-2, #f1f5f9)',
                    color: '#1f2937',
                    border: '1px solid var(--border)',
                  }}>L{e.level}</span>
                </td>
                <td style={{ padding: '8px' }}>{e.reason}</td>
                <td style={{ padding: '8px', textTransform: 'capitalize' }}>{e.status}</td>
                <td style={{ padding: '8px' }}>{new Date(e.created_at).toLocaleString()}</td>
                <td style={{ padding: '8px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                  {canUpdate && e.status === 'open' && (
                    <button type="button" style={{ ...cancelBtn, padding: '4px 10px', marginRight: 6 }}
                      disabled={transitionMutation.isPending}
                      onClick={() => transitionMutation.mutate({ id: e.id, status: 'acknowledged' })}>Acknowledge</button>
                  )}
                  {canUpdate && e.status !== 'resolved' && (
                    <button type="button" style={{ ...submitBtn, padding: '4px 10px' }}
                      disabled={transitionMutation.isPending}
                      onClick={() => transitionMutation.mutate({ id: e.id, status: 'resolved' })}>Resolve</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Pagination */}
        <Pagination
          page={page}
          totalPages={data?.meta?.totalPages ?? 1}
          total={data?.meta?.total}
          pageSize={pageSize}
          onPageChange={setPage}
          onPageSizeChange={(size) => { setPageSize(size); setPage(1); }}
        />
        </>
      )}

      {escalateTicketId !== null && (
        <EscalateModal ticketId={escalateTicketId} onClose={() => setEscalateTicketId(null)}
          onSaved={() => { refresh(); qc.invalidateQueries({ queryKey: ['escalations', 'candidates'] }); }} />
      )}
    </div>
  );
}
