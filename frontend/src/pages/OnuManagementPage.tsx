// =============================================================================
// FireISP 5.0 — ONU Management (§7.2)
// =============================================================================
// Tabbed page covering:
//   1. ONU Details      — provisioned ONUs, optical diagnostics, reboot
//   2. ONU Profiles     — T-CONT/GEM/VLAN line/service profile templates
//   3. Whitelist        — pre-authorized serial/LOID entries
//   4. OMCI Configs     — Wi-Fi + WAN config delivery records
//   5. Firmware Jobs    — upgrade scheduling and status
// =============================================================================

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';
import { styles, modalStyles, RequiredMark, capitalize } from './crudStyles';

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

interface PaginatedMeta { total: number; page: number; limit: number }

interface OnuDetail {
  id: number;
  device_id: number;
  device_name?: string;
  olt_device_id: number;
  olt_name?: string;
  olt_port_id: number | null;
  port_name?: string;
  onu_profile_id: number | null;
  onu_profile_name?: string;
  serial_number: string | null;
  loid: string | null;
  onu_state: string;
  onu_id: number | null;
  ranging_distance_m: number | null;
  wan_mode: string | null;
  line_profile_name: string | null;
  service_profile_name: string | null;
  last_status_at: string | null;
  last_provision_job_id: number | null;
}

interface OnuProfile {
  id: number;
  name: string;
  technology: string;
  tcont_id: number | null;
  dba_profile_name: string | null;
  assured_bw_kbps: number | null;
  max_bw_kbps: number | null;
  gem_port_id: number | null;
  service_vlan: number | null;
  client_vlan: number | null;
  vlan_mode: string;
  plan_id: number | null;
}

interface WhitelistEntry {
  id: number;
  olt_device_id: number;
  olt_name?: string;
  entry_type: string;
  entry_value: string;
  description: string | null;
  status: string;
}

interface OmciConfig {
  id: number;
  device_id: number;
  device_name?: string;
  wifi_ssid: string | null;
  wifi_band: string | null;
  wan_mode: string | null;
  delivery_method: string;
  apply_status: string;
}

interface FirmwareJob {
  id: number;
  job_type: string;
  scope: string;
  status: string;
  firmware_version: string | null;
  total_devices: number;
  completed_devices: number;
  failed_devices: number;
  created_at: string;
  scheduled_at: string | null;
}

interface OpticalMetric {
  id: number;
  tx_power_dbm: number | null;
  rx_power_dbm: number | null;
  temperature_c: number | null;
  voltage_v: number | null;
  bias_current_ma: number | null;
  olt_rx_power_dbm: number | null;
  polled_at: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PAGE_SIZE = 25;
const ONU_STATES = ['online', 'offline', 'los', 'dying_gasp', 'power_off', 'loc', 'unconfigured', 'unknown'];
const TECHNOLOGIES = ['gpon', 'epon', 'xgspon'];
const VLAN_MODES = ['tagged', 'untagged', 'transparent'];
const WIFI_BANDS = ['2.4GHz', '5GHz', 'both'];
const DELIVERY_METHODS = ['omci', 'tr069', 'manual'];
const JOB_TYPES = ['provision', 'reboot', 'firmware_upgrade'];
const SCOPES = ['single_onu', 'olt_port', 'full_olt'];
const JOB_STATUSES = ['pending', 'queued', 'in_progress', 'completed', 'failed', 'cancelled'];

// ---------------------------------------------------------------------------
// Tab button style
// ---------------------------------------------------------------------------

const tabBtn = (active: boolean): React.CSSProperties => ({
  padding: '0.4rem 1rem',
  border: 'none',
  borderBottom: active ? '2px solid var(--primary)' : '2px solid transparent',
  background: 'transparent',
  cursor: 'pointer',
  fontWeight: active ? 700 : 400,
  color: active ? 'var(--primary)' : 'var(--text-secondary)',
});

// ---------------------------------------------------------------------------
// ONU state badge
// ---------------------------------------------------------------------------

function OnuStateBadge({ state }: { state: string }) {
  const map: Record<string, { bg: string; color: string }> = {
    online:       { bg: '#d1fae5', color: '#065f46' },
    offline:      { bg: '#f3f4f6', color: '#374151' },
    los:          { bg: '#fee2e2', color: '#991b1b' },
    dying_gasp:   { bg: '#fef3c7', color: '#92400e' },
    power_off:    { bg: '#e5e7eb', color: '#4b5563' },
    loc:          { bg: '#fed7aa', color: '#9a3412' },
    unconfigured: { bg: '#ede9fe', color: '#5b21b6' },
    unknown:      { bg: '#f3f4f6', color: '#6b7280' },
  };
  const s = map[state] ?? { bg: '#f3f4f6', color: '#374151' };
  return (
    <span style={{ background: s.bg, color: s.color, padding: '2px 8px', borderRadius: 12, fontSize: '0.72rem', fontWeight: 600 }}>
      {state.replace('_', ' ')}
    </span>
  );
}

function JobStatusBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; color: string }> = {
    pending:     { bg: '#fef3c7', color: '#92400e' },
    queued:      { bg: '#dbeafe', color: '#1e40af' },
    in_progress: { bg: '#ede9fe', color: '#5b21b6' },
    completed:   { bg: '#d1fae5', color: '#065f46' },
    failed:      { bg: '#fee2e2', color: '#991b1b' },
    cancelled:   { bg: '#f3f4f6', color: '#6b7280' },
  };
  const s = map[status] ?? { bg: '#f3f4f6', color: '#374151' };
  return (
    <span style={{ background: s.bg, color: s.color, padding: '2px 8px', borderRadius: 12, fontSize: '0.72rem', fontWeight: 600 }}>
      {status.replace('_', ' ')}
    </span>
  );
}

// ---------------------------------------------------------------------------
// API helpers — ONU Details
// ---------------------------------------------------------------------------

async function fetchOnuDetails(page: number, state: string): Promise<{ data: OnuDetail[]; meta: PaginatedMeta }> {
  const query: Record<string, string | number> = { page, limit: PAGE_SIZE };
  if (state) query.onu_state = state;
  const res = await api.GET('/onu-management/details' as never, { params: { query: query as never } } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to load ONU details');
  return (res as { data: unknown }).data as unknown as { data: OnuDetail[]; meta: PaginatedMeta };
}

async function fetchOpticalHistory(onuDetailId: number): Promise<OpticalMetric[]> {
  const res = await api.GET('/onu-management/details/{id}/optical-metrics' as never, {
    params: { path: { id: onuDetailId } },
  } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to load optical metrics');
  return ((res as { data: unknown }).data as { data: OpticalMetric[] }).data;
}

async function scheduleReboot(onuDetailId: number): Promise<void> {
  const res = await api.POST('/onu-management/details/{id}/reboot' as never, {
    params: { path: { id: onuDetailId } },
    body: {} as never,
  } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to schedule reboot');
}

// ---------------------------------------------------------------------------
// API helpers — ONU Profiles
// ---------------------------------------------------------------------------

async function fetchProfiles(page: number): Promise<{ data: OnuProfile[]; meta: PaginatedMeta }> {
  const res = await api.GET('/onu-management/profiles' as never, { params: { query: { page, limit: PAGE_SIZE } as never } } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to load ONU profiles');
  return (res as { data: unknown }).data as unknown as { data: OnuProfile[]; meta: PaginatedMeta };
}

async function createProfile(body: Record<string, unknown>): Promise<void> {
  const res = await api.POST('/onu-management/profiles' as never, { body: body as never } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to create ONU profile');
}

async function updateProfile(id: number, body: Record<string, unknown>): Promise<void> {
  const res = await api.PUT('/onu-management/profiles/{id}' as never, { params: { path: { id } }, body: body as never } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to update ONU profile');
}

async function deleteProfile(id: number): Promise<void> {
  const res = await api.DELETE('/onu-management/profiles/{id}' as never, { params: { path: { id } } } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to delete ONU profile');
}

// ---------------------------------------------------------------------------
// API helpers — Whitelist
// ---------------------------------------------------------------------------

async function fetchWhitelist(page: number): Promise<{ data: WhitelistEntry[]; meta: PaginatedMeta }> {
  const res = await api.GET('/onu-management/whitelist' as never, { params: { query: { page, limit: PAGE_SIZE } as never } } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to load whitelist');
  return (res as { data: unknown }).data as unknown as { data: WhitelistEntry[]; meta: PaginatedMeta };
}

async function createWhitelistEntry(body: Record<string, unknown>): Promise<void> {
  const res = await api.POST('/onu-management/whitelist' as never, { body: body as never } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to create whitelist entry');
}

async function deleteWhitelistEntry(id: number): Promise<void> {
  const res = await api.DELETE('/onu-management/whitelist/{id}' as never, { params: { path: { id } } } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to delete whitelist entry');
}

// ---------------------------------------------------------------------------
// API helpers — OMCI Configs
// ---------------------------------------------------------------------------

async function fetchOmciConfigs(page: number): Promise<{ data: OmciConfig[]; meta: PaginatedMeta }> {
  const res = await api.GET('/onu-management/omci-configs' as never, { params: { query: { page, limit: PAGE_SIZE } as never } } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to load OMCI configs');
  return (res as { data: unknown }).data as unknown as { data: OmciConfig[]; meta: PaginatedMeta };
}

async function createOmciConfig(body: Record<string, unknown>): Promise<void> {
  const res = await api.POST('/onu-management/omci-configs' as never, { body: body as never } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to create OMCI config');
}

async function deleteOmciConfig(id: number): Promise<void> {
  const res = await api.DELETE('/onu-management/omci-configs/{id}' as never, { params: { path: { id } } } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to delete OMCI config');
}

// ---------------------------------------------------------------------------
// API helpers — Firmware Jobs
// ---------------------------------------------------------------------------

async function fetchFirmwareJobs(page: number, status: string): Promise<{ data: FirmwareJob[]; meta: PaginatedMeta }> {
  const query: Record<string, string | number> = { page, limit: PAGE_SIZE };
  if (status) query.status = status;
  const res = await api.GET('/onu-management/firmware-jobs' as never, { params: { query: query as never } } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to load firmware jobs');
  return (res as { data: unknown }).data as unknown as { data: FirmwareJob[]; meta: PaginatedMeta };
}

async function createFirmwareJob(body: Record<string, unknown>): Promise<void> {
  const res = await api.POST('/onu-management/firmware-jobs' as never, { body: body as never } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to create firmware job');
}

async function cancelFirmwareJob(id: number): Promise<void> {
  const res = await api.POST('/onu-management/firmware-jobs/{id}/cancel' as never, {
    params: { path: { id } },
    body: {} as never,
  } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to cancel firmware job');
}

// ---------------------------------------------------------------------------
// ONU Details Tab
// ---------------------------------------------------------------------------

function OnuDetailsTab() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [state, setState] = useState('');
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['onuDetails', page, state],
    queryFn: () => fetchOnuDetails(page, state),
  });

  const { data: optMetrics, isLoading: metricsLoading } = useQuery({
    queryKey: ['onuOptical', selectedId],
    queryFn: () => fetchOpticalHistory(selectedId!),
    enabled: selectedId !== null,
  });

  const rebootMut = useMutation({
    mutationFn: scheduleReboot,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['onuDetails'] }),
  });

  const totalPages = Math.ceil((data?.meta?.total ?? 0) / PAGE_SIZE);

  return (
    <div>
      <div style={styles.filterRow}>
        <select value={state} onChange={e => { setState(e.target.value); setPage(1); }} style={styles.filterSelect}>
          <option value="">{t('onuManagement.details.allStates')}</option>
          {ONU_STATES.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
        </select>
      </div>

      <div style={styles.tableCard}>
        {isLoading && <p style={styles.msg}>{t('common.loading')}</p>}
        {isError && <p style={styles.msgError}>{t('common.loadError')}</p>}
        {!isLoading && !isError && (
          <div style={{ overflowX: 'auto' }}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>{t('onuManagement.details.device')}</th>
                  <th style={styles.th}>{t('onuManagement.details.serial')}</th>
                  <th style={styles.th}>{t('onuManagement.details.state')}</th>
                  <th style={styles.th}>{t('onuManagement.details.olt')}</th>
                  <th style={styles.th}>{t('onuManagement.details.port')}</th>
                  <th style={styles.th}>{t('onuManagement.details.profile')}</th>
                  <th style={styles.thNum}>{t('onuManagement.details.onuId')}</th>
                  <th style={styles.th}></th>
                </tr>
              </thead>
              <tbody>
                {data?.data.length === 0 && (
                  <tr><td colSpan={8} style={styles.msg}>{t('common.noResults')}</td></tr>
                )}
                {data?.data.map(onu => (
                  <tr key={onu.id} style={styles.tr}>
                    <td style={styles.td}>{onu.device_name ?? `#${onu.device_id}`}</td>
                    <td style={styles.tdMono}>{onu.serial_number ?? '—'}</td>
                    <td style={styles.td}><OnuStateBadge state={onu.onu_state} /></td>
                    <td style={styles.td}>{onu.olt_name ?? `#${onu.olt_device_id}`}</td>
                    <td style={styles.td}>{onu.port_name ?? '—'}</td>
                    <td style={styles.td}>{onu.onu_profile_name ?? '—'}</td>
                    <td style={styles.tdNum}>{onu.onu_id ?? '—'}</td>
                    <td style={styles.td}>
                      <button
                        style={styles.actionBtn}
                        onClick={() => setSelectedId(selectedId === onu.id ? null : onu.id)}
                      >
                        {selectedId === onu.id ? t('onuManagement.details.hideOptical') : t('onuManagement.details.showOptical')}
                      </button>
                      <button
                        style={{ ...styles.actionBtn, color: 'var(--warning, #d97706)' }}
                        disabled={rebootMut.isPending}
                        onClick={() => {
                          if (window.confirm(t('onuManagement.details.confirmReboot'))) rebootMut.mutate(onu.id);
                        }}
                      >
                        {t('onuManagement.details.reboot')}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {totalPages > 1 && (
          <div style={styles.pagination}>
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} style={styles.pageBtn}>{t('common.prev')}</button>
            <span style={styles.pageInfo}>{page} / {totalPages}</span>
            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} style={styles.pageBtn}>{t('common.next')}</button>
          </div>
        )}
      </div>

      {selectedId !== null && (
        <div style={{ marginTop: '1.25rem' }}>
          <h4 style={{ margin: '0 0 0.75rem', fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-primary)' }}>
            {t('onuManagement.details.opticalHistory')}
          </h4>
          {metricsLoading && <p style={styles.msg}>{t('common.loading')}</p>}
          {optMetrics && (
            <div style={styles.tableCard}>
              <div style={{ overflowX: 'auto' }}>
                <table style={styles.table}>
                  <thead>
                    <tr>
                      <th style={styles.th}>{t('onuManagement.optical.polledAt')}</th>
                      <th style={styles.thNum}>{t('onuManagement.optical.txPower')}</th>
                      <th style={styles.thNum}>{t('onuManagement.optical.rxPower')}</th>
                      <th style={styles.thNum}>{t('onuManagement.optical.oltRxPower')}</th>
                      <th style={styles.thNum}>{t('onuManagement.optical.temp')}</th>
                      <th style={styles.thNum}>{t('onuManagement.optical.voltage')}</th>
                      <th style={styles.thNum}>{t('onuManagement.optical.biasCurrent')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {optMetrics.length === 0 && (
                      <tr><td colSpan={7} style={styles.msg}>{t('common.noResults')}</td></tr>
                    )}
                    {optMetrics.map(m => (
                      <tr key={m.id} style={styles.tr}>
                        <td style={styles.tdMono}>{new Date(m.polled_at).toLocaleString()}</td>
                        <td style={styles.tdNum}>{m.tx_power_dbm != null ? `${m.tx_power_dbm} dBm` : '—'}</td>
                        <td style={styles.tdNum}>{m.rx_power_dbm != null ? `${m.rx_power_dbm} dBm` : '—'}</td>
                        <td style={styles.tdNum}>{m.olt_rx_power_dbm != null ? `${m.olt_rx_power_dbm} dBm` : '—'}</td>
                        <td style={styles.tdNum}>{m.temperature_c != null ? `${m.temperature_c} °C` : '—'}</td>
                        <td style={styles.tdNum}>{m.voltage_v != null ? `${m.voltage_v} V` : '—'}</td>
                        <td style={styles.tdNum}>{m.bias_current_ma != null ? `${m.bias_current_ma} mA` : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ONU Profiles Tab
// ---------------------------------------------------------------------------

function OnuProfilesTab() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<OnuProfile | null>(null);
  const [form, setForm] = useState<Record<string, unknown>>({});
  const [err, setErr] = useState('');

  const { data, isLoading, isError } = useQuery({
    queryKey: ['onuProfiles', page],
    queryFn: () => fetchProfiles(page),
  });

  const createMut = useMutation({ mutationFn: createProfile, onSuccess: () => { qc.invalidateQueries({ queryKey: ['onuProfiles'] }); close_(); } });
  const updateMut = useMutation({ mutationFn: ({ id, body }: { id: number; body: Record<string, unknown> }) => updateProfile(id, body), onSuccess: () => { qc.invalidateQueries({ queryKey: ['onuProfiles'] }); close_(); } });
  const deleteMut = useMutation({ mutationFn: deleteProfile, onSuccess: () => qc.invalidateQueries({ queryKey: ['onuProfiles'] }) });

  function openCreate() { setEditing(null); setForm({ technology: 'gpon', vlan_mode: 'tagged' }); setErr(''); setOpen(true); }
  function openEdit(p: OnuProfile) { setEditing(p); setForm({ ...p }); setErr(''); setOpen(true); }
  function close_() { setOpen(false); setEditing(null); setForm({}); setErr(''); }

  function submit() {
    if (!form.name) { setErr(t('onuManagement.profiles.nameRequired')); return; }
    if (editing) updateMut.mutate({ id: editing.id, body: form });
    else createMut.mutate(form);
  }

  const totalPages = Math.ceil((data?.meta?.total ?? 0) / PAGE_SIZE);
  const busy = createMut.isPending || updateMut.isPending;

  return (
    <div>
      <div style={styles.filterRow}>
        <button onClick={openCreate} style={styles.btnPrimary}>{t('onuManagement.profiles.newProfile')}</button>
      </div>
      <div style={styles.tableCard}>
        {isLoading && <p style={styles.msg}>{t('common.loading')}</p>}
        {isError && <p style={styles.msgError}>{t('common.loadError')}</p>}
        {!isLoading && !isError && (
          <div style={{ overflowX: 'auto' }}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>{t('onuManagement.profiles.name')}</th>
                  <th style={styles.th}>{t('onuManagement.profiles.technology')}</th>
                  <th style={styles.thNum}>{t('onuManagement.profiles.tcontId')}</th>
                  <th style={styles.thNum}>{t('onuManagement.profiles.gemPortId')}</th>
                  <th style={styles.thNum}>{t('onuManagement.profiles.serviceVlan')}</th>
                  <th style={styles.th}>{t('onuManagement.profiles.vlanMode')}</th>
                  <th style={styles.th}></th>
                </tr>
              </thead>
              <tbody>
                {data?.data.length === 0 && <tr><td colSpan={7} style={styles.msg}>{t('common.noResults')}</td></tr>}
                {data?.data.map(p => (
                  <tr key={p.id} style={styles.tr}>
                    <td style={styles.td}>{p.name}</td>
                    <td style={styles.td}><span style={{ textTransform: 'uppercase', fontSize: '0.72rem', fontWeight: 600 }}>{p.technology}</span></td>
                    <td style={styles.tdNum}>{p.tcont_id ?? '—'}</td>
                    <td style={styles.tdNum}>{p.gem_port_id ?? '—'}</td>
                    <td style={styles.tdNum}>{p.service_vlan ?? '—'}</td>
                    <td style={styles.td}>{capitalize(p.vlan_mode)}</td>
                    <td style={styles.td}>
                      <button style={styles.actionBtn} onClick={() => openEdit(p)}>{t('common.edit')}</button>
                      <button style={{ ...styles.actionBtn, color: 'var(--danger)' }} onClick={() => { if (window.confirm(t('onuManagement.profiles.confirmDelete'))) deleteMut.mutate(p.id); }}>{t('common.delete')}</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {totalPages > 1 && (
          <div style={styles.pagination}>
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} style={styles.pageBtn}>{t('common.prev')}</button>
            <span style={styles.pageInfo}>{page} / {totalPages}</span>
            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} style={styles.pageBtn}>{t('common.next')}</button>
          </div>
        )}
      </div>

      {open && (
        <div style={modalStyles.backdrop}>
          <div style={modalStyles.panel}>
            <div style={modalStyles.header}>
              <h3 style={modalStyles.title}>{editing ? t('onuManagement.profiles.editTitle') : t('onuManagement.profiles.createTitle')}</h3>
              <button style={modalStyles.closeBtn} onClick={close_}>&#x2715;</button>
            </div>
            <div style={modalStyles.form}>
              {err && <p style={modalStyles.error}>{err}</p>}
              <label style={modalStyles.label}>
                {t('onuManagement.profiles.name')}<RequiredMark />
                <input style={modalStyles.input} value={(form.name as string) ?? ''} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
              </label>
              <label style={modalStyles.label}>
                {t('onuManagement.profiles.technology')}
                <select style={modalStyles.select} value={(form.technology as string) ?? 'gpon'} onChange={e => setForm(f => ({ ...f, technology: e.target.value }))}>
                  {TECHNOLOGIES.map(t_ => <option key={t_} value={t_}>{t_.toUpperCase()}</option>)}
                </select>
              </label>
              <label style={modalStyles.label}>
                {t('onuManagement.profiles.tcontId')}
                <input style={modalStyles.input} type="number" value={(form.tcont_id as number) ?? ''} onChange={e => setForm(f => ({ ...f, tcont_id: e.target.value ? Number(e.target.value) : null }))} />
              </label>
              <label style={modalStyles.label}>
                {t('onuManagement.profiles.gemPortId')}
                <input style={modalStyles.input} type="number" value={(form.gem_port_id as number) ?? ''} onChange={e => setForm(f => ({ ...f, gem_port_id: e.target.value ? Number(e.target.value) : null }))} />
              </label>
              <label style={modalStyles.label}>
                {t('onuManagement.profiles.serviceVlan')}
                <input style={modalStyles.input} type="number" value={(form.service_vlan as number) ?? ''} onChange={e => setForm(f => ({ ...f, service_vlan: e.target.value ? Number(e.target.value) : null }))} />
              </label>
              <label style={modalStyles.label}>
                {t('onuManagement.profiles.vlanMode')}
                <select style={modalStyles.select} value={(form.vlan_mode as string) ?? 'tagged'} onChange={e => setForm(f => ({ ...f, vlan_mode: e.target.value }))}>
                  {VLAN_MODES.map(m => <option key={m} value={m}>{capitalize(m)}</option>)}
                </select>
              </label>
              <div style={modalStyles.actions}>
                <button onClick={close_} style={styles.btnSecondary}>{t('common.cancel')}</button>
                <button onClick={submit} disabled={busy} style={styles.btnPrimary}>{busy ? t('common.saving') : t('common.save')}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Whitelist Tab
// ---------------------------------------------------------------------------

function WhitelistTab() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Record<string, unknown>>({ entry_type: 'serial', status: 'pending' });
  const [err, setErr] = useState('');

  const { data, isLoading, isError } = useQuery({
    queryKey: ['onuWhitelist', page],
    queryFn: () => fetchWhitelist(page),
  });

  const createMut = useMutation({ mutationFn: createWhitelistEntry, onSuccess: () => { qc.invalidateQueries({ queryKey: ['onuWhitelist'] }); setOpen(false); setForm({ entry_type: 'serial', status: 'pending' }); } });
  const deleteMut = useMutation({ mutationFn: deleteWhitelistEntry, onSuccess: () => qc.invalidateQueries({ queryKey: ['onuWhitelist'] }) });

  function submit() {
    if (!form.olt_device_id || !form.entry_value) { setErr(t('onuManagement.whitelist.fieldsRequired')); return; }
    createMut.mutate(form);
  }

  const totalPages = Math.ceil((data?.meta?.total ?? 0) / PAGE_SIZE);

  return (
    <div>
      <div style={styles.filterRow}>
        <button onClick={() => { setForm({ entry_type: 'serial', status: 'pending' }); setErr(''); setOpen(true); }} style={styles.btnPrimary}>{t('onuManagement.whitelist.newEntry')}</button>
      </div>
      <div style={styles.tableCard}>
        {isLoading && <p style={styles.msg}>{t('common.loading')}</p>}
        {isError && <p style={styles.msgError}>{t('common.loadError')}</p>}
        {!isLoading && !isError && (
          <div style={{ overflowX: 'auto' }}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>{t('onuManagement.whitelist.olt')}</th>
                  <th style={styles.th}>{t('onuManagement.whitelist.type')}</th>
                  <th style={styles.th}>{t('onuManagement.whitelist.value')}</th>
                  <th style={styles.th}>{t('onuManagement.whitelist.status')}</th>
                  <th style={styles.th}>{t('onuManagement.whitelist.description')}</th>
                  <th style={styles.th}></th>
                </tr>
              </thead>
              <tbody>
                {data?.data.length === 0 && <tr><td colSpan={6} style={styles.msg}>{t('common.noResults')}</td></tr>}
                {data?.data.map(e => (
                  <tr key={e.id} style={styles.tr}>
                    <td style={styles.td}>{e.olt_name ?? `#${e.olt_device_id}`}</td>
                    <td style={styles.td}>{capitalize(e.entry_type)}</td>
                    <td style={styles.tdMono}>{e.entry_value}</td>
                    <td style={styles.td}>{capitalize(e.status)}</td>
                    <td style={styles.td}>{e.description ?? '—'}</td>
                    <td style={styles.td}>
                      <button style={{ ...styles.actionBtn, color: 'var(--danger)' }} onClick={() => { if (window.confirm(t('onuManagement.whitelist.confirmDelete'))) deleteMut.mutate(e.id); }}>{t('common.delete')}</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {totalPages > 1 && (
          <div style={styles.pagination}>
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} style={styles.pageBtn}>{t('common.prev')}</button>
            <span style={styles.pageInfo}>{page} / {totalPages}</span>
            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} style={styles.pageBtn}>{t('common.next')}</button>
          </div>
        )}
      </div>

      {open && (
        <div style={modalStyles.backdrop}>
          <div style={modalStyles.panel}>
            <div style={modalStyles.header}>
              <h3 style={modalStyles.title}>{t('onuManagement.whitelist.createTitle')}</h3>
              <button style={modalStyles.closeBtn} onClick={() => setOpen(false)}>&#x2715;</button>
            </div>
            <div style={modalStyles.form}>
              {err && <p style={modalStyles.error}>{err}</p>}
              <label style={modalStyles.label}>
                {t('onuManagement.whitelist.oltDeviceId')}<RequiredMark />
                <input style={modalStyles.input} type="number" value={(form.olt_device_id as number) ?? ''} onChange={e => setForm(f => ({ ...f, olt_device_id: Number(e.target.value) }))} />
              </label>
              <label style={modalStyles.label}>
                {t('onuManagement.whitelist.type')}
                <select style={modalStyles.select} value={(form.entry_type as string) ?? 'serial'} onChange={e => setForm(f => ({ ...f, entry_type: e.target.value }))}>
                  <option value="serial">{t('onuManagement.whitelist.typeSerial')}</option>
                  <option value="loid">{t('onuManagement.whitelist.typeLoid')}</option>
                  <option value="mac">{t('onuManagement.whitelist.typeMac')}</option>
                </select>
              </label>
              <label style={modalStyles.label}>
                {t('onuManagement.whitelist.value')}<RequiredMark />
                <input style={modalStyles.input} value={(form.entry_value as string) ?? ''} onChange={e => setForm(f => ({ ...f, entry_value: e.target.value }))} placeholder="ALCL12345678" />
              </label>
              <label style={modalStyles.label}>
                {t('onuManagement.whitelist.description')}
                <input style={modalStyles.input} value={(form.description as string) ?? ''} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
              </label>
              <div style={modalStyles.actions}>
                <button onClick={() => setOpen(false)} style={styles.btnSecondary}>{t('common.cancel')}</button>
                <button onClick={submit} disabled={createMut.isPending} style={styles.btnPrimary}>{createMut.isPending ? t('common.saving') : t('common.save')}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// OMCI Configs Tab
// ---------------------------------------------------------------------------

function OmciConfigsTab() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Record<string, unknown>>({ delivery_method: 'omci' });
  const [err, setErr] = useState('');

  const { data, isLoading, isError } = useQuery({
    queryKey: ['onuOmciConfigs', page],
    queryFn: () => fetchOmciConfigs(page),
  });

  const createMut = useMutation({ mutationFn: createOmciConfig, onSuccess: () => { qc.invalidateQueries({ queryKey: ['onuOmciConfigs'] }); setOpen(false); } });
  const deleteMut = useMutation({ mutationFn: deleteOmciConfig, onSuccess: () => qc.invalidateQueries({ queryKey: ['onuOmciConfigs'] }) });

  function submit() {
    if (!form.device_id) { setErr(t('onuManagement.omci.deviceRequired')); return; }
    createMut.mutate(form);
  }

  const totalPages = Math.ceil((data?.meta?.total ?? 0) / PAGE_SIZE);

  return (
    <div>
      <div style={styles.filterRow}>
        <button onClick={() => { setForm({ delivery_method: 'omci' }); setErr(''); setOpen(true); }} style={styles.btnPrimary}>{t('onuManagement.omci.newConfig')}</button>
      </div>
      <div style={styles.tableCard}>
        {isLoading && <p style={styles.msg}>{t('common.loading')}</p>}
        {isError && <p style={styles.msgError}>{t('common.loadError')}</p>}
        {!isLoading && !isError && (
          <div style={{ overflowX: 'auto' }}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>{t('onuManagement.omci.device')}</th>
                  <th style={styles.th}>{t('onuManagement.omci.wifiSsid')}</th>
                  <th style={styles.th}>{t('onuManagement.omci.wifiBand')}</th>
                  <th style={styles.th}>{t('onuManagement.omci.wanMode')}</th>
                  <th style={styles.th}>{t('onuManagement.omci.deliveryMethod')}</th>
                  <th style={styles.th}>{t('onuManagement.omci.applyStatus')}</th>
                  <th style={styles.th}></th>
                </tr>
              </thead>
              <tbody>
                {data?.data.length === 0 && <tr><td colSpan={7} style={styles.msg}>{t('common.noResults')}</td></tr>}
                {data?.data.map(c => (
                  <tr key={c.id} style={styles.tr}>
                    <td style={styles.td}>{c.device_name ?? `#${c.device_id}`}</td>
                    <td style={styles.td}>{c.wifi_ssid ?? '—'}</td>
                    <td style={styles.td}>{c.wifi_band ?? '—'}</td>
                    <td style={styles.td}>{c.wan_mode ?? '—'}</td>
                    <td style={styles.td}>{capitalize(c.delivery_method)}</td>
                    <td style={styles.td}>{capitalize(c.apply_status)}</td>
                    <td style={styles.td}>
                      <button style={{ ...styles.actionBtn, color: 'var(--danger)' }} onClick={() => { if (window.confirm(t('onuManagement.omci.confirmDelete'))) deleteMut.mutate(c.id); }}>{t('common.delete')}</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {totalPages > 1 && (
          <div style={styles.pagination}>
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} style={styles.pageBtn}>{t('common.prev')}</button>
            <span style={styles.pageInfo}>{page} / {totalPages}</span>
            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} style={styles.pageBtn}>{t('common.next')}</button>
          </div>
        )}
      </div>

      {open && (
        <div style={modalStyles.backdrop}>
          <div style={modalStyles.panel}>
            <div style={modalStyles.header}>
              <h3 style={modalStyles.title}>{t('onuManagement.omci.createTitle')}</h3>
              <button style={modalStyles.closeBtn} onClick={() => setOpen(false)}>&#x2715;</button>
            </div>
            <div style={modalStyles.form}>
              {err && <p style={modalStyles.error}>{err}</p>}
              <label style={modalStyles.label}>
                {t('onuManagement.omci.deviceId')}<RequiredMark />
                <input style={modalStyles.input} type="number" value={(form.device_id as number) ?? ''} onChange={e => setForm(f => ({ ...f, device_id: Number(e.target.value) }))} />
              </label>
              <label style={modalStyles.label}>
                {t('onuManagement.omci.wifiSsid')}
                <input style={modalStyles.input} value={(form.wifi_ssid as string) ?? ''} onChange={e => setForm(f => ({ ...f, wifi_ssid: e.target.value }))} />
              </label>
              <label style={modalStyles.label}>
                {t('onuManagement.omci.wifiBand')}
                <select style={modalStyles.select} value={(form.wifi_band as string) ?? ''} onChange={e => setForm(f => ({ ...f, wifi_band: e.target.value }))}>
                  <option value="">{t('common.none')}</option>
                  {WIFI_BANDS.map(b => <option key={b} value={b}>{b}</option>)}
                </select>
              </label>
              <label style={modalStyles.label}>
                {t('onuManagement.omci.deliveryMethod')}
                <select style={modalStyles.select} value={(form.delivery_method as string) ?? 'omci'} onChange={e => setForm(f => ({ ...f, delivery_method: e.target.value }))}>
                  {DELIVERY_METHODS.map(d => <option key={d} value={d}>{d.toUpperCase()}</option>)}
                </select>
              </label>
              <div style={modalStyles.actions}>
                <button onClick={() => setOpen(false)} style={styles.btnSecondary}>{t('common.cancel')}</button>
                <button onClick={submit} disabled={createMut.isPending} style={styles.btnPrimary}>{createMut.isPending ? t('common.saving') : t('common.save')}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Firmware Jobs Tab
// ---------------------------------------------------------------------------

function FirmwareJobsTab() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Record<string, unknown>>({ job_type: 'firmware_upgrade', scope: 'single_onu' });
  const [err, setErr] = useState('');

  const { data, isLoading, isError } = useQuery({
    queryKey: ['onuFirmwareJobs', page, status],
    queryFn: () => fetchFirmwareJobs(page, status),
  });

  const createMut = useMutation({ mutationFn: createFirmwareJob, onSuccess: () => { qc.invalidateQueries({ queryKey: ['onuFirmwareJobs'] }); setOpen(false); } });
  const cancelMut = useMutation({ mutationFn: cancelFirmwareJob, onSuccess: () => qc.invalidateQueries({ queryKey: ['onuFirmwareJobs'] }) });

  function submit() {
    if (!form.job_type || !form.scope) { setErr(t('onuManagement.firmware.fieldsRequired')); return; }
    createMut.mutate(form);
  }

  const totalPages = Math.ceil((data?.meta?.total ?? 0) / PAGE_SIZE);

  const canCancel = (s: string) => s === 'pending' || s === 'queued';

  return (
    <div>
      <div style={styles.filterRow}>
        <select value={status} onChange={e => { setStatus(e.target.value); setPage(1); }} style={styles.filterSelect}>
          <option value="">{t('onuManagement.firmware.allStatuses')}</option>
          {JOB_STATUSES.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
        </select>
        <button onClick={() => { setForm({ job_type: 'firmware_upgrade', scope: 'single_onu' }); setErr(''); setOpen(true); }} style={styles.btnPrimary}>{t('onuManagement.firmware.newJob')}</button>
      </div>
      <div style={styles.tableCard}>
        {isLoading && <p style={styles.msg}>{t('common.loading')}</p>}
        {isError && <p style={styles.msgError}>{t('common.loadError')}</p>}
        {!isLoading && !isError && (
          <div style={{ overflowX: 'auto' }}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.thNum}>{t('common.id')}</th>
                  <th style={styles.th}>{t('onuManagement.firmware.type')}</th>
                  <th style={styles.th}>{t('onuManagement.firmware.scope')}</th>
                  <th style={styles.th}>{t('onuManagement.firmware.status')}</th>
                  <th style={styles.th}>{t('onuManagement.firmware.version')}</th>
                  <th style={styles.thNum}>{t('onuManagement.firmware.progress')}</th>
                  <th style={styles.th}>{t('onuManagement.firmware.created')}</th>
                  <th style={styles.th}></th>
                </tr>
              </thead>
              <tbody>
                {data?.data.length === 0 && <tr><td colSpan={8} style={styles.msg}>{t('common.noResults')}</td></tr>}
                {data?.data.map(j => (
                  <tr key={j.id} style={styles.tr}>
                    <td style={styles.tdNum}>{j.id}</td>
                    <td style={styles.td}>{j.job_type.replace('_', ' ')}</td>
                    <td style={styles.td}>{j.scope.replace('_', ' ')}</td>
                    <td style={styles.td}><JobStatusBadge status={j.status} /></td>
                    <td style={styles.tdMono}>{j.firmware_version ?? '—'}</td>
                    <td style={styles.tdNum}>{j.completed_devices} / {j.total_devices}</td>
                    <td style={styles.td}>{new Date(j.created_at).toLocaleDateString()}</td>
                    <td style={styles.td}>
                      {canCancel(j.status) && (
                        <button
                          style={{ ...styles.actionBtn, color: 'var(--danger)' }}
                          disabled={cancelMut.isPending}
                          onClick={() => { if (window.confirm(t('onuManagement.firmware.confirmCancel'))) cancelMut.mutate(j.id); }}
                        >
                          {t('onuManagement.firmware.cancel')}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {totalPages > 1 && (
          <div style={styles.pagination}>
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} style={styles.pageBtn}>{t('common.prev')}</button>
            <span style={styles.pageInfo}>{page} / {totalPages}</span>
            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} style={styles.pageBtn}>{t('common.next')}</button>
          </div>
        )}
      </div>

      {open && (
        <div style={modalStyles.backdrop}>
          <div style={modalStyles.panel}>
            <div style={modalStyles.header}>
              <h3 style={modalStyles.title}>{t('onuManagement.firmware.createTitle')}</h3>
              <button style={modalStyles.closeBtn} onClick={() => setOpen(false)}>&#x2715;</button>
            </div>
            <div style={modalStyles.form}>
              {err && <p style={modalStyles.error}>{err}</p>}
              <label style={modalStyles.label}>
                {t('onuManagement.firmware.type')}<RequiredMark />
                <select style={modalStyles.select} value={(form.job_type as string) ?? 'firmware_upgrade'} onChange={e => setForm(f => ({ ...f, job_type: e.target.value }))}>
                  {JOB_TYPES.map(jt => <option key={jt} value={jt}>{jt.replace('_', ' ')}</option>)}
                </select>
              </label>
              <label style={modalStyles.label}>
                {t('onuManagement.firmware.scope')}<RequiredMark />
                <select style={modalStyles.select} value={(form.scope as string) ?? 'single_onu'} onChange={e => setForm(f => ({ ...f, scope: e.target.value }))}>
                  {SCOPES.map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
                </select>
              </label>
              <label style={modalStyles.label}>
                {t('onuManagement.firmware.oltDeviceId')}
                <input style={modalStyles.input} type="number" value={(form.olt_device_id as number) ?? ''} onChange={e => setForm(f => ({ ...f, olt_device_id: e.target.value ? Number(e.target.value) : null }))} />
              </label>
              <label style={modalStyles.label}>
                {t('onuManagement.firmware.version')}
                <input style={modalStyles.input} value={(form.firmware_version as string) ?? ''} onChange={e => setForm(f => ({ ...f, firmware_version: e.target.value }))} placeholder="V8R012C00S125" />
              </label>
              <label style={modalStyles.label}>
                {t('onuManagement.firmware.firmwareUrl')}
                <input style={modalStyles.input} value={(form.firmware_url as string) ?? ''} onChange={e => setForm(f => ({ ...f, firmware_url: e.target.value }))} placeholder="https://firmware.example.com/onu/..." />
              </label>
              <div style={modalStyles.actions}>
                <button onClick={() => setOpen(false)} style={styles.btnSecondary}>{t('common.cancel')}</button>
                <button onClick={submit} disabled={createMut.isPending} style={styles.btnPrimary}>{createMut.isPending ? t('common.saving') : t('common.save')}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

type Tab = 'details' | 'profiles' | 'whitelist' | 'omci' | 'firmware';

export function OnuManagementPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>('details');

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h2 style={styles.pageTitle}>{t('onuManagement.title')}</h2>
      </div>
      <p style={{ color: 'var(--text-muted)', margin: '0 0 1.25rem', fontSize: '0.9rem' }}>
        {t('onuManagement.subtitle')}
      </p>

      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', marginBottom: '1.25rem', gap: 0 }}>
        {(['details', 'profiles', 'whitelist', 'omci', 'firmware'] as Tab[]).map(t_ => (
          <button key={t_} style={tabBtn(tab === t_)} onClick={() => setTab(t_)}>
            {t(`onuManagement.tabs.${t_}`)}
          </button>
        ))}
      </div>

      {tab === 'details' && <OnuDetailsTab />}
      {tab === 'profiles' && <OnuProfilesTab />}
      {tab === 'whitelist' && <WhitelistTab />}
      {tab === 'omci' && <OmciConfigsTab />}
      {tab === 'firmware' && <FirmwareJobsTab />}
    </div>
  );
}
