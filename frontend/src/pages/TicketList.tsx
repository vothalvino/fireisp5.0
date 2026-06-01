// =============================================================================
// FireISP 5.0 — Ticket List
// =============================================================================
// Standalone page at /tickets. Shows all support tickets with:
//   • Filtering by status and priority
//   • Paginated table (subject, client, priority, status, assigned to, date)
//   • "New Ticket" button opens an inline modal form
//   • Click a row to navigate to /tickets/:id for full detail
// =============================================================================

import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { extractApiError } from '@/components/ClientFormModal';

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

interface TicketsResponse {
  data: Ticket[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

interface Client {
  id: number;
  name: string;
}

interface User {
  id: number;
  first_name: string;
  last_name: string;
}

interface CreateTicketBody {
  subject: string;
  description?: string;
  client_id?: number;
  contract_id?: number;
  assigned_to?: number;
  priority?: string;
  category?: string;
  status?: string;
}

// ---------------------------------------------------------------------------
// Fetch / mutate helpers
// ---------------------------------------------------------------------------

const PAGE_SIZE = 25;

async function fetchTickets(
  page: number,
  statusFilter: string,
  priorityFilter: string,
): Promise<TicketsResponse> {
  const query: Record<string, string | number> = { page, limit: PAGE_SIZE };
  if (statusFilter) query.status = statusFilter;
  if (priorityFilter) query.priority = priorityFilter;
  const res = await api.GET('/tickets' as never, { params: { query: query as never } } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to load tickets');
  return res.data as unknown as TicketsResponse;
}

async function fetchClients(): Promise<Client[]> {
  const res = await api.GET('/clients', { params: { query: { limit: 500 } as never } });
  if (res.error) throw new Error('Failed to load clients');
  return (res.data as unknown as { data: Client[] }).data;
}

async function fetchUsers(): Promise<User[]> {
  const res = await api.GET('/users' as never, { params: { query: { limit: 200 } as never } } as never);
  if ((res as { error?: unknown }).error) return [];
  return (res.data as unknown as { data: User[] }).data ?? [];
}

async function createTicket(body: CreateTicketBody): Promise<void> {
  const { error } = await api.POST('/tickets', { body: body as never });
  if (error) throw new Error(extractApiError(error, 'Failed to create ticket'));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmt(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('es-MX', {
    year: 'numeric', month: 'short', day: 'numeric',
  });
}

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
      padding: '2px 8px', borderRadius: 12,
      fontSize: '0.72rem', fontWeight: 600, textTransform: 'capitalize',
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
      padding: '2px 8px', borderRadius: 12,
      fontSize: '0.72rem', fontWeight: 600, textTransform: 'capitalize',
    }}>
      {priority}
    </span>
  );
}

// ---------------------------------------------------------------------------
// New Ticket Modal
// ---------------------------------------------------------------------------

interface NewTicketModalProps {
  clients: Client[];
  users: User[];
  onClose: () => void;
  onCreated: () => void;
}

const PRIORITIES = ['low', 'medium', 'high', 'critical'];
const STATUSES = ['open', 'in_progress', 'waiting', 'resolved', 'closed'];

function NewTicketModal({ clients, users, onClose, onCreated }: NewTicketModalProps) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    subject: '',
    description: '',
    client_id: '',
    assigned_to: '',
    priority: 'medium',
    category: '',
    status: 'open',
  });
  const [err, setErr] = useState('');

  const mutation = useMutation({
    mutationFn: () => {
      const body: CreateTicketBody = { subject: form.subject.trim() };
      if (form.description.trim()) body.description = form.description.trim();
      if (form.client_id) body.client_id = Number(form.client_id);
      if (form.assigned_to) body.assigned_to = Number(form.assigned_to);
      if (form.priority) body.priority = form.priority;
      if (form.category.trim()) body.category = form.category.trim();
      if (form.status) body.status = form.status;
      return createTicket(body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tickets'] });
      onCreated();
    },
    onError: (e: Error) => setErr(e.message),
  });

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

  return (
    <div style={modalOverlay} role="dialog" aria-modal="true" aria-label="New Ticket">
      <div style={modalBox}>
        <h3 style={{ margin: '0 0 1rem' }}>New Ticket</h3>
        {err && <div style={errStyle}>{err}</div>}

        <label style={labelStyle}>Subject *</label>
        <input style={inputStyle} value={form.subject} onChange={set('subject')} placeholder="Brief description of the issue" />

        <label style={labelStyle}>Description</label>
        <textarea
          style={{ ...inputStyle, height: 80, resize: 'vertical' }}
          value={form.description}
          onChange={set('description')}
          placeholder="Detailed description (optional)"
        />

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <div>
            <label style={labelStyle}>Client</label>
            <select style={inputStyle} value={form.client_id} onChange={set('client_id')}>
              <option value="">— none —</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Assign to</label>
            <select style={inputStyle} value={form.assigned_to} onChange={set('assigned_to')}>
              <option value="">— unassigned —</option>
              {users.map(u => <option key={u.id} value={u.id}>{u.first_name} {u.last_name}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Priority</label>
            <select style={inputStyle} value={form.priority} onChange={set('priority')}>
              {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Status</label>
            <select style={inputStyle} value={form.status} onChange={set('status')}>
              {STATUSES.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
            </select>
          </div>
        </div>

        <label style={labelStyle}>Category</label>
        <input style={inputStyle} value={form.category} onChange={set('category')} placeholder="e.g. connectivity, billing, hardware" />

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: '1rem' }}>
          <button style={btnSecondary} onClick={onClose}>Cancel</button>
          <button
            style={btnPrimary}
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || !form.subject.trim()}
          >
            {mutation.isPending ? 'Creating…' : 'Create Ticket'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export function TicketList() {
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [showNew, setShowNew] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ['tickets', page, statusFilter, priorityFilter],
    queryFn: () => fetchTickets(page, statusFilter, priorityFilter),
  });

  const { data: clients = [] } = useQuery({
    queryKey: ['clients-mini'],
    queryFn: fetchClients,
  });

  const { data: users = [] } = useQuery({
    queryKey: ['users-mini'],
    queryFn: fetchUsers,
  });

  const clientMap = Object.fromEntries(clients.map(c => [c.id, c.name]));
  const userMap = Object.fromEntries(users.map(u => [u.id, `${u.first_name} ${u.last_name}`]));

  const tickets = data?.data ?? [];
  const meta = data?.meta;
  const totalPages = meta?.totalPages ?? 1;

  function handleFilterChange(setter: (v: string) => void) {
    return (e: React.ChangeEvent<HTMLSelectElement>) => {
      setter(e.target.value);
      setPage(1);
    };
  }

  return (
    <div style={{ padding: '1.5rem', maxWidth: 1100 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
        <h1 style={{ margin: 0, fontSize: '1.4rem' }}>🎫 Tickets</h1>
        <button style={btnPrimary} onClick={() => setShowNew(true)}>+ New Ticket</button>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 8, marginBottom: '1rem', flexWrap: 'wrap' }}>
        <select aria-label="Filter by status" style={filterSelect} value={statusFilter} onChange={handleFilterChange(setStatusFilter)}>
          <option value="">All statuses</option>
          {STATUSES.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
        </select>
        <select aria-label="Filter by priority" style={filterSelect} value={priorityFilter} onChange={handleFilterChange(setPriorityFilter)}>
          <option value="">All priorities</option>
          {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        {(statusFilter || priorityFilter) && (
          <button style={btnSecondary} onClick={() => { setStatusFilter(''); setPriorityFilter(''); setPage(1); }}>
            Clear filters
          </button>
        )}
      </div>

      {/* Table */}
      {isLoading && <p style={{ color: '#888' }}>Loading tickets…</p>}
      {error && <p style={{ color: '#e00' }}>Failed to load tickets.</p>}
      {!isLoading && !error && (
        <>
          <div style={{ overflowX: 'auto' }}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={th}>#</th>
                  <th style={th}>Subject</th>
                  <th style={th}>Client</th>
                  <th style={th}>Priority</th>
                  <th style={th}>Status</th>
                  <th style={th}>Assigned To</th>
                  <th style={th}>Created</th>
                </tr>
              </thead>
              <tbody>
                {tickets.length === 0 && (
                  <tr><td colSpan={7} style={{ ...td, textAlign: 'center', color: '#888', padding: '2rem' }}>No tickets found</td></tr>
                )}
                {tickets.map(t => (
                  <tr
                    key={t.id}
                    style={{ cursor: 'pointer' }}
                    onClick={() => navigate(`/tickets/${t.id}`)}
                    onMouseEnter={e => (e.currentTarget.style.background = '#f0f4ff')}
                    onMouseLeave={e => (e.currentTarget.style.background = '')}
                  >
                    <td style={td}>
                      <Link
                        to={`/tickets/${t.id}`}
                        style={{ color: 'var(--link)', textDecoration: 'none', fontWeight: 600 }}
                        onClick={e => e.stopPropagation()}
                      >
                        #{t.id}
                      </Link>
                    </td>
                    <td style={{ ...td, maxWidth: 300 }}>
                      <span style={{ fontWeight: 500 }}>{t.subject}</span>
                      {t.category && <span style={{ color: '#888', fontSize: '0.78rem', marginLeft: 6 }}>[{t.category}]</span>}
                    </td>
                    <td style={td}>{t.client_id ? (clientMap[t.client_id] ?? `#${t.client_id}`) : '—'}</td>
                    <td style={td}><PriorityBadge priority={t.priority} /></td>
                    <td style={td}><StatusBadge status={t.status} /></td>
                    <td style={td}>{t.assigned_to ? (userMap[t.assigned_to] ?? `#${t.assigned_to}`) : '—'}</td>
                    <td style={td}>{fmt(t.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: '1rem' }}>
              <button style={btnSecondary} disabled={page <= 1} onClick={() => setPage(p => p - 1)}>← Prev</button>
              <span style={{ fontSize: '0.85rem', color: '#555' }}>Page {page} of {totalPages} ({meta?.total} tickets)</span>
              <button style={btnSecondary} disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>Next →</button>
            </div>
          )}
        </>
      )}

      {showNew && (
        <NewTicketModal
          clients={clients}
          users={users}
          onClose={() => setShowNew(false)}
          onCreated={() => setShowNew(false)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const btnPrimary: React.CSSProperties = {
  background: 'var(--accent)', color: '#fff', border: 'none',
  padding: '7px 16px', borderRadius: 6, cursor: 'pointer',
  fontSize: '0.85rem', fontWeight: 600,
};
const btnSecondary: React.CSSProperties = {
  background: 'var(--bg-card)', color: 'var(--text-secondary)', border: '1px solid var(--border-strong)',
  padding: '6px 14px', borderRadius: 6, cursor: 'pointer', fontSize: '0.85rem',
};
const filterSelect: React.CSSProperties = {
  padding: '6px 10px', borderRadius: 6, border: '1px solid var(--input-border)',
  fontSize: '0.85rem', background: 'var(--input-bg)',
};
const tableStyle: React.CSSProperties = {
  width: '100%', borderCollapse: 'collapse', background: 'var(--bg-card)',
  borderRadius: 8, overflow: 'hidden',
  boxShadow: '0 0 0 1px var(--border)',
};
const th: React.CSSProperties = {
  padding: '10px 12px', textAlign: 'left', fontSize: '0.78rem',
  fontWeight: 700, color: 'var(--text-muted)', background: 'var(--bg-body)',
  borderBottom: '1px solid var(--border)',
};
const td: React.CSSProperties = {
  padding: '10px 12px', fontSize: '0.85rem', color: 'var(--text-secondary)',
  borderBottom: '1px solid var(--border-subtle)',
};
const modalOverlay: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
};
const modalBox: React.CSSProperties = {
  background: 'var(--bg-card)', borderRadius: 10, padding: '1.5rem',
  width: 560, maxHeight: '90vh', overflowY: 'auto',
  boxShadow: '0 8px 32px rgba(0,0,0,.18)',
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
