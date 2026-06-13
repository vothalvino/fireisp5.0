// =============================================================================
// FireISP 5.0 — Integrations Page (Section 20)
// =============================================================================
// Multi-tab page covering §20.2 Third-Party Integration Framework:
//   1. Providers    — read-only catalog of supported integration providers
//   2. Connections  — per-org configured integration instances
//   3. Sync Logs    — sync execution history for selected connection
// =============================================================================

import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Tab = 'providers' | 'connections' | 'logs';

interface IntegrationProvider {
  id: number;
  provider_key: string;
  name: string;
  category: string;
  capabilities: string[] | null;
  description: string | null;
  is_active: number;
}

interface IntegrationConnection {
  id: number;
  organization_id: number;
  provider_id: number;
  provider_key: string;
  provider_name: string;
  category: string;
  name: string;
  config_json: Record<string, unknown> | null;
  status: string;
  last_synced_at: string | null;
  last_error: string | null;
  is_enabled: number;
  created_at: string;
}

interface SyncLog {
  id: number;
  connection_id: number;
  direction: string;
  status: string;
  records_in: number;
  records_out: number;
  records_error: number;
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
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
// Sub-components
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: string }) {
  const color =
    status === 'active' ? '#16a34a' :
    status === 'error' ? '#dc2626' :
    status === 'disabled' ? '#6b7280' :
    status === 'stubbed' ? '#7c3aed' :
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

function ActionButton({ onClick, label, variant = 'primary', disabled = false }: {
  onClick: () => void; label: string; variant?: 'primary' | 'danger' | 'secondary'; disabled?: boolean;
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
// Providers Tab
// ---------------------------------------------------------------------------

function ProvidersTab() {
  const { t } = useTranslation();
  const [providers, setProviders] = useState<IntegrationProvider[]>([]);
  const [category, setCategory] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const qs = category ? `?category=${encodeURIComponent(category)}` : '';
      const data = await apiFetch<{ data: IntegrationProvider[] }>(`/integrations/providers${qs}`);
      setProviders(data.data);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [category]);

  useEffect(() => { load(); }, [load]);

  const categories = ['accounting', 'payment_gateway', 'communication', 'maps', 'monitoring', 'helpdesk', 'tax_sat', 'lorawan'];

  return (
    <div>
      <div style={{ marginBottom: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
        <select value={category} onChange={e => setCategory(e.target.value)} style={{ padding: '4px 8px' }}>
          <option value="">{t('integration.allCategories')}</option>
          {categories.map(c => (
            <option key={c} value={c}>{t(`integration.categoryNames.${c}`, c)}</option>
          ))}
        </select>
        <ActionButton onClick={load} label={t('integration.refresh')} variant="secondary" />
      </div>
      {error && <div style={{ color: '#dc2626', marginBottom: 8 }}>{error}</div>}
      {loading ? <div>{t('integration.loading')}</div> : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ background: '#f3f4f6' }}>
              <th style={{ padding: '8px', textAlign: 'left' }}>{t('integration.providerName')}</th>
              <th style={{ padding: '8px', textAlign: 'left' }}>{t('integration.category')}</th>
              <th style={{ padding: '8px', textAlign: 'left' }}>{t('integration.capabilities')}</th>
              <th style={{ padding: '8px', textAlign: 'left' }}>{t('integration.description')}</th>
            </tr>
          </thead>
          <tbody>
            {providers.map(p => (
              <tr key={p.id} style={{ borderBottom: '1px solid #e5e7eb' }}>
                <td style={{ padding: '8px', fontWeight: 600 }}>{p.name}</td>
                <td style={{ padding: '8px' }}><StatusBadge status={p.category} /></td>
                <td style={{ padding: '8px', fontSize: 12 }}>
                  {(p.capabilities ?? []).join(', ')}
                </td>
                <td style={{ padding: '8px', color: '#6b7280' }}>{p.description}</td>
              </tr>
            ))}
            {providers.length === 0 && (
              <tr><td colSpan={4} style={{ padding: 16, textAlign: 'center' }}>{t('integration.noProviders')}</td></tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Connections Tab
// ---------------------------------------------------------------------------

function ConnectionsTab({ onViewLogs }: { onViewLogs: (conn: IntegrationConnection) => void }) {
  const { t } = useTranslation();
  const [connections, setConnections] = useState<IntegrationConnection[]>([]);
  const [providers, setProviders] = useState<IntegrationProvider[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ provider_id: '', name: '', credentials: '', config_json: '', is_enabled: true });

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [connData, provData] = await Promise.all([
        apiFetch<{ data: IntegrationConnection[] }>('/integrations/connections'),
        apiFetch<{ data: IntegrationProvider[] }>('/integrations/providers'),
      ]);
      setConnections(connData.data);
      setProviders(provData.data);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async () => {
    setCreating(true);
    setError('');
    try {
      let credentials: unknown = undefined;
      let config_json: unknown = undefined;
      if (form.credentials.trim()) {
        credentials = JSON.parse(form.credentials);
      }
      if (form.config_json.trim()) {
        config_json = JSON.parse(form.config_json);
      }
      await apiFetch('/integrations/connections', {
        method: 'POST',
        body: JSON.stringify({
          provider_id: Number(form.provider_id),
          name: form.name,
          ...(credentials !== undefined ? { credentials } : {}),
          ...(config_json !== undefined ? { config_json } : {}),
          is_enabled: form.is_enabled,
        }),
      });
      setShowCreate(false);
      setForm({ provider_id: '', name: '', credentials: '', config_json: '', is_enabled: true });
      load();
    } catch (e) {
      setError(String(e));
    } finally {
      setCreating(false);
    }
  };

  const handleTest = async (id: number) => {
    try {
      const res = await apiFetch<{ data: { status: string } }>(`/integrations/connections/${id}/test`, { method: 'POST' });
      alert(`Test result: ${res.data.status}`);
      load();
    } catch (e) {
      alert(`Test failed: ${String(e)}`);
    }
  };

  const handleSync = async (id: number) => {
    try {
      const res = await apiFetch<{ data: { status: string } }>(`/integrations/connections/${id}/sync`, { method: 'POST', body: JSON.stringify({ direction: 'bidirectional' }) });
      alert(`Sync result: ${res.data.status}`);
      load();
    } catch (e) {
      alert(`Sync failed: ${String(e)}`);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm(t('integration.confirmDelete'))) return;
    try {
      await apiFetch(`/integrations/connections/${id}`, { method: 'DELETE' });
      load();
    } catch (e) {
      alert(String(e));
    }
  };

  return (
    <div>
      <div style={{ marginBottom: 12 }}>
        <ActionButton onClick={() => setShowCreate(!showCreate)} label={t('integration.newConnection')} />
        <ActionButton onClick={load} label={t('integration.refresh')} variant="secondary" />
      </div>
      {error && <div style={{ color: '#dc2626', marginBottom: 8 }}>{error}</div>}

      {showCreate && (
        <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 6, padding: 16, marginBottom: 16 }}>
          <h4 style={{ marginTop: 0 }}>{t('integration.newConnection')}</h4>
          <div style={{ display: 'grid', gap: 8 }}>
            <div>
              <label style={{ fontSize: 13 }}>{t('integration.provider')} *</label>
              <select value={form.provider_id} onChange={e => setForm(f => ({ ...f, provider_id: e.target.value }))} style={{ display: 'block', width: '100%', padding: '4px 8px', marginTop: 2 }}>
                <option value="">{t('integration.selectProvider')}</option>
                {providers.map(p => <option key={p.id} value={p.id}>{p.name} ({p.category})</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 13 }}>{t('integration.connectionName')} *</label>
              <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder={t('integration.connectionNameHint')} style={{ display: 'block', width: '100%', padding: '4px 8px', marginTop: 2 }} />
            </div>
            <div>
              <label style={{ fontSize: 13 }}>{t('integration.credentials')} ({t('integration.jsonFormat')})</label>
              <textarea value={form.credentials} onChange={e => setForm(f => ({ ...f, credentials: e.target.value }))} rows={3} placeholder='{"api_key":"..."}' style={{ display: 'block', width: '100%', padding: '4px 8px', marginTop: 2, fontFamily: 'monospace', fontSize: 12 }} />
              <small style={{ color: '#6b7280' }}>{t('integration.credentialsHint')}</small>
            </div>
            <div>
              <label style={{ fontSize: 13 }}>{t('integration.configJson')}</label>
              <textarea value={form.config_json} onChange={e => setForm(f => ({ ...f, config_json: e.target.value }))} rows={2} placeholder='{"base_url":"..."}' style={{ display: 'block', width: '100%', padding: '4px 8px', marginTop: 2, fontFamily: 'monospace', fontSize: 12 }} />
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
              <ActionButton onClick={handleCreate} label={t('integration.create')} disabled={!form.provider_id || !form.name || creating} />
              <ActionButton onClick={() => setShowCreate(false)} label={t('integration.cancel')} variant="secondary" />
            </div>
          </div>
        </div>
      )}

      {loading ? <div>{t('integration.loading')}</div> : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ background: '#f3f4f6' }}>
              <th style={{ padding: '8px', textAlign: 'left' }}>{t('integration.connectionName')}</th>
              <th style={{ padding: '8px', textAlign: 'left' }}>{t('integration.provider')}</th>
              <th style={{ padding: '8px', textAlign: 'left' }}>{t('integration.category')}</th>
              <th style={{ padding: '8px', textAlign: 'left' }}>{t('integration.status')}</th>
              <th style={{ padding: '8px', textAlign: 'left' }}>{t('integration.lastSynced')}</th>
              <th style={{ padding: '8px', textAlign: 'left' }}>{t('integration.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {connections.map(c => (
              <tr key={c.id} style={{ borderBottom: '1px solid #e5e7eb' }}>
                <td style={{ padding: '8px', fontWeight: 600 }}>{c.name}</td>
                <td style={{ padding: '8px' }}>{c.provider_name}</td>
                <td style={{ padding: '8px' }}><StatusBadge status={c.category} /></td>
                <td style={{ padding: '8px' }}><StatusBadge status={c.status} /></td>
                <td style={{ padding: '8px', fontSize: 12, color: '#6b7280' }}>
                  {c.last_synced_at ? new Date(c.last_synced_at).toLocaleString() : '—'}
                </td>
                <td style={{ padding: '8px' }}>
                  <ActionButton onClick={() => handleTest(c.id)} label={t('integration.test')} variant="secondary" />
                  <ActionButton onClick={() => handleSync(c.id)} label={t('integration.sync')} />
                  <ActionButton onClick={() => onViewLogs(c)} label={t('integration.logs')} variant="secondary" />
                  <ActionButton onClick={() => handleDelete(c.id)} label={t('integration.delete')} variant="danger" />
                </td>
              </tr>
            ))}
            {connections.length === 0 && (
              <tr><td colSpan={6} style={{ padding: 16, textAlign: 'center' }}>{t('integration.noConnections')}</td></tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sync Logs Tab
// ---------------------------------------------------------------------------

function LogsTab({ connection }: { connection: IntegrationConnection | null }) {
  const { t } = useTranslation();
  const [logs, setLogs] = useState<SyncLog[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!connection) return;
    setLoading(true);
    setError('');
    try {
      const data = await apiFetch<{ data: SyncLog[]; total: number }>(`/integrations/connections/${connection.id}/logs?limit=50`);
      setLogs(data.data);
      setTotal(data.total);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [connection]);

  useEffect(() => { load(); }, [load]);

  if (!connection) {
    return <div style={{ color: '#6b7280', padding: 16 }}>{t('integration.selectConnectionForLogs')}</div>;
  }

  return (
    <div>
      <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
        <strong>{connection.name}</strong>
        <span style={{ color: '#6b7280', fontSize: 13 }}>({connection.provider_name})</span>
        <span style={{ color: '#6b7280', fontSize: 13 }}>— {total} {t('integration.logsTotal')}</span>
        <ActionButton onClick={load} label={t('integration.refresh')} variant="secondary" />
      </div>
      {error && <div style={{ color: '#dc2626', marginBottom: 8 }}>{error}</div>}
      {loading ? <div>{t('integration.loading')}</div> : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: '#f3f4f6' }}>
              <th style={{ padding: '6px 8px', textAlign: 'left' }}>{t('integration.logTime')}</th>
              <th style={{ padding: '6px 8px', textAlign: 'left' }}>{t('integration.direction')}</th>
              <th style={{ padding: '6px 8px', textAlign: 'left' }}>{t('integration.logStatus')}</th>
              <th style={{ padding: '6px 8px', textAlign: 'right' }}>{t('integration.recordsIn')}</th>
              <th style={{ padding: '6px 8px', textAlign: 'right' }}>{t('integration.recordsOut')}</th>
              <th style={{ padding: '6px 8px', textAlign: 'right' }}>{t('integration.recordsError')}</th>
              <th style={{ padding: '6px 8px', textAlign: 'left' }}>{t('integration.errorMessage')}</th>
            </tr>
          </thead>
          <tbody>
            {logs.map(l => (
              <tr key={l.id} style={{ borderBottom: '1px solid #e5e7eb' }}>
                <td style={{ padding: '6px 8px', color: '#6b7280' }}>{new Date(l.created_at).toLocaleString()}</td>
                <td style={{ padding: '6px 8px' }}>{l.direction}</td>
                <td style={{ padding: '6px 8px' }}><StatusBadge status={l.status} /></td>
                <td style={{ padding: '6px 8px', textAlign: 'right' }}>{l.records_in}</td>
                <td style={{ padding: '6px 8px', textAlign: 'right' }}>{l.records_out}</td>
                <td style={{ padding: '6px 8px', textAlign: 'right', color: l.records_error > 0 ? '#dc2626' : undefined }}>{l.records_error}</td>
                <td style={{ padding: '6px 8px', color: '#dc2626', fontSize: 12 }}>{l.error_message ?? '—'}</td>
              </tr>
            ))}
            {logs.length === 0 && (
              <tr><td colSpan={7} style={{ padding: 16, textAlign: 'center' }}>{t('integration.noLogs')}</td></tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export function IntegrationsPage() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<Tab>('providers');
  const [selectedConnection, setSelectedConnection] = useState<IntegrationConnection | null>(null);

  const tabs: { id: Tab; label: string }[] = [
    { id: 'providers', label: t('integration.tabProviders') },
    { id: 'connections', label: t('integration.tabConnections') },
    { id: 'logs', label: t('integration.tabLogs') },
  ];

  const handleViewLogs = (conn: IntegrationConnection) => {
    setSelectedConnection(conn);
    setActiveTab('logs');
  };

  return (
    <div style={{ padding: 24 }}>
      <h2 style={{ marginTop: 0 }}>{t('integration.pageTitle')}</h2>

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

      {activeTab === 'providers' && <ProvidersTab />}
      {activeTab === 'connections' && <ConnectionsTab onViewLogs={handleViewLogs} />}
      {activeTab === 'logs' && <LogsTab connection={selectedConnection} />}
    </div>
  );
}
