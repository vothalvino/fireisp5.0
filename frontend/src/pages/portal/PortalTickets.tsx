// =============================================================================
// FireISP 5.0 — Portal Tickets
// =============================================================================
// Lists all support tickets for the authenticated client at /portal/tickets.
// =============================================================================

import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { portalTokenStore } from '@/auth/PortalAuthContext';

const API_BASE = '/api/v1/portal';

interface Ticket {
  id: number;
  subject: string;
  priority: string;
  category: string | null;
  status: string;
  created_at: string;
}

interface TicketsResponse {
  data: Ticket[];
  meta: { page: number; limit: number; total: number; pages: number };
}

async function fetchPortalTickets(page: number, status: string): Promise<TicketsResponse> {
  const token = portalTokenStore.getAccess();
  const query = new URLSearchParams({ page: String(page), limit: '20' });
  if (status) query.set('status', status);
  const res = await fetch(`${API_BASE}/tickets?${query}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error('Failed to load tickets');
  return res.json() as Promise<TicketsResponse>;
}

async function createTicket(body: { subject: string; description?: string; priority?: string; category?: string }): Promise<Ticket> {
  const token = portalTokenStore.getAccess();
  const res = await fetch(`${API_BASE}/tickets`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new Error(err.error?.message ?? 'Failed to create ticket');
  }
  return (await res.json() as { data: Ticket }).data;
}

const PRIORITY_COLORS: Record<string, React.CSSProperties> = {
  low: { background: '#f3f4f6', color: '#6b7280' },
  medium: { background: '#fef3c7', color: '#92400e' },
  high: { background: '#fee2e2', color: '#991b1b' },
  critical: { background: '#4b0082', color: '#fff' },
};

const STATUS_LABELS: Record<string, string> = {
  open: '🟢 Open',
  in_progress: '🔵 In Progress',
  waiting: '🟡 Waiting',
  resolved: '✅ Resolved',
  closed: '⬛ Closed',
};

export function PortalTickets() {
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('');
  const [showModal, setShowModal] = useState(false);

  // New ticket form state
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState('medium');
  const [formError, setFormError] = useState<string | null>(null);

  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const { data, isLoading, error } = useQuery({
    queryKey: ['portal-tickets', page, statusFilter],
    queryFn: () => fetchPortalTickets(page, statusFilter),
  });

  const createMutation = useMutation({
    mutationFn: createTicket,
    onSuccess: ticket => {
      queryClient.invalidateQueries({ queryKey: ['portal-tickets'] });
      setShowModal(false);
      resetForm();
      navigate(`/portal/tickets/${ticket.id}`);
    },
    onError: (err: Error) => setFormError(err.message),
  });

  function resetForm() {
    setSubject('');
    setDescription('');
    setPriority('medium');
    setFormError(null);
  }

  const tickets = data?.data ?? [];
  const meta = data?.meta;

  return (
    <div>
      <div style={styles.header}>
        <h1 style={styles.heading}>🎫 My Support Tickets</h1>
        <div style={styles.headerActions}>
          <select
            value={statusFilter}
            onChange={e => { setStatusFilter(e.target.value); setPage(1); }}
            style={styles.select}
          >
            <option value="">All statuses</option>
            <option value="open">Open</option>
            <option value="in_progress">In Progress</option>
            <option value="waiting">Waiting</option>
            <option value="resolved">Resolved</option>
            <option value="closed">Closed</option>
          </select>
          <button onClick={() => setShowModal(true)} style={styles.newBtn}>+ New Ticket</button>
        </div>
      </div>

      {isLoading && <p style={styles.info}>Loading…</p>}
      {error && <p style={styles.errorTxt}>Failed to load tickets.</p>}

      {!isLoading && tickets.length === 0 && (
        <p style={styles.info}>No tickets found. <button onClick={() => setShowModal(true)} style={styles.inlineBtn}>Open one now →</button></p>
      )}

      {tickets.length > 0 && (
        <div style={styles.card}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Subject</th>
                <th style={styles.th}>Priority</th>
                <th style={styles.th}>Status</th>
                <th style={styles.th}>Opened</th>
              </tr>
            </thead>
            <tbody>
              {tickets.map(t => (
                <tr key={t.id} style={{ cursor: 'pointer' }}>
                  <td style={styles.td}>
                    <Link to={`/portal/tickets/${t.id}`} style={styles.link}>{t.subject}</Link>
                  </td>
                  <td style={styles.td}>
                    <span style={{ ...styles.badge, ...(PRIORITY_COLORS[t.priority] ?? {}) }}>{t.priority}</span>
                  </td>
                  <td style={styles.td}>{STATUS_LABELS[t.status] ?? t.status}</td>
                  <td style={styles.td}>{t.created_at.slice(0, 10)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {meta && meta.pages > 1 && (
        <div style={styles.pagination}>
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} style={styles.pageBtn}>‹ Prev</button>
          <span style={styles.pageInfo}>Page {page} of {meta.pages}</span>
          <button onClick={() => setPage(p => Math.min(meta.pages, p + 1))} disabled={page === meta.pages} style={styles.pageBtn}>Next ›</button>
        </div>
      )}

      {/* New Ticket Modal */}
      {showModal && (
        <div style={styles.overlay}>
          <div style={styles.modal}>
            <h2 style={styles.modalTitle}>Open a Support Ticket</h2>
            {formError && <p style={styles.errorTxt}>{formError}</p>}

            <label style={styles.label}>
              Subject *
              <input
                value={subject}
                onChange={e => setSubject(e.target.value)}
                style={styles.input}
                placeholder="Briefly describe your issue"
                maxLength={300}
              />
            </label>

            <label style={styles.label}>
              Description
              <textarea
                value={description}
                onChange={e => setDescription(e.target.value)}
                style={{ ...styles.input, minHeight: 100, resize: 'vertical' as const }}
                placeholder="Please provide as much detail as possible…"
                maxLength={5000}
              />
            </label>

            <label style={styles.label}>
              Priority
              <select value={priority} onChange={e => setPriority(e.target.value)} style={styles.input}>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </label>

            <div style={styles.modalActions}>
              <button
                onClick={() => { setShowModal(false); resetForm(); }}
                style={styles.cancelBtn}
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  if (!subject.trim()) { setFormError('Subject is required'); return; }
                  createMutation.mutate({ subject, description: description || undefined, priority });
                }}
                disabled={createMutation.isPending}
                style={styles.submitBtn}
              >
                {createMutation.isPending ? 'Submitting…' : 'Submit Ticket'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const styles = {
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem', flexWrap: 'wrap' as const, gap: '0.5rem' },
  heading: { margin: 0, fontSize: '1.4rem', color: '#111827' },
  headerActions: { display: 'flex', gap: '0.5rem', alignItems: 'center' },
  select: { padding: '0.4rem 0.6rem', border: '1px solid #d1d5db', borderRadius: 4, fontSize: '0.9rem' },
  newBtn: { padding: '0.45rem 1rem', background: '#e25822', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontWeight: 600, fontSize: '0.875rem' },
  info: { color: '#6b7280' },
  errorTxt: { color: '#b91c1c', fontSize: '0.875rem', margin: '0.5rem 0' },
  inlineBtn: { background: 'none', border: 'none', color: '#e25822', cursor: 'pointer', fontWeight: 600, fontSize: 'inherit', padding: 0 },
  card: { background: '#fff', borderRadius: 8, boxShadow: '0 1px 4px rgba(0,0,0,.07)', overflow: 'auto' },
  table: { width: '100%', borderCollapse: 'collapse' as const, fontSize: '0.875rem' },
  th: { textAlign: 'left' as const, padding: '0.6rem 0.75rem', color: '#6b7280', fontWeight: 600, borderBottom: '2px solid #f3f4f6' },
  td: { padding: '0.6rem 0.75rem', borderBottom: '1px solid #f9fafb', color: '#374151' },
  link: { color: '#1d4ed8', textDecoration: 'none', fontWeight: 500 },
  badge: { display: 'inline-block', padding: '0.2rem 0.5rem', borderRadius: 12, fontSize: '0.78rem', fontWeight: 600 },
  pagination: { display: 'flex', alignItems: 'center', gap: '1rem', marginTop: '1rem', justifyContent: 'center' },
  pageBtn: { padding: '0.4rem 0.8rem', border: '1px solid #d1d5db', borderRadius: 4, cursor: 'pointer', background: '#fff', fontSize: '0.875rem' },
  pageInfo: { color: '#6b7280', fontSize: '0.875rem' },
  overlay: { position: 'fixed' as const, inset: 0, background: 'rgba(0,0,0,.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 },
  modal: { background: '#fff', borderRadius: 8, padding: '1.5rem', width: '100%', maxWidth: 500, boxShadow: '0 8px 32px rgba(0,0,0,.2)', display: 'flex', flexDirection: 'column' as const, gap: '1rem' },
  modalTitle: { margin: 0, fontSize: '1.1rem', color: '#111827' },
  label: { display: 'flex', flexDirection: 'column' as const, gap: 4, fontSize: '0.875rem', color: '#374151' },
  input: { padding: '0.5rem 0.75rem', border: '1px solid #d1d5db', borderRadius: 4, fontSize: '0.9rem', fontFamily: 'inherit', width: '100%', boxSizing: 'border-box' as const },
  modalActions: { display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '0.5rem' },
  cancelBtn: { padding: '0.5rem 1rem', border: '1px solid #d1d5db', borderRadius: 4, background: '#fff', cursor: 'pointer', fontSize: '0.875rem' },
  submitBtn: { padding: '0.5rem 1.25rem', background: '#e25822', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontWeight: 600, fontSize: '0.875rem' },
} as const;
