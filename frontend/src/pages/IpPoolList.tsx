// =============================================================================
// FireISP 5.0 — IP Pool Management
// =============================================================================
// Standalone page at /ip-pools. Lists IP address pools with a status filter,
// paginated table, and "New Pool" create modal plus per-row Edit and Delete
// (soft-delete). All mutations go through the typed `api` client + React Query,
// invalidating the ['ip-pools'] query so the list refreshes automatically.
// =============================================================================

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';
import { styles, modalStyles, RequiredMark, capitalize } from './crudStyles';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface IpPool {
  id: number;
  name: string;
  network: string;
  subnet_mask: string | null;
  gateway: string | null;
  ip_version: string | null;
  dns_primary: string | null;
  dns_secondary: string | null;
  pool_type: string | null;
  site_id: number | null;
  notes: string | null;
  status: string;
  nas_id: number | null;
  service_type: string | null;
  default_prefix_len: number | null;
  excluded_ranges: string | null;
  dhcpv6_mode: string | null;
  ra_enabled: boolean | null;
  ra_managed_flag: boolean | null;
  ra_other_flag: boolean | null;
  ra_lifetime_seconds: number | null;
  slaac_prefix: string | null;
  region_name: string | null;
  last_alerted_threshold: number | null;
  utilization?: { assigned: number; total_usable: number; percent_used: number } | null;
}

interface IpPoolsResponse {
  data: IpPool[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

interface SiteOption {
  id: number;
  name: string;
}

interface NasOption {
  id: number;
  name: string;
  ip_address: string;
}

interface IpPoolBody {
  name: string;
  network: string;
  subnet_mask?: string;
  gateway?: string;
  ip_version?: string;
  dns_primary?: string;
  dns_secondary?: string;
  pool_type?: string;
  site_id?: number;
  notes?: string;
  status?: string;
  nas_id?: number;
  service_type?: string;
  default_prefix_len?: number;
  excluded_ranges?: string;
  dhcpv6_mode?: string;
  ra_enabled?: boolean;
  ra_managed_flag?: boolean;
  ra_other_flag?: boolean;
  ra_lifetime_seconds?: number;
  slaac_prefix?: string;
  region_name?: string;
}

interface PoolUtilizationRow {
  pool_id: number;
  pool_name: string;
  network: string;
  ip_version: string;
  total_usable: number;
  assigned: number;
  available: number;
  percent_used: number;
  by_type: { static: number; dynamic: number; reserved: number };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_PAGE_SIZE = 25;
const IP_VERSIONS = ['4', '6'];
const STATUSES = ['active', 'inactive'];
const STATUS_FILTER_OPTIONS = ['', ...STATUSES];
const SERVICE_TYPES = ['residential', 'business', 'corporate', 'government', 'mixed'];
const PREFIX_LENGTHS = [48, 56, 64];
const DHCPV6_MODES = ['stateful', 'stateless', 'slaac'];

// ---------------------------------------------------------------------------
// Fetch / mutate helpers
// ---------------------------------------------------------------------------

async function fetchIpPools(page: number, statusFilter: string): Promise<IpPoolsResponse> {
  const query: Record<string, string | number> = { page, limit: DEFAULT_PAGE_SIZE };
  if (statusFilter) query.status = statusFilter;
  const res = await api.GET('/ip-pools', { params: { query: query as never } });
  if (res.error) throw new Error('Failed to load IP pools');
  return res.data as unknown as IpPoolsResponse;
}

async function fetchSiteOptions(): Promise<SiteOption[]> {
  const res = await api.GET('/sites', { params: { query: { limit: 500 } as never } });
  if (res.error) throw new Error('Failed to load sites');
  return (res.data as unknown as { data: SiteOption[] }).data;
}

async function fetchNasOptions(): Promise<NasOption[]> {
  const res = await api.GET('/nas', { params: { query: { limit: 500 } as never } });
  if (res.error) throw new Error('Failed to load NAS options');
  return (res.data as unknown as { data: NasOption[] }).data;
}

async function createIpPool(body: IpPoolBody): Promise<void> {
  const res = await api.POST('/ip-pools', { body: body as never });
  if (res.error) throw new Error('Failed to create IP pool');
}

async function updateIpPool(id: number, body: Partial<IpPoolBody>): Promise<void> {
  const res = await api.PUT('/ip-pools/{id}', { params: { path: { id } }, body: body as never });
  if (res.error) throw new Error('Failed to update IP pool');
}

async function deleteIpPool(id: number): Promise<void> {
  const res = await api.DELETE('/ip-pools/{id}', { params: { path: { id } } });
  if (res.error) throw new Error('Failed to delete IP pool');
}

// ---------------------------------------------------------------------------
// Utilization bar
// ---------------------------------------------------------------------------

function UtilizationBar({ percent }: { percent: number | null | undefined }) {
  if (percent == null) {
    return <span style={{ color: 'var(--text-faint)', fontSize: '0.75rem' }}>—</span>;
  }
  const color = percent >= 90 ? '#dc2626' : percent >= 75 ? '#f59e0b' : '#16a34a';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{ width: 80, height: 8, background: '#e5e7eb', borderRadius: 4, overflow: 'hidden' }}>
        <div style={{ width: `${Math.min(100, percent)}%`, height: '100%', background: color, borderRadius: 4 }} />
      </div>
      <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{percent}%</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; color: string }> = {
    active: { bg: '#d1fae5', color: '#065f46' },
    inactive: { bg: '#fef3c7', color: '#92400e' },
  };
  const badge = map[status] ?? { bg: '#f3f4f6', color: '#374151' };
  return (
    <span
      style={{
        background: badge.bg,
        color: badge.color,
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

// ---------------------------------------------------------------------------
// IP Pool form modal (create + edit)
// ---------------------------------------------------------------------------

interface IpPoolModalProps {
  pool: IpPool | null;
  sites: SiteOption[];
  nas: NasOption[];
  onClose: () => void;
  onSaved: () => void;
}

function IpPoolModal({ pool, sites, nas, onClose, onSaved }: IpPoolModalProps) {
  const { t } = useTranslation();
  const isEdit = pool !== null;
  const [form, setForm] = useState({
    name: pool?.name ?? '',
    network: pool?.network ?? '',
    subnet_mask: pool?.subnet_mask ?? '',
    gateway: pool?.gateway ?? '',
    ip_version: pool?.ip_version ?? '4',
    dns_primary: pool?.dns_primary ?? '',
    dns_secondary: pool?.dns_secondary ?? '',
    pool_type: pool?.pool_type ?? '',
    site_id: pool?.site_id != null ? String(pool.site_id) : '',
    notes: pool?.notes ?? '',
    status: pool?.status ?? 'active',
    nas_id: pool?.nas_id != null ? String(pool.nas_id) : '',
    service_type: pool?.service_type ?? '',
    default_prefix_len: pool?.default_prefix_len != null ? String(pool.default_prefix_len) : '',
    excluded_ranges: pool?.excluded_ranges ?? '',
    dhcpv6_mode: pool?.dhcpv6_mode ?? '',
    ra_enabled: pool?.ra_enabled ?? false,
    ra_managed_flag: pool?.ra_managed_flag ?? false,
    ra_other_flag: pool?.ra_other_flag ?? false,
    ra_lifetime_seconds: pool?.ra_lifetime_seconds != null ? String(pool.ra_lifetime_seconds) : '1800',
    slaac_prefix: pool?.slaac_prefix ?? '',
    region_name: pool?.region_name ?? '',
  });
  const [error, setError] = useState('');

  function setField(name: string, value: unknown) {
    setForm(prev => ({ ...prev, [name]: value }));
  }

  const mutation = useMutation({
    mutationFn: () => {
      const body: IpPoolBody = {
        name: form.name.trim(),
        network: form.network.trim(),
        ip_version: form.ip_version,
        status: form.status,
      };
      if (form.subnet_mask) body.subnet_mask = form.subnet_mask.trim();
      if (form.gateway) body.gateway = form.gateway.trim();
      if (form.dns_primary) body.dns_primary = form.dns_primary.trim();
      if (form.dns_secondary) body.dns_secondary = form.dns_secondary.trim();
      if (form.pool_type) body.pool_type = form.pool_type.trim();
      if (form.site_id) body.site_id = Number(form.site_id);
      if (form.notes) body.notes = form.notes;
      if (form.nas_id) body.nas_id = Number(form.nas_id);
      if (form.service_type) body.service_type = form.service_type;
      if (form.default_prefix_len && form.ip_version === '6') {
        body.default_prefix_len = Number(form.default_prefix_len);
      }
      if (form.excluded_ranges.trim()) body.excluded_ranges = form.excluded_ranges.trim();
      if (form.ip_version === '6') {
        if (form.dhcpv6_mode) body.dhcpv6_mode = form.dhcpv6_mode;
        body.ra_enabled = form.ra_enabled;
        body.ra_managed_flag = form.ra_managed_flag;
        body.ra_other_flag = form.ra_other_flag;
        if (form.ra_lifetime_seconds) body.ra_lifetime_seconds = Number(form.ra_lifetime_seconds);
        if (form.slaac_prefix.trim()) body.slaac_prefix = form.slaac_prefix.trim();
      }
      if (form.region_name.trim()) body.region_name = form.region_name.trim();
      return isEdit ? updateIpPool(pool.id, body) : createIpPool(body);
    },
    onSuccess: () => {
      onSaved();
      onClose();
    },
    onError: () => setError('Failed to save IP pool. Check all fields and try again.'),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim() || !form.network.trim()) {
      setError('Name and network address are required.');
      return;
    }
    setError('');
    mutation.mutate();
  }

  return (
    <div style={modalStyles.backdrop} onClick={onClose}>
      <div
        style={modalStyles.panel}
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={isEdit ? `Edit IP pool ${pool.name}` : 'New IP pool'}
      >
        <div style={modalStyles.header}>
          <h2 style={modalStyles.title}>{isEdit ? `📝 Edit IP Pool #${pool.id}` : '🌐 New IP Pool'}</h2>
          <button style={modalStyles.closeBtn} onClick={onClose} aria-label="Close">✕</button>
        </div>

        <form onSubmit={handleSubmit} style={modalStyles.form}>
          <label style={modalStyles.label}>
            Name <RequiredMark />
            <input
              style={modalStyles.input}
              type="text"
              maxLength={255}
              value={form.name}
              onChange={e => setField('name', e.target.value)}
              required
            />
          </label>

          <label style={modalStyles.label}>
            IP Version
            <select
              style={modalStyles.select}
              value={form.ip_version}
              onChange={e => setField('ip_version', e.target.value)}
            >
              {IP_VERSIONS.map(v => <option key={v} value={v}>IPv{v}</option>)}
            </select>
          </label>

          <label style={modalStyles.label}>
            Network <RequiredMark />
            <input
              style={modalStyles.input}
              type="text"
              maxLength={45}
              value={form.network}
              onChange={e => setField('network', e.target.value)}
              placeholder="e.g. 10.0.0.0"
              required
            />
          </label>

          <label style={modalStyles.label}>
            Subnet Mask
            <input
              style={modalStyles.input}
              type="text"
              maxLength={45}
              value={form.subnet_mask}
              onChange={e => setField('subnet_mask', e.target.value)}
              placeholder="e.g. 255.255.255.0"
            />
          </label>

          <label style={modalStyles.label}>
            Gateway
            <input
              style={modalStyles.input}
              type="text"
              maxLength={45}
              value={form.gateway}
              onChange={e => setField('gateway', e.target.value)}
            />
          </label>

          <label style={modalStyles.label}>
            Primary DNS
            <input
              style={modalStyles.input}
              type="text"
              maxLength={45}
              value={form.dns_primary}
              onChange={e => setField('dns_primary', e.target.value)}
            />
          </label>

          <label style={modalStyles.label}>
            Secondary DNS
            <input
              style={modalStyles.input}
              type="text"
              maxLength={45}
              value={form.dns_secondary}
              onChange={e => setField('dns_secondary', e.target.value)}
            />
          </label>

          <label style={modalStyles.label}>
            Pool Type
            <input
              style={modalStyles.input}
              type="text"
              maxLength={50}
              value={form.pool_type}
              onChange={e => setField('pool_type', e.target.value)}
              placeholder="e.g. dynamic, static"
            />
          </label>

          <label style={modalStyles.label}>
            Site
            <select
              style={modalStyles.select}
              value={form.site_id}
              onChange={e => setField('site_id', e.target.value)}
            >
              <option value="">— None —</option>
              {sites.map(site => <option key={site.id} value={site.id}>{site.name}</option>)}
            </select>
          </label>

          <label style={modalStyles.label}>
            {t('ip_pools.nas_label')}
            <select
              style={modalStyles.select}
              value={form.nas_id}
              onChange={e => setField('nas_id', e.target.value)}
            >
              <option value="">— None —</option>
              {nas.map(n => <option key={n.id} value={n.id}>{n.name} ({n.ip_address})</option>)}
            </select>
          </label>

          <label style={modalStyles.label}>
            {t('ip_pools.service_type_label')}
            <select
              style={modalStyles.select}
              value={form.service_type}
              onChange={e => setField('service_type', e.target.value)}
            >
              <option value="">— None —</option>
              {SERVICE_TYPES.map(st => (
                <option key={st} value={st}>
                  {t(`ip_pools.service_types.${st}`)}
                </option>
              ))}
            </select>
          </label>

          {form.ip_version === '6' && (
            <>
              <label style={modalStyles.label}>
                {t('ip_pools.default_prefix_len_label')}
                <select
                  style={modalStyles.select}
                  value={form.default_prefix_len}
                  onChange={e => setField('default_prefix_len', e.target.value)}
                >
                  <option value="">— None —</option>
                  {PREFIX_LENGTHS.map(pl => (
                    <option key={pl} value={pl}>/{pl}</option>
                  ))}
                </select>
              </label>
              <label style={modalStyles.label}>
                {t('ip_pools.dhcpv6_mode_label')}
                <select
                  style={modalStyles.select}
                  value={form.dhcpv6_mode}
                  onChange={e => setField('dhcpv6_mode', e.target.value)}
                >
                  <option value="">— None —</option>
                  {DHCPV6_MODES.map(m => (
                    <option key={m} value={m}>{t(`ip_pools.dhcpv6_modes.${m}`)}</option>
                  ))}
                </select>
              </label>
              <label style={modalStyles.label}>
                {t('ip_pools.slaac_prefix_label')}
                <input
                  style={modalStyles.input}
                  type="text"
                  maxLength={50}
                  value={form.slaac_prefix}
                  onChange={e => setField('slaac_prefix', e.target.value)}
                  placeholder="e.g. 2001:db8::/32"
                />
              </label>
              <label style={modalStyles.label}>
                RA Lifetime (s)
                <input
                  style={modalStyles.input}
                  type="number"
                  min={0}
                  max={65535}
                  value={form.ra_lifetime_seconds}
                  onChange={e => setField('ra_lifetime_seconds', e.target.value)}
                />
              </label>
              <label style={{ ...modalStyles.label, display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="checkbox"
                  checked={Boolean(form.ra_enabled)}
                  onChange={e => setField('ra_enabled', e.target.checked)}
                />
                {t('ip_pools.ra_enabled_label')}
              </label>
              <label style={{ ...modalStyles.label, display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="checkbox"
                  checked={Boolean(form.ra_managed_flag)}
                  onChange={e => setField('ra_managed_flag', e.target.checked)}
                />
                {t('ip_pools.ra_managed_flag_label')}
              </label>
              <label style={{ ...modalStyles.label, display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="checkbox"
                  checked={Boolean(form.ra_other_flag)}
                  onChange={e => setField('ra_other_flag', e.target.checked)}
                />
                {t('ip_pools.ra_other_flag_label')}
              </label>
            </>
          )}

          <label style={modalStyles.label}>
            {t('ip_pools.region_name_label')}
            <input
              style={modalStyles.input}
              type="text"
              maxLength={100}
              value={form.region_name}
              onChange={e => setField('region_name', e.target.value)}
              placeholder="e.g. North"
            />
          </label>

          <label style={modalStyles.label}>
            {t('ip_pools.excluded_ranges_label')}
            <textarea
              style={{ ...modalStyles.input, minHeight: 60, resize: 'vertical' }}
              value={form.excluded_ranges}
              onChange={e => setField('excluded_ranges', e.target.value)}
              placeholder="e.g. 10.0.0.1-10.0.0.10"
            />
          </label>

          <label style={modalStyles.label}>
            Status
            <select
              style={modalStyles.select}
              value={form.status}
              onChange={e => setField('status', e.target.value)}
            >
              {STATUSES.map(st => <option key={st} value={st}>{capitalize(st)}</option>)}
            </select>
          </label>

          <label style={modalStyles.label}>
            Notes
            <textarea
              style={{ ...modalStyles.input, minHeight: 60, resize: 'vertical' }}
              maxLength={5000}
              value={form.notes}
              onChange={e => setField('notes', e.target.value)}
            />
          </label>

          {error && <p style={modalStyles.error}>{error}</p>}

          <div style={modalStyles.actions}>
            <button type="button" onClick={onClose} style={styles.btnSecondary} disabled={mutation.isPending}>
              Cancel
            </button>
            <button type="submit" style={styles.btnPrimary} disabled={mutation.isPending}>
              {mutation.isPending ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Pool'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Confirm dialog
// ---------------------------------------------------------------------------

interface ConfirmDialogProps {
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}

function ConfirmDialog({ message, onConfirm, onCancel }: ConfirmDialogProps) {
  return (
    <div style={modalStyles.backdrop} onClick={onCancel}>
      <div
        style={{ ...modalStyles.panel, maxWidth: 380 }}
        onClick={e => e.stopPropagation()}
        role="alertdialog"
        aria-label="Confirm action"
      >
        <p style={{ margin: '0 0 1.25rem', fontSize: '0.95rem', color: 'var(--text-primary)' }}>{message}</p>
        <div style={modalStyles.actions}>
          <button onClick={onCancel} style={styles.btnSecondary}>No, go back</button>
          <button onClick={onConfirm} style={styles.btnDanger}>Yes, confirm</button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// IpPoolList component
// ---------------------------------------------------------------------------

export function IpPoolList() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [editPool, setEditPool] = useState<IpPool | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);

  const poolsQ = useQuery({
    queryKey: ['ip-pools', page, statusFilter],
    queryFn: () => fetchIpPools(page, statusFilter),
  });

  const sitesQ = useQuery({
    queryKey: ['sites', 'options'],
    queryFn: fetchSiteOptions,
  });

  const nasQ = useQuery({
    queryKey: ['nas', 'options'],
    queryFn: fetchNasOptions,
  });

  const utilQ = useQuery({
    queryKey: ['ip-pools-utilization'],
    queryFn: async () => {
      const res = await api.GET('/ip-pools/utilization' as never, {} as never);
      if (res.error) return [];
      return (res.data as unknown as { data: PoolUtilizationRow[] }).data;
    },
    staleTime: 60_000,
  });

  const utilMap = new Map((utilQ.data ?? []).map(u => [u.pool_id, u]));

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteIpPool(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['ip-pools'] }),
  });

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ['ip-pools'] });
  }

  function handleFilterChange(value: string) {
    setStatusFilter(value);
    setPage(1);
  }

  const pools = poolsQ.data?.data ?? [];
  const meta = poolsQ.data?.meta;
  const sites = sitesQ.data ?? [];
  const nasOptions = nasQ.data ?? [];
  const siteName = (id: number | null) =>
    id == null ? '—' : sites.find(site => site.id === id)?.name ?? `#${id}`;

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.pageTitle}>🌐 IP Pools</h1>
        {meta && <span style={styles.countBadge}>{meta.total} total</span>}
        <button style={{ ...styles.btnPrimary, marginLeft: 'auto' }} onClick={() => setShowNew(true)}>
          + New Pool
        </button>
      </div>

      <div style={styles.filterRow}>
        <label style={styles.filterLabel}>Status:</label>
        <select
          style={styles.filterSelect}
          value={statusFilter}
          onChange={e => handleFilterChange(e.target.value)}
        >
          {STATUS_FILTER_OPTIONS.map(st => (
            <option key={st} value={st}>{st ? capitalize(st) : 'All'}</option>
          ))}
        </select>
        {statusFilter && (
          <button type="button" style={styles.btnSecondary} onClick={() => handleFilterChange('')}>
            Clear filter
          </button>
        )}
      </div>

      {deleteMutation.isError && (
        <p style={{ color: '#ef4444', marginBottom: '0.75rem', fontSize: '0.85rem' }}>
          Action failed. Please try again.
        </p>
      )}

      <div style={styles.tableCard}>
        {poolsQ.isLoading ? (
          <p style={styles.msg}>Loading…</p>
        ) : poolsQ.error ? (
          <p style={styles.msgError}>Failed to load IP pools.</p>
        ) : pools.length === 0 ? (
          <p style={styles.msg}>No IP pools found{statusFilter ? ` with status "${statusFilter}"` : ''}.</p>
        ) : (
          <>
            <div style={{ overflowX: 'auto' }}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    {['ID', 'Name', 'Network', 'Version', 'Gateway', 'Site', 'Status', t('ip_pools.utilization_column'), 'Actions'].map(
                      h => <th key={h} style={styles.th}>{h}</th>,
                    )}
                  </tr>
                </thead>
                <tbody>
                  {pools.map(p => {
                    const util = utilMap.get(p.id);
                    return (
                      <tr key={p.id} style={styles.tr}>
                        <td style={styles.td}>#{p.id}</td>
                        <td style={{ ...styles.td, fontWeight: 500 }}>{p.name}</td>
                        <td style={styles.td}>{p.network}</td>
                        <td style={styles.td}>{p.ip_version ? `IPv${p.ip_version}` : '—'}</td>
                        <td style={styles.td}>{p.gateway ?? '—'}</td>
                        <td style={styles.td}>{siteName(p.site_id)}</td>
                        <td style={styles.td}><StatusBadge status={p.status} /></td>
                        <td style={styles.td}>
                          <UtilizationBar percent={util?.percent_used ?? null} />
                        </td>
                        <td style={{ ...styles.td, whiteSpace: 'nowrap' }}>
                          <button style={styles.actionBtn} onClick={() => setEditPool(p)} title="Edit this pool">
                            ✏️ Edit
                          </button>
                          <button
                            style={{ ...styles.actionBtn, color: '#991b1b' }}
                            onClick={() => setDeleteId(p.id)}
                            title="Delete this pool"
                          >
                            🗑 Delete
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {meta && meta.totalPages > 1 && (
              <div style={styles.pagination}>
                <button style={styles.pageBtn} onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>
                  ← Prev
                </button>
                <span style={styles.pageInfo}>Page {page} of {meta.totalPages}</span>
                <button
                  style={styles.pageBtn}
                  onClick={() => setPage(p => Math.min(meta.totalPages, p + 1))}
                  disabled={page === meta.totalPages}
                >
                  Next →
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {showNew && (
        <IpPoolModal pool={null} sites={sites} nas={nasOptions} onClose={() => setShowNew(false)} onSaved={invalidate} />
      )}
      {editPool && (
        <IpPoolModal pool={editPool} sites={sites} nas={nasOptions} onClose={() => setEditPool(null)} onSaved={invalidate} />
      )}

      {deleteId !== null && (
        <ConfirmDialog
          message="Delete this IP pool? It will be soft-deleted and removed from the list."
          onConfirm={() => {
            deleteMutation.mutate(deleteId);
            setDeleteId(null);
          }}
          onCancel={() => setDeleteId(null)}
        />
      )}
    </div>
  );
}
