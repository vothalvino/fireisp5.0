// =============================================================================
// FireISP 5.0 — PAC Providers
// =============================================================================
// Page at /pac-providers (MX orgs). Lists the PAC (Proveedor Autorizado de
// Certificación) configurations and lets an operator create/edit them —
// provider, environment, endpoint, credentials, status. Credentials are
// WRITE-ONLY: the API redacts them on read (has_username/has_password flags
// only), so the edit form shows "saved — leave blank to keep" and an empty
// field never overwrites a stored secret (same three-state pattern as the
// org Mail tab / BackupSettings).
// =============================================================================

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { styles, capitalize, fmtDate, RequiredMark } from './crudStyles';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PacProvider {
  id: number;
  provider_name: string;
  label: string | null;
  environment: string;
  api_url: string | null;
  is_default: number | boolean;
  status: string;
  last_stamp_at: string | null;
  has_username?: boolean;
  has_password?: boolean;
  has_token?: boolean;
}

interface PacResponse {
  data: PacProvider[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

const DEFAULT_PAGE_SIZE = 50;

// ---------------------------------------------------------------------------
// Fetch helper
// ---------------------------------------------------------------------------

async function fetchProviders(page: number): Promise<PacResponse> {
  const query = { page, limit: DEFAULT_PAGE_SIZE };
  const res = await api.GET('/pac-providers', { params: { query: query as never } });
  if (res.error) throw new Error('Failed to load PAC providers');
  return res.data as unknown as PacResponse;
}

// ---------------------------------------------------------------------------
// Badges
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; color: string }> = {
    active: { bg: '#d1fae5', color: '#065f46' },
    inactive: { bg: '#f3f4f6', color: '#374151' },
  };
  const s = map[status] ?? { bg: '#f3f4f6', color: '#374151' };
  return (
    <span
      style={{
        background: s.bg,
        color: s.color,
        padding: '2px 8px',
        borderRadius: 12,
        fontSize: '0.72rem',
        fontWeight: 600,
        textTransform: 'capitalize',
      }}
    >
      {status}
    </span>
  );
}

function EnvBadge({ env }: { env: string }) {
  const isProd = env === 'production';
  return (
    <span
      style={{
        background: isProd ? '#fee2e2' : '#dbeafe',
        color: isProd ? '#991b1b' : '#1e40af',
        padding: '2px 8px',
        borderRadius: 12,
        fontSize: '0.72rem',
        fontWeight: 600,
        textTransform: 'capitalize',
      }}
    >
      {env}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Create / edit modal
// ---------------------------------------------------------------------------

const PROVIDERS = ['finkok', 'sw_sapien', 'digicel', 'comercio_digital', 'facturapi', 'other', 'simulator'];
// Known endpoints per provider+environment — prefilled, still editable.
const API_URL_PRESETS: Record<string, { sandbox?: string; production?: string }> = {
  sw_sapien: { sandbox: 'https://services.test.sw.com.mx', production: 'https://services.sw.com.mx' },
  finkok: { sandbox: 'https://demo-facturacion.finkok.com/servicios/soap', production: 'https://facturacion.finkok.com/servicios/soap' },
  simulator: { sandbox: 'https://simulator.invalid' },
};

interface PacModalProps {
  existing: PacProvider | null; // null = create
  onClose: () => void;
  onSaved: () => void;
}

function PacModal({ existing, onClose, onSaved }: PacModalProps) {
  const [form, setForm] = useState({
    provider_name: existing?.provider_name ?? 'sw_sapien',
    label: existing?.label ?? '',
    environment: existing?.environment ?? 'sandbox',
    seal_mode: (existing as { seal_mode?: string } | null)?.seal_mode ?? 'pac',
    priority: String((existing as { priority?: number } | null)?.priority ?? 100),
    api_url: existing?.api_url ?? API_URL_PRESETS.sw_sapien.sandbox ?? '',
    username: '',
    password: '',
    token: '',
    status: existing?.status ?? 'active',
  });
  const [error, setError] = useState('');
  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  // Changing provider/environment refreshes the endpoint preset — but never
  // clobbers a URL the operator already typed by hand for that combo.
  function applyPreset(provider: string, environment: string) {
    const preset = API_URL_PRESETS[provider]?.[environment as 'sandbox' | 'production'];
    if (preset) set('api_url', preset);
  }

  const mutation = useMutation({
    mutationFn: async () => {
      const body: Record<string, string | number> = {
        provider_name: form.provider_name,
        label: form.label.trim(),
        environment: form.environment,
        seal_mode: form.provider_name === 'finkok' ? 'local' : form.seal_mode,
        // priority is a NUMBER column — validate() does not coerce strings, so
        // sending form.priority verbatim 422s every save (review-confirmed).
        priority: Number.parseInt(form.priority, 10) || 100,
        api_url: form.api_url.trim(),
        status: form.status,
      };
      // Write-only three-state: blank = keep the stored credential.
      if (form.username.trim()) body.username_encrypted = form.username.trim();
      if (form.password.trim()) body.password_encrypted = form.password.trim();
      if (form.token.trim()) body.token_encrypted = form.token.trim();

      const res = existing
        ? await api.PUT('/pac-providers/{id}', { params: { path: { id: existing.id } }, body: body as never })
        : await api.POST('/pac-providers', { body: body as never });
      if ((res as { error?: { error?: { message?: string } } }).error) {
        const err = (res as { error?: { error?: { message?: string } } }).error;
        throw new Error(err?.error?.message ?? 'Save failed');
      }
    },
    onSuccess: () => { onSaved(); onClose(); },
    onError: (err: Error) => setError(err.message),
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!form.label.trim() || !form.api_url.trim()) {
      setError('Label and API URL are required.');
      return;
    }
    if (form.provider_name === 'simulator' && form.environment !== 'sandbox') {
      setError("The simulator only runs with environment 'sandbox' — it never produces fiscally valid CFDIs.");
      return;
    }
    mutation.mutate();
  }

  const overlay: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 };
  const box: React.CSSProperties = { background: 'var(--bg-card, #fff)', borderRadius: 10, padding: '1.25rem 1.5rem', width: 520, maxWidth: '92vw', maxHeight: '88vh', overflowY: 'auto' };
  const label: React.CSSProperties = { display: 'block', fontSize: '0.8rem', fontWeight: 600, margin: '0.6rem 0 0.2rem' };
  const input: React.CSSProperties = { width: '100%', padding: '6px 8px', border: '1px solid var(--border-color, #d1d5db)', borderRadius: 6, background: 'var(--bg-primary, #fff)', color: 'inherit', fontSize: '0.85rem' };

  return (
    <div style={overlay} role="dialog" aria-modal="true" aria-label={existing ? 'Edit PAC provider' : 'New PAC provider'}>
      <div style={box}>
        <h3 style={{ margin: '0 0 0.75rem' }}>{existing ? `Edit PAC provider #${existing.id}` : 'New PAC provider'}</h3>
        {error && <p style={{ ...styles.msgError, textAlign: 'left' }}>{error}</p>}
        <form onSubmit={submit}>
          <label style={label} htmlFor="pac-provider">Provider <RequiredMark /></label>
          <select id="pac-provider" style={input} value={form.provider_name}
            onChange={e => { set('provider_name', e.target.value); applyPreset(e.target.value, form.environment); }}>
            {PROVIDERS.map(p => <option key={p} value={p}>{p.replace(/_/g, ' ')}</option>)}
          </select>

          <label style={label} htmlFor="pac-label">Label <RequiredMark /></label>
          <input id="pac-label" style={input} maxLength={100} placeholder="SW Sapien (sandbox)" value={form.label} onChange={e => set('label', e.target.value)} />

          <label style={label} htmlFor="pac-env">Environment <RequiredMark /></label>
          <select id="pac-env" style={input} value={form.environment}
            onChange={e => { set('environment', e.target.value); applyPreset(form.provider_name, e.target.value); }}>
            <option value="sandbox">sandbox</option>
            <option value="production">production</option>
          </select>

          <label style={label} htmlFor="pac-seal">Sealing</label>
          <select id="pac-seal" style={input} value={form.seal_mode} onChange={e => set('seal_mode', e.target.value)}>
            <option value="pac">PAC seals (Emisión — CSD in the PAC’s vault)</option>
            <option value="local">Local sealing (we seal, stamp-only tier)</option>
          </select>
          {form.seal_mode === 'local' && (
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: '4px 0 8px' }}>
              FireISP signs the invoice with the org’s active CSD (Facturación → Certificados CSD) and sends the
              sealed XML to the PAC’s stamp-only tier. Cancellations are signed with the same CSD sent inline
              per request (SW <code>cancel/csd</code>, Finkok cer/key), so the CSD never needs uploading to the
              PAC — it stays on your server. Supported for SW Sapien and Finkok.
            </p>
          )}

          <label style={label} htmlFor="pac-priority">Failover priority</label>
          <input id="pac-priority" style={input} type="number" min={0} max={1000} value={form.priority}
            onChange={e => set('priority', e.target.value)} />
          <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', margin: '2px 0 8px' }}>
            Lower is tried first. With two active PACs, stamping fails over to the next only when the
            primary is unreachable.
          </p>

          <label style={label} htmlFor="pac-url">API URL <RequiredMark /></label>
          <input id="pac-url" style={{ ...input, fontFamily: 'monospace' }} maxLength={500} value={form.api_url} onChange={e => set('api_url', e.target.value)} />

          <label style={label} htmlFor="pac-user">Username</label>
          <input id="pac-user" style={input} maxLength={500} autoComplete="off"
            placeholder={existing?.has_username ? 'saved — leave blank to keep' : ''}
            value={form.username} onChange={e => set('username', e.target.value)} />

          <label style={label} htmlFor="pac-pass">Password</label>
          <input id="pac-pass" type="password" style={input} maxLength={500} autoComplete="new-password"
            placeholder={existing?.has_password ? 'saved — leave blank to keep' : ''}
            value={form.password} onChange={e => set('password', e.target.value)} />

          <label style={label} htmlFor="pac-token">Access token</label>
          <input id="pac-token" type="password" style={input} maxLength={2000} autoComplete="off"
            placeholder={existing?.has_token ? 'saved — leave blank to keep' : 'alternative to username + password'}
            value={form.token} onChange={e => set('token', e.target.value)} />
          <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', margin: '2px 0 0' }}>
            Use EITHER an access token (SW portal “infinite token”) OR username + password.
          </p>

          <label style={label} htmlFor="pac-status">Status</label>
          <select id="pac-status" style={input} value={form.status} onChange={e => set('status', e.target.value)}>
            <option value="active">active</option>
            <option value="inactive">inactive</option>
          </select>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: '0.4rem 0 0' }}>
            Stamping uses the newest <strong>active</strong> provider for the organization.
          </p>

          <div style={{ display: 'flex', gap: 8, marginTop: '1.1rem', justifyContent: 'flex-end' }}>
            <button type="button" onClick={onClose} disabled={mutation.isPending}
              style={{ background: 'var(--bg-card)', color: 'var(--text-secondary)', border: '1px solid var(--border-strong, #d1d5db)', padding: '7px 18px', borderRadius: 6, cursor: 'pointer', fontWeight: 600, fontSize: '0.875rem' }}>
              Cancel
            </button>
            <button type="submit" disabled={mutation.isPending}
              style={{ background: 'var(--accent, #ea580c)', color: '#fff', border: 'none', padding: '7px 18px', borderRadius: 6, cursor: 'pointer', fontWeight: 600, fontSize: '0.875rem' }}>
              {mutation.isPending ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Fiscal environment switch — the single control that decides which PAC rows
// (sandbox vs production, each with its own credentials) actually stamp and
// cancel. Backed by /pac-providers/environment (org-scoped).
// ---------------------------------------------------------------------------

function FiscalEnvironmentBar() {
  const qc = useQueryClient();
  const [err, setErr] = useState<string | null>(null);

  const envQ = useQuery({
    queryKey: ['pac-environment'],
    queryFn: async () => {
      const res = await api.GET('/pac-providers/environment' as never);
      if ((res as { error?: unknown }).error) throw new Error('load failed');
      return ((res as { data: { data: { pac_environment: string } } }).data?.data?.pac_environment) ?? 'sandbox';
    },
  });

  const setEnv = useMutation({
    mutationFn: async (value: string) => {
      const res = await api.PUT('/pac-providers/environment' as never, { body: { pac_environment: value } as never } as never);
      const e = (res as { error?: { error?: { message?: string } } }).error;
      if (e) throw new Error(e.error?.message || 'Could not change the fiscal environment.');
    },
    onSuccess: () => { setErr(null); qc.invalidateQueries({ queryKey: ['pac-environment'] }); },
    onError: (e: unknown) => setErr(e instanceof Error ? e.message : 'Could not change the fiscal environment.'),
  });

  const env = envQ.data ?? 'sandbox';
  const isProd = env === 'production';

  function onSelect(value: string) {
    if (value === env) return;
    // Guard the jump to live SAT stamping behind an explicit confirmation.
    if (value === 'production' && !window.confirm(
      'Switch to PRODUCTION? CFDIs will be stamped against the real SAT with legal validity. '
      + 'Make sure your production PAC entries have real credentials and your active CSD is a real (non-test) certificate.',
    )) return;
    setEnv.mutate(value);
  }

  return (
    <div style={{ background: isProd ? '#fffbeb' : 'var(--bg-secondary, #f8fafc)', border: `1px solid ${isProd ? '#fde68a' : 'var(--border-color, #e2e8f0)'}`, borderRadius: 8, padding: '10px 14px', margin: '4px 0 12px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>Fiscal environment</span>
        <select
          value={env}
          disabled={envQ.isLoading || setEnv.isPending}
          onChange={e => onSelect(e.target.value)}
          style={{ padding: '6px 10px', border: '1px solid var(--border-color, #d1d5db)', borderRadius: 6, background: 'var(--bg-primary, #fff)', color: 'inherit', fontSize: '0.85rem', fontWeight: 600 }}
        >
          <option value="sandbox">Sandbox (testing)</option>
          <option value="production">Production (live SAT)</option>
        </select>
        <span style={{ fontSize: '0.8rem', color: isProd ? '#92400e' : 'var(--text-muted)' }}>
          {setEnv.isPending ? 'Saving…' : isProd
            ? 'Live: stamping real, legally-valid CFDIs against the SAT.'
            : 'Testing: CFDIs are not fiscally valid.'}
        </span>
      </div>
      <p style={{ margin: '8px 0 0', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
        Only providers whose <strong>Environment</strong> matches this setting stamp and cancel — lowest{' '}
        <strong>failover priority</strong> first, the rest as backups. Sandbox and production are separate entries
        with their own credentials, so a row in the other environment stays dormant until you switch here.
      </p>
      {err && <p style={{ margin: '6px 0 0', fontSize: '0.8rem', color: '#991b1b' }}>{err}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// PacProviderList component
// ---------------------------------------------------------------------------

export function PacProviderList() {
  const [page, setPage] = useState(1);
  const [modal, setModal] = useState<{ open: boolean; existing: PacProvider | null }>({ open: false, existing: null });
  const qc = useQueryClient();

  const providersQ = useQuery({
    queryKey: ['pac-providers', page],
    queryFn: () => fetchProviders(page),
  });

  const providers = providersQ.data?.data ?? [];
  const meta = providersQ.data?.meta;
  const totalPages = meta?.totalPages ?? 1;

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.pageTitle}>🧾 PAC Providers</h1>
        {meta && <span style={styles.countBadge}>{meta.total} total</span>}
        <button
          onClick={() => setModal({ open: true, existing: null })}
          style={{ marginLeft: 'auto', background: 'var(--accent, #ea580c)', color: '#fff', border: 'none', padding: '8px 16px', borderRadius: 6, cursor: 'pointer', fontWeight: 600, fontSize: '0.875rem' }}
        >
          + New provider
        </button>
      </div>

      <FiscalEnvironmentBar />

      <div style={styles.tableCard}>
        {providersQ.isLoading ? (
          <p style={styles.msg}>Loading…</p>
        ) : providersQ.error ? (
          <p style={styles.msgError}>Failed to load PAC providers.</p>
        ) : providers.length === 0 ? (
          <p style={styles.msg}>No PAC providers configured — add one to enable CFDI stamping.</p>
        ) : (
          <>
            <div style={{ overflowX: 'auto' }}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    {['ID', 'Provider', 'Label', 'Environment', 'API URL', 'Default', 'Status', 'Last Stamp', ''].map(
                      h => <th key={h} style={styles.th}>{h}</th>,
                    )}
                  </tr>
                </thead>
                <tbody>
                  {providers.map(p => (
                    <tr key={p.id} style={styles.tr}>
                      <td style={styles.td}>#{p.id}</td>
                      <td style={{ ...styles.td, fontWeight: 500, textTransform: 'capitalize' }}>
                        {p.provider_name?.replace(/_/g, ' ')}
                      </td>
                      <td style={styles.td}>{p.label ?? '—'}</td>
                      <td style={styles.td}><EnvBadge env={p.environment} /></td>
                      <td style={{ ...styles.td, maxWidth: 280, overflowWrap: 'anywhere', fontFamily: 'monospace', fontSize: '0.78rem' }}>
                        {p.api_url ?? '—'}
                      </td>
                      <td style={styles.td}>{p.is_default ? '⭐' : '—'}</td>
                      <td style={styles.td}><StatusBadge status={p.status} /></td>
                      <td style={{ ...styles.td, whiteSpace: 'nowrap' }}>{p.last_stamp_at ? fmtDate(p.last_stamp_at) : '—'}</td>
                      <td style={styles.td}>
                        <button
                          onClick={() => setModal({ open: true, existing: p })}
                          style={{ background: 'transparent', border: '1px solid var(--border-strong, #d1d5db)', borderRadius: 6, padding: '3px 12px', cursor: 'pointer', fontSize: '0.78rem', color: 'var(--text-secondary)' }}
                        >
                          Edit
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {totalPages > 1 && (
              <div style={styles.pagination}>
                <button style={styles.pageBtn} onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>
                  ← Prev
                </button>
                <span style={styles.pageInfo}>Page {page} of {totalPages}</span>
                <button
                  style={styles.pageBtn}
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                >
                  Next →
                </button>
              </div>
            )}
          </>
        )}
      </div>

      <p style={{ ...styles.msg, textAlign: 'left', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
        {capitalize('credentials are write-only: they are encrypted at rest and never shown again after saving.')}
      </p>

      {modal.open && (
        <PacModal
          existing={modal.existing}
          onClose={() => setModal({ open: false, existing: null })}
          onSaved={() => qc.invalidateQueries({ queryKey: ['pac-providers'] })}
        />
      )}
    </div>
  );
}
