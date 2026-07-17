// =============================================================================
// FireISP 5.0 — Database Backups (admin)
// =============================================================================
// Admin page at /backups. Three concerns on one page:
//   1. Status — when the nightly database_backup task last ran / runs next,
//      the latest run's outcome, and a "Run backup now" action.
//   2. Remote destination — UI-configured off-site upload target speaking the
//      S3 API (Amazon S3, Google Cloud Storage interop, Backblaze B2,
//      Cloudflare R2, self-hosted MinIO, or any custom endpoint), with a
//      live "Test connection" probe. The secret key is write-only: leaving
//      the field blank keeps the saved key (three-state contract, see
//      BackupSettings.upsert() backend model). When settings are absent or
//      disabled, BACKUP_S3_* env vars remain the fallback — the page says
//      which source is live via `effective_source`.
//   3. History — backup_runs rows (every dump + its remote-upload outcome)
//      and the local .sql.gz files currently on disk.
// =============================================================================

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';
import { styles, fmtDate } from './crudStyles';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface BackupSettingsData {
  remote_enabled: boolean;
  provider: string;
  bucket: string | null;
  region: string | null;
  endpoint: string | null;
  prefix: string;
  access_key: string | null;
  secret_configured: boolean;
  last_test_at: string | null;
  last_test_status: string | null;
  last_test_error: string | null;
  env_configured: boolean;
  effective_source: 'settings' | 'env' | 'none';
}

interface BackupSchedule {
  cron_expression: string | null;
  is_enabled: number | boolean;
  last_run_at: string | null;
  last_status: string | null;
  next_run_at: string | null;
}

interface BackupRun {
  id: number;
  trigger_source: string;
  status: string;
  filename: string | null;
  size_bytes: number | null;
  remote_status: string | null;
  remote_url: string | null;
  error_message: string | null;
  started_at: string;
  finished_at: string | null;
}

interface BackupFile {
  filename: string;
  size_bytes: number;
  modified_at: string;
}

interface Overview {
  settings: BackupSettingsData;
  schedule: BackupSchedule | null;
  latest_run: BackupRun | null;
}

interface TestResult {
  success: boolean;
  source: string;
  url?: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// Provider presets — every one speaks the S3 API; only the endpoint differs.
// ---------------------------------------------------------------------------

const PROVIDERS: Record<string, { label: string; endpoint?: string; endpointPlaceholder?: string; region?: string }> = {
  aws: { label: 'Amazon S3', region: 'us-east-1' },
  gcs: { label: 'Google Cloud Storage', endpoint: 'https://storage.googleapis.com', region: 'auto' },
  b2: { label: 'Backblaze B2', endpointPlaceholder: 'https://s3.us-west-002.backblazeb2.com', region: 'us-west-002' },
  r2: { label: 'Cloudflare R2', endpointPlaceholder: 'https://<account-id>.r2.cloudflarestorage.com', region: 'auto' },
  minio: { label: 'MinIO / self-hosted', endpointPlaceholder: 'http://192.168.1.50:9000', region: 'us-east-1' },
  custom: { label: 'Custom S3-compatible', endpointPlaceholder: 'https://s3.example.com' },
};

// ---------------------------------------------------------------------------
// Fetch helpers
// ---------------------------------------------------------------------------

async function fetchOverview(): Promise<Overview> {
  const res = await api.GET('/backup-settings', {});
  if (res.error) throw new Error('Failed to load backup settings');
  return (res.data as unknown as { data: Overview }).data;
}

async function fetchRuns(): Promise<{ runs: BackupRun[]; files: BackupFile[] }> {
  const res = await api.GET('/backup-settings/runs', {});
  if (res.error) throw new Error('Failed to load backup runs');
  return (res.data as unknown as { data: { runs: BackupRun[]; files: BackupFile[] } }).data;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtBytes(n: number | null): string {
  if (n == null) return '—';
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = n / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value.toFixed(1)} ${units[i]}`;
}

function StatusBadge({ value }: { value: string | null }) {
  const map: Record<string, { bg: string; color: string }> = {
    success: { bg: '#d1fae5', color: '#065f46' },
    uploaded: { bg: '#d1fae5', color: '#065f46' },
    running: { bg: '#dbeafe', color: '#1e40af' },
    failed: { bg: '#fee2e2', color: '#991b1b' },
    disabled: { bg: '#f3f4f6', color: '#374151' },
  };
  const s = map[value ?? ''] ?? { bg: '#f3f4f6', color: '#374151' };
  return (
    <span style={{ background: s.bg, color: s.color, padding: '2px 10px', borderRadius: 12, fontSize: '0.78rem', fontWeight: 600 }}>
      {value ?? '—'}
    </span>
  );
}

// ---------------------------------------------------------------------------
// BackupSettings component
// ---------------------------------------------------------------------------

export function BackupSettings() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const overviewQ = useQuery({ queryKey: ['backup-settings'], queryFn: fetchOverview });

  const runsQ = useQuery({
    queryKey: ['backup-runs'],
    queryFn: fetchRuns,
    // Follow an in-flight backup without a manual refresh.
    refetchInterval: (q) => (q.state.data?.runs.some(r => r.status === 'running') ? 4000 : false),
  });

  // --- Form state ---------------------------------------------------------
  const [form, setForm] = useState({
    remote_enabled: false,
    provider: 'custom',
    bucket: '',
    region: '',
    endpoint: '',
    prefix: 'db-backups/',
    access_key: '',
    secret_key: '',
  });
  const [saveError, setSaveError] = useState<string | null>(null);

  const settings = overviewQ.data?.settings;
  useEffect(() => {
    if (!settings) return;
    setForm({
      remote_enabled: settings.remote_enabled,
      provider: settings.provider,
      bucket: settings.bucket ?? '',
      region: settings.region ?? '',
      endpoint: settings.endpoint ?? '',
      prefix: settings.prefix ?? 'db-backups/',
      access_key: settings.access_key ?? '',
      secret_key: '',
    });
  }, [settings]);

  const set = (field: string, value: string | boolean) => setForm(f => ({ ...f, [field]: value }));

  const onProviderChange = (provider: string) => {
    const preset = PROVIDERS[provider] ?? {};
    setForm(f => ({
      ...f,
      provider,
      // AWS derives its endpoint from the region; fixed-endpoint providers
      // (GCS) are filled in; the rest keep whatever is typed.
      endpoint: provider === 'aws' ? '' : (preset.endpoint ?? f.endpoint),
      region: f.region && f.region !== (PROVIDERS[f.provider]?.region ?? '') ? f.region : (preset.region ?? ''),
    }));
  };

  const saveMut = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = {
        remote_enabled: form.remote_enabled,
        provider: form.provider,
        bucket: form.bucket,
        region: form.region,
        endpoint: form.endpoint,
        prefix: form.prefix,
        access_key: form.access_key,
      };
      // Write-only three-state field: blank = keep the saved secret.
      if (form.secret_key) body.secret_key = form.secret_key;
      const res = await api.PUT('/backup-settings', { body: body as never });
      const resErr = (res as { error?: { error?: { message?: string } } }).error;
      if (resErr) {
        throw new Error(resErr.error?.message || 'Failed to save backup settings');
      }
    },
    onSuccess: () => {
      setSaveError(null);
      setForm(f => ({ ...f, secret_key: '' }));
      queryClient.invalidateQueries({ queryKey: ['backup-settings'] });
    },
    onError: (err: Error) => setSaveError(err.message),
  });

  const testMut = useMutation({
    mutationFn: async (): Promise<TestResult> => {
      const res = await api.POST('/backup-settings/test', {});
      if (res.error) throw new Error('Connection test request failed');
      return (res.data as unknown as { data: TestResult }).data;
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['backup-settings'] }),
  });

  const runNowMut = useMutation({
    mutationFn: async () => {
      const res = await api.POST('/backup-settings/run-now', {});
      const resErr = (res as { error?: { error?: { message?: string } } }).error;
      if (resErr) {
        throw new Error(resErr.error?.message || 'Failed to start backup');
      }
    },
    onSuccess: () => {
      // The run row appears immediately in 'running' state; polling follows it.
      setTimeout(() => queryClient.invalidateQueries({ queryKey: ['backup-runs'] }), 800);
    },
  });

  const schedule = overviewQ.data?.schedule;
  const latestRun = runsQ.data?.runs[0] ?? overviewQ.data?.latest_run ?? null;
  const backupRunning = latestRun?.status === 'running' || runNowMut.isPending;
  const preset = PROVIDERS[form.provider] ?? {};

  const label = { display: 'block', fontSize: '0.8rem', fontWeight: 600 as const, margin: '0.6rem 0 0.2rem' };
  const input = { width: '100%', maxWidth: 420, padding: '6px 8px', border: '1px solid var(--border-color, #d1d5db)', borderRadius: 6, background: 'var(--bg-primary, #fff)', color: 'inherit', fontSize: '0.85rem' };

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.pageTitle}>💾 {t('backups.title')}</h1>
        <button
          style={{ ...styles.btnPrimary, marginLeft: 'auto' }}
          onClick={() => runNowMut.mutate()}
          disabled={backupRunning}
        >
          {backupRunning ? t('backups.runningNow') : t('backups.runNow')}
        </button>
      </div>

      <p style={{ margin: '0 0 1rem', fontSize: '0.85rem', color: 'var(--text-secondary)', maxWidth: 760 }}>
        {t('backups.intro')}
      </p>

      {runNowMut.error && <p style={styles.msgError}>{(runNowMut.error as Error).message}</p>}

      {/* --- Status ---------------------------------------------------------- */}
      <div style={styles.tableCard}>
        {overviewQ.isLoading ? (
          <p style={styles.msg}>Loading…</p>
        ) : overviewQ.error ? (
          <p style={styles.msgError}>{t('backups.loadError')}</p>
        ) : (
          <table style={styles.table}>
            <tbody>
              <tr style={styles.tr}>
                <td style={{ ...styles.td, fontWeight: 500, width: 240 }}>{t('backups.schedule')}</td>
                <td style={styles.td}>
                  {schedule
                    ? `${schedule.cron_expression ?? '—'} ${schedule.is_enabled ? '' : `(${t('backups.scheduleDisabled')})`}`
                    : t('backups.scheduleMissing')}
                </td>
              </tr>
              <tr style={styles.tr}>
                <td style={{ ...styles.td, fontWeight: 500 }}>{t('backups.lastScheduledRun')}</td>
                <td style={styles.td}>
                  {schedule?.last_run_at ? <>{fmtDate(schedule.last_run_at)} <StatusBadge value={schedule.last_status} /></> : '—'}
                </td>
              </tr>
              <tr style={styles.tr}>
                <td style={{ ...styles.td, fontWeight: 500 }}>{t('backups.nextRun')}</td>
                <td style={styles.td}>{schedule?.next_run_at ? fmtDate(schedule.next_run_at) : '—'}</td>
              </tr>
              <tr style={styles.tr}>
                <td style={{ ...styles.td, fontWeight: 500 }}>{t('backups.offsiteSource')}</td>
                <td style={styles.td}>
                  {settings?.effective_source === 'settings' && <span style={{ color: '#065f46', fontWeight: 600 }}>{t('backups.sourceSettings')}</span>}
                  {settings?.effective_source === 'env' && <span style={{ color: '#92400e', fontWeight: 600 }}>{t('backups.sourceEnv')}</span>}
                  {settings?.effective_source === 'none' && <span style={{ color: '#991b1b', fontWeight: 600 }}>{t('backups.sourceNone')}</span>}
                </td>
              </tr>
            </tbody>
          </table>
        )}
      </div>

      {/* --- Remote destination ---------------------------------------------- */}
      <div style={{ ...styles.tableCard, marginTop: '1rem', padding: '1rem 1.25rem' }}>
        <h2 style={{ margin: '0 0 0.25rem', fontSize: '1rem' }}>☁️ {t('backups.remoteTitle')}</h2>
        <p style={{ margin: '0 0 0.5rem', fontSize: '0.8rem', color: 'var(--text-secondary)', maxWidth: 760 }}>
          {t('backups.remoteIntro')}
        </p>

        <label style={{ ...label, display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            type="checkbox"
            checked={form.remote_enabled}
            onChange={e => set('remote_enabled', e.target.checked)}
          />
          {t('backups.enableRemote')}
        </label>

        <label style={label}>{t('backups.provider')}</label>
        <select style={input} value={form.provider} onChange={e => onProviderChange(e.target.value)}>
          {Object.entries(PROVIDERS).map(([key, p]) => (
            <option key={key} value={key}>{p.label}</option>
          ))}
        </select>

        <label style={label}>{t('backups.bucket')}</label>
        <input style={input} value={form.bucket} onChange={e => set('bucket', e.target.value)} placeholder="fireisp-backups" />

        <label style={label}>{t('backups.region')}</label>
        <input style={input} value={form.region} onChange={e => set('region', e.target.value)} placeholder={preset.region ?? 'us-east-1'} />

        {form.provider !== 'aws' && (
          <>
            <label style={label}>{t('backups.endpoint')}</label>
            <input style={input} value={form.endpoint} onChange={e => set('endpoint', e.target.value)} placeholder={preset.endpoint ?? preset.endpointPlaceholder ?? ''} />
          </>
        )}

        <label style={label}>{t('backups.prefix')}</label>
        <input style={input} value={form.prefix} onChange={e => set('prefix', e.target.value)} placeholder="db-backups/" />

        <label style={label}>{t('backups.accessKey')}</label>
        <input style={input} value={form.access_key} onChange={e => set('access_key', e.target.value)} autoComplete="off" />

        <label style={label}>{t('backups.secretKey')}</label>
        <input
          style={input}
          type="password"
          value={form.secret_key}
          onChange={e => set('secret_key', e.target.value)}
          placeholder={settings?.secret_configured ? t('backups.secretSaved') : ''}
          autoComplete="new-password"
        />

        <div style={{ display: 'flex', gap: 8, marginTop: '0.9rem', alignItems: 'center' }}>
          <button style={styles.btnPrimary} onClick={() => saveMut.mutate()} disabled={saveMut.isPending}>
            {saveMut.isPending ? t('common.saving') : t('common.save')}
          </button>
          <button style={styles.btnSecondary} onClick={() => testMut.mutate()} disabled={testMut.isPending || saveMut.isPending}>
            {testMut.isPending ? t('backups.testing') : t('backups.testConnection')}
          </button>
        </div>

        {saveError && <p style={styles.msgError}>{saveError}</p>}
        {saveMut.isSuccess && !saveError && <p style={{ ...styles.msg, color: '#065f46' }}>{t('backups.saved')}</p>}
        {testMut.data && (
          <p style={{ ...styles.msg, color: testMut.data.success ? '#065f46' : '#991b1b' }}>
            {testMut.data.success
              ? t('backups.testOk', { source: testMut.data.source })
              : t('backups.testFail', { error: testMut.data.error ?? 'unknown' })}
          </p>
        )}
        {!testMut.data && settings?.last_test_at && (
          <p style={{ ...styles.msg, fontSize: '0.78rem' }}>
            {t('backups.lastTest', { date: fmtDate(settings.last_test_at) })}{' '}
            <StatusBadge value={settings.last_test_status} />
            {settings.last_test_status === 'failed' && settings.last_test_error && ` — ${settings.last_test_error}`}
          </p>
        )}
      </div>

      {/* --- Run history ------------------------------------------------------ */}
      <div style={{ ...styles.tableCard, marginTop: '1rem' }}>
        <h2 style={{ margin: '0.75rem 1.25rem 0.25rem', fontSize: '1rem' }}>📜 {t('backups.historyTitle')}</h2>
        {runsQ.isLoading ? (
          <p style={styles.msg}>Loading…</p>
        ) : runsQ.error ? (
          <p style={styles.msgError}>{t('backups.loadError')}</p>
        ) : !runsQ.data || runsQ.data.runs.length === 0 ? (
          <p style={styles.msg}>{t('backups.noRuns')}</p>
        ) : (
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>{t('backups.colStarted')}</th>
                <th style={styles.th}>{t('backups.colTrigger')}</th>
                <th style={styles.th}>{t('backups.colStatus')}</th>
                <th style={styles.th}>{t('backups.colFile')}</th>
                <th style={styles.th}>{t('backups.colSize')}</th>
                <th style={styles.th}>{t('backups.colRemote')}</th>
              </tr>
            </thead>
            <tbody>
              {runsQ.data.runs.map(run => (
                <tr key={run.id} style={styles.tr} title={run.error_message ?? undefined}>
                  <td style={styles.td}>{fmtDate(run.started_at)}</td>
                  <td style={styles.td}>{run.trigger_source}</td>
                  <td style={styles.td}><StatusBadge value={run.status} /></td>
                  <td style={styles.td}>{run.filename ?? '—'}</td>
                  <td style={styles.td}>{fmtBytes(run.size_bytes)}</td>
                  <td style={styles.td}><StatusBadge value={run.remote_status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* --- Local files ------------------------------------------------------ */}
      <div style={{ ...styles.tableCard, marginTop: '1rem' }}>
        <h2 style={{ margin: '0.75rem 1.25rem 0.25rem', fontSize: '1rem' }}>🗄️ {t('backups.filesTitle')}</h2>
        {runsQ.data && runsQ.data.files.length === 0 ? (
          <p style={styles.msg}>{t('backups.noFiles')}</p>
        ) : (
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>{t('backups.colFile')}</th>
                <th style={styles.th}>{t('backups.colSize')}</th>
                <th style={styles.th}>{t('backups.colModified')}</th>
              </tr>
            </thead>
            <tbody>
              {(runsQ.data?.files ?? []).map(file => (
                <tr key={file.filename} style={styles.tr}>
                  <td style={styles.td}>{file.filename}</td>
                  <td style={styles.td}>{fmtBytes(file.size_bytes)}</td>
                  <td style={styles.td}>{fmtDate(file.modified_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
