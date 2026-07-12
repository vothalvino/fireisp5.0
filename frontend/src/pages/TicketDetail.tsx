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

import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, tokenStore, authedFetch } from '@/api/client';
import { useWebSocket } from '@/api/useWebSocket';
import { useGraphQLSubscription } from '@/api/useGraphQLSubscription';
import { useAuth } from '@/auth/AuthContext';
import { useTranslation } from 'react-i18next';

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
  const res = await authedFetch(`${API_BASE}/tickets/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
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
  const res = await authedFetch(`${API_BASE}/tickets/${ticketId}/comments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ body, is_internal: isInternal }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || 'Failed to add comment');
  }
}

async function updateComment(
  ticketId: number,
  commentId: number,
  commentBody: string,
  isInternal: boolean,
): Promise<void> {
  const res = await authedFetch(`${API_BASE}/tickets/${ticketId}/comments/${commentId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ body: commentBody, is_internal: isInternal }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || 'Failed to update comment');
  }
}

async function deleteComment(ticketId: number, commentId: number): Promise<void> {
  const res = await authedFetch(`${API_BASE}/tickets/${ticketId}/comments/${commentId}`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || 'Failed to delete comment');
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

interface CommentItemProps {
  ticketId: number;
  comment: TicketComment;
  onChanged: () => void;
}

function CommentItem({ ticketId, comment, onChanged }: CommentItemProps) {
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [draft, setDraft] = useState(comment.body);
  const [err, setErr] = useState('');
  const isInternal = Boolean(comment.is_internal);

  const saveMutation = useMutation({
    mutationFn: () => updateComment(ticketId, comment.id, draft.trim(), isInternal),
    onSuccess: () => { setEditing(false); setErr(''); onChanged(); },
    onError: (e: Error) => setErr(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteComment(ticketId, comment.id),
    onSuccess: () => { setConfirmDelete(false); setErr(''); onChanged(); },
    onError: (e: Error) => setErr(e.message),
  });

  return (
    <div
      style={{
        background: isInternal ? '#fef9c3' : '#f9fafb',
        border: `1px solid ${isInternal ? '#fde047' : '#e5e7eb'}`,
        borderRadius: 8, padding: '10px 14px',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
        <span style={{ fontWeight: 600, fontSize: '0.82rem', color: '#374151' }}>
          {comment.first_name && comment.last_name ? `${comment.first_name} ${comment.last_name}` : 'System'}
        </span>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {isInternal && (
            <span style={{
              background: '#fde047', color: '#713f12',
              fontSize: '0.7rem', fontWeight: 700,
              padding: '1px 6px', borderRadius: 10,
            }}>
              INTERNAL
            </span>
          )}
          <span style={{ fontSize: '0.75rem', color: '#9ca3af' }}>{fmt(comment.created_at)}</span>
        </div>
      </div>

      {err && <div style={errStyle}>{err}</div>}

      {editing ? (
        <>
          <textarea
            style={{ ...inputStyle, height: 70, resize: 'vertical' }}
            value={draft}
            onChange={e => setDraft(e.target.value)}
          />
          <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
            <button
              style={btnPrimary}
              disabled={saveMutation.isPending || !draft.trim()}
              onClick={() => saveMutation.mutate()}
            >
              {saveMutation.isPending ? 'Saving…' : 'Save'}
            </button>
            <button
              style={commentActionBtn}
              onClick={() => { setEditing(false); setDraft(comment.body); setErr(''); }}
            >
              Cancel
            </button>
          </div>
        </>
      ) : (
        <>
          <p style={{ margin: 0, fontSize: '0.87rem', color: '#374151', whiteSpace: 'pre-wrap' }}>
            {comment.body}
          </p>
          {confirmDelete ? (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6 }}>
              <span style={{ fontSize: '0.78rem', color: '#991b1b' }}>Delete this comment?</span>
              <button
                style={commentDeleteBtn}
                disabled={deleteMutation.isPending}
                onClick={() => deleteMutation.mutate()}
              >
                {deleteMutation.isPending ? 'Deleting…' : 'Confirm'}
              </button>
              <button style={commentActionBtn} onClick={() => setConfirmDelete(false)}>Cancel</button>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
              <button style={commentActionBtn} onClick={() => { setEditing(true); setDraft(comment.body); }}>
                Edit
              </button>
              <button style={commentDeleteBtn} onClick={() => setConfirmDelete(true)}>
                Delete
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
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
          <CommentItem key={c.id} ticketId={ticketId} comment={c} onChanged={onAdded} />
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
// AI Suggested Reply — types & helpers
// ---------------------------------------------------------------------------

interface AiPolicy {
  enabled: number | boolean;
  mode: string;
  active_provider_id: number | null;
}

interface TopologyNode {
  id?: number;
  name?: string;
  device_id?: number;
}

interface TopologyContext {
  cpe: TopologyNode | null;
  accessDevice: TopologyNode | null;
  backhauls: Array<{ device: TopologyNode | null; medium: string | null }>;
  coreDevice: TopologyNode | null;
  activeOutages: Array<{ id: number; device_id: number }>;
}

interface AiReplyLog {
  id: number;
  ticket_id: number;
  provider_id: number | null;
  classification: string | null;
  confidence: number | null;
  action: string;
  cost_usd: number | null;
  duration_ms: number | null;
  draft_text: string | null;
  context_snapshot: string | null;
  created_at: string;
}

async function fetchAiPolicy(): Promise<AiPolicy | null> {
  const token = tokenStore.getAccess();
  const res = await fetch(`${API_BASE}/ai/policy`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) return null;
  const body = await res.json() as { data: AiPolicy };
  return body.data ?? null;
}

async function fetchLatestAiLog(ticketId: number): Promise<AiReplyLog | null> {
  const token = tokenStore.getAccess();
  const res = await fetch(`${API_BASE}/ai/logs?ticket_id=${ticketId}&limit=1`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) return null;
  const body = await res.json() as { data: AiReplyLog[] };
  return body.data?.[0] ?? null;
}

async function generateDraft(ticketId: number, contractId: number | null): Promise<{ logId: number; draftText: string | null }> {
  const res = await authedFetch(`${API_BASE}/ai/reply/draft`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ticket_id: ticketId, channel: 'portal', inbound_text: '', contract_id: contractId }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || 'Failed to generate draft');
  }
  const body = await res.json() as { data: { logId: number; draftText: string | null; skipped?: boolean; reason?: string } };
  if (body.data?.skipped) throw new Error(body.data.reason ?? 'Draft skipped');
  return { logId: body.data.logId, draftText: body.data.draftText };
}

async function finalizeReply(logId: number, finalText: string, action: 'sent' | 'edited' | 'discarded'): Promise<void> {
  const res = await authedFetch(`${API_BASE}/ai/reply/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ log_id: logId, final_text: finalText, action }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || 'Failed to finalize reply');
  }
}

function parseTopology(contextSnapshot: string | null): TopologyContext | null {
  if (!contextSnapshot) return null;
  try {
    const parsed = JSON.parse(contextSnapshot) as { topology?: TopologyContext };
    return parsed.topology ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Confidence badge
// ---------------------------------------------------------------------------

function ConfidenceBadge({ confidence }: { confidence: number | null }) {
  if (confidence === null) return null;
  const pct = Math.round(confidence * 100);
  const color = pct >= 80 ? '#065f46' : pct >= 60 ? '#854d0e' : '#991b1b';
  const bg    = pct >= 80 ? '#d1fae5' : pct >= 60 ? '#fef9c3' : '#fee2e2';
  return (
    <span style={{
      background: bg, color,
      padding: '2px 8px', borderRadius: 10,
      fontSize: '0.72rem', fontWeight: 700,
    }}>
      {pct}% confidence
    </span>
  );
}

// ---------------------------------------------------------------------------
// Topology breadcrumb
// ---------------------------------------------------------------------------

interface TopoBreadcrumbProps { topology: TopologyContext }

function TopoBreadcrumb({ topology }: TopoBreadcrumbProps) {
  const outagedIds = new Set(topology.activeOutages.map(o => o.device_id));

  function NodeChip({ node, role }: { node: TopologyNode | null; role: string }) {
    if (!node) return null;
    const nodeId = node.id ?? node.device_id;
    const hasOutage = nodeId !== undefined && outagedIds.has(nodeId);
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        {hasOutage && <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#ef4444', display: 'inline-block' }} aria-label="active outage" />}
        <span style={{
          background: '#f3f4f6', color: '#374151',
          padding: '2px 8px', borderRadius: 6, fontSize: '0.75rem', fontWeight: 600,
        }}>
          {role}: {node.name ?? `#${nodeId}`}
        </span>
      </span>
    );
  }

  function MediumIcon({ medium }: { medium: string | null }) {
    if (medium === 'fiber') return <span title="fiber">🔵</span>;
    if (medium === 'wireless') return <span title="wireless">📡</span>;
    return <span>—</span>;
  }

  return (
    <div
      style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginTop: 8 }}
      aria-label="topology breadcrumb"
    >
      <NodeChip node={topology.cpe} role="CPE" />
      {topology.accessDevice && (
        <>
          <span style={{ color: '#9ca3af' }}>→</span>
          <NodeChip node={topology.accessDevice} role="Access" />
        </>
      )}
      {topology.backhauls.map((bh, i) => (
        <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <span style={{ color: '#9ca3af' }}>→</span>
          <MediumIcon medium={bh.medium} />
          <NodeChip node={bh.device} role="Backhaul" />
        </span>
      ))}
      {topology.coreDevice && (
        <>
          <span style={{ color: '#9ca3af' }}>→</span>
          <NodeChip node={topology.coreDevice} role="Core" />
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// AI Suggested Reply Panel
// ---------------------------------------------------------------------------

interface AiSuggestedReplyPanelProps {
  ticket: Ticket;
  onReplySent: () => void;
}

function AiSuggestedReplyPanel({ ticket, onReplySent }: AiSuggestedReplyPanelProps) {
  const { t } = useTranslation();
  const { user } = useAuth();

  // draft state
  const [logId, setLogId] = useState<number | null>(null);
  const [draftText, setDraftText] = useState<string | null>(null);
  const [topology, setTopology] = useState<TopologyContext | null>(null);
  const [editText, setEditText] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [actionDone, setActionDone] = useState<string | null>(null);
  const [panelErr, setPanelErr] = useState('');

  // Fetch policy
  const { data: policy, isLoading: policyLoading } = useQuery({
    queryKey: ['ai-policy'],
    queryFn: fetchAiPolicy,
  });

  // Fetch latest log for this ticket
  const { data: latestLog, refetch: refetchLog } = useQuery({
    queryKey: ['ai-log', ticket.id],
    queryFn: () => fetchLatestAiLog(ticket.id),
    enabled: !!policy && !!Number(policy.enabled),
  });

  // Populate state from latest log when it arrives (and we don't have an in-memory draft yet)
  useEffect(() => {
    if (latestLog && latestLog.action === 'proposed' && draftText === null && logId === null) {
      setLogId(latestLog.id);
      setDraftText(latestLog.draft_text);
      const topo = parseTopology(latestLog.context_snapshot);
      setTopology(topo);
      setEditText(latestLog.draft_text ?? '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latestLog]);

  const generateMutation = useMutation({
    mutationFn: () => generateDraft(ticket.id, ticket.contract_id),
    onSuccess: (data) => {
      setLogId(data.logId);
      setDraftText(data.draftText);
      setEditText(data.draftText ?? '');
      setActionDone(null);
      setPanelErr('');
      void refetchLog();
    },
    onError: (e: Error) => setPanelErr(e.message),
  });

  const finalizeMutation = useMutation({
    mutationFn: ({ action, text }: { action: 'sent' | 'edited' | 'discarded'; text: string }) =>
      finalizeReply(logId!, text, action),
    onSuccess: (_data, vars) => {
      setActionDone(vars.action);
      if (vars.action === 'sent' || vars.action === 'edited') {
        onReplySent();
      }
      setIsEditing(false);
    },
    onError: (e: Error) => setPanelErr(e.message),
  });

  // Role gate: only show to staff (admin/support/technician/billing)
  const ALLOWED_ROLES = ['admin', 'support', 'technician', 'billing'];
  if (!user || !ALLOWED_ROLES.includes(user.role)) return null;

  if (policyLoading) return null;
  if (!policy || !Number(policy.enabled)) return null;

  const isGenerating = generateMutation.isPending;
  const isFinalizing = finalizeMutation.isPending;
  const hasDraft = draftText !== null && logId !== null;

  return (
    <div
      style={{
        ...card,
        marginTop: '1.5rem',
        border: '1px solid #dbeafe',
        background: 'var(--bg-card)',
      }}
      aria-label={t('aiSuggestedReply.panelLabel', 'AI Suggested Reply')}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
        <h3 style={{ ...cardTitle, margin: 0, color: '#1e40af' }}>
          🤖 {t('aiSuggestedReply.title', 'AI Suggested Reply')}
        </h3>
        {hasDraft && !actionDone && (
          <button
            style={{ ...btnSecondary, width: 'auto', fontSize: '0.78rem' }}
            disabled={isGenerating}
            onClick={() => { setDraftText(null); setLogId(null); setTopology(null); generateMutation.mutate(); }}
            aria-label={t('aiSuggestedReply.regenerate', 'Regenerate')}
          >
            {isGenerating ? t('aiSuggestedReply.generating', 'Generating…') : '↻ ' + t('aiSuggestedReply.regenerate', 'Regenerate')}
          </button>
        )}
      </div>

      {panelErr && <div style={errStyle}>{panelErr}</div>}

      {/* ── No draft yet ── */}
      {!hasDraft && !actionDone && (
        <div style={{ textAlign: 'center', padding: '1rem 0' }}>
          <p style={{ color: '#6b7280', fontSize: '0.85rem', marginBottom: 12 }}>
            {t('aiSuggestedReply.noReply', 'No AI draft for this ticket yet.')}
          </p>
          <button
            style={btnPrimary}
            disabled={isGenerating}
            onClick={() => generateMutation.mutate()}
            aria-label={t('aiSuggestedReply.generate', 'Generate Draft')}
          >
            {isGenerating ? t('aiSuggestedReply.generating', 'Generating…') : '✨ ' + t('aiSuggestedReply.generate', 'Generate Draft')}
          </button>
        </div>
      )}

      {/* ── Draft ready ── */}
      {hasDraft && !actionDone && (
        <>
          {/* Metadata row */}
          {latestLog && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10, fontSize: '0.78rem', color: '#6b7280' }}>
              {latestLog.classification && (
                <span style={{ background: '#ede9fe', color: '#5b21b6', padding: '2px 8px', borderRadius: 10, fontWeight: 600 }}>
                  {latestLog.classification}
                </span>
              )}
              <ConfidenceBadge confidence={latestLog.confidence} />
              {latestLog.cost_usd != null && (
                <span>💲 ${Number(latestLog.cost_usd).toFixed(5)}</span>
              )}
              {latestLog.duration_ms != null && (
                <span>⏱ {latestLog.duration_ms}ms</span>
              )}
            </div>
          )}

          {/* Topology breadcrumb */}
          {topology && <TopoBreadcrumb topology={topology} />}

          {/* Draft text or edit textarea */}
          {isEditing ? (
            <textarea
              style={{ ...inputStyle, height: 120, resize: 'vertical', marginTop: 12 }}
              value={editText}
              onChange={e => setEditText(e.target.value)}
              aria-label={t('aiSuggestedReply.editDraft', 'Edit draft')}
            />
          ) : (
            <div style={{
              marginTop: 12, padding: '10px 14px',
              background: '#eff6ff', border: '1px solid #bfdbfe',
              borderRadius: 8, fontSize: '0.87rem', color: '#1e3a5f',
              whiteSpace: 'pre-wrap', lineHeight: 1.6,
            }}
              data-testid="ai-draft-text"
            >
              {draftText}
            </div>
          )}

          {/* Action buttons */}
          <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
            {isEditing ? (
              <>
                <button
                  style={btnPrimary}
                  disabled={isFinalizing || !editText.trim()}
                  onClick={() => finalizeMutation.mutate({ action: 'edited', text: editText.trim() })}
                  aria-label={t('aiSuggestedReply.sendEdited', 'Send edited')}
                >
                  {isFinalizing ? t('aiSuggestedReply.sending', 'Sending…') : '📤 ' + t('aiSuggestedReply.send', 'Send')}
                </button>
                <button
                  style={btnSecondary}
                  disabled={isFinalizing}
                  onClick={() => { setIsEditing(false); setEditText(draftText ?? ''); }}
                >
                  {t('common.cancel', 'Cancel')}
                </button>
              </>
            ) : (
              <>
                <button
                  style={btnPrimary}
                  disabled={isFinalizing}
                  onClick={() => finalizeMutation.mutate({ action: 'sent', text: draftText ?? '' })}
                  aria-label={t('aiSuggestedReply.send', 'Send')}
                >
                  {isFinalizing ? t('aiSuggestedReply.sending', 'Sending…') : '📤 ' + t('aiSuggestedReply.send', 'Send')}
                </button>
                <button
                  style={btnSecondary}
                  disabled={isFinalizing}
                  onClick={() => { setIsEditing(true); setEditText(draftText ?? ''); }}
                  aria-label={t('aiSuggestedReply.editAndSend', 'Edit & Send')}
                >
                  ✏️ {t('aiSuggestedReply.editAndSend', 'Edit & Send')}
                </button>
                <button
                  style={{ ...btnSecondary, color: '#991b1b', borderColor: '#fca5a5' }}
                  disabled={isFinalizing}
                  onClick={() => finalizeMutation.mutate({ action: 'discarded', text: '' })}
                  aria-label={t('aiSuggestedReply.discard', 'Discard')}
                >
                  🗑️ {t('aiSuggestedReply.discard', 'Discard')}
                </button>
              </>
            )}
          </div>
        </>
      )}

      {/* ── Action completed ── */}
      {actionDone && (
        <div style={{ textAlign: 'center', padding: '0.75rem 0' }}>
          <p style={{ color: actionDone === 'discarded' ? '#6b7280' : '#065f46', fontWeight: 600, marginBottom: 12 }}>
            {actionDone === 'sent'     && ('✅ ' + t('aiSuggestedReply.sent', 'Reply sent.'))}
            {actionDone === 'edited'   && ('✅ ' + t('aiSuggestedReply.edited', 'Edited reply sent.'))}
            {actionDone === 'discarded'&& ('🗑️ ' + t('aiSuggestedReply.discarded', 'Draft discarded.'))}
          </p>
          <button
            style={btnSecondary}
            onClick={() => { setActionDone(null); setDraftText(null); setLogId(null); setTopology(null); }}
          >
            ✨ {t('aiSuggestedReply.generate', 'Generate Draft')}
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// AI Triage panel
// ---------------------------------------------------------------------------

interface AiTriageData {
  id: number;
  suggested_category: string | null;
  suggested_priority: string | null;
  suggested_resolution: string | null;
  /** JSON column — mysql2 returns a parsed array, but tolerate a raw string too. */
  kb_article_ids: number[] | string | null;
}

/** Normalize kb_article_ids (JSON array, JSON string, or legacy CSV) to number[]. */
export function parseKbArticleIds(raw: AiTriageData['kb_article_ids']): number[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map(Number).filter(Boolean);
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) return parsed.map(Number).filter(Boolean);
  } catch {
    // not JSON — fall through to CSV
  }
  return raw.split(',').map(Number).filter(Boolean);
}

async function fetchAiTriage(ticketId: number): Promise<AiTriageData | null> {
  const token = tokenStore.getAccess();
  const res = await fetch(`${API_BASE}/tickets/${ticketId}/ai-triage`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) return null;
  const body = await res.json() as { data?: AiTriageData };
  return body.data ?? null;
}

export async function postAiSummary(ticketId: number): Promise<string> {
  const res = await authedFetch(`${API_BASE}/tickets/${ticketId}/ai-summary`, {
    method: 'POST',
  });
  if (!res.ok) throw new Error('Failed to generate summary');
  // Backend contract (aiReplyService.generate): { skipped, reason } on a policy
  // gate, otherwise { skipped: false, logId, draftText, action } — the generated
  // text is `draftText`; there is no `summary` field.
  const body = await res.json() as {
    data?: { skipped?: boolean; reason?: string; logId?: number; draftText?: string | null; action?: string };
  };
  // When AI is disabled by policy the endpoint returns 200 { skipped, reason }.
  // Surface it instead of silently coercing to an empty summary.
  if (body.data?.skipped) throw new Error(body.data.reason ?? 'AI summaries are disabled by policy');
  if (body.data?.action === 'failed' || !body.data?.draftText) {
    throw new Error('AI generation failed — no draft was produced');
  }
  return body.data.draftText;
}

function AiTriagePanel({ ticketId }: { ticketId: number }) {
  const { t } = useTranslation();
  const [summary, setSummary] = useState<string | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryErr, setSummaryErr] = useState('');

  const { data: triage } = useQuery({
    queryKey: ['ai-triage', ticketId],
    queryFn: () => fetchAiTriage(ticketId),
  });

  async function handleGenerateSummary() {
    setSummaryLoading(true);
    setSummaryErr('');
    try {
      const s = await postAiSummary(ticketId);
      setSummary(s);
    } catch (e) {
      setSummaryErr((e as Error).message);
    } finally {
      setSummaryLoading(false);
    }
  }

  const kbIds: number[] = parseKbArticleIds(triage?.kb_article_ids ?? null);

  return (
    <div style={{ ...card, marginTop: '1.5rem', border: '1px solid #e0e7ff', background: 'var(--bg-card)' }}>
      <h3 style={{ ...cardTitle, color: '#4338ca' }}>{t('ticketDetail.aiTriage')}</h3>

      {!triage ? (
        <p style={{ color: '#6b7280', fontSize: '0.85rem', margin: 0 }}>{t('ticketDetail.aiTriageNone')}</p>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem 1.5rem', fontSize: '0.85rem' }}>
          {triage.suggested_category && (
            <div>
              <div style={{ fontWeight: 600, color: '#6b7280', fontSize: '0.75rem', textTransform: 'uppercase' }}>{t('ticketDetail.aiTriageCategory')}</div>
              <div>{triage.suggested_category}</div>
            </div>
          )}
          {triage.suggested_priority && (
            <div>
              <div style={{ fontWeight: 600, color: '#6b7280', fontSize: '0.75rem', textTransform: 'uppercase' }}>{t('ticketDetail.aiTriagePriority')}</div>
              <PriorityBadge priority={triage.suggested_priority} />
            </div>
          )}
          {triage.suggested_resolution && (
            <div style={{ gridColumn: '1 / -1' }}>
              <div style={{ fontWeight: 600, color: '#6b7280', fontSize: '0.75rem', textTransform: 'uppercase' }}>{t('ticketDetail.aiTriageResolution')}</div>
              <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.5, marginTop: 2 }}>{triage.suggested_resolution}</div>
            </div>
          )}
          {kbIds.length > 0 && (
            <div style={{ gridColumn: '1 / -1' }}>
              <div style={{ fontWeight: 600, color: '#6b7280', fontSize: '0.75rem', textTransform: 'uppercase' }}>{t('ticketDetail.aiTriageKb')}</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
                {kbIds.map(id => (
                  <span key={id} style={{ background: '#e0e7ff', color: '#3730a3', padding: '2px 8px', borderRadius: 10, fontSize: '0.78rem' }}>
                    KB #{id}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <div style={{ marginTop: '1rem', borderTop: '1px solid #e5e7eb', paddingTop: '0.75rem' }}>
        <div style={{ fontWeight: 600, fontSize: '0.88rem', color: '#374151', marginBottom: 6 }}>{t('ticketDetail.aiSummary')}</div>
        {summaryErr && <div style={errStyle}>{summaryErr}</div>}
        {summary && (
          <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 6, padding: '0.75rem', fontSize: '0.85rem', whiteSpace: 'pre-wrap', lineHeight: 1.6, marginBottom: 8 }}>
            <div style={{ fontWeight: 600, color: '#6b7280', fontSize: '0.75rem', marginBottom: 4 }}>{t('ticketDetail.aiSummaryResult')}</div>
            {summary}
          </div>
        )}
        <button
          style={{ ...btnPrimary, fontSize: '0.82rem', padding: '5px 14px' }}
          disabled={summaryLoading}
          onClick={() => void handleGenerateSummary()}
        >
          {summaryLoading ? t('ticketDetail.aiSummaryGenerating') : t('ticketDetail.aiSummaryGenerate')}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Relations panel
// ---------------------------------------------------------------------------

interface TicketRelation {
  id: number;
  ticket_id_a: number;
  ticket_id_b: number;
  relation_type: string;
}

async function fetchRelations(ticketId: number): Promise<TicketRelation[]> {
  const token = tokenStore.getAccess();
  const res = await fetch(`${API_BASE}/tickets/${ticketId}/relations`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) return [];
  const body = await res.json() as { data: TicketRelation[] };
  return body.data ?? [];
}

async function addRelation(ticketId: number, relatedId: number, relationType: string): Promise<void> {
  const res = await authedFetch(`${API_BASE}/tickets/${ticketId}/relations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ related_ticket_id: relatedId, relation_type: relationType }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(err.error || 'Failed to add relation');
  }
}

async function removeRelation(ticketId: number, relId: number): Promise<void> {
  const res = await authedFetch(`${API_BASE}/tickets/${ticketId}/relations/${relId}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error('Failed to remove relation');
}

function RelationsPanel({ ticketId }: { ticketId: number }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [relatedId, setRelatedId] = useState('');
  const [relationType, setRelationType] = useState('related');
  const [formErr, setFormErr] = useState('');

  const { data: relations = [], refetch } = useQuery({
    queryKey: ['ticket-relations', ticketId],
    queryFn: () => fetchRelations(ticketId),
  });

  const addMut = useMutation({
    mutationFn: () => addRelation(ticketId, Number(relatedId), relationType),
    onSuccess: () => {
      setShowForm(false);
      setRelatedId('');
      setFormErr('');
      void refetch();
      queryClient.invalidateQueries({ queryKey: ['ticket-relations', ticketId] });
    },
    onError: (e: Error) => setFormErr(e.message),
  });

  const removeMut = useMutation({
    mutationFn: (relId: number) => removeRelation(ticketId, relId),
    onSuccess: () => void refetch(),
  });

  const RELATION_TYPES = ['related', 'blocks', 'blocked_by', 'duplicate'];
  const typeLabel = (type: string) => {
    const map: Record<string, string> = {
      related: t('ticketDetail.relationsTypeRelated'),
      blocks: t('ticketDetail.relationsTypeBlocks'),
      blocked_by: t('ticketDetail.relationsTypeBlockedBy'),
      duplicate: t('ticketDetail.relationsTypeDuplicate'),
    };
    return map[type] ?? type;
  };

  return (
    <div style={{ ...card, marginTop: '1.5rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
        <h3 style={{ ...cardTitle, margin: 0 }}>{t('ticketDetail.relations')}</h3>
        <button style={{ ...btnPrimary, fontSize: '0.78rem', padding: '4px 12px' }} onClick={() => setShowForm(s => !s)}>
          {t('ticketDetail.relationsAdd')}
        </button>
      </div>

      {showForm && (
        <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 6, padding: '0.75rem', marginBottom: '0.75rem' }}>
          {formErr && <div style={errStyle}>{formErr}</div>}
          <label style={labelStyle}>{t('ticketDetail.relationsRelatedId')}</label>
          <input
            type="number"
            style={inputStyle}
            value={relatedId}
            onChange={e => setRelatedId(e.target.value)}
            placeholder="e.g. 1234"
          />
          <label style={labelStyle}>{t('ticketDetail.relationsType')}</label>
          <select style={inputStyle} value={relationType} onChange={e => setRelationType(e.target.value)}>
            {RELATION_TYPES.map(rt => <option key={rt} value={rt}>{typeLabel(rt)}</option>)}
          </select>
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button style={btnPrimary} disabled={!relatedId || addMut.isPending} onClick={() => addMut.mutate()}>
              {addMut.isPending ? '...' : t('ticketDetail.relationsAdd')}
            </button>
            <button style={btnSecondary} onClick={() => { setShowForm(false); setFormErr(''); }}>
              {t('common.cancel', 'Cancel')}
            </button>
          </div>
        </div>
      )}

      {relations.length === 0 ? (
        <p style={{ color: '#9ca3af', fontSize: '0.85rem', margin: 0 }}>{t('ticketDetail.relationsNone')}</p>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {relations.map(rel => {
            const other = rel.ticket_id_a === ticketId ? rel.ticket_id_b : rel.ticket_id_a;
            return (
              <li key={rel.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.85rem' }}>
                <span style={{ background: '#f3f4f6', color: '#374151', padding: '2px 8px', borderRadius: 10 }}>{typeLabel(rel.relation_type)}</span>
                <span>Ticket #{other}</span>
                <button
                  style={{ marginLeft: 'auto', ...commentDeleteBtn, fontSize: '0.75rem', padding: '2px 8px' }}
                  disabled={removeMut.isPending}
                  onClick={() => removeMut.mutate(rel.id)}
                >
                  {t('ticketDetail.relationsRemove')}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Time Logs panel
// ---------------------------------------------------------------------------

interface TimeLog {
  id: number;
  ticket_id: number;
  user_id: number;
  minutes: number;
  work_date: string;
  description: string | null;
  first_name: string | null;
  last_name: string | null;
}

async function fetchTimeLogs(ticketId: number): Promise<TimeLog[]> {
  const token = tokenStore.getAccess();
  const res = await fetch(`${API_BASE}/tickets/${ticketId}/time-logs`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) return [];
  const body = await res.json() as { data: TimeLog[] };
  return body.data ?? [];
}

async function addTimeLog(ticketId: number, minutes: number, workDate: string, description: string): Promise<void> {
  const res = await authedFetch(`${API_BASE}/tickets/${ticketId}/time-logs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ minutes, work_date: workDate, description }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(err.error || 'Failed to log time');
  }
}

function TimeLogsPanel({ ticketId }: { ticketId: number }) {
  const { t } = useTranslation();
  const [showForm, setShowForm] = useState(false);
  const [minutes, setMinutes] = useState('');
  const [workDate, setWorkDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [description, setDescription] = useState('');
  const [formErr, setFormErr] = useState('');

  const { data: logs = [], refetch } = useQuery({
    queryKey: ['ticket-time-logs', ticketId],
    queryFn: () => fetchTimeLogs(ticketId),
  });

  const addMut = useMutation({
    mutationFn: () => addTimeLog(ticketId, Number(minutes), workDate, description),
    onSuccess: () => {
      setShowForm(false);
      setMinutes('');
      setDescription('');
      setFormErr('');
      void refetch();
    },
    onError: (e: Error) => setFormErr(e.message),
  });

  const totalMinutes = logs.reduce((sum, l) => sum + (l.minutes ?? 0), 0);
  const fmtDuration = (mins: number) => `${Math.floor(mins / 60)}h ${mins % 60}m`;

  return (
    <div style={{ ...card, marginTop: '1.5rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
        <h3 style={{ ...cardTitle, margin: 0 }}>
          {t('ticketDetail.timeLogs')}
          {totalMinutes > 0 && (
            <span style={{ fontSize: '0.8rem', fontWeight: 400, color: '#6b7280', marginLeft: 8 }}>
              ({t('ticketDetail.timeLogsTotal')}: {fmtDuration(totalMinutes)})
            </span>
          )}
        </h3>
        <button style={{ ...btnPrimary, fontSize: '0.78rem', padding: '4px 12px' }} onClick={() => setShowForm(s => !s)}>
          {t('ticketDetail.timeLogsAdd')}
        </button>
      </div>

      {showForm && (
        <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 6, padding: '0.75rem', marginBottom: '0.75rem' }}>
          {formErr && <div style={errStyle}>{formErr}</div>}
          <label style={labelStyle}>{t('ticketDetail.timeLogsMinutes')}</label>
          <input type="number" min="1" style={inputStyle} value={minutes} onChange={e => setMinutes(e.target.value)} />
          <label style={labelStyle}>{t('ticketDetail.timeLogsDate')}</label>
          <input type="date" style={inputStyle} value={workDate} onChange={e => setWorkDate(e.target.value)} />
          <label style={labelStyle}>{t('ticketDetail.timeLogsDescription')}</label>
          <input type="text" style={inputStyle} value={description} onChange={e => setDescription(e.target.value)} />
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button style={btnPrimary} disabled={!minutes || addMut.isPending} onClick={() => addMut.mutate()}>
              {addMut.isPending ? '...' : t('ticketDetail.timeLogsSave')}
            </button>
            <button style={btnSecondary} onClick={() => { setShowForm(false); setFormErr(''); }}>
              {t('common.cancel', 'Cancel')}
            </button>
          </div>
        </div>
      )}

      {logs.length === 0 ? (
        <p style={{ color: '#9ca3af', fontSize: '0.85rem', margin: 0 }}>{t('ticketDetail.timeLogsNone')}</p>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {logs.map(log => (
            <li key={log.id} style={{ fontSize: '0.85rem', display: 'flex', gap: 10, padding: '6px 0', borderBottom: '1px solid #f3f4f6' }}>
              <span style={{ fontWeight: 600, minWidth: 48, color: '#374151' }}>{fmtDuration(log.minutes)}</span>
              <span style={{ color: '#6b7280' }}>{log.work_date?.slice(0, 10) ?? '—'}</span>
              {(log.first_name || log.last_name) && (
                <span style={{ color: '#6b7280' }}>{log.first_name} {log.last_name}</span>
              )}
              {log.description && <span style={{ flex: 1, color: '#374151' }}>{log.description}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Work Orders panel (A — Ticket → Work Order wiring)
// ---------------------------------------------------------------------------

interface WorkOrderRow {
  id: number;
  title: string;
  status: string;
  work_type: string;
  scheduled_at: string | null;
  assigned_first: string | null;
  assigned_last: string | null;
}

const WORK_TYPES_LIST = ['installation', 'maintenance', 'repair', 'survey', 'other'];

async function fetchWorkOrdersByTicket(ticketId: number): Promise<WorkOrderRow[]> {
  const token = tokenStore.getAccess();
  const res = await fetch(`${API_BASE}/work-orders?ticket_id=${ticketId}&limit=50`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) return [];
  const body = await res.json() as { data: WorkOrderRow[] };
  return body.data ?? [];
}

async function createWorkOrderFromTicket(payload: {
  ticket_id: number;
  client_id: number;
  title: string;
  work_type: string;
  scheduled_at: string | null;
  assigned_to: number | null;
}): Promise<void> {
  const res = await authedFetch(`${API_BASE}/work-orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(err.error || 'Failed to create work order');
  }
}

function WorkOrdersPanel({ ticket, users }: { ticket: Ticket; users: User[] }) {
  const { t } = useTranslation();
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState('');
  const [workType, setWorkType] = useState('repair');
  const [scheduledAt, setScheduledAt] = useState('');
  const [assignedTo, setAssignedTo] = useState('');
  const [formErr, setFormErr] = useState('');

  const { data: workOrders = [], refetch } = useQuery({
    queryKey: ['ticket-work-orders', ticket.id],
    queryFn: () => fetchWorkOrdersByTicket(ticket.id),
  });

  const addMut = useMutation({
    mutationFn: () => {
      if (ticket.client_id == null) throw new Error(t('ticketDetail.workOrdersNoClient', 'This ticket has no client.'));
      return createWorkOrderFromTicket({
        ticket_id: ticket.id,
        client_id: ticket.client_id,
        title: title.trim(),
        work_type: workType,
        scheduled_at: scheduledAt || null,
        assigned_to: assignedTo ? Number(assignedTo) : null,
      });
    },
    onSuccess: () => { setShowForm(false); setTitle(''); setScheduledAt(''); setAssignedTo(''); setFormErr(''); void refetch(); },
    onError: (e: Error) => setFormErr(e.message),
  });

  return (
    <div style={{ ...card, marginTop: '1.5rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
        <h3 style={{ ...cardTitle, margin: 0 }}>{t('ticketDetail.workOrders', 'Work Orders')} ({workOrders.length})</h3>
        {ticket.client_id != null && (
          <button style={{ ...btnPrimary, fontSize: '0.78rem', padding: '4px 12px' }} onClick={() => setShowForm(s => !s)}>
            {t('ticketDetail.workOrdersCreate', 'Create Work Order')}
          </button>
        )}
      </div>

      {showForm && (
        <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 6, padding: '0.75rem', marginBottom: '0.75rem' }}>
          {formErr && <div style={errStyle}>{formErr}</div>}
          <label style={labelStyle}>{t('ticketDetail.workOrdersTitle', 'Title')}</label>
          <input type="text" style={inputStyle} value={title} onChange={e => setTitle(e.target.value)} placeholder={t('ticketDetail.workOrdersTitlePlaceholder', 'Describe the work needed')} />
          <label style={labelStyle}>{t('ticketDetail.workOrdersType', 'Work Type')}</label>
          <select style={inputStyle} value={workType} onChange={e => setWorkType(e.target.value)}>
            {WORK_TYPES_LIST.map(wt => <option key={wt} value={wt}>{t(`workOrders.workType.${wt}`, wt)}</option>)}
          </select>
          <label style={labelStyle}>{t('ticketDetail.workOrdersScheduled', 'Scheduled At')}</label>
          <input type="datetime-local" style={inputStyle} value={scheduledAt} onChange={e => setScheduledAt(e.target.value)} />
          <label style={labelStyle}>{t('ticketDetail.workOrdersAssignee', 'Assign To')}</label>
          <select style={inputStyle} value={assignedTo} onChange={e => setAssignedTo(e.target.value)}>
            <option value="">{t('common.unassigned', '— unassigned —')}</option>
            {users.map(u => <option key={u.id} value={u.id}>{u.first_name} {u.last_name}</option>)}
          </select>
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button style={btnPrimary} disabled={!title.trim() || addMut.isPending} onClick={() => addMut.mutate()}>
              {addMut.isPending ? '...' : t('ticketDetail.workOrdersSave', 'Create')}
            </button>
            <button style={btnSecondary} onClick={() => { setShowForm(false); setFormErr(''); }}>
              {t('common.cancel', 'Cancel')}
            </button>
          </div>
        </div>
      )}

      {workOrders.length === 0 ? (
        <p style={{ color: '#9ca3af', fontSize: '0.85rem', margin: 0 }}>{t('ticketDetail.workOrdersNone', 'No work orders linked to this ticket.')}</p>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {workOrders.map(wo => (
            <li key={wo.id} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: '0.85rem', padding: '6px 0', borderBottom: '1px solid #f3f4f6' }}>
              <Link to={`/work-orders`} style={{ color: 'var(--link)', textDecoration: 'none', fontWeight: 600, minWidth: 32 }}>#{wo.id}</Link>
              <span style={{ flex: 1, color: '#374151' }}>{wo.title}</span>
              <span style={{ textTransform: 'capitalize', color: '#6b7280', fontSize: '0.78rem' }}>{wo.work_type}</span>
              <span style={{ textTransform: 'capitalize', color: '#6b7280', fontSize: '0.78rem' }}>{wo.status}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Escalations panel (D — fold escalations into TicketDetail)
// ---------------------------------------------------------------------------

interface EscalationRow {
  id: number;
  ticket_id: number;
  level: number;
  reason: string | null;
  status: string;
  escalated_to: number | null;
  created_at: string;
}

async function fetchEscalationsByTicket(ticketId: number): Promise<EscalationRow[]> {
  const token = tokenStore.getAccess();
  const res = await fetch(`${API_BASE}/escalations?ticket_id=${ticketId}&limit=50`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) return [];
  const body = await res.json() as { data: EscalationRow[] };
  return body.data ?? [];
}

async function createEscalation(ticketId: number, reason: string, escalatedTo: number | null): Promise<void> {
  const res = await authedFetch(`${API_BASE}/escalations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ticket_id: ticketId, reason, ...(escalatedTo != null ? { escalated_to: escalatedTo } : {}) }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(err.error || 'Failed to create escalation');
  }
}

const ESC_STATUS_COLOR: Record<string, { bg: string; color: string }> = {
  open:         { bg: '#fee2e2', color: '#991b1b' },
  acknowledged: { bg: '#fef9c3', color: '#854d0e' },
  resolved:     { bg: '#d1fae5', color: '#065f46' },
};

function EscalationsPanel({ ticket, users }: { ticket: Ticket; users: User[] }) {
  const { t } = useTranslation();
  const [showForm, setShowForm] = useState(false);
  const [reason, setReason] = useState('');
  const [escalatedTo, setEscalatedTo] = useState('');
  const [formErr, setFormErr] = useState('');

  const { data: escalations = [], refetch } = useQuery({
    queryKey: ['ticket-escalations', ticket.id],
    queryFn: () => fetchEscalationsByTicket(ticket.id),
  });

  const addMut = useMutation({
    mutationFn: () => createEscalation(ticket.id, reason.trim(), escalatedTo ? Number(escalatedTo) : null),
    onSuccess: () => { setShowForm(false); setReason(''); setEscalatedTo(''); setFormErr(''); void refetch(); },
    onError: (e: Error) => setFormErr(e.message),
  });

  return (
    <div style={{ ...card, marginTop: '1.5rem', border: '1px solid #fee2e2' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
        <h3 style={{ ...cardTitle, margin: 0, color: '#991b1b' }}>{t('ticketDetail.escalations', 'Escalations')} ({escalations.length})</h3>
        <button style={{ ...btnPrimary, fontSize: '0.78rem', padding: '4px 12px', background: '#dc2626' }} onClick={() => setShowForm(s => !s)}>
          {t('ticketDetail.escalationsAdd', 'Escalate')}
        </button>
      </div>

      {showForm && (
        <div style={{ background: '#fff5f5', border: '1px solid #fca5a5', borderRadius: 6, padding: '0.75rem', marginBottom: '0.75rem' }}>
          {formErr && <div style={errStyle}>{formErr}</div>}
          <label style={labelStyle}>{t('ticketDetail.escalationsReason', 'Reason')}</label>
          <textarea
            style={{ ...inputStyle, height: 70, resize: 'vertical' as const }}
            value={reason}
            onChange={e => setReason(e.target.value)}
            placeholder={t('ticketDetail.escalationsReasonPlaceholder', 'Why is this ticket being escalated?')}
          />
          <label style={labelStyle}>{t('ticketDetail.escalationsAssignee', 'Escalate To')}</label>
          <select style={inputStyle} value={escalatedTo} onChange={e => setEscalatedTo(e.target.value)}>
            <option value="">{t('common.unassigned', '— unassigned —')}</option>
            {users.map(u => <option key={u.id} value={u.id}>{u.first_name} {u.last_name}</option>)}
          </select>
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button style={{ ...btnPrimary, background: '#dc2626' }} disabled={!reason.trim() || addMut.isPending} onClick={() => addMut.mutate()}>
              {addMut.isPending ? '...' : t('ticketDetail.escalationsSave', 'Escalate')}
            </button>
            <button style={btnSecondary} onClick={() => { setShowForm(false); setFormErr(''); }}>
              {t('common.cancel', 'Cancel')}
            </button>
          </div>
        </div>
      )}

      {escalations.length === 0 ? (
        <p style={{ color: '#9ca3af', fontSize: '0.85rem', margin: 0 }}>{t('ticketDetail.escalationsNone', 'No escalations for this ticket.')}</p>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {escalations.map(esc => {
            const s = ESC_STATUS_COLOR[esc.status] ?? { bg: '#f3f4f6', color: '#374151' };
            return (
              <li key={esc.id} style={{ fontSize: '0.85rem', padding: '8px 10px', background: '#fff5f5', borderRadius: 6, border: '1px solid #fca5a5' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: esc.reason ? 4 : 0 }}>
                  <span style={{ fontWeight: 700, color: '#dc2626' }}>{t('ticketDetail.escalationsLevel', 'Level')} {esc.level}</span>
                  <span style={{ ...s, padding: '2px 8px', borderRadius: 10, fontSize: '0.72rem', fontWeight: 700, textTransform: 'capitalize' as const }}>
                    {esc.status}
                  </span>
                  <span style={{ marginLeft: 'auto', color: '#9ca3af', fontSize: '0.75rem' }}>{fmt(esc.created_at)}</span>
                </div>
                {esc.reason && <p style={{ margin: 0, color: '#374151', lineHeight: 1.5 }}>{esc.reason}</p>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Follow-ups panel
// ---------------------------------------------------------------------------

interface FollowUp {
  id: number;
  title: string;
  status: string;
  priority: string | null;
  due_at: string | null;
}

async function fetchFollowUps(ticketId: number): Promise<FollowUp[]> {
  const token = tokenStore.getAccess();
  const res = await fetch(`${API_BASE}/follow-up-reminders?ticket_id=${ticketId}&limit=100`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) return [];
  const body = await res.json() as { data: FollowUp[] };
  return body.data ?? [];
}

async function createFollowUp(body: { client_id: number; ticket_id: number; title: string; due_at: string }): Promise<void> {
  const res = await authedFetch(`${API_BASE}/follow-up-reminders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(err.error || 'Failed to create follow-up');
  }
}

function FollowUpsPanel({ ticket }: { ticket: Ticket }) {
  const { t } = useTranslation();
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState('');
  const [dueAt, setDueAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [formErr, setFormErr] = useState('');

  const { data: followUps = [], refetch } = useQuery({
    queryKey: ['ticket-follow-ups', ticket.id],
    queryFn: () => fetchFollowUps(ticket.id),
  });

  const addMut = useMutation({
    mutationFn: () => {
      if (ticket.client_id == null) throw new Error('This ticket has no client to attach a follow-up to.');
      return createFollowUp({ client_id: ticket.client_id, ticket_id: ticket.id, title: title.trim(), due_at: dueAt });
    },
    onSuccess: () => { setShowForm(false); setTitle(''); setFormErr(''); void refetch(); },
    onError: (e: Error) => setFormErr(e.message),
  });

  return (
    <div style={{ ...card, marginTop: '1.5rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
        <h3 style={{ ...cardTitle, margin: 0 }}>{t('ticketDetail.followUps', 'Follow-ups')}</h3>
        {ticket.client_id != null && (
          <button style={{ ...btnPrimary, fontSize: '0.78rem', padding: '4px 12px' }} onClick={() => setShowForm(s => !s)}>
            {t('ticketDetail.followUpsAdd', 'Add follow-up')}
          </button>
        )}
      </div>

      {showForm && (
        <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 6, padding: '0.75rem', marginBottom: '0.75rem' }}>
          {formErr && <div style={errStyle}>{formErr}</div>}
          <label style={labelStyle}>{t('ticketDetail.followUpsTitle', 'Title')}</label>
          <input type="text" style={inputStyle} value={title} onChange={e => setTitle(e.target.value)} />
          <label style={labelStyle}>{t('ticketDetail.followUpsDue', 'Due date')}</label>
          <input type="date" style={inputStyle} value={dueAt} onChange={e => setDueAt(e.target.value)} />
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button style={btnPrimary} disabled={!title.trim() || addMut.isPending} onClick={() => addMut.mutate()}>
              {addMut.isPending ? '...' : t('ticketDetail.followUpsSave', 'Save')}
            </button>
            <button style={btnSecondary} onClick={() => { setShowForm(false); setFormErr(''); }}>
              {t('common.cancel', 'Cancel')}
            </button>
          </div>
        </div>
      )}

      {followUps.length === 0 ? (
        <p style={{ color: '#9ca3af', fontSize: '0.85rem', margin: 0 }}>{t('ticketDetail.followUpsNone', 'No follow-ups for this ticket.')}</p>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {followUps.map(f => (
            <li key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: '0.85rem', padding: '6px 0', borderBottom: '1px solid #f3f4f6' }}>
              <span style={{ fontWeight: 600, color: '#374151' }}>{f.title}</span>
              <span style={{ color: '#6b7280' }}>{f.due_at ? fmt(f.due_at) : '—'}</span>
              <span style={{ marginLeft: 'auto', textTransform: 'capitalize', color: '#6b7280' }}>{f.status}</span>
            </li>
          ))}
        </ul>
      )}

      <div style={{ marginTop: 10 }}>
        <Link to="/follow-up-reminders" style={{ fontSize: '0.8rem', color: '#2563eb', textDecoration: 'none', fontWeight: 600 }}>
          {t('ticketDetail.followUpsViewAll', 'View all follow-ups →')}
        </Link>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Attachments panel
// ---------------------------------------------------------------------------

interface TicketAttachment {
  id: number;
  filename: string;
  original_filename: string;
  mime_type: string;
  file_size: number;
  created_at: string;
}

async function fetchAttachments(ticketId: number): Promise<TicketAttachment[]> {
  const token = tokenStore.getAccess();
  const res = await fetch(`${API_BASE}/tickets/${ticketId}/attachments`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) return [];
  const body = await res.json() as { data: TicketAttachment[] };
  return body.data ?? [];
}

async function deleteAttachment(ticketId: number, attachmentId: number): Promise<void> {
  const res = await authedFetch(`${API_BASE}/tickets/${ticketId}/attachments/${attachmentId}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error('Failed to delete attachment');
}

function AttachmentsPanel({ ticketId }: { ticketId: number }) {
  const { t } = useTranslation();
  const [uploading, setUploading] = useState(false);
  const [uploadErr, setUploadErr] = useState('');

  const { data: attachments = [], refetch } = useQuery({
    queryKey: ['ticket-attachments', ticketId],
    queryFn: () => fetchAttachments(ticketId),
  });

  const deleteMut = useMutation({
    mutationFn: (attachmentId: number) => deleteAttachment(ticketId, attachmentId),
    onSuccess: () => void refetch(),
  });

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadErr('');
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await authedFetch(`${API_BASE}/tickets/${ticketId}/attachments`, {
        method: 'POST',
        body: formData,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(err.error || 'Upload failed');
      }
      void refetch();
    } catch (err) {
      setUploadErr((err as Error).message);
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  }

  const fmtSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div style={{ ...card, marginTop: '1.5rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
        <h3 style={{ ...cardTitle, margin: 0 }}>{t('ticketDetail.attachments')}</h3>
        <label style={{ ...btnPrimary, fontSize: '0.78rem', padding: '4px 12px', cursor: 'pointer' }}>
          {uploading ? t('ticketDetail.attachmentsUploading') : t('ticketDetail.attachmentsUpload')}
          <input type="file" style={{ display: 'none' }} disabled={uploading} onChange={e => void handleFileChange(e)} />
        </label>
      </div>

      {uploadErr && <div style={errStyle}>{uploadErr}</div>}

      {attachments.length === 0 ? (
        <p style={{ color: '#9ca3af', fontSize: '0.85rem', margin: 0 }}>{t('ticketDetail.attachmentsNone')}</p>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {attachments.map(att => (
            <li key={att.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', borderBottom: '1px solid #f3f4f6', fontSize: '0.85rem' }}>
              <span style={{ flex: 1, color: '#374151', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{att.original_filename}</span>
              <span style={{ color: '#9ca3af', fontSize: '0.78rem' }}>{fmtSize(att.file_size)}</span>
              <a
                href={`${API_BASE}/tickets/${ticketId}/attachments/${att.id}/download`}
                style={{ color: 'var(--link)', fontSize: '0.78rem', textDecoration: 'none' }}
                download={att.original_filename}
              >
                {t('ticketDetail.attachmentsDownload')}
              </a>
              <button
                style={{ ...commentDeleteBtn, fontSize: '0.75rem', padding: '2px 8px' }}
                disabled={deleteMut.isPending}
                onClick={() => deleteMut.mutate(att.id)}
              >
                {t('ticketDetail.attachmentsDelete')}
              </button>
            </li>
          ))}
        </ul>
      )}
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

  // ── Live ticket updates via WebSocket ──────────────────────────────────────
  const { lastMessage: liveEvent } = useWebSocket(id ? `ticket:${id}` : 'notifications');

  // ── GraphQL subscription for new comments (P3.9) ─────────────────────────
  const { data: gqlCommentEvent } = useGraphQLSubscription<{ ticketCommentAdded: { id: number } }>(
    `subscription($ticketId: ID!) { ticketCommentAdded(ticketId: $ticketId) { id } }`,
    id ? { ticketId: id } : {},
  );

  useEffect(() => {
    if (gqlCommentEvent?.ticketCommentAdded && id) {
      void refetchComments();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gqlCommentEvent]);

  useEffect(() => {
    if (!liveEvent || !id) return;
    const ev = liveEvent.event;
    if (ev === 'comment') {
      // New comment posted — refetch comments silently
      void refetchComments();
    } else if (ev === 'status') {
      // Status or assignment changed — refetch ticket
      queryClient.invalidateQueries({ queryKey: ['ticket', id] });
    }
  }, [liveEvent, id, refetchComments, queryClient]);

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
        <Link to="/tickets" style={{ color: 'var(--link)', textDecoration: 'none' }}>Tickets</Link>
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
                  <Link to={`/clients/${client.id}`} style={{ color: 'var(--link)', textDecoration: 'none' }}>
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

          {/* AI Suggested Reply */}
          <AiSuggestedReplyPanel
            ticket={ticket}
            onReplySent={() => void refetchComments()}
          />

          {/* AI Triage Suggestions + AI Summary */}
          <AiTriagePanel ticketId={ticket.id} />

          {/* Relations */}
          <RelationsPanel ticketId={ticket.id} />

          {/* Work Orders (A) */}
          <WorkOrdersPanel ticket={ticket} users={users} />

          {/* Escalations (D) */}
          <EscalationsPanel ticket={ticket} users={users} />

          {/* Follow-ups */}
          <FollowUpsPanel ticket={ticket} />

          {/* Time Logs */}
          <TimeLogsPanel ticketId={ticket.id} />

          {/* Attachments */}
          <AttachmentsPanel ticketId={ticket.id} />
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
  background: 'var(--accent)', color: '#fff', border: 'none',
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
  boxShadow: '0 0 0 1px var(--border)',
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
const commentActionBtn: React.CSSProperties = {
  background: '#f3f4f6', color: '#374151', border: '1px solid #d1d5db',
  padding: '3px 10px', borderRadius: 6, cursor: 'pointer', fontSize: '0.78rem', fontWeight: 600,
};
const commentDeleteBtn: React.CSSProperties = {
  background: '#fee2e2', color: '#991b1b', border: '1px solid #fca5a5',
  padding: '3px 10px', borderRadius: 6, cursor: 'pointer', fontSize: '0.78rem', fontWeight: 600,
};
