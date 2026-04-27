// =============================================================================
// FireISP 5.0 — Ticket Detail
// =============================================================================
// Shows a single ticket at /tickets/:id with:
//   • Ticket metadata (subject, description, status, priority, category,
//     client, assigned to, dates)
//   • Actions: change status (open/in_progress/waiting/resolved/closed),
//     reassign to a user
//   • Comments thread (chronological list, add comment with is_internal toggle)
// =============================================================================

import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, tokenStore } from '@/api/client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Ticket {
  id: number;
  client_id: number | null;
  contract_id: number | null;
  assigned_to: number | null;
  subject: string;
  description: string | null;
  priority: string;
  category: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

type TicketPatch = Partial<Omit<Ticket, 'id' | 'created_at' | 'updated_at'>>;

interface TicketComment {
  id: number;
  ticket_id: number;
  user_id: number | null;
  body: string;
  is_internal: boolean | number;
  created_at: string;
  first_name: string | null;
  last_name: string | null;
}

interface Client {
  id: number;
  name: string;
  email: string | null;
}

interface User {
  id: number;
  first_name: string;
  last_name: string;
}

// ---------------------------------------------------------------------------
// Fetch / mutate helpers
// ---------------------------------------------------------------------------

const API_BASE = '/api/v1';

async function fetchTicket(id: string): Promise<Ticket> {
  const res = await api.GET('/tickets/{id}' as never, { params: { path: { id: Number(id) } } } as never);
  if ((res as { error?: unknown }).error) throw new Error('Ticket not found');
  const d = res.data as unknown;
  return ((d as { data?: Ticket }).data ?? d) as Ticket;
}

async function fetchComments(ticketId: string): Promise<TicketComment[]> {
  const token = tokenStore.getAccess();
  const res = await fetch(`${API_BASE}/tickets/${ticketId}/comments`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) return [];
  const body = await res.json() as { data: TicketComment[] };
  return body.data ?? [];
}

async function fetchClient(id: number): Promise<Client> {
  const res = await api.GET('/clients/{id}', { params: { path: { id } } });
  if (res.error) throw new Error('Client not found');
  return ((res.data as unknown as { data?: Client }).data ?? res.data) as unknown as Client;
}

async function fetchUsers(): Promise<User[]> {
  const res = await api.GET('/users' as never, { params: { query: { limit: 200 } as never } } as never);
  if ((res as { error?: unknown }).error) return [];
  return (res.data as unknown as { data: User[] }).data ?? [];
}

async function patchTicket(id: number, patch: TicketPatch): Promise<void> {
  const token = tokenStore.getAccess();
  const res = await fetch(`${API_BASE}/tickets/${id}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || 'Failed to update ticket');
  }
}

async function addComment(
  ticketId: number,
  body: string,
  isInternal: boolean,
): Promise<void> {
  const token = tokenStore.getAccess();
  const res = await fetch(`${API_BASE}/tickets/${ticketId}/comments`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ body, is_internal: isInternal }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || 'Failed to add comment');
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmt(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleString('es-MX', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

const STATUSES = ['open', 'in_progress', 'waiting', 'resolved', 'closed'];

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; color: string }> = {
    open:        { bg: '#dbeafe', color: '#1e40af' },
    in_progress: { bg: '#ede9fe', color: '#5b21b6' },
    waiting:     { bg: '#fef9c3', color: '#854d0e' },
    resolved:    { bg: '#d1fae5', color: '#065f46' },
    closed:      { bg: '#f3f4f6', color: '#374151' },
  };
  const s = map[status] ?? { bg: '#f3f4f6', color: '#374151' };
  return (
    <span style={{
      background: s.bg, color: s.color,
      padding: '3px 10px', borderRadius: 12,
      fontSize: '0.78rem', fontWeight: 600, textTransform: 'capitalize',
    }}>
      {status.replace('_', ' ')}
    </span>
  );
}

function PriorityBadge({ priority }: { priority: string }) {
  const map: Record<string, { bg: string; color: string }> = {
    low:      { bg: '#f0fdf4', color: '#15803d' },
    medium:   { bg: '#fff7ed', color: '#c2410c' },
    high:     { bg: '#fef2f2', color: '#b91c1c' },
    critical: { bg: '#fee2e2', color: '#7f1d1d' },
  };
  const s = map[priority] ?? { bg: '#f3f4f6', color: '#374151' };
  return (
    <span style={{
      background: s.bg, color: s.color,
      padding: '3px 10px', borderRadius: 12,
      fontSize: '0.78rem', fontWeight: 600, textTransform: 'capitalize',
    }}>
      {priority}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Status / Assign action panel
// ---------------------------------------------------------------------------

interface ActionsProps {
  ticket: Ticket;
  users: User[];
  onPatched: () => void;
}

function TicketActions({ ticket, users, onPatched }: ActionsProps) {
  const [newStatus, setNewStatus] = useState(ticket.status);
  const [newAssignee, setNewAssignee] = useState(String(ticket.assigned_to ?? ''));
  const [err, setErr] = useState('');

  const mutation = useMutation({
    mutationFn: () => {
      const patch: TicketPatch = {};
      if (newStatus !== ticket.status) patch.status = newStatus;
      if (newAssignee !== String(ticket.assigned_to ?? '')) {
        patch.assigned_to = newAssignee ? Number(newAssignee) : null;
      }
      return patchTicket(ticket.id, patch);
    },
    onSuccess: () => { setErr(''); onPatched(); },
    onError: (e: Error) => setErr(e.message),
  });

  const isDirty =
    newStatus !== ticket.status ||
    newAssignee !== String(ticket.assigned_to ?? '');

  return (
    <div style={card}>
      <h3 style={cardTitle}>Actions</h3>
      {err && <div style={errStyle}>{err}</div>}

      <label style={labelStyle}>Status</label>
      <select
        style={inputStyle}
        value={newStatus}
        onChange={e => setNewStatus(e.target.value)}
      >
        {STATUSES.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
      </select>

      <label style={labelStyle}>Assigned To</label>
      <select
        style={inputStyle}
        value={newAssignee}
        onChange={e => setNewAssignee(e.target.value)}
      >
        <option value="">— unassigned —</option>
        {users.map(u => (
          <option key={u.id} value={u.id}>{u.first_name} {u.last_name}</option>
        ))}
      </select>

      <button
        style={{ ...btnPrimary, marginTop: 12, width: '100%', opacity: isDirty ? 1 : 0.5 }}
        disabled={!isDirty || mutation.isPending}
        onClick={() => mutation.mutate()}
      >
        {mutation.isPending ? 'Saving…' : 'Save Changes'}
      </button>

      {/* Quick-action shortcuts */}
      <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {ticket.status !== 'in_progress' && ticket.status !== 'closed' && (
          <button style={btnSecondary} onClick={() => { setNewStatus('in_progress'); }}>
            ▶ Mark In Progress
          </button>
        )}
        {ticket.status !== 'resolved' && ticket.status !== 'closed' && (
          <button style={btnSecondary} onClick={() => { setNewStatus('resolved'); }}>
            ✅ Mark Resolved
          </button>
        )}
        {ticket.status !== 'closed' && (
          <button style={btnSecondary} onClick={() => { setNewStatus('closed'); }}>
            🔒 Close Ticket
          </button>
        )}
        {(ticket.status === 'resolved' || ticket.status === 'closed') && (
          <button style={btnSecondary} onClick={() => { setNewStatus('open'); }}>
            🔄 Reopen
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Comments thread
// ---------------------------------------------------------------------------

interface CommentsProps {
  ticketId: number;
  comments: TicketComment[];
  onAdded: () => void;
}

function CommentsThread({ ticketId, comments, onAdded }: CommentsProps) {
  const [body, setBody] = useState('');
  const [isInternal, setIsInternal] = useState(false);
  const [err, setErr] = useState('');

  const mutation = useMutation({
    mutationFn: () => addComment(ticketId, body.trim(), isInternal),
    onSuccess: () => { setBody(''); setIsInternal(false); setErr(''); onAdded(); },
    onError: (e: Error) => setErr(e.message),
  });

  return (
    <div style={{ ...card, marginTop: '1.5rem' }}>
      <h3 style={cardTitle}>Comments ({comments.length})</h3>

      {/* Existing comments */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 20 }}>
        {comments.length === 0 && (
          <p style={{ color: '#888', fontSize: '0.85rem', margin: 0 }}>No comments yet.</p>
        )}
        {comments.map(c => (
          <div
            key={c.id}
            style={{
              background: c.is_internal ? '#fef9c3' : '#f9fafb',
              border: `1px solid ${c.is_internal ? '#fde047' : '#e5e7eb'}`,
              borderRadius: 8, padding: '10px 14px',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ fontWeight: 600, fontSize: '0.82rem', color: '#374151' }}>
                {c.first_name && c.last_name ? `${c.first_name} ${c.last_name}` : 'System'}
              </span>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                {c.is_internal && (
                  <span style={{
                    background: '#fde047', color: '#713f12',
                    fontSize: '0.7rem', fontWeight: 700,
                    padding: '1px 6px', borderRadius: 10,
                  }}>
                    INTERNAL
                  </span>
                )}
                <span style={{ fontSize: '0.75rem', color: '#9ca3af' }}>{fmt(c.created_at)}</span>
              </div>
            </div>
            <p style={{ margin: 0, fontSize: '0.87rem', color: '#374151', whiteSpace: 'pre-wrap' }}>
              {c.body}
            </p>
          </div>
        ))}
      </div>

      {/* Add comment form */}
      <div style={{ borderTop: '1px solid #e5e7eb', paddingTop: 16 }}>
        <label style={labelStyle}>Add Comment</label>
        {err && <div style={errStyle}>{err}</div>}
        <textarea
          style={{ ...inputStyle, height: 90, resize: 'vertical' }}
          value={body}
          onChange={e => setBody(e.target.value)}
          placeholder="Write a comment…"
        />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.82rem', color: '#374151', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={isInternal}
              onChange={e => setIsInternal(e.target.checked)}
            />
            Internal note (not visible to client)
          </label>
          <button
            style={btnPrimary}
            disabled={mutation.isPending || !body.trim()}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? 'Posting…' : 'Post Comment'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export function TicketDetail() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();

  const { data: ticket, isLoading, error } = useQuery({
    queryKey: ['ticket', id],
    queryFn: () => fetchTicket(id!),
    enabled: !!id,
  });

  const { data: comments = [], refetch: refetchComments } = useQuery({
    queryKey: ['ticket-comments', id],
    queryFn: () => fetchComments(id!),
    enabled: !!id,
  });

  const { data: client } = useQuery({
    queryKey: ['client', ticket?.client_id],
    queryFn: () => fetchClient(ticket!.client_id!),
    enabled: !!ticket?.client_id,
  });

  const { data: users = [] } = useQuery({
    queryKey: ['users-mini'],
    queryFn: fetchUsers,
  });

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ['ticket', id] });
    queryClient.invalidateQueries({ queryKey: ['tickets'] });
  }

  if (isLoading) return <div style={{ padding: '2rem', color: '#888' }}>Loading ticket…</div>;
  if (error || !ticket) return <div style={{ padding: '2rem', color: '#e00' }}>Ticket not found.</div>;

  const assignedUser = ticket.assigned_to
    ? users.find(u => u.id === ticket.assigned_to)
    : null;

  return (
    <div style={{ padding: '1.5rem', maxWidth: 1000 }}>
      {/* Breadcrumb */}
      <div style={{ fontSize: '0.82rem', color: '#888', marginBottom: '0.75rem' }}>
        <Link to="/tickets" style={{ color: '#1d4ed8', textDecoration: 'none' }}>Tickets</Link>
        {' › '}
        <span>#{ticket.id}</span>
      </div>

      {/* Title row */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: '1.5rem', flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0, fontSize: '1.3rem', flex: 1 }}>
          #{ticket.id} — {ticket.subject}
        </h1>
        <StatusBadge status={ticket.status} />
        <PriorityBadge priority={ticket.priority} />
      </div>

      {/* Two-column layout */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: '1.5rem', alignItems: 'start' }}>

        {/* Left — description + comments */}
        <div>
          {/* Metadata card */}
          <div style={card}>
            <h3 style={cardTitle}>Details</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem 1.5rem' }}>
              <MetaRow label="Status"><StatusBadge status={ticket.status} /></MetaRow>
              <MetaRow label="Priority"><PriorityBadge priority={ticket.priority} /></MetaRow>
              <MetaRow label="Client">
                {client ? (
                  <Link to={`/clients/${client.id}`} style={{ color: '#1d4ed8', textDecoration: 'none' }}>
                    {client.name}
                  </Link>
                ) : ticket.client_id ? `#${ticket.client_id}` : '—'}
              </MetaRow>
              <MetaRow label="Assigned To">
                {assignedUser
                  ? `${assignedUser.first_name} ${assignedUser.last_name}`
                  : ticket.assigned_to ? `#${ticket.assigned_to}` : '—'}
              </MetaRow>
              <MetaRow label="Category">{ticket.category ?? '—'}</MetaRow>
              <MetaRow label="Created">{fmt(ticket.created_at)}</MetaRow>
              <MetaRow label="Updated">{fmt(ticket.updated_at)}</MetaRow>
              {ticket.contract_id && (
                <MetaRow label="Contract">#{ticket.contract_id}</MetaRow>
              )}
            </div>

            {ticket.description && (
              <>
                <div style={{ height: 1, background: '#e5e7eb', margin: '1rem 0' }} />
                <p style={{ margin: 0, fontSize: '0.88rem', color: '#374151', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
                  {ticket.description}
                </p>
              </>
            )}
          </div>

          {/* Comments */}
          <CommentsThread
            ticketId={ticket.id}
            comments={comments}
            onAdded={() => void refetchComments()}
          />
        </div>

        {/* Right — actions sidebar */}
        <TicketActions ticket={ticket} users={users} onPatched={invalidate} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// MetaRow helper
// ---------------------------------------------------------------------------

function MetaRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', marginBottom: 2 }}>
        {label}
      </div>
      <div style={{ fontSize: '0.85rem', color: '#374151' }}>{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const btnPrimary: React.CSSProperties = {
  background: '#e25822', color: '#fff', border: 'none',
  padding: '7px 16px', borderRadius: 6, cursor: 'pointer',
  fontSize: '0.85rem', fontWeight: 600,
};
const btnSecondary: React.CSSProperties = {
  background: 'var(--bg-card)', color: 'var(--text-secondary)', border: '1px solid var(--border-strong)',
  padding: '6px 14px', borderRadius: 6, cursor: 'pointer', fontSize: '0.85rem',
  width: '100%', textAlign: 'left' as const,
};
const card: React.CSSProperties = {
  background: 'var(--bg-card)', borderRadius: 10, padding: '1.25rem',
  boxShadow: '0 1px 3px rgba(0,0,0,.08)',
};
const cardTitle: React.CSSProperties = {
  margin: '0 0 1rem', fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-primary)',
};
const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: '0.78rem', fontWeight: 600,
  color: 'var(--text-secondary)', marginBottom: 3, marginTop: 10,
};
const inputStyle: React.CSSProperties = {
  width: '100%', padding: '7px 10px', border: '1px solid var(--input-border)',
  borderRadius: 6, fontSize: '0.85rem', boxSizing: 'border-box',
};
const errStyle: React.CSSProperties = {
  background: '#fee2e2', color: '#991b1b',
  padding: '8px 12px', borderRadius: 6, fontSize: '0.83rem', marginBottom: 8,
};
