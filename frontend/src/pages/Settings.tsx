// =============================================================================
// FireISP 5.0 — Settings Page
// =============================================================================
// Admin-only page at /settings. Provides four tabs:
//
//   1. Org Config       — key/value settings from GET/PUT /api/v1/settings
//   2. Alert Rules      — CRUD on alert rules via /api/v1/alerts/rules
//   3. Payment Gateways — CRUD on payment gateways via /api/v1/payment-gateways
//   4. Quotas           — per-tenant resource usage + limit management
//
// Message templates were promoted into their own page at /message-templates.
// =============================================================================

import { useState } from 'react';
import type { FormEvent } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { tokenStore } from '@/api/client';
import { useAuth } from '@/auth/AuthContext';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SettingsTab = 'orgConfig' | 'alertRules' | 'paymentGateways' | 'quotas';

interface Setting {
  key: string;
  value: string | null;
  description?: string;
}

interface AlertRule {
  id: number;
  name: string;
  description: string | null;
  metric: string;
  operator: string;
  threshold: number;
  device_id: number | null;
  duration_minutes: number;
  severity: string;
  auto_create_outage: boolean;
  is_enabled: boolean;
  created_at: string;
}

interface PaymentGateway {
  id: number;
  provider: string;
  label: string | null;
  environment: string;
  public_key: string | null;
  webhook_secret: string | null;
  status: string;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const API_BASE = '/api/v1';
const METRICS = ['bandwidth_in', 'bandwidth_out', 'cpu', 'memory', 'signal', 'latency', 'uptime'];
const OPERATORS = ['>', '>=', '<', '<=', '='];
const SEVERITIES = ['critical', 'major', 'minor', 'warning'];
const PROVIDERS = ['stripe', 'conekta', 'openpay', 'mercadopago', 'paypal', 'manual', 'other'];
const ENVIRONMENTS = ['sandbox', 'production'];

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

function authHeaders(): Record<string, string> {
  const token = tokenStore.getAccess();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...authHeaders(), ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
    throw new Error(body.error ?? body.message ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Org Config tab
// ---------------------------------------------------------------------------

function OrgConfigTab() {
  const [editKey, setEditKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [saveError, setSaveError] = useState('');
  const qc = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ['settings'],
    queryFn: () => apiFetch<{ data: Setting[] }>(`${API_BASE}/settings`),
  });

  const updateMutation = useMutation({
    mutationFn: ({ key, value }: { key: string; value: string }) =>
      apiFetch(`${API_BASE}/settings/${encodeURIComponent(key)}`, {
        method: 'PUT',
        body: JSON.stringify({ value }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings'] });
      setEditKey(null);
      setSaveError('');
    },
    onError: (err: Error) => setSaveError(err.message),
  });

  if (isLoading) return <p style={sty.muted}>Loading settings…</p>;
  if (error) return <p style={sty.errorText}>Failed to load settings.</p>;

  const settings = data?.data ?? [];

  function startEdit(setting: Setting) {
    setEditKey(setting.key);
    setEditValue(setting.value ?? '');
    setSaveError('');
  }

  return (
    <div>
      <h3 style={sty.sectionTitle}>Organization Settings</h3>
      {settings.length === 0 && <p style={sty.muted}>No settings found.</p>}
      {settings.length > 0 && (
        <table style={sty.table}>
          <thead>
            <tr>
              {['Key', 'Value', 'Description', ''].map(h => (
                <th key={h} style={sty.th}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {settings.map(setting => (
              <tr key={setting.key}>
                <td style={sty.td}><code style={sty.code}>{setting.key}</code></td>
                <td style={{ ...sty.td, maxWidth: 260 }}>
                  {editKey === setting.key ? (
                    <input
                      style={sty.input}
                      value={editValue}
                      onChange={e => setEditValue(e.target.value)}
                    />
                  ) : (
                    <span style={sty.valueCap}>{setting.value ?? <em style={sty.muted}>—</em>}</span>
                  )}
                </td>
                <td style={{ ...sty.td, color: '#888', fontSize: '0.82rem' }}>{setting.description ?? ''}</td>
                <td style={sty.td}>
                  {editKey === setting.key ? (
                    <span style={sty.rowActions}>
                      <button style={sty.btnPrimary} disabled={updateMutation.isPending}
                        onClick={() => { setSaveError(''); updateMutation.mutate({ key: setting.key, value: editValue }); }}>
                        Save
                      </button>
                      <button style={sty.btnGhost} onClick={() => setEditKey(null)}>Cancel</button>
                    </span>
                  ) : (
                    <button style={sty.btnGhost} onClick={() => startEdit(setting)}>Edit</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {saveError && <p style={sty.errorText}>{saveError}</p>}
    </div>
  );
}


// ---------------------------------------------------------------------------
// Alert Rules tab
// ---------------------------------------------------------------------------

const EMPTY_RULE = {
  name: '', description: '', metric: 'bandwidth_in', operator: '>',
  threshold: '0', device_id: '', duration_minutes: '5', severity: 'major',
  auto_create_outage: false, is_enabled: true,
};

function AlertRulesTab() {
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<AlertRule | null>(null);
  const [form, setForm] = useState({ ...EMPTY_RULE });
  const [formError, setFormError] = useState('');
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const qc = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ['alert-rules'],
    queryFn: () =>
      apiFetch<{ data: AlertRule[]; meta: { total: number } }>(`${API_BASE}/alerts/rules?limit=100`),
  });

  const saveMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      editing
        ? apiFetch(`${API_BASE}/alerts/rules/${editing.id}`, { method: 'PUT', body: JSON.stringify(body) })
        : apiFetch(`${API_BASE}/alerts/rules`, { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['alert-rules'] }); closeModal(); },
    onError: (err: Error) => setFormError(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiFetch(`${API_BASE}/alerts/rules/${id}`, { method: 'DELETE' }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['alert-rules'] }); setDeleteId(null); },
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, is_enabled }: { id: number; is_enabled: boolean }) =>
      apiFetch(`${API_BASE}/alerts/rules/${id}`, { method: 'PUT', body: JSON.stringify({ is_enabled }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['alert-rules'] }),
  });

  function openNew() { setEditing(null); setForm({ ...EMPTY_RULE }); setFormError(''); setShowModal(true); }
  function openEdit(r: AlertRule) {
    setEditing(r);
    setForm({
      name: r.name, description: r.description ?? '', metric: r.metric,
      operator: r.operator, threshold: String(r.threshold),
      device_id: r.device_id ? String(r.device_id) : '',
      duration_minutes: String(r.duration_minutes),
      severity: r.severity, auto_create_outage: r.auto_create_outage, is_enabled: r.is_enabled,
    });
    setFormError(''); setShowModal(true);
  }
  function closeModal() { setShowModal(false); setEditing(null); }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError('');
    if (!form.name.trim()) { setFormError('Name is required'); return; }
    const threshold = parseFloat(form.threshold);
    if (isNaN(threshold)) { setFormError('Threshold must be a number'); return; }
    saveMutation.mutate({
      name: form.name, description: form.description || undefined,
      metric: form.metric, operator: form.operator, threshold,
      device_id: form.device_id ? parseInt(form.device_id, 10) : undefined,
      duration_minutes: parseInt(form.duration_minutes, 10) || 5,
      severity: form.severity, auto_create_outage: form.auto_create_outage,
      is_enabled: form.is_enabled,
    });
  }

  const rules = data?.data ?? [];

  return (
    <div>
      <div style={sty.tabBar}>
        <h3 style={sty.sectionTitle}>Alert Rules</h3>
        <button style={sty.btnPrimary} onClick={openNew}>+ New Rule</button>
      </div>

      {isLoading && <p style={sty.muted}>Loading rules…</p>}
      {error && <p style={sty.errorText}>Failed to load alert rules.</p>}
      {!isLoading && rules.length === 0 && <p style={sty.muted}>No alert rules defined.</p>}

      {rules.length > 0 && (
        <table style={sty.table}>
          <thead>
            <tr>{['Rule', 'Metric', 'Condition', 'Severity', 'Enabled', ''].map(h => <th key={h} style={sty.th}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {rules.map(r => (
              <tr key={r.id}>
                <td style={sty.td}>
                  <div style={{ fontWeight: 500 }}>{r.name}</div>
                  {r.description && <div style={{ fontSize: '0.8rem', color: '#888' }}>{r.description}</div>}
                </td>
                <td style={sty.td}><code style={sty.code}>{r.metric}</code></td>
                <td style={sty.td}>{r.operator} {r.threshold} for {r.duration_minutes}m</td>
                <td style={sty.td}><span style={severityBadge(r.severity)}>{r.severity}</span></td>
                <td style={sty.td}>
                  <button
                    style={r.is_enabled ? sty.btnPrimary : sty.btnGhost}
                    onClick={() => toggleMutation.mutate({ id: r.id, is_enabled: !r.is_enabled })}
                    disabled={toggleMutation.isPending}
                  >
                    {r.is_enabled ? 'On' : 'Off'}
                  </button>
                </td>
                <td style={sty.td}>
                  <span style={sty.rowActions}>
                    <button style={sty.btnGhost} onClick={() => openEdit(r)}>Edit</button>
                    <button style={sty.btnDanger} onClick={() => setDeleteId(r.id)}>Delete</button>
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {showModal && (
        <Modal title={editing ? 'Edit Alert Rule' : 'New Alert Rule'} onClose={closeModal}>
          <form onSubmit={handleSubmit} style={sty.form}>
            <label style={sty.label}>Name *
              <input style={sty.input} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required />
            </label>
            <label style={sty.label}>Description
              <input style={sty.input} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
            </label>
            <div style={sty.row2}>
              <label style={sty.label}>Metric *
                <select style={sty.select} value={form.metric} onChange={e => setForm(f => ({ ...f, metric: e.target.value }))}>
                  {METRICS.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </label>
              <label style={sty.label}>Operator
                <select style={sty.select} value={form.operator} onChange={e => setForm(f => ({ ...f, operator: e.target.value }))}>
                  {OPERATORS.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </label>
            </div>
            <div style={sty.row2}>
              <label style={sty.label}>Threshold *
                <input style={sty.input} type="number" step="any" value={form.threshold}
                  onChange={e => setForm(f => ({ ...f, threshold: e.target.value }))} required />
              </label>
              <label style={sty.label}>Duration (min)
                <input style={sty.input} type="number" min="1" value={form.duration_minutes}
                  onChange={e => setForm(f => ({ ...f, duration_minutes: e.target.value }))} />
              </label>
            </div>
            <div style={sty.row2}>
              <label style={sty.label}>Severity
                <select style={sty.select} value={form.severity} onChange={e => setForm(f => ({ ...f, severity: e.target.value }))}>
                  {SEVERITIES.map(sv => <option key={sv} value={sv}>{sv}</option>)}
                </select>
              </label>
              <label style={sty.label}>Device ID (optional)
                <input style={sty.input} type="number" value={form.device_id} placeholder="leave blank for all"
                  onChange={e => setForm(f => ({ ...f, device_id: e.target.value }))} />
              </label>
            </div>
            <div style={sty.checkRow}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input type="checkbox" checked={form.auto_create_outage}
                  onChange={e => setForm(f => ({ ...f, auto_create_outage: e.target.checked }))} />
                Auto-create outage when triggered
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input type="checkbox" checked={form.is_enabled}
                  onChange={e => setForm(f => ({ ...f, is_enabled: e.target.checked }))} />
                Enabled
              </label>
            </div>
            {formError && <p style={sty.errorText}>{formError}</p>}
            <div style={sty.modalFooter}>
              <button type="button" style={sty.btnGhost} onClick={closeModal}>Cancel</button>
              <button type="submit" style={sty.btnPrimary} disabled={saveMutation.isPending}>
                {saveMutation.isPending ? 'Saving…' : editing ? 'Update' : 'Create'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {deleteId !== null && (
        <ConfirmDialog
          message="Delete this alert rule?"
          onConfirm={() => deleteMutation.mutate(deleteId!)}
          onCancel={() => setDeleteId(null)}
          loading={deleteMutation.isPending}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Payment Gateways tab
// ---------------------------------------------------------------------------

const EMPTY_GW = {
  provider: 'stripe', label: '', environment: 'sandbox',
  public_key: '', secret_key_encrypted: '', webhook_secret: '', status: 'active',
};

function PaymentGatewaysTab() {
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<PaymentGateway | null>(null);
  const [form, setForm] = useState({ ...EMPTY_GW });
  const [formError, setFormError] = useState('');
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const qc = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ['payment-gateways'],
    queryFn: () =>
      apiFetch<{ data: PaymentGateway[]; meta: { total: number } }>(`${API_BASE}/payment-gateways?limit=100`),
  });

  const saveMutation = useMutation({
    mutationFn: (body: typeof form) =>
      editing
        ? apiFetch(`${API_BASE}/payment-gateways/${editing.id}`, { method: 'PUT', body: JSON.stringify(body) })
        : apiFetch(`${API_BASE}/payment-gateways`, { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['payment-gateways'] }); closeModal(); },
    onError: (err: Error) => setFormError(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiFetch(`${API_BASE}/payment-gateways/${id}`, { method: 'DELETE' }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['payment-gateways'] }); setDeleteId(null); },
  });

  function openNew() { setEditing(null); setForm({ ...EMPTY_GW }); setFormError(''); setShowModal(true); }
  function openEdit(gw: PaymentGateway) {
    setEditing(gw);
    setForm({
      provider: gw.provider, label: gw.label ?? '', environment: gw.environment,
      public_key: gw.public_key ?? '', secret_key_encrypted: '',
      webhook_secret: gw.webhook_secret ?? '', status: gw.status,
    });
    setFormError(''); setShowModal(true);
  }
  function closeModal() { setShowModal(false); setEditing(null); }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError('');
    saveMutation.mutate(form);
  }

  const gateways = data?.data ?? [];

  return (
    <div>
      <div style={sty.tabBar}>
        <h3 style={sty.sectionTitle}>Payment Gateways</h3>
        <button style={sty.btnPrimary} onClick={openNew}>+ Add Gateway</button>
      </div>

      {isLoading && <p style={sty.muted}>Loading gateways…</p>}
      {error && <p style={sty.errorText}>Failed to load payment gateways.</p>}
      {!isLoading && gateways.length === 0 && <p style={sty.muted}>No payment gateways configured.</p>}

      {gateways.length > 0 && (
        <table style={sty.table}>
          <thead>
            <tr>{['Provider', 'Label', 'Environment', 'Status', ''].map(h => <th key={h} style={sty.th}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {gateways.map(gw => (
              <tr key={gw.id}>
                <td style={sty.td}><span style={channelBadge(gw.provider)}>{gw.provider}</span></td>
                <td style={sty.td}>{gw.label ?? <em style={sty.muted}>—</em>}</td>
                <td style={sty.td}>{gw.environment}</td>
                <td style={sty.td}><span style={statusBadge(gw.status)}>{gw.status}</span></td>
                <td style={sty.td}>
                  <span style={sty.rowActions}>
                    <button style={sty.btnGhost} onClick={() => openEdit(gw)}>Edit</button>
                    <button style={sty.btnDanger} onClick={() => setDeleteId(gw.id)}>Delete</button>
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {showModal && (
        <Modal title={editing ? 'Edit Gateway' : 'Add Payment Gateway'} onClose={closeModal}>
          <form onSubmit={handleSubmit} style={sty.form}>
            <div style={sty.row2}>
              <label style={sty.label}>Provider *
                <select style={sty.select} value={form.provider} onChange={e => setForm(f => ({ ...f, provider: e.target.value }))}>
                  {PROVIDERS.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </label>
              <label style={sty.label}>Label
                <input style={sty.input} value={form.label} placeholder="e.g. Stripe MX"
                  onChange={e => setForm(f => ({ ...f, label: e.target.value }))} />
              </label>
            </div>
            <div style={sty.row2}>
              <label style={sty.label}>Environment
                <select style={sty.select} value={form.environment} onChange={e => setForm(f => ({ ...f, environment: e.target.value }))}>
                  {ENVIRONMENTS.map(env => <option key={env} value={env}>{env}</option>)}
                </select>
              </label>
              <label style={sty.label}>Status
                <select style={sty.select} value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
                  <option value="active">active</option>
                  <option value="inactive">inactive</option>
                </select>
              </label>
            </div>
            <label style={sty.label}>Public Key
              <input style={sty.input} value={form.public_key} placeholder="pk_live_…"
                onChange={e => setForm(f => ({ ...f, public_key: e.target.value }))} />
            </label>
            <label style={sty.label}>
              Secret Key {editing && <span style={sty.hint}>(leave blank to keep existing)</span>}
              <input style={sty.input} type="password" value={form.secret_key_encrypted}
                placeholder={editing ? '••••••••' : 'sk_live_…'}
                onChange={e => setForm(f => ({ ...f, secret_key_encrypted: e.target.value }))} />
            </label>
            <label style={sty.label}>Webhook Secret
              <input style={sty.input} value={form.webhook_secret} placeholder="whsec_…"
                onChange={e => setForm(f => ({ ...f, webhook_secret: e.target.value }))} />
            </label>
            {formError && <p style={sty.errorText}>{formError}</p>}
            <div style={sty.modalFooter}>
              <button type="button" style={sty.btnGhost} onClick={closeModal}>Cancel</button>
              <button type="submit" style={sty.btnPrimary} disabled={saveMutation.isPending}>
                {saveMutation.isPending ? 'Saving…' : editing ? 'Update' : 'Create'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {deleteId !== null && (
        <ConfirmDialog
          message="Delete this payment gateway? Existing transactions linked to it will be preserved."
          onConfirm={() => deleteMutation.mutate(deleteId!)}
          onCancel={() => setDeleteId(null)}
          loading={deleteMutation.isPending}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared helper components
// ---------------------------------------------------------------------------

interface ModalProps { title: string; onClose: () => void; children: React.ReactNode; }
function Modal({ title, onClose, children }: ModalProps) {
  return (
    <div style={sty.overlay}>
      <div style={sty.modal}>
        <div style={sty.modalHeader}>
          <span style={{ fontWeight: 600 }}>{title}</span>
          <button style={sty.closeBtn} onClick={onClose}>✕</button>
        </div>
        <div style={sty.modalBody}>{children}</div>
      </div>
    </div>
  );
}

interface ConfirmProps { message: string; onConfirm: () => void; onCancel: () => void; loading: boolean; }
function ConfirmDialog({ message, onConfirm, onCancel, loading }: ConfirmProps) {
  return (
    <div style={sty.overlay}>
      <div style={{ ...sty.modal, maxWidth: 400 }}>
        <div style={sty.modalBody}>
          <p style={{ marginTop: 0 }}>{message}</p>
          <div style={sty.modalFooter}>
            <button style={sty.btnGhost} onClick={onCancel} disabled={loading}>Cancel</button>
            <button style={sty.btnDanger} onClick={onConfirm} disabled={loading}>
              {loading ? 'Deleting…' : 'Delete'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Badge helpers
// ---------------------------------------------------------------------------

function channelBadge(label: string) {
  const colours: Record<string, string> = {
    email: '#3b82f6', sms: '#8b5cf6', whatsapp: '#22c55e', push: '#f59e0b',
    stripe: '#635bff', conekta: '#e74c3c', openpay: '#2ecc71', paypal: '#003087',
    mercadopago: '#009ee3', manual: '#888', other: '#888',
  };
  return { ...sty.badge, background: colours[label] ?? '#888' };
}

function severityBadge(level: string) {
  const colours: Record<string, string> = {
    critical: '#dc2626', major: '#ea580c', minor: '#d97706', warning: '#ca8a04',
  };
  return {
    padding: '2px 8px', borderRadius: 10, fontSize: '0.75rem', fontWeight: 600,
    background: colours[level] ?? '#888', color: '#fff',
  };
}

function statusBadge(st: string) {
  return {
    padding: '2px 8px', borderRadius: 10, fontSize: '0.75rem', fontWeight: 600,
    background: st === 'active' ? '#16a34a' : '#888', color: '#fff',
  };
}

// ---------------------------------------------------------------------------
// Quotas Tab
// ---------------------------------------------------------------------------

interface QuotaLimits {
  max_clients: number | null;
  max_devices: number | null;
  max_storage_mb: number | null;
  max_scheduled_tasks: number | null;
}

interface QuotaUsage {
  clients: number;
  devices: number;
  storage_mb: number;
  scheduled_tasks: number;
}

interface QuotaData {
  limits: QuotaLimits;
  usage: QuotaUsage;
}

function QuotaBar({ label, used, limit }: { label: string; used: number; limit: number | null }) {
  const isUnlimited = limit === null;
  const pct = (isUnlimited || limit === 0) ? 100 : Math.min(100, Math.round((used / limit!) * 100));
  const color = pct >= 95 ? '#dc2626' : pct >= 80 ? '#d97706' : '#16a34a';
  return (
    <div style={{ marginBottom: '1rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: '0.875rem' }}>
        <span style={{ fontWeight: 500 }}>{label}</span>
        <span style={{ color: '#555' }}>
          {used.toLocaleString()} / {isUnlimited ? '∞' : limit!.toLocaleString()}
          {!isUnlimited && <span style={{ color: pct >= 95 ? '#dc2626' : '#888', marginLeft: 6 }}>({pct}%)</span>}
        </span>
      </div>
      {!isUnlimited && (
        <div style={{ background: '#f3f4f6', borderRadius: 6, height: 8, overflow: 'hidden' }}>
          <div style={{ width: `${pct}%`, background: color, height: '100%', borderRadius: 6, transition: 'width .3s' }} />
        </div>
      )}
    </div>
  );
}

function QuotasTab() {
  const { user } = useAuth();
  const orgId = user?.organization_id;
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery<{ data: QuotaData }>({
    queryKey: ['org-quota', orgId],
    queryFn: () => apiFetch<{ data: QuotaData }>(`/api/v1/organizations/${orgId}/quota`),
    enabled: !!orgId,
  });

  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Partial<Record<keyof QuotaLimits, string>>>({});

  const saveMutation = useMutation({
    mutationFn: (body: Record<string, number | null>) =>
      apiFetch<{ data: QuotaData }>(`/api/v1/organizations/${orgId}/quota`, { method: 'PUT', body: JSON.stringify(body) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['org-quota', orgId] });
      setEditing(false);
    },
  });

  if (isLoading) return <p style={sty.muted}>Loading quota…</p>;
  if (error || !data) return <p style={{ color: '#dc2626', fontSize: '0.875rem' }}>Failed to load quota.</p>;

  const { limits, usage } = data.data;

  function startEdit() {
    setForm({
      max_clients:         limits.max_clients         === null ? '' : String(limits.max_clients),
      max_devices:         limits.max_devices         === null ? '' : String(limits.max_devices),
      max_storage_mb:      limits.max_storage_mb      === null ? '' : String(limits.max_storage_mb),
      max_scheduled_tasks: limits.max_scheduled_tasks === null ? '' : String(limits.max_scheduled_tasks),
    });
    setEditing(true);
  }

  function handleSave(e: FormEvent) {
    e.preventDefault();
    const body: Record<string, number | null> = {};
    for (const [k, v] of Object.entries(form)) {
      body[k] = v === '' || v === undefined ? null : Number(v);
    }
    saveMutation.mutate(body);
  }

  return (
    <div>
      <div style={sty.tabBar}>
        <h3 style={sty.sectionTitle}>Resource Quotas</h3>
        {!editing && (
          <button style={sty.btnPrimary} onClick={startEdit}>✏️ Edit Limits</button>
        )}
      </div>

      {!editing ? (
        <>
          <p style={{ fontSize: '0.85rem', color: '#555', marginTop: 0, marginBottom: '1.5rem' }}>
            Current usage versus configured limits. <strong>∞</strong> means unlimited.
          </p>
          <QuotaBar label="Clients"         used={usage.clients}         limit={limits.max_clients} />
          <QuotaBar label="Devices"         used={usage.devices}         limit={limits.max_devices} />
          <QuotaBar label="Storage (MB)"    used={usage.storage_mb}      limit={limits.max_storage_mb} />
          <QuotaBar label="Scheduled Tasks" used={usage.scheduled_tasks} limit={limits.max_scheduled_tasks} />
        </>
      ) : (
        <form onSubmit={handleSave} style={sty.form}>
          <p style={{ fontSize: '0.85rem', color: '#555', margin: '0 0 0.75rem' }}>
            Leave a field blank to set it as <strong>unlimited</strong>.
          </p>
          {(
            [
              ['max_clients',         'Max Clients'],
              ['max_devices',         'Max Devices'],
              ['max_storage_mb',      'Max Storage (MB)'],
              ['max_scheduled_tasks', 'Max Scheduled Tasks'],
            ] as const
          ).map(([key, label]) => (
            <label key={key} style={sty.label}>
              {label}
              <input
                style={sty.input}
                type="number"
                min={0}
                placeholder="unlimited"
                value={form[key] ?? ''}
                onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
              />
            </label>
          ))}
          {saveMutation.error && (
            <p style={sty.errorText}>{(saveMutation.error as Error).message}</p>
          )}
          <div style={sty.modalFooter}>
            <button type="button" style={sty.btnGhost} onClick={() => setEditing(false)}>Cancel</button>
            <button type="submit" style={sty.btnPrimary} disabled={saveMutation.isPending}>
              {saveMutation.isPending ? 'Saving…' : 'Save Limits'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Settings page
// ---------------------------------------------------------------------------

const TABS: { id: SettingsTab; label: string }[] = [
  { id: 'orgConfig', label: '🏢 Org Config' },
  { id: 'alertRules', label: '🚨 Alert Rules' },
  { id: 'paymentGateways', label: '💳 Payment Gateways' },
  { id: 'quotas', label: '📊 Quotas' },
];

export function Settings() {
  const [tab, setTab] = useState<SettingsTab>('orgConfig');

  return (
    <div style={sty.page}>
      <h2 style={sty.pageTitle}>Settings</h2>

      {/* Tab bar */}
      <div style={sty.tabs}>
        {TABS.map(t => (
          <button
            key={t.id}
            style={{ ...sty.tabBtn, ...(tab === t.id ? sty.tabBtnActive : {}) }}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div style={sty.card}>
        {tab === 'orgConfig' && <OrgConfigTab />}
        {tab === 'alertRules' && <AlertRulesTab />}
        {tab === 'paymentGateways' && <PaymentGatewaysTab />}
        {tab === 'quotas' && <QuotasTab />}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const sty = {
  page: { padding: '1.5rem 2rem', fontFamily: 'system-ui, sans-serif', maxWidth: 1000 },
  pageTitle: { margin: '0 0 1rem', fontSize: '1.4rem' },
  tabs: { display: 'flex', gap: 4, borderBottom: '2px solid var(--border)', marginBottom: '1.25rem' },
  tabBtn: {
    background: 'none', border: 'none', borderBottom: '2px solid transparent',
    padding: '0.5rem 1rem', cursor: 'pointer', fontSize: '0.9rem', color: 'var(--text-muted)',
    marginBottom: -2, transition: 'color .15s',
  } as React.CSSProperties,
  tabBtnActive: { color: '#e25822', borderBottomColor: '#e25822', fontWeight: 600 } as React.CSSProperties,
  card: { background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, padding: '1.5rem' },
  sectionTitle: { margin: '0 0 1rem', fontSize: '1rem', fontWeight: 600 },
  tabBar: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' },
  muted: { color: 'var(--text-faint)', fontStyle: 'italic' as const, fontSize: '0.875rem' },
  table: { width: '100%', borderCollapse: 'collapse' as const, fontSize: '0.875rem' },
  th: { textAlign: 'left' as const, padding: '0.5rem 0.75rem', borderBottom: '2px solid var(--border)', fontWeight: 600, color: 'var(--text-secondary)' },
  td: { padding: '0.6rem 0.75rem', borderBottom: '1px solid var(--border-subtle)', verticalAlign: 'middle' as const },
  code: { background: 'var(--bg-subtle)', padding: '2px 6px', borderRadius: 4, fontFamily: 'monospace', fontSize: '0.82rem' },
  valueCap: { display: 'block', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const },
  badge: { padding: '2px 8px', borderRadius: 10, fontSize: '0.75rem', fontWeight: 600, color: '#fff' },
  rowActions: { display: 'flex', gap: 6 },
  errorText: { color: '#dc2626', fontSize: '0.85rem', margin: '0.5rem 0 0' },
  hint: { fontWeight: 400, color: 'var(--text-faint)', fontSize: '0.8rem' },
  // modal
  overlay: { position: 'fixed' as const, inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: 80, zIndex: 1000 },
  modal: { background: 'var(--bg-card)', borderRadius: 8, width: '100%', maxWidth: 560, boxShadow: '0 8px 32px rgba(0,0,0,.2)', maxHeight: '80vh', overflow: 'auto' as const },
  modalHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem 1.25rem', borderBottom: '1px solid var(--border)' },
  modalBody: { padding: '1.25rem' },
  modalFooter: { display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: '1rem' },
  closeBtn: { background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.1rem', color: 'var(--text-faint)' },
  form: { display: 'flex', flexDirection: 'column' as const, gap: 12 },
  label: { display: 'flex', flexDirection: 'column' as const, gap: 4, fontSize: '0.875rem', fontWeight: 500, color: 'var(--text-secondary)' },
  input: { padding: '0.45rem 0.65rem', border: '1px solid var(--input-border)', borderRadius: 6, fontSize: '0.875rem', width: '100%', boxSizing: 'border-box' as const },
  select: { padding: '0.45rem 0.65rem', border: '1px solid var(--input-border)', borderRadius: 6, fontSize: '0.875rem', background: 'var(--input-bg)', width: '100%', boxSizing: 'border-box' as const },
  row2: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 },
  checkRow: { display: 'flex', gap: 24, fontSize: '0.875rem' },
  // buttons
  btnPrimary: { padding: '0.4rem 1rem', background: '#e25822', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: '0.875rem', fontWeight: 500 },
  btnGhost: { padding: '0.4rem 1rem', background: 'var(--bg-body)', color: 'var(--text-secondary)', border: '1px solid var(--border-strong)', borderRadius: 6, cursor: 'pointer', fontSize: '0.875rem' },
  btnDanger: { padding: '0.4rem 1rem', background: '#dc2626', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: '0.875rem' },
};
