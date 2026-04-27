// =============================================================================
// FireISP 5.0 — Portal Ticket Detail
// =============================================================================
// Shows a ticket with its comments thread and allows the client to add a reply.
// At /portal/tickets/:id
// =============================================================================

import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { portalTokenStore } from '@/auth/PortalAuthContext';

const API_BASE = '/api/v1/portal';

interface Comment {
  id: number;
  body: string;
  created_at: string;
}

interface Ticket {
  id: number;
  subject: string;
  description: string | null;
  priority: string;
  category: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  comments: Comment[];
}

async function portalGet<T>(path: string): Promise<T> {
  const token = portalTokenStore.getAccess();
  const res = await fetch(`${API_BASE}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error('Not found');
  return (await res.json() as { data: T }).data;
}

async function addComment(ticketId: number, body: string): Promise<Comment> {
  const token = portalTokenStore.getAccess();
  const res = await fetch(`${API_BASE}/tickets/${ticketId}/comments`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ body }),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new Error(err.error?.message ?? 'Failed to post comment');
  }
  return (await res.json() as { data: Comment }).data;
}

const STATUS_COLORS: Record<string, React.CSSProperties> = {
  open: { background: '#d1fae5', color: '#065f46' },
  in_progress: { background: '#dbeafe', color: '#1e40af' },
  waiting: { background: '#fef3c7', color: '#92400e' },
  resolved: { background: '#f3f4f6', color: '#374151' },
  closed: { background: '#f3f4f6', color: '#9ca3af' },
};

export function PortalTicketDetail() {
  const { id } = useParams<{ id: string }>();
  const [commentBody, setCommentBody] = useState('');
  const [commentError, setCommentError] = useState<string | null>(null);

  const queryClient = useQueryClient();

  const { data: ticket, isLoading, error } = useQuery({
    queryKey: ['portal-ticket', id],
    queryFn: () => portalGet<Ticket>(`/tickets/${id}`),
    enabled: !!id,
  });

  const commentMutation = useMutation({
    mutationFn: (body: string) => addComment(Number(id), body),
    onSuccess: () => {
      setCommentBody('');
      setCommentError(null);
      queryClient.invalidateQueries({ queryKey: ['portal-ticket', id] });
    },
    onError: (err: Error) => setCommentError(err.message),
  });

  if (isLoading) return <p style={{ color: '#6b7280' }}>Loading…</p>;
  if (error || !ticket) return <p style={{ color: '#b91c1c' }}>Ticket not found.</p>;

  const isClosed = ticket.status === 'closed' || ticket.status === 'resolved';

  return (
    <div>
      <div style={styles.breadcrumb}>
        <Link to="/portal/tickets" style={styles.back}>← Back to tickets</Link>
      </div>

      <div style={styles.card}>
        {/* Header */}
        <div style={styles.ticketHeader}>
          <div>
            <h1 style={styles.subject}>{ticket.subject}</h1>
            <p style={styles.meta}>
              #{ticket.id} · {ticket.priority} priority
              {ticket.category ? ` · ${ticket.category}` : ''}
              &nbsp;· opened {ticket.created_at.slice(0, 10)}
            </p>
          </div>
          <span style={{ ...styles.badge, ...(STATUS_COLORS[ticket.status] ?? {}) }}>
            {ticket.status.replace('_', ' ').toUpperCase()}
          </span>
        </div>

        {/* Description */}
        {ticket.description && (
          <div style={styles.description}>
            <p style={styles.descText}>{ticket.description}</p>
          </div>
        )}

        {/* Comments thread */}
        <h2 style={styles.sectionTitle}>Conversation</h2>

        {ticket.comments.length === 0 && (
          <p style={styles.noComments}>No replies yet.</p>
        )}

        <div style={styles.thread}>
          {ticket.comments.map(comment => (
            <div key={comment.id} style={styles.comment}>
              <div style={styles.commentMeta}>{comment.created_at.slice(0, 16).replace('T', ' ')}</div>
              <p style={styles.commentBody}>{comment.body}</p>
            </div>
          ))}
        </div>

        {/* Reply form */}
        {!isClosed && (
          <div style={styles.replyForm}>
            <h3 style={styles.replyTitle}>Add a reply</h3>
            {commentError && <p style={styles.errorTxt}>{commentError}</p>}
            <textarea
              value={commentBody}
              onChange={e => setCommentBody(e.target.value)}
              style={styles.textarea}
              placeholder="Type your reply…"
              maxLength={5000}
              rows={4}
            />
            <button
              onClick={() => {
                if (!commentBody.trim()) return;
                commentMutation.mutate(commentBody);
              }}
              disabled={commentMutation.isPending || !commentBody.trim()}
              style={styles.replyBtn}
            >
              {commentMutation.isPending ? 'Sending…' : 'Send Reply'}
            </button>
          </div>
        )}

        {isClosed && (
          <p style={styles.closedNote}>This ticket is {ticket.status}. <Link to="/portal/tickets" style={{ color: '#e25822' }}>Open a new ticket</Link> if you need further assistance.</p>
        )}
      </div>
    </div>
  );
}

const styles = {
  breadcrumb: { marginBottom: '1rem' },
  back: { color: 'var(--text-muted)', textDecoration: 'none', fontSize: '0.9rem' },
  card: { background: 'var(--bg-card)', borderRadius: 8, padding: '1.5rem', boxShadow: '0 1px 4px rgba(0,0,0,.07)' },
  ticketHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem', flexWrap: 'wrap' as const, gap: '0.75rem' },
  subject: { margin: '0 0 0.25rem', fontSize: '1.3rem', color: 'var(--text-primary)' },
  meta: { margin: 0, color: 'var(--text-muted)', fontSize: '0.85rem' },
  badge: { display: 'inline-block', padding: '0.3rem 0.75rem', borderRadius: 12, fontSize: '0.8rem', fontWeight: 700, whiteSpace: 'nowrap' as const },
  description: { background: 'var(--bg-body)', borderRadius: 6, padding: '1rem', marginBottom: '1rem' },
  descText: { margin: 0, color: 'var(--text-secondary)', fontSize: '0.9rem', lineHeight: 1.6, whiteSpace: 'pre-wrap' as const },
  sectionTitle: { fontSize: '1rem', color: 'var(--text-secondary)', margin: '1rem 0 0.5rem', borderTop: '1px solid var(--border-subtle)', paddingTop: '1rem' },
  noComments: { color: 'var(--text-dimmed)', fontSize: '0.875rem' },
  thread: { display: 'flex', flexDirection: 'column' as const, gap: '0.75rem' },
  comment: { background: '#f0f7ff', borderRadius: 6, padding: '0.75rem 1rem', borderLeft: '3px solid #bfdbfe' },
  commentMeta: { color: 'var(--text-muted)', fontSize: '0.78rem', marginBottom: '0.25rem' },
  commentBody: { margin: 0, color: '#1e3a5f', fontSize: '0.9rem', lineHeight: 1.6, whiteSpace: 'pre-wrap' as const },
  replyForm: { marginTop: '1.25rem', borderTop: '1px solid var(--border-subtle)', paddingTop: '1rem', display: 'flex', flexDirection: 'column' as const, gap: '0.5rem' },
  replyTitle: { margin: 0, fontSize: '0.95rem', color: 'var(--text-secondary)' },
  errorTxt: { color: '#b91c1c', fontSize: '0.875rem', margin: 0 },
  textarea: { padding: '0.6rem 0.75rem', border: '1px solid var(--input-border)', borderRadius: 4, fontSize: '0.9rem', fontFamily: 'inherit', resize: 'vertical' as const, width: '100%', boxSizing: 'border-box' as const },
  replyBtn: { alignSelf: 'flex-start', padding: '0.5rem 1.25rem', background: '#e25822', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontWeight: 600, fontSize: '0.875rem' },
  closedNote: { marginTop: '1rem', color: 'var(--text-muted)', fontSize: '0.875rem', fontStyle: 'italic' as const },
};
