// =============================================================================
// FireISP 5.0 — AI Customer Support Page (Section 21)
// =============================================================================
// 4-tab page covering §21 AI Customer Support:
//   1. Chat        — conversation list + message thread + escalation
//   2. Knowledge Base — article search/create/embed
//   3. Metrics     — KPI cards for resolution rate, escalation rate, etc.
//   4. NOC Insights — AI-generated NOC analysis actions + insight history
// =============================================================================

import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { readCsrfCookie } from '@/api/csrf';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Tab = 'chat' | 'kb' | 'metrics' | 'noc';

interface SupportConversation {
  id: number;
  organization_id: number;
  client_id: number | null;
  channel: string;
  status: string;
  intent: string | null;
  confidence: number | null;
  created_at: string;
  updated_at: string;
}

interface SupportMessage {
  id: number;
  conversation_id: number;
  role: string;
  content: string;
  created_at: string;
}

interface KbArticle {
  id: number;
  organization_id: number;
  title: string;
  body: string;
  category: string | null;
  locale: string;
  tags: string[] | null;
  is_published: number;
  created_at: string;
}

interface SupportMetrics {
  resolution_rate: number | null;
  escalation_rate: number | null;
  avg_handle_time_seconds: number | null;
  csat: number | null;
  total_conversations: number;
  total_escalations: number;
}

interface NocInsight {
  id: number;
  organization_id: number;
  insight_type: string;
  alert_id: number | null;
  confidence: number | null;
  summary: string | null;
  recommendation: string | null;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getOrgId(): string {
  return localStorage.getItem('orgId') ?? '';
}
function getToken(): string {
  return localStorage.getItem('token') ?? '';
}

async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api/v1${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'X-Org-Id': getOrgId(),
      Authorization: `Bearer ${getToken()}`,
      ...(readCsrfCookie() ? { 'X-CSRF-Token': readCsrfCookie()! } : {}),
      ...(init.headers as Record<string, string> | undefined),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? res.statusText);
  }
  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Shared sub-components
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: string }) {
  const color =
    status === 'open' ? '#2563eb' :
    status === 'resolved' ? '#16a34a' :
    status === 'escalated' ? '#dc2626' :
    status === 'published' ? '#16a34a' :
    '#d97706';
  return (
    <span style={{
      background: color, color: '#fff',
      borderRadius: 4, padding: '2px 8px', fontSize: 12, fontWeight: 600,
    }}>
      {status}
    </span>
  );
}

function ActionButton({
  onClick, label, variant = 'primary', disabled = false,
}: {
  onClick: () => void;
  label: string;
  variant?: 'primary' | 'danger' | 'secondary';
  disabled?: boolean;
}) {
  const bg = variant === 'danger' ? '#dc2626' : variant === 'secondary' ? '#6b7280' : '#2563eb';
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        background: disabled ? '#9ca3af' : bg, color: '#fff', border: 'none',
        borderRadius: 4, padding: '4px 10px', cursor: disabled ? 'not-allowed' : 'pointer',
        fontSize: 12, marginRight: 4,
      }}
    >
      {label}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Chat Tab
// ---------------------------------------------------------------------------

function ChatTab() {
  const { t } = useTranslation();
  const [conversations, setConversations] = useState<SupportConversation[]>([]);
  const [selected, setSelected] = useState<SupportConversation | null>(null);
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [msgLoading, setMsgLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [input, setInput] = useState('');

  const loadConversations = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await apiFetch<{ data: SupportConversation[] }>('/support/conversations');
      setConversations(data.data);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadConversations(); }, [loadConversations]);

  const loadMessages = useCallback(async (conv: SupportConversation) => {
    setMsgLoading(true);
    try {
      const data = await apiFetch<{ data: SupportMessage[] }>(`/support/conversations/${conv.id}/messages`);
      setMessages(data.data);
    } catch (e) {
      setError(String(e));
    } finally {
      setMsgLoading(false);
    }
  }, []);

  const handleSelect = (conv: SupportConversation) => {
    setSelected(conv);
    loadMessages(conv);
  };

  const handleNewConversation = async () => {
    try {
      const data = await apiFetch<{ data: SupportConversation }>('/support/conversations', {
        method: 'POST',
        body: JSON.stringify({ channel: 'web' }),
      });
      await loadConversations();
      handleSelect(data.data);
    } catch (e) {
      setError(String(e));
    }
  };

  const handleSend = async () => {
    if (!selected || !input.trim()) return;
    setSending(true);
    try {
      await apiFetch(`/support/conversations/${selected.id}/messages`, {
        method: 'POST',
        body: JSON.stringify({ content: input.trim() }),
      });
      setInput('');
      loadMessages(selected);
    } catch (e) {
      setError(String(e));
    } finally {
      setSending(false);
    }
  };

  const handleEscalate = async () => {
    if (!selected) return;
    try {
      await apiFetch(`/support/conversations/${selected.id}/escalate`, { method: 'POST' });
      await loadConversations();
      const updated = conversations.find(c => c.id === selected.id);
      if (updated) setSelected({ ...updated, status: 'escalated' });
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <div style={{ display: 'flex', gap: 16, height: 480 }}>
      {/* Conversation list */}
      <div style={{ width: 240, borderRight: '1px solid #e5e7eb', overflowY: 'auto' }}>
        <div style={{ padding: '8px 0' }}>
          <ActionButton onClick={handleNewConversation} label={t('aiSupport.chat.newConversation')} />
        </div>
        {error && <div style={{ color: '#dc2626', fontSize: 12, padding: '0 4px' }}>{error}</div>}
        {loading ? (
          <div style={{ color: '#6b7280', padding: 8, fontSize: 13 }}>...</div>
        ) : conversations.length === 0 ? (
          <div style={{ color: '#6b7280', padding: 8, fontSize: 13 }}>
            {t('aiSupport.chat.noConversations')}
            <br />{t('aiSupport.chat.startNew')}
          </div>
        ) : (
          conversations.map(conv => (
            <div
              key={conv.id}
              onClick={() => handleSelect(conv)}
              style={{
                padding: '8px 10px',
                cursor: 'pointer',
                background: selected?.id === conv.id ? '#eff6ff' : 'transparent',
                borderLeft: selected?.id === conv.id ? '3px solid #2563eb' : '3px solid transparent',
                fontSize: 13,
              }}
            >
              <div style={{ fontWeight: 600 }}>#{conv.id}</div>
              <div style={{ fontSize: 11, color: '#6b7280' }}>{t('aiSupport.chat.channel')}: {conv.channel}</div>
              <StatusBadge status={conv.status} />
            </div>
          ))
        )}
      </div>

      {/* Message thread */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        {!selected ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6b7280' }}>
            {t('aiSupport.chat.startNew')}
          </div>
        ) : (
          <>
            <div style={{ padding: '4px 0 8px', borderBottom: '1px solid #e5e7eb', display: 'flex', gap: 8, alignItems: 'center' }}>
              <strong>#{selected.id}</strong>
              <StatusBadge status={selected.status} />
              {selected.intent && (
                <span style={{ fontSize: 12, color: '#6b7280' }}>
                  {t('aiSupport.chat.intent')}: {selected.intent}
                  {selected.confidence != null && ` (${Math.round(selected.confidence * 100)}%)`}
                </span>
              )}
              <div style={{ marginLeft: 'auto' }}>
                <ActionButton
                  onClick={handleEscalate}
                  label={t('aiSupport.chat.escalate')}
                  variant="danger"
                  disabled={selected.status === 'escalated' || selected.status === 'resolved'}
                />
              </div>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
              {msgLoading ? (
                <div style={{ color: '#6b7280', fontSize: 13 }}>{t('aiSupport.chat.typing')}</div>
              ) : (
                messages.map(msg => (
                  <div
                    key={msg.id}
                    style={{
                      marginBottom: 8,
                      display: 'flex',
                      flexDirection: msg.role === 'user' ? 'row-reverse' : 'row',
                      gap: 8,
                    }}
                  >
                    <div style={{
                      maxWidth: '70%',
                      background: msg.role === 'user' ? '#2563eb' : '#f3f4f6',
                      color: msg.role === 'user' ? '#fff' : '#111827',
                      borderRadius: 8,
                      padding: '6px 12px',
                      fontSize: 13,
                    }}>
                      <div style={{ fontWeight: 600, fontSize: 11, marginBottom: 2, opacity: 0.75 }}>{msg.role}</div>
                      {msg.content}
                    </div>
                  </div>
                ))
              )}
            </div>
            <div style={{ display: 'flex', gap: 8, paddingTop: 8 }}>
              <input
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                placeholder={t('aiSupport.chat.send')}
                style={{ flex: 1, padding: '6px 10px', border: '1px solid #e5e7eb', borderRadius: 4, fontSize: 13 }}
              />
              <ActionButton onClick={handleSend} label={t('aiSupport.chat.send')} disabled={sending || !input.trim()} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Knowledge Base Tab
// ---------------------------------------------------------------------------

function KbTab() {
  const { t } = useTranslation();
  const [articles, setArticles] = useState<KbArticle[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [embedding, setEmbedding] = useState<number | null>(null);
  const [form, setForm] = useState({
    title: '',
    body: '',
    category: '',
    locale: 'es',
    tags: '',
    is_published: false,
  });

  const load = useCallback(async (q?: string) => {
    setLoading(true);
    setError('');
    try {
      const qs = q ? `/search?q=${encodeURIComponent(q)}` : '';
      const data = await apiFetch<{ data: KbArticle[] }>(`/support/kb${qs}`);
      setArticles(data.data);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleSearch = () => { load(search); };

  const handleCreate = async () => {
    setCreating(true);
    setError('');
    try {
      await apiFetch('/support/kb', {
        method: 'POST',
        body: JSON.stringify({
          title: form.title,
          body: form.body,
          category: form.category || undefined,
          locale: form.locale,
          tags: form.tags ? form.tags.split(',').map(t => t.trim()).filter(Boolean) : undefined,
          is_published: form.is_published,
        }),
      });
      setShowCreate(false);
      setForm({ title: '', body: '', category: '', locale: 'es', tags: '', is_published: false });
      load();
    } catch (e) {
      setError(String(e));
    } finally {
      setCreating(false);
    }
  };

  const handleEmbed = async (id: number) => {
    setEmbedding(id);
    try {
      await apiFetch(`/support/kb/${id}/embed`, { method: 'POST' });
      alert('Embedding generated');
    } catch (e) {
      alert(String(e));
    } finally {
      setEmbedding(null);
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleSearch(); }}
          placeholder={t('aiSupport.kb.search')}
          style={{ flex: 1, padding: '4px 8px', border: '1px solid #e5e7eb', borderRadius: 4, fontSize: 13 }}
        />
        <ActionButton onClick={handleSearch} label={t('aiSupport.kb.search')} variant="secondary" />
        <ActionButton onClick={() => setShowCreate(!showCreate)} label={t('aiSupport.kb.create')} />
      </div>

      {error && <div style={{ color: '#dc2626', marginBottom: 8 }}>{error}</div>}

      {showCreate && (
        <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 6, padding: 16, marginBottom: 16 }}>
          <h4 style={{ marginTop: 0 }}>{t('aiSupport.kb.create')}</h4>
          <div style={{ display: 'grid', gap: 8 }}>
            <div>
              <label style={{ fontSize: 13 }}>{t('aiSupport.kb.title')} *</label>
              <input
                value={form.title}
                onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                style={{ display: 'block', width: '100%', padding: '4px 8px', marginTop: 2 }}
              />
            </div>
            <div>
              <label style={{ fontSize: 13 }}>{t('aiSupport.kb.body')} *</label>
              <textarea
                value={form.body}
                onChange={e => setForm(f => ({ ...f, body: e.target.value }))}
                rows={4}
                style={{ display: 'block', width: '100%', padding: '4px 8px', marginTop: 2, fontFamily: 'inherit', fontSize: 13 }}
              />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <div>
                <label style={{ fontSize: 13 }}>{t('aiSupport.kb.category')}</label>
                <input
                  value={form.category}
                  onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
                  style={{ display: 'block', width: '100%', padding: '4px 8px', marginTop: 2 }}
                />
              </div>
              <div>
                <label style={{ fontSize: 13 }}>{t('aiSupport.kb.locale')}</label>
                <select
                  value={form.locale}
                  onChange={e => setForm(f => ({ ...f, locale: e.target.value }))}
                  style={{ display: 'block', width: '100%', padding: '4px 8px', marginTop: 2 }}
                >
                  <option value="es">es</option>
                  <option value="en">en</option>
                  <option value="pt">pt</option>
                </select>
              </div>
            </div>
            <div>
              <label style={{ fontSize: 13 }}>{t('aiSupport.kb.tags')} (comma-separated)</label>
              <input
                value={form.tags}
                onChange={e => setForm(f => ({ ...f, tags: e.target.value }))}
                placeholder="billing, service, outage"
                style={{ display: 'block', width: '100%', padding: '4px 8px', marginTop: 2 }}
              />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="checkbox"
                id="kb-published"
                checked={form.is_published}
                onChange={e => setForm(f => ({ ...f, is_published: e.target.checked }))}
              />
              <label htmlFor="kb-published" style={{ fontSize: 13 }}>{t('aiSupport.kb.published')}</label>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <ActionButton onClick={handleCreate} label={t('aiSupport.kb.create')} disabled={!form.title || !form.body || creating} />
              <ActionButton onClick={() => setShowCreate(false)} label="Cancel" variant="secondary" />
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <div style={{ color: '#6b7280' }}>...</div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ background: '#f3f4f6' }}>
              <th style={{ padding: '8px', textAlign: 'left' }}>{t('aiSupport.kb.title')}</th>
              <th style={{ padding: '8px', textAlign: 'left' }}>{t('aiSupport.kb.category')}</th>
              <th style={{ padding: '8px', textAlign: 'left' }}>{t('aiSupport.kb.locale')}</th>
              <th style={{ padding: '8px', textAlign: 'left' }}>{t('aiSupport.kb.published')}</th>
              <th style={{ padding: '8px', textAlign: 'left' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {articles.map(a => (
              <tr key={a.id} style={{ borderBottom: '1px solid #e5e7eb' }}>
                <td style={{ padding: '8px', fontWeight: 600 }}>{a.title}</td>
                <td style={{ padding: '8px', color: '#6b7280' }}>{a.category ?? '—'}</td>
                <td style={{ padding: '8px' }}>{a.locale}</td>
                <td style={{ padding: '8px' }}>
                  {a.is_published ? <StatusBadge status="published" /> : <StatusBadge status="draft" />}
                </td>
                <td style={{ padding: '8px' }}>
                  <ActionButton
                    onClick={() => handleEmbed(a.id)}
                    label={t('aiSupport.kb.embed')}
                    variant="secondary"
                    disabled={embedding === a.id}
                  />
                </td>
              </tr>
            ))}
            {articles.length === 0 && (
              <tr>
                <td colSpan={5} style={{ padding: 16, textAlign: 'center', color: '#6b7280' }}>
                  {t('aiSupport.kb.noArticles')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Metrics Tab
// ---------------------------------------------------------------------------

function MetricsTab() {
  const { t } = useTranslation();
  const [metrics, setMetrics] = useState<SupportMetrics | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [from, setFrom] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().slice(0, 10);
  });
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const qs = `?from=${from}&to=${to}`;
      const data = await apiFetch<{ data: SupportMetrics }>(`/support/metrics${qs}`);
      setMetrics(data.data);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => { load(); }, [load]);

  function fmtPct(v: number | null | undefined) {
    if (v == null) return '—';
    return `${(v * 100).toFixed(1)}%`;
  }
  function fmtTime(v: number | null | undefined) {
    if (v == null) return '—';
    const m = Math.floor(v / 60);
    const s = Math.round(v % 60);
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
  }

  const kpis: { label: string; value: string }[] = metrics
    ? [
        { label: t('aiSupport.metrics.resolutionRate'), value: fmtPct(metrics.resolution_rate) },
        { label: t('aiSupport.metrics.escalationRate'), value: fmtPct(metrics.escalation_rate) },
        { label: t('aiSupport.metrics.handleTime'), value: fmtTime(metrics.avg_handle_time_seconds) },
        { label: t('aiSupport.metrics.csat'), value: metrics.csat != null ? metrics.csat.toFixed(2) : '—' },
        { label: t('aiSupport.metrics.totalConversations'), value: String(metrics.total_conversations) },
        { label: t('aiSupport.metrics.totalEscalations'), value: String(metrics.total_escalations) },
      ]
    : [];

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 16 }}>
        <label style={{ fontSize: 13 }}>{t('aiSupport.metrics.dateRange')}:</label>
        <input
          type="date"
          value={from}
          onChange={e => setFrom(e.target.value)}
          style={{ padding: '4px 8px', fontSize: 13 }}
        />
        <span style={{ fontSize: 13 }}>—</span>
        <input
          type="date"
          value={to}
          onChange={e => setTo(e.target.value)}
          style={{ padding: '4px 8px', fontSize: 13 }}
        />
        <ActionButton onClick={load} label="Apply" variant="secondary" disabled={loading} />
      </div>

      {error && <div style={{ color: '#dc2626', marginBottom: 8 }}>{error}</div>}

      {loading ? (
        <div style={{ color: '#6b7280' }}>...</div>
      ) : metrics == null ? (
        <div style={{ color: '#6b7280' }}>{t('aiSupport.metrics.noData')}</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
          {kpis.map(kpi => (
            <div
              key={kpi.label}
              style={{
                background: '#f9fafb',
                border: '1px solid #e5e7eb',
                borderRadius: 8,
                padding: 20,
                textAlign: 'center',
              }}
            >
              <div style={{ fontSize: 28, fontWeight: 700, color: '#2563eb' }}>{kpi.value}</div>
              <div style={{ fontSize: 13, color: '#6b7280', marginTop: 4 }}>{kpi.label}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// NOC Insights Tab
// ---------------------------------------------------------------------------

function NocInsightsTab() {
  const { t } = useTranslation();
  const [insights, setInsights] = useState<NocInsight[]>([]);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState('');
  const [error, setError] = useState('');
  const [alertId, setAlertId] = useState('');

  const loadInsights = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await apiFetch<{ data: NocInsight[] }>('/noc-ai/insights');
      setInsights(data.data);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadInsights(); }, [loadInsights]);

  const runAction = async (type: string, body?: Record<string, unknown>) => {
    setRunning(type);
    setError('');
    try {
      await apiFetch(`/noc-ai/insights/${type}`, {
        method: 'POST',
        body: body ? JSON.stringify(body) : undefined,
      });
      loadInsights();
    } catch (e) {
      setError(String(e));
    } finally {
      setRunning('');
    }
  };

  const handleExplainAlert = () => {
    if (!alertId.trim()) return;
    runAction('alert-explain', { alert_id: Number(alertId) });
  };

  return (
    <div>
      {/* Action bar */}
      <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 6, padding: 12, marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <ActionButton
            onClick={() => runAction('shift-summary')}
            label={t('aiSupport.noc.shiftSummary')}
            disabled={running === 'shift-summary'}
          />
          <ActionButton
            onClick={() => runAction('capacity-warning')}
            label={t('aiSupport.noc.capacityWarning')}
            variant="secondary"
            disabled={running === 'capacity-warning'}
          />
          <ActionButton
            onClick={() => runAction('interference')}
            label={t('aiSupport.noc.interference')}
            variant="secondary"
            disabled={running === 'interference'}
          />
          <ActionButton
            onClick={() => runAction('alignment-drift')}
            label={t('aiSupport.noc.alignmentDrift')}
            variant="secondary"
            disabled={running === 'alignment-drift'}
          />
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center' }}>
          <input
            value={alertId}
            onChange={e => setAlertId(e.target.value)}
            placeholder={t('aiSupport.noc.alertId')}
            style={{ padding: '4px 8px', border: '1px solid #e5e7eb', borderRadius: 4, fontSize: 13, width: 160 }}
          />
          <ActionButton
            onClick={handleExplainAlert}
            label={t('aiSupport.noc.explainAlert')}
            disabled={!alertId.trim() || running === 'alert-explain'}
          />
        </div>
      </div>

      {error && <div style={{ color: '#dc2626', marginBottom: 8 }}>{error}</div>}

      {loading ? (
        <div style={{ color: '#6b7280' }}>...</div>
      ) : insights.length === 0 ? (
        <div style={{ color: '#6b7280', padding: 16, textAlign: 'center' }}>
          {t('aiSupport.noc.noInsights')}
        </div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ background: '#f3f4f6' }}>
              <th style={{ padding: '8px', textAlign: 'left' }}>{t('aiSupport.noc.alertType')}</th>
              <th style={{ padding: '8px', textAlign: 'left' }}>{t('aiSupport.noc.alertId')}</th>
              <th style={{ padding: '8px', textAlign: 'left' }}>{t('aiSupport.noc.confidence')}</th>
              <th style={{ padding: '8px', textAlign: 'left' }}>{t('aiSupport.noc.summary')}</th>
              <th style={{ padding: '8px', textAlign: 'left' }}>{t('aiSupport.noc.recommendation')}</th>
              <th style={{ padding: '8px', textAlign: 'left' }}>Time</th>
            </tr>
          </thead>
          <tbody>
            {insights.map(ins => (
              <tr key={ins.id} style={{ borderBottom: '1px solid #e5e7eb' }}>
                <td style={{ padding: '8px' }}><StatusBadge status={ins.insight_type} /></td>
                <td style={{ padding: '8px', color: '#6b7280' }}>{ins.alert_id ?? '—'}</td>
                <td style={{ padding: '8px' }}>
                  {ins.confidence != null ? `${Math.round(ins.confidence * 100)}%` : '—'}
                </td>
                <td style={{ padding: '8px', maxWidth: 240, fontSize: 12 }}>{ins.summary ?? '—'}</td>
                <td style={{ padding: '8px', maxWidth: 240, fontSize: 12, color: '#2563eb' }}>
                  {ins.recommendation ?? '—'}
                </td>
                <td style={{ padding: '8px', fontSize: 12, color: '#6b7280' }}>
                  {new Date(ins.created_at).toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export function AiSupportPage() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<Tab>('chat');

  const tabs: { id: Tab; label: string }[] = [
    { id: 'chat', label: t('aiSupport.tabs.chat') },
    { id: 'kb', label: t('aiSupport.tabs.kb') },
    { id: 'metrics', label: t('aiSupport.tabs.metrics') },
    { id: 'noc', label: t('aiSupport.tabs.noc') },
  ];

  return (
    <div style={{ padding: 24 }}>
      <h2 style={{ marginTop: 0 }}>{t('aiSupport.title')}</h2>

      <div style={{ borderBottom: '2px solid #e5e7eb', marginBottom: 20, display: 'flex', gap: 0 }}>
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              padding: '10px 18px',
              border: 'none',
              borderBottom: activeTab === tab.id ? '2px solid #2563eb' : '2px solid transparent',
              background: 'transparent',
              cursor: 'pointer',
              fontWeight: activeTab === tab.id ? 600 : 400,
              color: activeTab === tab.id ? '#2563eb' : '#374151',
              fontSize: 14,
              marginBottom: -2,
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'chat' && <ChatTab />}
      {activeTab === 'kb' && <KbTab />}
      {activeTab === 'metrics' && <MetricsTab />}
      {activeTab === 'noc' && <NocInsightsTab />}
    </div>
  );
}
