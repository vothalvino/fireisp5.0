// =============================================================================
// FireISP 5.0 — Organization Detail (tabbed)
// =============================================================================
// Admin page at /organizations/:id. Consolidates what used to be per-row
// modals on /organizations into tabs — Edit, Settings, Quota — and adds a
// Mail tab for per-function outbound email identities (migration 407):
// general / support / billing / noc, each with its own from-address and
// optional SMTP override. An unconfigured function inherits general, then the
// global SMTP config, at send time.
// =============================================================================

import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';
import { styles, RequiredMark, capitalize } from './crudStyles';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Organization {
  id: number;
  name: string;
  legal_name: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip_code: string | null;
  country: string | null;
  currency: string | null;
  locale: string | null;
  tax_id: string | null;
  logo_url: string | null;
  status: string | null;
}

interface EmailIdentity {
  organization_id: number;
  email_function: string;
  enabled: boolean;
  smtp_host: string | null;
  smtp_port: number;
  smtp_secure: boolean;
  smtp_user: string | null;
  from_email: string | null;
  from_name: string | null;
  configured: boolean;
  has_password: boolean;
  last_test_at: string | null;
  last_test_status: string | null;
  last_test_error: string | null;
}

interface QuotaResponse {
  limits: { max_clients: number | null; max_devices: number | null; max_storage_mb: number | null; max_scheduled_tasks: number | null } | null;
  usage: { clients: number; devices: number; storage_mb: number; scheduled_tasks: number };
}

const LOCALES = ['global', 'MX'];
const STATUSES = ['active', 'inactive'];
const EMAIL_FUNCTIONS = ['general', 'support', 'billing', 'noc'];
const QUOTA_FIELDS: { key: keyof NonNullable<QuotaResponse['limits']>; usageKey: keyof QuotaResponse['usage'] }[] = [
  { key: 'max_clients', usageKey: 'clients' },
  { key: 'max_devices', usageKey: 'devices' },
  { key: 'max_storage_mb', usageKey: 'storage_mb' },
  { key: 'max_scheduled_tasks', usageKey: 'scheduled_tasks' },
];

type TabId = 'edit' | 'settings' | 'quota' | 'mail' | 'fiscal';

// ---------------------------------------------------------------------------
// Shared field styles
// ---------------------------------------------------------------------------

const label = { display: 'block', fontSize: '0.8rem', fontWeight: 600 as const, margin: '0.6rem 0 0.2rem' };
const input = { width: '100%', maxWidth: 440, padding: '6px 8px', border: '1px solid var(--border-color, #d1d5db)', borderRadius: 6, background: 'var(--bg-primary, #fff)', color: 'inherit', fontSize: '0.85rem' };

// ---------------------------------------------------------------------------
// Edit tab
// ---------------------------------------------------------------------------

function EditTab({ org }: { org: Organization }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [form, setForm] = useState({
    name: org.name ?? '', legal_name: org.legal_name ?? '', email: org.email ?? '', phone: org.phone ?? '',
    website: org.website ?? '', address: org.address ?? '', city: org.city ?? '', state: org.state ?? '',
    zip_code: org.zip_code ?? '', country: org.country ?? '', currency: org.currency ?? 'MXN',
    locale: org.locale ?? 'global', tax_id: org.tax_id ?? '', logo_url: org.logo_url ?? '', status: org.status ?? 'active',
  });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  const save = useMutation({
    mutationFn: async () => {
      const body: Record<string, string> = { name: form.name.trim(), locale: form.locale, status: form.status };
      const cur = form.currency.trim().toUpperCase();
      if (cur.length === 3) body.currency = cur;
      for (const k of ['legal_name', 'email', 'phone', 'website', 'address', 'city', 'state', 'zip_code', 'country', 'tax_id', 'logo_url'] as const) {
        const v = (form as Record<string, string>)[k].trim();
        if (v) body[k] = v;
      }
      const res = await api.PUT('/organizations/{id}', { params: { path: { id: org.id } }, body: body as never });
      if (res.error) throw new Error('save failed');
    },
    onSuccess: () => { setMsg({ ok: true, text: t('orgDetail.saved') }); qc.invalidateQueries({ queryKey: ['organization', org.id] }); },
    onError: () => setMsg({ ok: false, text: t('orgDetail.saveError') }),
  });

  const field = (key: keyof typeof form, labelKey: string, req = false, max = 255, type = 'text') => (
    <label style={label}>{t(labelKey)} {req && <RequiredMark />}
      <input style={input} type={type} maxLength={max} value={form[key]} onChange={e => set(key, key === 'currency' ? e.target.value.toUpperCase() : e.target.value)} />
    </label>
  );

  return (
    <div>
      {field('name', 'orgDetail.name', true)}
      {field('legal_name', 'orgDetail.legalName')}
      {field('email', 'orgDetail.email', false, 255, 'email')}
      {field('phone', 'orgDetail.phone', false, 30)}
      {field('website', 'orgDetail.website')}
      {field('tax_id', 'orgDetail.taxId', false, 50)}
      {field('address', 'orgDetail.address')}
      {field('city', 'orgDetail.city', false, 100)}
      {field('state', 'orgDetail.state', false, 100)}
      {field('zip_code', 'orgDetail.zip', false, 20)}
      {field('country', 'orgDetail.country', false, 100)}
      {field('currency', 'orgDetail.currency', true, 3)}
      {field('logo_url', 'orgDetail.logoUrl', false, 500)}
      <label style={label}>{t('orgDetail.locale')} <RequiredMark />
        <select style={input} value={form.locale} onChange={e => set('locale', e.target.value)}>
          {LOCALES.map(l => <option key={l} value={l}>{l === 'MX' ? 'Mexico (MX)' : capitalize(l)}</option>)}
        </select>
      </label>
      <label style={label}>{t('orgDetail.status')} <RequiredMark />
        <select style={input} value={form.status} onChange={e => set('status', e.target.value)}>
          {STATUSES.map(s => <option key={s} value={s}>{capitalize(s)}</option>)}
        </select>
      </label>
      <div style={{ marginTop: '1rem' }}>
        <button style={styles.btnPrimary} onClick={() => { setMsg(null); save.mutate(); }} disabled={save.isPending || !form.name.trim()}>
          {save.isPending ? t('common.saving') : t('common.save')}
        </button>
      </div>
      {msg && <p style={{ ...styles.msg, color: msg.ok ? '#065f46' : '#991b1b' }}>{msg.text}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Settings tab
// ---------------------------------------------------------------------------

function SettingsTab({ id }: { id: number }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [form, setForm] = useState<Record<string, string>>({});
  const [loaded, setLoaded] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const q = useQuery({
    queryKey: ['organization-settings', id],
    queryFn: async () => {
      const res = await api.GET('/organizations/{id}/settings', { params: { path: { id } } });
      if (res.error) throw new Error('load failed');
      return ((res.data as unknown as { data: Record<string, string> }).data) ?? {};
    },
  });

  useEffect(() => {
    if (q.data && !loaded) {
      const seed: Record<string, string> = {};
      for (const [k, v] of Object.entries(q.data)) seed[k] = v == null ? '' : String(v);
      setForm(seed);
      setLoaded(true);
    }
  }, [q.data, loaded]);

  const original = q.data ?? {};
  const keys = Object.keys(original);

  const save = useMutation({
    mutationFn: async () => {
      for (const k of keys) {
        const next = form[k] ?? '';
        if (next !== (original[k] == null ? '' : String(original[k]))) {
          const res = await api.PUT('/organizations/{id}/settings/{key}', { params: { path: { id, key: k } }, body: { value: next } as never });
          if (res.error) throw new Error('save failed');
        }
      }
    },
    onSuccess: () => { setMsg({ ok: true, text: t('orgDetail.saved') }); qc.invalidateQueries({ queryKey: ['organization-settings', id] }); },
    onError: () => setMsg({ ok: false, text: t('orgDetail.saveError') }),
  });

  if (q.isLoading) return <p style={styles.msg}>{t('common.loading')}</p>;
  if (q.error) return <p style={styles.msgError}>{t('orgDetail.settingsLoadError')}</p>;
  if (keys.length === 0) return <p style={styles.msg}>{t('orgDetail.noSettings')}</p>;

  return (
    <div>
      {keys.map(k => (
        <label key={k} style={label}>{k}
          <input style={input} type="text" value={form[k] ?? ''} onChange={e => setForm(prev => ({ ...prev, [k]: e.target.value }))} />
        </label>
      ))}
      <div style={{ marginTop: '1rem' }}>
        <button style={styles.btnPrimary} onClick={() => { setMsg(null); save.mutate(); }} disabled={save.isPending}>
          {save.isPending ? t('common.saving') : t('common.save')}
        </button>
      </div>
      {msg && <p style={{ ...styles.msg, color: msg.ok ? '#065f46' : '#991b1b' }}>{msg.text}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Quota tab
// ---------------------------------------------------------------------------

function QuotaTab({ id }: { id: number }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [form, setForm] = useState<Record<string, string>>({});
  const [loaded, setLoaded] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const q = useQuery({
    queryKey: ['organization-quota', id],
    queryFn: async () => {
      const res = await api.GET('/organizations/{id}/quota', { params: { path: { id } } });
      if (res.error) throw new Error('load failed');
      return (res.data as unknown as { data: QuotaResponse }).data;
    },
  });

  useEffect(() => {
    if (q.data && !loaded) {
      const lim = q.data.limits;
      setForm({
        max_clients: lim?.max_clients != null ? String(lim.max_clients) : '',
        max_devices: lim?.max_devices != null ? String(lim.max_devices) : '',
        max_storage_mb: lim?.max_storage_mb != null ? String(lim.max_storage_mb) : '',
        max_scheduled_tasks: lim?.max_scheduled_tasks != null ? String(lim.max_scheduled_tasks) : '',
      });
      setLoaded(true);
    }
  }, [q.data, loaded]);

  const save = useMutation({
    mutationFn: async () => {
      const body: Record<string, number | null> = {};
      for (const f of QUOTA_FIELDS) {
        const raw = (form[f.key] ?? '').trim();
        body[f.key] = raw === '' ? null : Number(raw);
      }
      const res = await api.PUT('/organizations/{id}/quota', { params: { path: { id } }, body: body as never });
      if (res.error) throw new Error('save failed');
    },
    onSuccess: () => { setMsg({ ok: true, text: t('orgDetail.saved') }); qc.invalidateQueries({ queryKey: ['organization-quota', id] }); },
    onError: () => setMsg({ ok: false, text: t('orgDetail.quotaError') }),
  });

  function submit() {
    for (const f of QUOTA_FIELDS) {
      const raw = (form[f.key] ?? '').trim();
      if (raw !== '' && !/^\d+$/.test(raw)) { setMsg({ ok: false, text: t('orgDetail.quotaError') }); return; }
    }
    setMsg(null);
    save.mutate();
  }

  if (q.isLoading) return <p style={styles.msg}>{t('common.loading')}</p>;
  if (q.error) return <p style={styles.msgError}>{t('orgDetail.quotaLoadError')}</p>;
  const usage = q.data?.usage;

  return (
    <div>
      <p style={{ ...styles.msg, fontSize: '0.82rem' }}>{t('orgDetail.quotaHint')}</p>
      {QUOTA_FIELDS.map(f => (
        <label key={f.key} style={label}>
          {t(`orgDetail.quota_${f.key}`)}{' '}
          <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>({t('orgDetail.inUse')}: {usage ? usage[f.usageKey] : '—'})</span>
          <input style={input} type="number" min={0} step={1} value={form[f.key] ?? ''} placeholder={t('orgDetail.unlimited')}
            onChange={e => setForm(prev => ({ ...prev, [f.key]: e.target.value }))} />
        </label>
      ))}
      <div style={{ marginTop: '1rem' }}>
        <button style={styles.btnPrimary} onClick={submit} disabled={save.isPending}>
          {save.isPending ? t('common.saving') : t('common.save')}
        </button>
      </div>
      {msg && <p style={{ ...styles.msg, color: msg.ok ? '#065f46' : '#991b1b' }}>{msg.text}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Mail tab — per-function identities
// ---------------------------------------------------------------------------

function StatusPill({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return <span style={{ background: ok ? '#d1fae5' : '#f3f4f6', color: ok ? '#065f46' : '#374151', padding: '1px 8px', borderRadius: 10, fontSize: '0.72rem', fontWeight: 600 }}>{children}</span>;
}

function IdentityEditor({ id, identity }: { id: number; identity: EmailIdentity }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const fn = identity.email_function;
  const [form, setForm] = useState({
    enabled: identity.enabled,
    smtp_host: identity.smtp_host ?? '',
    smtp_port: String(identity.smtp_port ?? 587),
    smtp_secure: identity.smtp_secure,
    smtp_user: identity.smtp_user ?? '',
    smtp_password: '',
    from_email: identity.from_email ?? '',
    from_name: identity.from_name ?? '',
  });
  const [testTo, setTestTo] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const set = (k: string, v: string | boolean) => setForm(f => ({ ...f, [k]: v }));

  const save = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = {
        enabled: form.enabled,
        smtp_host: form.smtp_host || null,
        // The port field is always pre-filled and never meaningfully "blank";
        // a cleared field means "reset to default", not "keep existing", so
        // send 587 rather than undefined (which the model reads as keep).
        smtp_port: form.smtp_port ? Number(form.smtp_port) : 587,
        smtp_secure: form.smtp_secure,
        smtp_user: form.smtp_user || null,
        from_email: form.from_email || null,
        from_name: form.from_name || null,
      };
      if (form.smtp_password) body.smtp_password = form.smtp_password;
      const res = await api.PUT('/organizations/{id}/email-settings/{function}', { params: { path: { id, function: fn as 'general' | 'support' | 'billing' | 'noc' } }, body: body as never });
      if (res.error) throw new Error('save failed');
    },
    onSuccess: () => { setMsg({ ok: true, text: t('orgDetail.saved') }); setForm(f => ({ ...f, smtp_password: '' })); qc.invalidateQueries({ queryKey: ['org-email-identities', id] }); },
    onError: () => setMsg({ ok: false, text: t('orgDetail.saveError') }),
  });

  const test = useMutation({
    mutationFn: async (): Promise<{ success: boolean; error?: string }> => {
      const res = await api.POST('/organizations/{id}/email-settings/{function}/test', { params: { path: { id, function: fn as 'general' | 'support' | 'billing' | 'noc' } }, body: { to: testTo.trim() } as never });
      if (res.error) throw new Error('test request failed');
      return (res.data as unknown as { data: { success: boolean; error?: string } }).data;
    },
    onSuccess: (r) => { setMsg(r.success ? { ok: true, text: t('orgDetail.mailTestOk') } : { ok: false, text: t('orgDetail.mailTestFail', { error: r.error ?? '' }) }); qc.invalidateQueries({ queryKey: ['org-email-identities', id] }); },
    onError: () => setMsg({ ok: false, text: t('orgDetail.mailTestFail', { error: '' }) }),
  });

  return (
    <div style={{ padding: '0.5rem 0 1rem' }}>
      <p style={{ ...styles.msg, fontSize: '0.8rem', margin: '0 0 0.5rem' }}>{t(`orgDetail.mailFn_${fn}_hint`)}</p>
      <label style={{ ...label, display: 'flex', alignItems: 'center', gap: 8 }}>
        <input type="checkbox" checked={form.enabled} onChange={e => set('enabled', e.target.checked)} /> {t('orgDetail.mailEnabled')}
      </label>
      <label style={label}>{t('orgDetail.fromName')}<input style={input} value={form.from_name} onChange={e => set('from_name', e.target.value)} placeholder={`${capitalize(fn)} Team`} /></label>
      <label style={label}>{t('orgDetail.fromEmail')}<input style={input} type="email" value={form.from_email} onChange={e => set('from_email', e.target.value)} placeholder={`${fn}@isp.example`} /></label>
      <label style={label}>{t('orgDetail.smtpHost')}<input style={input} value={form.smtp_host} onChange={e => set('smtp_host', e.target.value)} placeholder="smtp.example.com" /></label>
      <label style={label}>{t('orgDetail.smtpPort')}<input style={input} type="number" min={1} max={65535} value={form.smtp_port} onChange={e => set('smtp_port', e.target.value)} /></label>
      <label style={{ ...label, display: 'flex', alignItems: 'center', gap: 8 }}>
        <input type="checkbox" checked={form.smtp_secure} onChange={e => set('smtp_secure', e.target.checked)} /> {t('orgDetail.smtpSecure')}
      </label>
      <label style={label}>{t('orgDetail.smtpUser')}<input style={input} value={form.smtp_user} onChange={e => set('smtp_user', e.target.value)} autoComplete="off" /></label>
      <label style={label}>{t('orgDetail.smtpPassword')}
        <input style={input} type="password" value={form.smtp_password} autoComplete="new-password"
          placeholder={identity.has_password ? t('orgDetail.secretSaved') : ''} onChange={e => set('smtp_password', e.target.value)} />
      </label>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: '0.8rem', flexWrap: 'wrap' }}>
        <button style={styles.btnPrimary} onClick={() => { setMsg(null); save.mutate(); }} disabled={save.isPending}>
          {save.isPending ? t('common.saving') : t('common.save')}
        </button>
        <input style={{ ...input, maxWidth: 220 }} type="email" value={testTo} placeholder={t('orgDetail.testTo')} onChange={e => setTestTo(e.target.value)} />
        <button style={styles.btnSecondary} onClick={() => { setMsg(null); test.mutate(); }} disabled={test.isPending || !testTo.trim()}>
          {test.isPending ? t('orgDetail.testing') : t('orgDetail.sendTest')}
        </button>
      </div>
      {msg && <p style={{ ...styles.msg, color: msg.ok ? '#065f46' : '#991b1b' }}>{msg.text}</p>}
    </div>
  );
}

function MailTab({ id }: { id: number }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState<string | null>(null);

  const q = useQuery({
    queryKey: ['org-email-identities', id],
    queryFn: async () => {
      const res = await api.GET('/organizations/{id}/email-settings', { params: { path: { id } } });
      if (res.error) throw new Error('load failed');
      return (res.data as unknown as { data: EmailIdentity[] }).data;
    },
  });

  if (q.isLoading) return <p style={styles.msg}>{t('common.loading')}</p>;
  if (q.error) return <p style={styles.msgError}>{t('orgDetail.mailLoadError')}</p>;

  const byFn: Record<string, EmailIdentity> = {};
  for (const idn of q.data ?? []) byFn[idn.email_function] = idn;

  return (
    <div>
      <p style={{ ...styles.msg, fontSize: '0.85rem', maxWidth: 720 }}>{t('orgDetail.mailIntro')}</p>
      {EMAIL_FUNCTIONS.map(fn => {
        const idn = byFn[fn];
        if (!idn) return null;
        const isOpen = open === fn;
        return (
          <div key={fn} style={{ border: '1px solid var(--border-color, #e5e7eb)', borderRadius: 8, marginBottom: 8 }}>
            <button
              onClick={() => setOpen(isOpen ? null : fn)}
              style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: 'transparent', border: 'none', cursor: 'pointer', color: 'inherit', textAlign: 'left' }}
            >
              <span style={{ fontWeight: 600, textTransform: 'capitalize', minWidth: 80 }}>{t(`orgDetail.mailFn_${fn}`)}</span>
              <StatusPill ok={idn.configured && idn.enabled}>{idn.configured ? (idn.enabled ? t('orgDetail.mailConfigured') : t('orgDetail.mailDisabled')) : t('orgDetail.mailInherits')}</StatusPill>
              {idn.from_email && <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>{idn.from_email}</span>}
              {idn.last_test_status && <StatusPill ok={idn.last_test_status === 'success'}>{idn.last_test_status}</StatusPill>}
              <span style={{ marginLeft: 'auto' }}>{isOpen ? '▲' : '▼'}</span>
            </button>
            {isOpen && <div style={{ padding: '0 14px', borderTop: '1px solid var(--border-color, #e5e7eb)' }}><IdentityEditor id={id} identity={idn} /></div>}
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Fiscal (SAT) tab — the org's emisor identity for CFDI 4.0
// ---------------------------------------------------------------------------
// Only rendered for MX-locale orgs (gated on the VIEWED org's locale, not the
// caller's active org). CSD certificates and PAC credentials deliberately live
// on their own pages (/csd-certificates, /pac-providers) — this tab is the
// taxpayer identity that cfdiService stamps into every CFDI as cfdi:Emisor.

interface OrgMxProfile {
  rfc: string;
  razon_social: string;
  regimen_fiscal: string;
  codigo_postal_fiscal: string;
  colonia: string | null;
  municipio: string | null;
  exterior_number: string | null;
  interior_number: string | null;
  cfdi_serie_ingreso: string;
  cfdi_serie_egreso: string;
  cfdi_serie_pago: string;
  cfdi_folio_next: number;
}

function FiscalTab({ id }: { id: number }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [form, setForm] = useState<Record<string, string>>({});
  const [loaded, setLoaded] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const q = useQuery({
    queryKey: ['organization-mx-profile', id],
    queryFn: async () => {
      const res = await api.GET('/organizations/{id}/mx-profile' as never, { params: { path: { id } } } as never);
      if ((res as { error?: unknown }).error) throw new Error('load failed');
      return ((res as { data: { data: OrgMxProfile | null } }).data?.data) ?? null;
    },
  });

  // Régimen fiscal from the seeded SAT catalog; degrade to a free-text code
  // input if the caller lacks cfdi_documents.view.
  const regimenQ = useQuery({
    queryKey: ['sat-regimen-fiscal'],
    queryFn: async () => {
      const res = await api.GET('/sat-catalogs/regimen-fiscal' as never);
      if ((res as { error?: unknown }).error) return [] as { code: string; description: string }[];
      return ((res as { data: { data: { code: string; description: string }[] } }).data?.data) ?? [];
    },
  });

  useEffect(() => {
    if (q.data !== undefined && !loaded) {
      const p = q.data;
      setForm({
        rfc: p?.rfc ?? '', razon_social: p?.razon_social ?? '',
        regimen_fiscal: p?.regimen_fiscal ?? '', codigo_postal_fiscal: p?.codigo_postal_fiscal ?? '',
        colonia: p?.colonia ?? '', municipio: p?.municipio ?? '',
        exterior_number: p?.exterior_number ?? '', interior_number: p?.interior_number ?? '',
        cfdi_serie_ingreso: p?.cfdi_serie_ingreso ?? 'A',
        cfdi_serie_egreso: p?.cfdi_serie_egreso ?? 'E',
        cfdi_serie_pago: p?.cfdi_serie_pago ?? 'P',
      });
      setLoaded(true);
    }
  }, [q.data, loaded]);

  const save = useMutation({
    mutationFn: async () => {
      const body: Record<string, string> = {
        rfc: form.rfc.trim().toUpperCase(),
        razon_social: form.razon_social.trim(),
        regimen_fiscal: form.regimen_fiscal.trim(),
        codigo_postal_fiscal: form.codigo_postal_fiscal.trim(),
      };
      // Address fields are ALWAYS sent: the backend treats a present-but-empty
      // value as "clear to NULL" and an omitted key as "leave unchanged" — so
      // clearing an input genuinely clears the stored value.
      for (const k of ['colonia', 'municipio', 'exterior_number', 'interior_number']) {
        body[k] = (form[k] ?? '').trim();
      }
      // Serie columns are NOT NULL — only send a replacement value.
      for (const k of ['cfdi_serie_ingreso', 'cfdi_serie_egreso', 'cfdi_serie_pago']) {
        const v = (form[k] ?? '').trim();
        if (v) body[k] = v;
      }
      const res = await api.PUT('/organizations/{id}/mx-profile' as never, { params: { path: { id } }, body: body as never } as never);
      if ((res as { error?: unknown }).error) throw new Error('save failed');
    },
    onSuccess: () => {
      setMsg({ ok: true, text: t('orgDetail.saved') });
      // Re-sync the form from the persisted row (a blank serie input is a
      // no-op server-side — without this it would stay blank while the DB
      // kept its value, a false confirmation).
      setLoaded(false);
      qc.invalidateQueries({ queryKey: ['organization-mx-profile', id] });
    },
    onError: () => setMsg({ ok: false, text: t('orgDetail.fiscalError') }),
  });

  function submit() {
    if (!/^[A-ZÑ&0-9]{12,13}$/i.test(form.rfc?.trim() ?? '')) { setMsg({ ok: false, text: t('orgDetail.fiscalRfcInvalid') }); return; }
    if (!(form.razon_social ?? '').trim() || !/^\d{3}$/.test(form.regimen_fiscal ?? '') || !/^\d{5}$/.test(form.codigo_postal_fiscal ?? '')) {
      setMsg({ ok: false, text: t('orgDetail.fiscalIncomplete') }); return;
    }
    setMsg(null);
    save.mutate();
  }

  if (q.isLoading) return <p style={styles.msg}>{t('common.loading')}</p>;
  if (q.error) return <p style={styles.msgError}>{t('orgDetail.fiscalLoadError')}</p>;

  const regimenes = regimenQ.data ?? [];
  return (
    <div style={{ maxWidth: 560 }}>
      <p style={{ ...styles.msg, fontSize: '0.82rem' }}>{t('orgDetail.fiscalHint')}</p>
      <label style={label}>{t('orgDetail.fiscalRfc')} <RequiredMark />
        <input style={input} maxLength={13} value={form.rfc ?? ''} placeholder="EKU9003173C9"
          onChange={e => setForm(p => ({ ...p, rfc: e.target.value.toUpperCase() }))} />
      </label>
      <label style={label}>{t('orgDetail.fiscalRazonSocial')} <RequiredMark />
        <input style={input} maxLength={300} value={form.razon_social ?? ''}
          onChange={e => setForm(p => ({ ...p, razon_social: e.target.value }))} />
      </label>
      <label style={label}>{t('orgDetail.fiscalRegimen')} <RequiredMark />
        {regimenes.length > 0 ? (
          <select style={input} value={form.regimen_fiscal ?? ''} onChange={e => setForm(p => ({ ...p, regimen_fiscal: e.target.value }))}>
            <option value="">—</option>
            {/* Keep a stored code visible even when it's absent from the
                fetched catalog — otherwise the select silently shows blank
                while saving the stale value. */}
            {form.regimen_fiscal && !regimenes.some(r => r.code === form.regimen_fiscal) && (
              <option value={form.regimen_fiscal}>{form.regimen_fiscal} — ?</option>
            )}
            {regimenes.map(r => <option key={r.code} value={r.code}>{r.code} — {r.description}</option>)}
          </select>
        ) : (
          <input style={input} maxLength={3} placeholder="601" value={form.regimen_fiscal ?? ''}
            onChange={e => setForm(p => ({ ...p, regimen_fiscal: e.target.value }))} />
        )}
      </label>
      <label style={label}>{t('orgDetail.fiscalCp')} <RequiredMark />
        <input style={input} maxLength={5} placeholder="26015" value={form.codigo_postal_fiscal ?? ''}
          onChange={e => setForm(p => ({ ...p, codigo_postal_fiscal: e.target.value }))} />
      </label>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 12px' }}>
        <label style={label}>{t('orgDetail.fiscalColonia')}
          <input style={input} maxLength={150} value={form.colonia ?? ''} onChange={e => setForm(p => ({ ...p, colonia: e.target.value }))} />
        </label>
        <label style={label}>{t('orgDetail.fiscalMunicipio')}
          <input style={input} maxLength={150} value={form.municipio ?? ''} onChange={e => setForm(p => ({ ...p, municipio: e.target.value }))} />
        </label>
        <label style={label}>{t('orgDetail.fiscalExterior')}
          <input style={input} maxLength={20} value={form.exterior_number ?? ''} onChange={e => setForm(p => ({ ...p, exterior_number: e.target.value }))} />
        </label>
        <label style={label}>{t('orgDetail.fiscalInterior')}
          <input style={input} maxLength={20} value={form.interior_number ?? ''} onChange={e => setForm(p => ({ ...p, interior_number: e.target.value }))} />
        </label>
      </div>
      <p style={{ ...styles.msg, fontSize: '0.82rem', marginTop: '0.75rem' }}>{t('orgDetail.fiscalSeriesHint')}</p>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0 12px' }}>
        <label style={label}>{t('orgDetail.fiscalSerieIngreso')}
          <input style={input} maxLength={10} value={form.cfdi_serie_ingreso ?? ''} onChange={e => setForm(p => ({ ...p, cfdi_serie_ingreso: e.target.value }))} />
        </label>
        <label style={label}>{t('orgDetail.fiscalSerieEgreso')}
          <input style={input} maxLength={10} value={form.cfdi_serie_egreso ?? ''} onChange={e => setForm(p => ({ ...p, cfdi_serie_egreso: e.target.value }))} />
        </label>
        <label style={label}>{t('orgDetail.fiscalSeriePago')}
          <input style={input} maxLength={10} value={form.cfdi_serie_pago ?? ''} onChange={e => setForm(p => ({ ...p, cfdi_serie_pago: e.target.value }))} />
        </label>
      </div>
      <p style={{ ...styles.msg, fontSize: '0.8rem' }}>
        {t('orgDetail.fiscalCsdPacHint')}{' '}
        <Link to="/csd-certificates" style={{ color: 'var(--accent)' }}>{t('orgDetail.fiscalCsdLink')}</Link>
        {' · '}
        <Link to="/pac-providers" style={{ color: 'var(--accent)' }}>{t('orgDetail.fiscalPacLink')}</Link>
      </p>
      <div style={{ marginTop: '1rem' }}>
        <button style={styles.btnPrimary} onClick={submit} disabled={save.isPending}>
          {save.isPending ? t('common.saving') : t('common.save')}
        </button>
      </div>
      {msg && <p style={{ ...styles.msg, color: msg.ok ? '#065f46' : '#991b1b' }}>{msg.text}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// OrganizationDetail
// ---------------------------------------------------------------------------

export function OrganizationDetail() {
  const { t } = useTranslation();
  const { id: idParam } = useParams<{ id: string }>();
  const id = Number(idParam);
  const [tab, setTab] = useState<TabId>('edit');

  const orgQ = useQuery({
    queryKey: ['organization', id],
    queryFn: async () => {
      const res = await api.GET('/organizations/{id}', { params: { path: { id } } });
      if (res.error) throw new Error('load failed');
      return (res.data as unknown as { data: Organization }).data;
    },
    enabled: Number.isFinite(id),
  });

  const TABS: { id: TabId; labelKey: string }[] = [
    { id: 'edit', labelKey: 'orgDetail.tabEdit' },
    { id: 'settings', labelKey: 'orgDetail.tabSettings' },
    { id: 'quota', labelKey: 'orgDetail.tabQuota' },
    { id: 'mail', labelKey: 'orgDetail.tabMail' },
    // Fiscal identity only applies to MX-locale orgs — gate on the VIEWED
    // org's locale (the backend 404s REGION_DISABLED for global orgs anyway).
    ...(orgQ.data?.locale === 'MX' ? [{ id: 'fiscal' as TabId, labelKey: 'orgDetail.tabFiscal' }] : []),
  ];

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <Link to="/organizations" style={{ ...styles.btnSecondary, textDecoration: 'none' }}>← {t('orgDetail.back')}</Link>
        <h1 style={{ ...styles.pageTitle, marginLeft: 8 }}>
          🏢 {orgQ.data ? orgQ.data.name : `#${id}`}
        </h1>
      </div>

      {orgQ.isLoading ? (
        <p style={styles.msg}>{t('common.loading')}</p>
      ) : orgQ.error || !orgQ.data ? (
        <p style={styles.msgError}>{t('orgDetail.loadError')}</p>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--border-color, #e5e7eb)', marginBottom: '1rem', flexWrap: 'wrap' }}>
            {TABS.map(tb => (
              <button key={tb.id} onClick={() => setTab(tb.id)}
                style={{
                  padding: '8px 16px', border: 'none', cursor: 'pointer', fontSize: '0.9rem', fontWeight: 600,
                  background: 'transparent', color: tab === tb.id ? 'var(--accent)' : 'var(--text-secondary)',
                  borderBottom: tab === tb.id ? '2px solid var(--accent)' : '2px solid transparent',
                }}>
                {t(tb.labelKey)}
              </button>
            ))}
          </div>

          <div style={styles.tableCard ? { ...styles.tableCard, padding: '1rem 1.25rem' } : undefined}>
            {tab === 'edit' && <EditTab org={orgQ.data} />}
            {tab === 'settings' && <SettingsTab id={id} />}
            {tab === 'quota' && <QuotaTab id={id} />}
            {tab === 'mail' && <MailTab id={id} />}
            {tab === 'fiscal' && orgQ.data.locale === 'MX' && <FiscalTab id={id} />}
          </div>
        </>
      )}
    </div>
  );
}
