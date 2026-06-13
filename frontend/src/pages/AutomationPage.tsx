// =============================================================================
// FireISP 5.0 — Automation & Scripting Page (Section 18)
// =============================================================================
// Multi-tab page covering §18 automation features:
//   1. Automation Rules  — event-triggered workflow rules
//   2. Batch Jobs        — bulk subscriber operations
//   3. Pipelines         — auto-provisioning pipeline runs
//   4. Remediation       — auto-remediation rules
//   5. Scripts           — script storage, library, execution log
//   6. Router Drivers    — vendor router API configs + command dispatch
//   7. Analytics         — anomaly detection, predictive failure, churn scoring
// =============================================================================

import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Tab =
  | 'automationRules'
  | 'batchJobs'
  | 'pipelines'
  | 'remediation'
  | 'scripts'
  | 'routerDrivers'
  | 'analytics';

interface AutomationRule {
  id: number;
  name: string;
  trigger_event: string;
  action_type: string;
  is_enabled: number;
  run_count: number;
  last_triggered_at: string | null;
}

interface BatchJob {
  id: number;
  name: string;
  operation: string;
  status: string;
  total_items: number;
  success_items: number;
  failed_items: number;
  created_at: string;
}

interface Pipeline {
  id: number;
  name: string;
  status: string;
  current_stage: string | null;
  contract_id: number | null;
  client_id: number | null;
  started_at: string | null;
  completed_at: string | null;
}

interface RemediationRule {
  id: number;
  name: string;
  condition_metric: string;
  condition_operator: string;
  action_type: string;
  is_enabled: number;
  cooldown_minutes: number;
}

interface AutomationScript {
  id: number;
  name: string;
  language: string;
  version: number;
  is_shared: number;
  description: string | null;
  created_at: string;
}

interface RouterDriver {
  id: number;
  name: string | null;
  vendor: string;
  protocol: string;
  host: string;
  last_test_status: string | null;
  has_password: boolean;
  has_api_token: boolean;
}

interface Anomaly {
  id: number;
  metric: string;
  device_id: number | null;
  severity: string;
  z_score: number | null;
  is_acknowledged: number;
  detected_at: string;
}

interface ChurnScore {
  id: number;
  client_id: number;
  client_name: string | null;
  score: number;
  risk_band: string;
  scored_at: string;
}

interface ListMeta { total: number; page: number; limit: number; pages: number }
interface ApiList<T> { data: T[]; meta: ListMeta }

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const orgId = localStorage.getItem('orgId') ?? '1';
  const token = localStorage.getItem('token') ?? '';
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      'X-Org-Id': orgId,
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatusBadge({ value }: { value: string }) {
  const color: Record<string, string> = {
    success: '#2ecc71', completed: '#2ecc71', ok: '#2ecc71', active: '#2ecc71',
    failure: '#e74c3c', failed: '#e74c3c', critical: '#e74c3c',
    running: '#3498db',
    pending: '#f39c12', queued: '#f39c12', medium: '#f39c12',
    stubbed: '#9b59b6',
    skipped: '#95a5a6', cancelled: '#95a5a6', low: '#95a5a6',
    high: '#e67e22',
  };
  return (
    <span style={{
      display: 'inline-block', padding: '2px 8px', borderRadius: 10,
      fontSize: 11, fontWeight: 600, color: '#fff',
      background: color[value] ?? '#7f8c8d',
    }}>
      {value}
    </span>
  );
}

function ActionButton({ label, onClick, disabled, variant = 'primary' }:
  { label: string; onClick: () => void; disabled?: boolean; variant?: 'primary' | 'danger' | 'success' }) {
  const bg = variant === 'danger' ? '#e74c3c' : variant === 'success' ? '#2ecc71' : '#3498db';
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: '4px 10px', fontSize: 12, cursor: disabled ? 'not-allowed' : 'pointer',
        background: disabled ? '#ccc' : bg, color: '#fff', border: 'none', borderRadius: 4,
      }}
    >
      {label}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Tab: Automation Rules
// ---------------------------------------------------------------------------

function AutomationRulesTab() {
  const { t } = useTranslation();
  const [rules, setRules] = useState<AutomationRule[]>([]);
  const [meta, setMeta] = useState<ListMeta | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await apiFetch<ApiList<AutomationRule>>(`/automation-rules?page=${page}&limit=20`);
      setRules(res.data); setMeta(res.meta);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('automation.errorLoading'));
    } finally { setLoading(false); }
  }, [page, t]);

  useEffect(() => { load(); }, [load]);

  const deleteRule = async (id: number) => {
    if (!confirm(t('automation.confirmDelete'))) return;
    try {
      await apiFetch(`/automation-rules/${id}`, { method: 'DELETE' });
      load();
    } catch (err) { alert(err instanceof Error ? err.message : t('automation.errorDelete')); }
  };

  const executeRule = async (id: number) => {
    try {
      await apiFetch(`/automation-rules/${id}/execute`, { method: 'POST', body: JSON.stringify({}) });
      alert(t('automation.executionTriggered'));
    } catch (err) { alert(err instanceof Error ? err.message : t('automation.errorExecute')); }
  };

  return (
    <div>
      <h3>{t('automation.rules')}</h3>
      {error && <p style={{ color: 'red' }}>{error}</p>}
      {loading ? <p>{t('common.loading')}</p> : (
        <>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#f5f5f5' }}>
                <th style={th}>ID</th>
                <th style={th}>{t('common.name')}</th>
                <th style={th}>{t('automation.triggerEvent')}</th>
                <th style={th}>{t('automation.actionType')}</th>
                <th style={th}>{t('common.status')}</th>
                <th style={th}>{t('automation.runCount')}</th>
                <th style={th}>{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {rules.map(r => (
                <tr key={r.id} style={{ borderBottom: '1px solid #eee' }}>
                  <td style={td}>{r.id}</td>
                  <td style={td}>{r.name}</td>
                  <td style={td}><code>{r.trigger_event}</code></td>
                  <td style={td}>{r.action_type}</td>
                  <td style={td}><StatusBadge value={r.is_enabled ? 'active' : 'disabled'} /></td>
                  <td style={td}>{r.run_count}</td>
                  <td style={td}>
                    <ActionButton label={t('automation.run')} onClick={() => executeRule(r.id)} />
                    {' '}
                    <ActionButton label={t('common.delete')} onClick={() => deleteRule(r.id)} variant="danger" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {meta && (
            <div style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
              <button disabled={page <= 1} onClick={() => setPage(p => p - 1)}>{t('common.prev')}</button>
              <span>{t('common.pageOf', { page, pages: meta.pages })}</span>
              <button disabled={page >= meta.pages} onClick={() => setPage(p => p + 1)}>{t('common.next')}</button>
              <span style={{ marginLeft: 'auto' }}>{t('common.totalItems', { total: meta.total })}</span>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab: Batch Jobs
// ---------------------------------------------------------------------------

function BatchJobsTab() {
  const { t } = useTranslation();
  const [jobs, setJobs] = useState<BatchJob[]>([]);
  const [meta, setMeta] = useState<ListMeta | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await apiFetch<ApiList<BatchJob>>(`/batch-jobs?page=${page}&limit=20`);
      setJobs(res.data); setMeta(res.meta);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('automation.errorLoading'));
    } finally { setLoading(false); }
  }, [page, t]);

  useEffect(() => { load(); }, [load]);

  const cancelJob = async (id: number) => {
    try {
      await apiFetch(`/batch-jobs/${id}/cancel`, { method: 'POST' });
      load();
    } catch (err) { alert(err instanceof Error ? err.message : t('automation.errorCancel')); }
  };

  return (
    <div>
      <h3>{t('automation.batchJobs')}</h3>
      {error && <p style={{ color: 'red' }}>{error}</p>}
      {loading ? <p>{t('common.loading')}</p> : (
        <>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#f5f5f5' }}>
                <th style={th}>ID</th>
                <th style={th}>{t('common.name')}</th>
                <th style={th}>{t('automation.operation')}</th>
                <th style={th}>{t('common.status')}</th>
                <th style={th}>{t('automation.items')}</th>
                <th style={th}>{t('common.createdAt')}</th>
                <th style={th}>{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map(j => (
                <tr key={j.id} style={{ borderBottom: '1px solid #eee' }}>
                  <td style={td}>{j.id}</td>
                  <td style={td}>{j.name}</td>
                  <td style={td}>{j.operation}</td>
                  <td style={td}><StatusBadge value={j.status} /></td>
                  <td style={td}>{j.success_items}/{j.total_items} ({j.failed_items} {t('automation.failed')})</td>
                  <td style={td}>{new Date(j.created_at).toLocaleString()}</td>
                  <td style={td}>
                    {j.status === 'running' && (
                      <ActionButton label={t('automation.cancel')} onClick={() => cancelJob(j.id)} variant="danger" />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {meta && (
            <div style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
              <button disabled={page <= 1} onClick={() => setPage(p => p - 1)}>{t('common.prev')}</button>
              <span>{t('common.pageOf', { page, pages: meta.pages })}</span>
              <button disabled={page >= meta.pages} onClick={() => setPage(p => p + 1)}>{t('common.next')}</button>
              <span style={{ marginLeft: 'auto' }}>{t('common.totalItems', { total: meta.total })}</span>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab: Provisioning Pipelines
// ---------------------------------------------------------------------------

function PipelinesTab() {
  const { t } = useTranslation();
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [meta, setMeta] = useState<ListMeta | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await apiFetch<ApiList<Pipeline>>(`/provisioning-pipelines?page=${page}&limit=20`);
      setPipelines(res.data); setMeta(res.meta);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('automation.errorLoading'));
    } finally { setLoading(false); }
  }, [page, t]);

  useEffect(() => { load(); }, [load]);

  return (
    <div>
      <h3>{t('automation.pipelines')}</h3>
      {error && <p style={{ color: 'red' }}>{error}</p>}
      {loading ? <p>{t('common.loading')}</p> : (
        <>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#f5f5f5' }}>
                <th style={th}>ID</th>
                <th style={th}>{t('common.name')}</th>
                <th style={th}>{t('common.status')}</th>
                <th style={th}>{t('automation.currentStage')}</th>
                <th style={th}>{t('automation.startedAt')}</th>
                <th style={th}>{t('automation.completedAt')}</th>
              </tr>
            </thead>
            <tbody>
              {pipelines.map(p => (
                <tr key={p.id} style={{ borderBottom: '1px solid #eee' }}>
                  <td style={td}>{p.id}</td>
                  <td style={td}>{p.name}</td>
                  <td style={td}><StatusBadge value={p.status} /></td>
                  <td style={td}>{p.current_stage ?? '-'}</td>
                  <td style={td}>{p.started_at ? new Date(p.started_at).toLocaleString() : '-'}</td>
                  <td style={td}>{p.completed_at ? new Date(p.completed_at).toLocaleString() : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {meta && (
            <div style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
              <button disabled={page <= 1} onClick={() => setPage(p => p - 1)}>{t('common.prev')}</button>
              <span>{t('common.pageOf', { page, pages: meta.pages })}</span>
              <button disabled={page >= meta.pages} onClick={() => setPage(p => p + 1)}>{t('common.next')}</button>
              <span style={{ marginLeft: 'auto' }}>{t('common.totalItems', { total: meta.total })}</span>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab: Remediation Rules
// ---------------------------------------------------------------------------

function RemediationTab() {
  const { t } = useTranslation();
  const [rules, setRules] = useState<RemediationRule[]>([]);
  const [meta, setMeta] = useState<ListMeta | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [evaluating, setEvaluating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await apiFetch<ApiList<RemediationRule>>(`/remediation-rules?page=${page}&limit=20`);
      setRules(res.data); setMeta(res.meta);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('automation.errorLoading'));
    } finally { setLoading(false); }
  }, [page, t]);

  useEffect(() => { load(); }, [load]);

  const evaluate = async () => {
    setEvaluating(true);
    try {
      const res = await apiFetch<{ data: { evaluated: number; triggered: number } }>('/remediation-rules/evaluate', { method: 'POST' });
      alert(t('automation.evaluationComplete', { evaluated: res.data.evaluated, triggered: res.data.triggered }));
    } catch (err) {
      alert(err instanceof Error ? err.message : t('automation.errorEvaluate'));
    } finally { setEvaluating(false); }
  };

  const deleteRule = async (id: number) => {
    if (!confirm(t('automation.confirmDelete'))) return;
    try {
      await apiFetch(`/remediation-rules/${id}`, { method: 'DELETE' });
      load();
    } catch (err) { alert(err instanceof Error ? err.message : t('automation.errorDelete')); }
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3>{t('automation.remediation')}</h3>
        <ActionButton label={t('automation.runEvaluation')} onClick={evaluate} disabled={evaluating} variant="success" />
      </div>
      {error && <p style={{ color: 'red' }}>{error}</p>}
      {loading ? <p>{t('common.loading')}</p> : (
        <>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#f5f5f5' }}>
                <th style={th}>ID</th>
                <th style={th}>{t('common.name')}</th>
                <th style={th}>{t('automation.condition')}</th>
                <th style={th}>{t('automation.actionType')}</th>
                <th style={th}>{t('automation.cooldown')}</th>
                <th style={th}>{t('common.status')}</th>
                <th style={th}>{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {rules.map(r => (
                <tr key={r.id} style={{ borderBottom: '1px solid #eee' }}>
                  <td style={td}>{r.id}</td>
                  <td style={td}>{r.name}</td>
                  <td style={td}><code>{r.condition_metric} {r.condition_operator}</code></td>
                  <td style={td}>{r.action_type}</td>
                  <td style={td}>{r.cooldown_minutes} {t('automation.minutes')}</td>
                  <td style={td}><StatusBadge value={r.is_enabled ? 'active' : 'disabled'} /></td>
                  <td style={td}>
                    <ActionButton label={t('common.delete')} onClick={() => deleteRule(r.id)} variant="danger" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {meta && (
            <div style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
              <button disabled={page <= 1} onClick={() => setPage(p => p - 1)}>{t('common.prev')}</button>
              <span>{t('common.pageOf', { page, pages: meta.pages })}</span>
              <button disabled={page >= meta.pages} onClick={() => setPage(p => p + 1)}>{t('common.next')}</button>
              <span style={{ marginLeft: 'auto' }}>{t('common.totalItems', { total: meta.total })}</span>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab: Scripts
// ---------------------------------------------------------------------------

function ScriptsTab() {
  const { t } = useTranslation();
  const [scripts, setScripts] = useState<AutomationScript[]>([]);
  const [meta, setMeta] = useState<ListMeta | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await apiFetch<ApiList<AutomationScript>>(`/automation-scripts?page=${page}&limit=20`);
      setScripts(res.data); setMeta(res.meta);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('automation.errorLoading'));
    } finally { setLoading(false); }
  }, [page, t]);

  useEffect(() => { load(); }, [load]);

  const executeScript = async (id: number) => {
    try {
      const res = await apiFetch<{ data: { id: number; status: string }; note: string }>(`/automation-scripts/${id}/execute`, {
        method: 'POST', body: JSON.stringify({}),
      });
      alert(`${t('automation.executionQueued')}: ${res.note}`);
    } catch (err) { alert(err instanceof Error ? err.message : t('automation.errorExecute')); }
  };

  const deleteScript = async (id: number) => {
    if (!confirm(t('automation.confirmDelete'))) return;
    try {
      await apiFetch(`/automation-scripts/${id}`, { method: 'DELETE' });
      load();
    } catch (err) { alert(err instanceof Error ? err.message : t('automation.errorDelete')); }
  };

  return (
    <div>
      <h3>{t('automation.scripts')}</h3>
      <p style={{ fontSize: 12, color: '#888' }}>{t('automation.scriptsNote')}</p>
      {error && <p style={{ color: 'red' }}>{error}</p>}
      {loading ? <p>{t('common.loading')}</p> : (
        <>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#f5f5f5' }}>
                <th style={th}>ID</th>
                <th style={th}>{t('common.name')}</th>
                <th style={th}>{t('automation.language')}</th>
                <th style={th}>{t('automation.version')}</th>
                <th style={th}>{t('automation.shared')}</th>
                <th style={th}>{t('common.createdAt')}</th>
                <th style={th}>{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {scripts.map(s => (
                <tr key={s.id} style={{ borderBottom: '1px solid #eee' }}>
                  <td style={td}>{s.id}</td>
                  <td style={td}>{s.name}</td>
                  <td style={td}><StatusBadge value={s.language} /></td>
                  <td style={td}>v{s.version}</td>
                  <td style={td}>{s.is_shared ? t('common.yes') : t('common.no')}</td>
                  <td style={td}>{new Date(s.created_at).toLocaleDateString()}</td>
                  <td style={td}>
                    <ActionButton label={t('automation.queue')} onClick={() => executeScript(s.id)} />
                    {' '}
                    <ActionButton label={t('common.delete')} onClick={() => deleteScript(s.id)} variant="danger" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {meta && (
            <div style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
              <button disabled={page <= 1} onClick={() => setPage(p => p - 1)}>{t('common.prev')}</button>
              <span>{t('common.pageOf', { page, pages: meta.pages })}</span>
              <button disabled={page >= meta.pages} onClick={() => setPage(p => p + 1)}>{t('common.next')}</button>
              <span style={{ marginLeft: 'auto' }}>{t('common.totalItems', { total: meta.total })}</span>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab: Router Drivers
// ---------------------------------------------------------------------------

function RouterDriversTab() {
  const { t } = useTranslation();
  const [drivers, setDrivers] = useState<RouterDriver[]>([]);
  const [meta, setMeta] = useState<ListMeta | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await apiFetch<ApiList<RouterDriver>>(`/router-drivers?page=${page}&limit=20`);
      setDrivers(res.data); setMeta(res.meta);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('automation.errorLoading'));
    } finally { setLoading(false); }
  }, [page, t]);

  useEffect(() => { load(); }, [load]);

  const testDriver = async (id: number) => {
    try {
      const res = await apiFetch<{ data: { status: string; message: string } }>(`/router-drivers/${id}/test`, { method: 'POST' });
      alert(`${t('automation.testResult')}: ${res.data.status} — ${res.data.message}`);
      load();
    } catch (err) { alert(err instanceof Error ? err.message : t('automation.errorTest')); }
  };

  const deleteDriver = async (id: number) => {
    if (!confirm(t('automation.confirmDelete'))) return;
    try {
      await apiFetch(`/router-drivers/${id}`, { method: 'DELETE' });
      load();
    } catch (err) { alert(err instanceof Error ? err.message : t('automation.errorDelete')); }
  };

  return (
    <div>
      <h3>{t('automation.routerDrivers')}</h3>
      {error && <p style={{ color: 'red' }}>{error}</p>}
      {loading ? <p>{t('common.loading')}</p> : (
        <>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#f5f5f5' }}>
                <th style={th}>ID</th>
                <th style={th}>{t('automation.vendor')}</th>
                <th style={th}>{t('automation.protocol')}</th>
                <th style={th}>{t('automation.host')}</th>
                <th style={th}>{t('automation.lastTest')}</th>
                <th style={th}>{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {drivers.map(d => (
                <tr key={d.id} style={{ borderBottom: '1px solid #eee' }}>
                  <td style={td}>{d.id}</td>
                  <td style={td}><StatusBadge value={d.vendor} /></td>
                  <td style={td}>{d.protocol}</td>
                  <td style={td}>{d.host}</td>
                  <td style={td}>{d.last_test_status ? <StatusBadge value={d.last_test_status} /> : '-'}</td>
                  <td style={td}>
                    <ActionButton label={t('automation.test')} onClick={() => testDriver(d.id)} variant="success" />
                    {' '}
                    <ActionButton label={t('common.delete')} onClick={() => deleteDriver(d.id)} variant="danger" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {meta && (
            <div style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
              <button disabled={page <= 1} onClick={() => setPage(p => p - 1)}>{t('common.prev')}</button>
              <span>{t('common.pageOf', { page, pages: meta.pages })}</span>
              <button disabled={page >= meta.pages} onClick={() => setPage(p => p + 1)}>{t('common.next')}</button>
              <span style={{ marginLeft: 'auto' }}>{t('common.totalItems', { total: meta.total })}</span>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab: Analytics
// ---------------------------------------------------------------------------

function AnalyticsAITab() {
  const { t } = useTranslation();
  const [anomalies, setAnomalies] = useState<Anomaly[]>([]);
  const [churnScores, setChurnScores] = useState<ChurnScore[]>([]);
  const [anomaliesMeta, setAnomaliesMeta] = useState<ListMeta | null>(null);
  const [churnMeta, setChurnMeta] = useState<ListMeta | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [scoring, setScoring] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [aRes, cRes] = await Promise.all([
        apiFetch<ApiList<Anomaly>>('/analytics/anomalies?limit=10'),
        apiFetch<ApiList<ChurnScore>>('/analytics/churn-scores?limit=10'),
      ]);
      setAnomalies(aRes.data); setAnomaliesMeta(aRes.meta);
      setChurnScores(cRes.data); setChurnMeta(cRes.meta);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('automation.errorLoading'));
    } finally { setLoading(false); }
  }, [t]);

  useEffect(() => { load(); }, [load]);

  const detectAnomalies = async () => {
    setDetecting(true);
    try {
      const res = await apiFetch<{ data: { combos_checked: number; anomalies_detected: number } }>('/analytics/anomalies/detect', { method: 'POST' });
      alert(t('automation.anomalyDetected', { checked: res.data.combos_checked, found: res.data.anomalies_detected }));
      load();
    } catch (err) { alert(err instanceof Error ? err.message : t('automation.errorDetect')); }
    finally { setDetecting(false); }
  };

  const computeChurn = async () => {
    setScoring(true);
    try {
      const res = await apiFetch<{ data: { clients_scored: number } }>('/analytics/churn-scores/compute', { method: 'POST' });
      alert(t('automation.churnScored', { scored: res.data.clients_scored }));
      load();
    } catch (err) { alert(err instanceof Error ? err.message : t('automation.errorChurn')); }
    finally { setScoring(false); }
  };

  const acknowledgeAnomaly = async (id: number) => {
    try {
      await apiFetch(`/analytics/anomalies/${id}/acknowledge`, { method: 'POST' });
      load();
    } catch (err) { alert(err instanceof Error ? err.message : t('automation.errorAck')); }
  };

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <ActionButton label={t('automation.detectAnomalies')} onClick={detectAnomalies} disabled={detecting} />
        <ActionButton label={t('automation.computeChurn')} onClick={computeChurn} disabled={scoring} variant="success" />
      </div>
      {error && <p style={{ color: 'red' }}>{error}</p>}
      {loading ? <p>{t('common.loading')}</p> : (
        <>
          <h4>{t('automation.anomalies')} ({anomaliesMeta?.total ?? 0})</h4>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, marginBottom: 24 }}>
            <thead>
              <tr style={{ background: '#f5f5f5' }}>
                <th style={th}>ID</th>
                <th style={th}>{t('automation.metric')}</th>
                <th style={th}>{t('automation.severity')}</th>
                <th style={th}>{t('automation.zScore')}</th>
                <th style={th}>{t('common.status')}</th>
                <th style={th}>{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {anomalies.map(a => (
                <tr key={a.id} style={{ borderBottom: '1px solid #eee' }}>
                  <td style={td}>{a.id}</td>
                  <td style={td}>{a.metric}</td>
                  <td style={td}><StatusBadge value={a.severity} /></td>
                  <td style={td}>{a.z_score?.toFixed(2) ?? '-'}</td>
                  <td style={td}><StatusBadge value={a.is_acknowledged ? 'acknowledged' : 'pending'} /></td>
                  <td style={td}>
                    {!a.is_acknowledged && (
                      <ActionButton label={t('automation.acknowledge')} onClick={() => acknowledgeAnomaly(a.id)} />
                    )}
                  </td>
                </tr>
              ))}
              {anomalies.length === 0 && (
                <tr><td colSpan={6} style={{ ...td, textAlign: 'center', color: '#888' }}>{t('automation.noAnomalies')}</td></tr>
              )}
            </tbody>
          </table>

          <h4>{t('automation.churnScores')} ({churnMeta?.total ?? 0})</h4>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#f5f5f5' }}>
                <th style={th}>{t('automation.clientId')}</th>
                <th style={th}>{t('common.name')}</th>
                <th style={th}>{t('automation.score')}</th>
                <th style={th}>{t('automation.riskBand')}</th>
                <th style={th}>{t('automation.scoredAt')}</th>
              </tr>
            </thead>
            <tbody>
              {churnScores.map(c => (
                <tr key={c.id} style={{ borderBottom: '1px solid #eee' }}>
                  <td style={td}>{c.client_id}</td>
                  <td style={td}>{c.client_name ?? '-'}</td>
                  <td style={td}>{c.score.toFixed(1)}</td>
                  <td style={td}><StatusBadge value={c.risk_band} /></td>
                  <td style={td}>{new Date(c.scored_at).toLocaleString()}</td>
                </tr>
              ))}
              {churnScores.length === 0 && (
                <tr><td colSpan={5} style={{ ...td, textAlign: 'center', color: '#888' }}>{t('automation.noChurnScores')}</td></tr>
              )}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared styles
// ---------------------------------------------------------------------------

const th: React.CSSProperties = { padding: '8px 10px', textAlign: 'left', fontWeight: 600, fontSize: 12, whiteSpace: 'nowrap' };
const td: React.CSSProperties = { padding: '6px 10px', verticalAlign: 'middle' };

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function AutomationPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>('automationRules');

  const tabs: { key: Tab; label: string }[] = [
    { key: 'automationRules', label: t('automation.rules') },
    { key: 'batchJobs',       label: t('automation.batchJobs') },
    { key: 'pipelines',       label: t('automation.pipelines') },
    { key: 'remediation',     label: t('automation.remediation') },
    { key: 'scripts',         label: t('automation.scripts') },
    { key: 'routerDrivers',   label: t('automation.routerDrivers') },
    { key: 'analytics',       label: t('automation.analytics') },
  ];

  return (
    <div style={{ padding: 24 }}>
      <h2 style={{ marginBottom: 16 }}>{t('automation.pageTitle')}</h2>

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 0, borderBottom: '2px solid #e0e0e0', marginBottom: 20 }}>
        {tabs.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            style={{
              padding: '8px 16px', border: 'none', background: 'none',
              cursor: 'pointer', fontSize: 13, fontWeight: tab === key ? 700 : 400,
              borderBottom: tab === key ? '2px solid #3498db' : '2px solid transparent',
              color: tab === key ? '#3498db' : '#555', marginBottom: -2,
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === 'automationRules' && <AutomationRulesTab />}
      {tab === 'batchJobs'       && <BatchJobsTab />}
      {tab === 'pipelines'       && <PipelinesTab />}
      {tab === 'remediation'     && <RemediationTab />}
      {tab === 'scripts'         && <ScriptsTab />}
      {tab === 'routerDrivers'   && <RouterDriversTab />}
      {tab === 'analytics'       && <AnalyticsAITab />}
    </div>
  );
}
