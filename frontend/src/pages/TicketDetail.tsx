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
import { api, tokenStore } from '@/api/client';
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
  const token = tokenStore.getAccess();
  const res = await fetch(`${API_BASE}/ai/reply/draft`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
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
  const token = tokenStore.getAccess();
  const res = await fetch(`${API_BASE}/ai/reply/send`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
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

          {/* AI Suggested Reply */}
          <AiSuggestedReplyPanel
            ticket={ticket}
            onReplySent={() => void refetchComments()}
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
