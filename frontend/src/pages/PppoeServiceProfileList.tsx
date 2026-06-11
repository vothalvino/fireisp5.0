// =============================================================================
// FireISP 5.0 — PPPoE Service Profile Management
// =============================================================================
// Standalone page at /pppoe-service-profiles. Lists PPPoE service profiles with
// a status filter, paginated table, "New Profile" create modal, and per-row
// Edit and Delete (soft-delete).
// =============================================================================

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';
import { styles, modalStyles, RequiredMark, capitalize } from './crudStyles';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PppoeServiceProfile {
  id: number;
  name: string;
  service_name: string | null;
  mtu: number;
  mru: number;
  auth_methods: string;
  dns_primary: string | null;
  dns_secondary: string | null;
  session_timeout_seconds: number | null;
  idle_timeout_seconds: number | null;
  rate_limit_override: string | null;
  address_list: string | null;
  filter_id: string | null;
  ipv6cp_enabled: boolean;
  delegated_prefix_len: number | null;
  dns_primary_v6: string | null;
  dns_secondary_v6: string | null;
  nat64_enabled: boolean;
  dns64_prefix: string | null;
  status: string;
  notes: string | null;
}

interface ProfilesResponse {
  data: PppoeServiceProfile[];
  meta: { total: number; page: number; limit: number };
}

interface ProfileBody {
  name: string;
  service_name?: string;
  mtu?: number;
  mru?: number;
  auth_methods?: string;
  dns_primary?: string;
  dns_secondary?: string;
  session_timeout_seconds?: number;
  idle_timeout_seconds?: number;
  rate_limit_override?: string;
  address_list?: string;
  filter_id?: string;
  ipv6cp_enabled?: boolean;
  delegated_prefix_len?: number;
  dns_primary_v6?: string;
  dns_secondary_v6?: string;
  nat64_enabled?: boolean;
  dns64_prefix?: string;
  status?: string;
  notes?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PAGE_SIZE = 25;
const STATUSES = ['active', 'inactive'];

// ---------------------------------------------------------------------------
// Fetch / mutate helpers
// ---------------------------------------------------------------------------

async function fetchProfiles(page: number, statusFilter: string): Promise<ProfilesResponse> {
  const query: Record<string, string | number> = { page, limit: PAGE_SIZE };
  if (statusFilter) query.status = statusFilter;
  const res = await api.GET('/pppoe-service-profiles', { params: { query: query as never } });
  if (res.error) throw new Error('Failed to load profiles');
  return res.data as unknown as ProfilesResponse;
}

async function createProfile(body: ProfileBody): Promise<void> {
  const res = await api.POST('/pppoe-service-profiles', { body: body as never });
  if (res.error) throw new Error('Failed to create profile');
}

async function updateProfile(id: number, body: Partial<ProfileBody>): Promise<void> {
  const res = await api.PUT('/pppoe-service-profiles/{id}', { params: { path: { id } }, body: body as never });
  if (res.error) throw new Error('Failed to update profile');
}

async function deleteProfile(id: number): Promise<void> {
  const res = await api.DELETE('/pppoe-service-profiles/{id}', { params: { path: { id } } });
  if (res.error) throw new Error('Failed to delete profile');
}

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, { bg: string; color: string }> = {
    active: { bg: '#d1fae5', color: '#065f46' },
    inactive: { bg: '#fef3c7', color: '#92400e' },
  };
  const c = colors[status] ?? { bg: '#f3f4f6', color: '#374151' };
  return (
    <span style={{ background: c.bg, color: c.color, padding: '2px 8px', borderRadius: 12, fontSize: '0.72rem', fontWeight: 600, textTransform: 'capitalize' }}>
      {status}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Profile form modal
// ---------------------------------------------------------------------------

interface ProfileFormProps {
  initial: Partial<PppoeServiceProfile>;
  onSave: (body: ProfileBody) => void;
  onClose: () => void;
  saving: boolean;
  editMode: boolean;
}

function ProfileForm({ initial, onSave, onClose, saving, editMode }: ProfileFormProps) {
  const { t } = useTranslation();
  const [name, setName] = useState(initial.name ?? '');
  const [serviceName, setServiceName] = useState(initial.service_name ?? '');
  const [mtu, setMtu] = useState<string>(initial.mtu !== undefined ? String(initial.mtu) : '1492');
  const [mru, setMru] = useState<string>(initial.mru !== undefined ? String(initial.mru) : '1492');
  const [authMethods, setAuthMethods] = useState(initial.auth_methods ?? 'pap,chap,mschapv2');
  const [dnsPrimary, setDnsPrimary] = useState(initial.dns_primary ?? '');
  const [dnsSecondary, setDnsSecondary] = useState(initial.dns_secondary ?? '');
  const [sessionTimeout, setSessionTimeout] = useState<string>(
    initial.session_timeout_seconds !== null && initial.session_timeout_seconds !== undefined
      ? String(initial.session_timeout_seconds)
      : '',
  );
  const [idleTimeout, setIdleTimeout] = useState<string>(
    initial.idle_timeout_seconds !== null && initial.idle_timeout_seconds !== undefined
      ? String(initial.idle_timeout_seconds)
      : '',
  );
  const [rateLimitOverride, setRateLimitOverride] = useState(initial.rate_limit_override ?? '');
  const [addressList, setAddressList] = useState(initial.address_list ?? '');
  const [filterId, setFilterId] = useState(initial.filter_id ?? '');
  const [status, setStatus] = useState(initial.status ?? 'active');
  const [notes, setNotes] = useState(initial.notes ?? '');
  const [ipv6cpEnabled, setIpv6cpEnabled] = useState(initial.ipv6cp_enabled ?? false);
  const [delegatedPrefixLen, setDelegatedPrefixLen] = useState<string>(
    initial.delegated_prefix_len != null ? String(initial.delegated_prefix_len) : '',
  );
  const [dnsPrimaryV6, setDnsPrimaryV6] = useState(initial.dns_primary_v6 ?? '');
  const [dnsSecondaryV6, setDnsSecondaryV6] = useState(initial.dns_secondary_v6 ?? '');
  const [nat64Enabled, setNat64Enabled] = useState(initial.nat64_enabled ?? false);
  const [dns64Prefix, setDns64Prefix] = useState(initial.dns64_prefix ?? '');

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const body: ProfileBody = { name, status };
    if (serviceName) body.service_name = serviceName;
    if (mtu) body.mtu = Number(mtu);
    if (mru) body.mru = Number(mru);
    if (authMethods) body.auth_methods = authMethods;
    if (dnsPrimary) body.dns_primary = dnsPrimary;
    if (dnsSecondary) body.dns_secondary = dnsSecondary;
    if (sessionTimeout) body.session_timeout_seconds = Number(sessionTimeout);
    if (idleTimeout) body.idle_timeout_seconds = Number(idleTimeout);
    if (rateLimitOverride) body.rate_limit_override = rateLimitOverride;
    if (addressList) body.address_list = addressList;
    if (filterId) body.filter_id = filterId;
    if (notes) body.notes = notes;
    body.ipv6cp_enabled = ipv6cpEnabled;
    if (delegatedPrefixLen) body.delegated_prefix_len = Number(delegatedPrefixLen);
    if (dnsPrimaryV6) body.dns_primary_v6 = dnsPrimaryV6;
    if (dnsSecondaryV6) body.dns_secondary_v6 = dnsSecondaryV6;
    body.nat64_enabled = nat64Enabled;
    if (dns64Prefix) body.dns64_prefix = dns64Prefix;
    onSave(body);
  }

  const inp: React.CSSProperties = { ...modalStyles.input, width: '100%', boxSizing: 'border-box' as const };

  return (
    <div style={modalStyles.backdrop} onClick={onClose}>
      <div style={{ ...modalStyles.panel, maxWidth: 600 }} onClick={e => e.stopPropagation()}>
        <div style={modalStyles.header}>
          <h3 style={modalStyles.title}>{editMode ? t('pppoe_service_profiles.edit', 'Edit Profile') : t('pppoe_service_profiles.new', 'New Profile')}</h3>
          <button style={modalStyles.closeBtn} onClick={onClose} aria-label="Close">x</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: '0.75rem' }}>
            <label style={modalStyles.label}>{t('pppoe_service_profiles.name', 'Profile Name')}<RequiredMark /></label>
            <input style={inp} value={name} onChange={e => setName(e.target.value)} required />
          </div>

          <div style={{ marginBottom: '0.75rem' }}>
            <label style={modalStyles.label}>{t('pppoe_service_profiles.service_name', 'AC Service Name')}</label>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>
              {t('pppoe_service_profiles.service_name_hint', 'PPPoE Access Concentrator service name. Must match pppoe-service-name on the NAS. Leave blank to accept any.')}
            </div>
            <input style={inp} value={serviceName} onChange={e => setServiceName(e.target.value)} placeholder="e.g. ISP-PPPoE" />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
            <div>
              <label style={modalStyles.label}>{t('pppoe_service_profiles.mtu', 'MTU')}</label>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>
                {t('pppoe_service_profiles.mtu_hint', 'PPPoE over Ethernet ceiling is 1492.')}
              </div>
              <input style={inp} type="number" min={576} max={9000} value={mtu} onChange={e => setMtu(e.target.value)} />
            </div>
            <div>
              <label style={modalStyles.label}>{t('pppoe_service_profiles.mru', 'MRU')}</label>
              <input style={inp} type="number" min={576} max={9000} value={mru} onChange={e => setMru(e.target.value)} />
            </div>
          </div>

          <div style={{ marginBottom: '0.75rem' }}>
            <label style={modalStyles.label}>{t('pppoe_service_profiles.auth_methods', 'Auth Methods')}</label>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>
              {t('pppoe_service_profiles.auth_methods_hint', 'Comma-separated: pap,chap,mschapv2. Reference only — FreeRADIUS derives all three from Cleartext-Password.')}
            </div>
            <input style={inp} value={authMethods} onChange={e => setAuthMethods(e.target.value)} placeholder="pap,chap,mschapv2" />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
            <div>
              <label style={modalStyles.label}>{t('pppoe_service_profiles.dns_primary', 'Primary DNS')}</label>
              <input style={inp} value={dnsPrimary} onChange={e => setDnsPrimary(e.target.value)} placeholder="8.8.8.8" />
            </div>
            <div>
              <label style={modalStyles.label}>{t('pppoe_service_profiles.dns_secondary', 'Secondary DNS')}</label>
              <input style={inp} value={dnsSecondary} onChange={e => setDnsSecondary(e.target.value)} placeholder="8.8.4.4" />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
            <div>
              <label style={modalStyles.label}>{t('pppoe_service_profiles.session_timeout', 'Session Timeout (s)')}</label>
              <input style={inp} type="number" min={0} value={sessionTimeout} onChange={e => setSessionTimeout(e.target.value)} placeholder="Leave blank = plan default" />
            </div>
            <div>
              <label style={modalStyles.label}>{t('pppoe_service_profiles.idle_timeout', 'Idle Timeout (s)')}</label>
              <input style={inp} type="number" min={0} value={idleTimeout} onChange={e => setIdleTimeout(e.target.value)} placeholder="Leave blank = plan default" />
            </div>
          </div>

          <div style={{ marginBottom: '0.75rem' }}>
            <label style={modalStyles.label}>{t('pppoe_service_profiles.rate_limit_override', 'Rate Limit Override')}</label>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>
              {t('pppoe_service_profiles.rate_limit_override_hint', "Vendor rate-limit string (e.g. MikroTik: '10M/5M'). MikroTik-specific.")}
            </div>
            <input style={inp} value={rateLimitOverride} onChange={e => setRateLimitOverride(e.target.value)} placeholder="10M/5M" />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
            <div>
              <label style={modalStyles.label}>{t('pppoe_service_profiles.address_list', 'MikroTik Address List')}</label>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>
                {t('pppoe_service_profiles.address_list_hint', 'MikroTik firewall address-list name.')}
              </div>
              <input style={inp} value={addressList} onChange={e => setAddressList(e.target.value)} />
            </div>
            <div>
              <label style={modalStyles.label}>{t('pppoe_service_profiles.filter_id', 'Filter-Id')}</label>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>
                {t('pppoe_service_profiles.filter_id_hint', 'RFC 2865 Filter-Id for NAS firewall policy.')}
              </div>
              <input style={inp} value={filterId} onChange={e => setFilterId(e.target.value)} />
            </div>
          </div>

          <div style={{ marginBottom: '0.75rem' }}>
            <label style={modalStyles.label}>{t('pppoe_service_profiles.status', 'Status')}</label>
            <select style={inp} value={status} onChange={e => setStatus(e.target.value)}>
              {STATUSES.map(s => <option key={s} value={s}>{capitalize(s)}</option>)}
            </select>
          </div>

          <div style={{ marginBottom: '1rem' }}>
            <label style={modalStyles.label}>{t('pppoe_service_profiles.notes', 'Notes')}</label>
            <textarea style={{ ...inp, minHeight: 64, resize: 'vertical' as const }} value={notes} onChange={e => setNotes(e.target.value)} />
          </div>

          <div style={{ marginBottom: '0.75rem', borderTop: '1px solid var(--border)', paddingTop: '0.75rem' }}>
            <div style={{ fontWeight: 600, marginBottom: '0.5rem', fontSize: '0.85rem' }}>
              {t('pppoe_service_profiles.ipv6_section', 'IPv6 / Dual Stack')}
            </div>

            <label style={{ ...modalStyles.label, display: 'flex', alignItems: 'center', gap: 8, marginBottom: '0.5rem' }}>
              <input
                type="checkbox"
                checked={ipv6cpEnabled}
                onChange={e => setIpv6cpEnabled(e.target.checked)}
              />
              {t('pppoe_service_profiles.ipv6cp_enabled', 'Enable IPv6CP')}
            </label>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
              {t('pppoe_service_profiles.ipv6cp_enabled_hint', 'Negotiate IPv6 Control Protocol during PPPoE session establishment.')}
            </div>

            <div style={{ marginBottom: '0.75rem' }}>
              <label style={modalStyles.label}>{t('pppoe_service_profiles.delegated_prefix_len', 'Delegated Prefix Length')}</label>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>
                {t('pppoe_service_profiles.delegated_prefix_len_hint', 'DHCPv6-PD prefix length to delegate (e.g. 56, 60, 64). Requires IPv6CP enabled.')}
              </div>
              <input style={inp} type="number" min={48} max={128} value={delegatedPrefixLen} onChange={e => setDelegatedPrefixLen(e.target.value)} placeholder="e.g. 56" />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
              <div>
                <label style={modalStyles.label}>{t('pppoe_service_profiles.dns_primary_v6', 'Primary IPv6 DNS')}</label>
                <input style={inp} value={dnsPrimaryV6} onChange={e => setDnsPrimaryV6(e.target.value)} placeholder="2001:4860:4860::8888" />
              </div>
              <div>
                <label style={modalStyles.label}>{t('pppoe_service_profiles.dns_secondary_v6', 'Secondary IPv6 DNS')}</label>
                <input style={inp} value={dnsSecondaryV6} onChange={e => setDnsSecondaryV6(e.target.value)} placeholder="2001:4860:4860::8844" />
              </div>
            </div>

            <label style={{ ...modalStyles.label, display: 'flex', alignItems: 'center', gap: 8, marginBottom: '0.5rem' }}>
              <input
                type="checkbox"
                checked={nat64Enabled}
                onChange={e => setNat64Enabled(e.target.checked)}
              />
              {t('pppoe_service_profiles.nat64_enabled', 'Enable NAT64')}
            </label>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
              {t('pppoe_service_profiles.nat64_enabled_hint', 'Apply NAT64 translation for IPv6-only subscribers accessing IPv4 resources.')}
            </div>

            <div style={{ marginBottom: '0.75rem' }}>
              <label style={modalStyles.label}>{t('pppoe_service_profiles.dns64_prefix', 'DNS64 Prefix')}</label>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>
                {t('pppoe_service_profiles.dns64_prefix_hint', 'DNS64 synthesis prefix (e.g. 64:ff9b::/96). Configured on the DNS64 resolver, not sent via RADIUS.')}
              </div>
              <input style={inp} value={dns64Prefix} onChange={e => setDns64Prefix(e.target.value)} placeholder="64:ff9b::/96" />
            </div>
          </div>

          <div style={modalStyles.actions}>
            <button type="button" style={styles.btnSecondary} onClick={onClose}>Cancel</button>
            <button type="submit" style={styles.btnPrimary} disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page component
// ---------------------------------------------------------------------------

export function PppoeServiceProfileList() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('active');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<PppoeServiceProfile | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null);

  const profilesQ = useQuery({
    queryKey: ['pppoe-service-profiles', page, statusFilter],
    queryFn: () => fetchProfiles(page, statusFilter),
  });

  const profiles = profilesQ.data?.data ?? [];
  const meta = profilesQ.data?.meta;

  function showMsg(type: 'ok' | 'err', msg: string) {
    setFeedback({ type, msg });
    setTimeout(() => setFeedback(null), 4000);
  }

  const createMut = useMutation({
    mutationFn: createProfile,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pppoe-service-profiles'] });
      setShowForm(false);
      showMsg('ok', t('pppoe_service_profiles.create_success', 'Profile created.'));
    },
    onError: () => showMsg('err', t('pppoe_service_profiles.create_error', 'Failed to create profile.')),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, body }: { id: number; body: Partial<ProfileBody> }) => updateProfile(id, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pppoe-service-profiles'] });
      setEditing(null);
      showMsg('ok', t('pppoe_service_profiles.update_success', 'Profile updated.'));
    },
    onError: () => showMsg('err', t('pppoe_service_profiles.update_error', 'Failed to update profile.')),
  });

  const deleteMut = useMutation({
    mutationFn: deleteProfile,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pppoe-service-profiles'] });
      setDeleteConfirm(null);
      showMsg('ok', t('pppoe_service_profiles.delete_success', 'Profile deleted.'));
    },
    onError: () => showMsg('err', t('pppoe_service_profiles.delete_error', 'Failed to delete profile.')),
  });

  const totalPages = meta ? Math.ceil(meta.total / PAGE_SIZE) : 1;

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.pageTitle}>{t('pppoe_service_profiles.title', 'PPPoE Service Profiles')}</h1>
        {meta && <span style={styles.countBadge}>{meta.total} total</span>}
        <button style={{ ...styles.btnPrimary, marginLeft: 'auto' }} onClick={() => setShowForm(true)}>
          + {t('pppoe_service_profiles.new', 'New Profile')}
        </button>
      </div>

      {feedback && (
        <div style={{ padding: '0.6rem 1rem', borderRadius: 6, marginBottom: '1rem', background: feedback.type === 'ok' ? '#d1fae5' : '#fee2e2', color: feedback.type === 'ok' ? '#065f46' : '#991b1b', fontSize: '0.85rem' }}>
          {feedback.msg}
        </div>
      )}

      <div style={styles.filterRow}>
        <span style={styles.filterLabel}>Status:</span>
        <select style={styles.filterSelect} value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(1); }}>
          <option value="">All</option>
          {STATUSES.map(s => <option key={s} value={s}>{capitalize(s)}</option>)}
        </select>
      </div>

      <div style={styles.tableCard}>
        {profilesQ.isLoading ? (
          <p style={styles.msg}>Loading...</p>
        ) : profilesQ.error ? (
          <p style={styles.msgError}>{t('pppoe_service_profiles.error', 'Failed to load profiles.')}</p>
        ) : profiles.length === 0 ? (
          <p style={styles.msg}>{t('pppoe_service_profiles.empty', 'No PPPoE service profiles found.')}</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>Name</th>
                  <th style={styles.th}>AC Service Name</th>
                  <th style={styles.th}>MTU/MRU</th>
                  <th style={styles.th}>DNS</th>
                  <th style={styles.th}>Auth Methods</th>
                  <th style={styles.th}>Status</th>
                  <th style={styles.th}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {profiles.map(p => (
                  <tr key={p.id} style={styles.tr}>
                    <td style={styles.td}><strong>{p.name}</strong></td>
                    <td style={styles.tdMono}>{p.service_name ?? '—'}</td>
                    <td style={styles.td}>{p.mtu}/{p.mru}</td>
                    <td style={styles.td}>
                      {p.dns_primary ? (
                        <span style={{ fontSize: '0.8rem' }}>{p.dns_primary}{p.dns_secondary ? `, ${p.dns_secondary}` : ''}</span>
                      ) : '—'}
                    </td>
                    <td style={styles.tdMono}>{p.auth_methods}</td>
                    <td style={styles.td}><StatusBadge status={p.status} /></td>
                    <td style={styles.td}>
                      <button style={{ ...styles.btnSecondary, fontSize: '0.78rem', padding: '0.25rem 0.6rem', marginRight: 4 }} onClick={() => setEditing(p)}>Edit</button>
                      <button style={{ ...styles.btnDanger, fontSize: '0.78rem', padding: '0.25rem 0.6rem' }} onClick={() => setDeleteConfirm(p.id)}>Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {totalPages > 1 && (
        <div style={styles.pagination}>
          <button style={styles.pageBtn} disabled={page <= 1} onClick={() => setPage(p => p - 1)}>&larr; Prev</button>
          <span style={styles.pageInfo}>Page {page} of {totalPages}</span>
          <button style={styles.pageBtn} disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>Next &rarr;</button>
        </div>
      )}

      {showForm && (
        <ProfileForm
          initial={{}}
          onSave={body => createMut.mutate(body)}
          onClose={() => setShowForm(false)}
          saving={createMut.isPending}
          editMode={false}
        />
      )}

      {editing && (
        <ProfileForm
          initial={editing}
          onSave={body => updateMut.mutate({ id: editing.id, body })}
          onClose={() => setEditing(null)}
          saving={updateMut.isPending}
          editMode={true}
        />
      )}

      {deleteConfirm !== null && (
        <div style={modalStyles.backdrop} onClick={() => setDeleteConfirm(null)}>
          <div style={{ ...modalStyles.panel, maxWidth: 380 }} onClick={e => e.stopPropagation()}>
            <p style={{ marginBottom: '1.5rem' }}>{t('pppoe_service_profiles.delete_confirm', 'Delete this service profile?')}</p>
            <div style={modalStyles.actions}>
              <button style={styles.btnSecondary} onClick={() => setDeleteConfirm(null)}>Cancel</button>
              <button style={styles.btnDanger} onClick={() => deleteMut.mutate(deleteConfirm)} disabled={deleteMut.isPending}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
