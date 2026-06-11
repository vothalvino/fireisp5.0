// =============================================================================
// FireISP 5.0 — Wireless Management (§9)
// =============================================================================
// Tabbed page covering:
//   1. AP Sectors       — ap_sector_configs CRUD + nested client sessions panel
//   2. Channel Plans    — ap_channel_plans CRUD
//   3. AP Commands      — ap_command_jobs (remote power/freq adjustment)
//   4. Interference Log — wireless_channel_interference CRUD
// =============================================================================

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';
import { styles, modalStyles, RequiredMark, fmtDate } from './crudStyles';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Device {
  id: number;
  name: string;
  device_type: string;
}

interface DevicesResponse {
  data: Device[];
  meta: { total: number; page: number; limit: number };
}

interface Site {
  id: number;
  name: string;
}

interface SitesResponse {
  data: Site[];
  meta: { total: number; page: number; limit: number };
}

interface ApSector {
  id: number;
  device_id: number | null;
  device_name?: string;
  sector_azimuth_deg: number | null;
  sector_width_deg: number | null;
  frequency_mhz: number | null;
  channel_width_mhz: number | null;
  tx_power_dbm: number | null;
  encryption: string | null;
  max_clients: number | null;
  status: string;
  notes: string | null;
}

interface ApSectorsResponse {
  data: ApSector[];
  meta: { total: number; page: number; limit: number };
}

interface ApSectorBody {
  device_id?: number;
  sector_azimuth_deg?: number;
  sector_width_deg?: number;
  frequency_mhz?: number;
  channel_width_mhz?: number;
  tx_power_dbm?: number;
  encryption?: string;
  max_clients?: number;
  status?: string;
  notes?: string;
}

interface WirelessClient {
  id: number;
  ap_device_id: number;
  client_mac: string;
  signal_dbm: number | null;
  snr_db: number | null;
  ccq_percent: number | null;
  distance_m: number | null;
  tx_rate_mbps: number | null;
  last_seen: string | null;
}

interface WirelessClientsResponse {
  data: WirelessClient[];
  meta: { total: number; page: number; limit: number };
}

interface ChannelPlan {
  id: number;
  name: string;
  site_id: number | null;
  site_name?: string;
  frequency_mhz: number | null;
  channel_width_mhz: number | null;
  status: string;
  notes: string | null;
}

interface ChannelPlansResponse {
  data: ChannelPlan[];
  meta: { total: number; page: number; limit: number };
}

interface ChannelPlanBody {
  name: string;
  site_id?: number;
  frequency_mhz?: number;
  channel_width_mhz?: number;
  status?: string;
  notes?: string;
}

interface ApCommandJob {
  id: number;
  device_id: number | null;
  device_name?: string;
  command_type: string;
  target_value: string | null;
  status: string;
  notes: string | null;
  created_at: string;
  completed_at: string | null;
}

interface ApCommandsResponse {
  data: ApCommandJob[];
  meta: { total: number; page: number; limit: number };
}

interface ApCommandBody {
  device_id?: number;
  command_type: string;
  target_value?: string;
  notes?: string;
}

interface InterferenceRecord {
  id: number;
  site_id: number | null;
  site_name?: string;
  frequency_mhz: number | null;
  channel_width_mhz: number | null;
  interference_level: string | null;
  detected_at: string | null;
  notes: string | null;
}

interface InterferenceResponse {
  data: InterferenceRecord[];
  meta: { total: number; page: number; limit: number };
}

interface InterferenceBody {
  site_id?: number;
  frequency_mhz?: number;
  channel_width_mhz?: number;
  interference_level?: string;
  detected_at?: string;
  notes?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PAGE_SIZE = 25;
const ENCRYPTION_OPTIONS = ['none', 'wpa2', 'wpa3', 'wpa2_enterprise', 'wpa3_enterprise'];
const SECTOR_STATUSES = ['active', 'inactive', 'planned', 'decommissioned'];
const PLAN_STATUSES = ['active', 'inactive', 'draft'];
const COMMAND_TYPES = ['power_adjust', 'frequency_change', 'channel_change', 'reboot', 'scan', 'other'];
const INTERFERENCE_LEVELS = ['low', 'medium', 'high', 'critical'];

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

async function fetchDevices(): Promise<DevicesResponse> {
  const res = await api.GET('/devices' as never, {
    params: { query: { limit: 200 } as never },
  } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to load devices');
  return (res as { data: unknown }).data as unknown as DevicesResponse;
}

async function fetchSites(): Promise<SitesResponse> {
  const res = await api.GET('/sites' as never, {
    params: { query: { limit: 200 } as never },
  } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to load sites');
  return (res as { data: unknown }).data as unknown as SitesResponse;
}

// AP Sectors
async function fetchApSectors(page: number): Promise<ApSectorsResponse> {
  const res = await api.GET('/wireless/ap-sectors' as never, {
    params: { query: { page, limit: PAGE_SIZE } as never },
  } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to load AP sectors');
  return (res as { data: unknown }).data as unknown as ApSectorsResponse;
}

async function createApSector(body: ApSectorBody): Promise<void> {
  const res = await api.POST('/wireless/ap-sectors' as never, { body: body as never } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to create AP sector');
}

async function updateApSector(id: number, body: Partial<ApSectorBody>): Promise<void> {
  const res = await api.PATCH('/wireless/ap-sectors/{id}' as never, {
    params: { path: { id } },
    body: body as never,
  } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to update AP sector');
}

async function deleteApSector(id: number): Promise<void> {
  const res = await api.DELETE('/wireless/ap-sectors/{id}' as never, {
    params: { path: { id } },
  } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to delete AP sector');
}

async function fetchApClients(deviceId: number): Promise<WirelessClientsResponse> {
  const res = await api.GET('/wireless/clients' as never, {
    params: { query: { device_id: deviceId, limit: 100 } as never },
  } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to load clients');
  return (res as { data: unknown }).data as unknown as WirelessClientsResponse;
}

// Channel Plans
async function fetchChannelPlans(page: number): Promise<ChannelPlansResponse> {
  const res = await api.GET('/wireless/channel-plans' as never, {
    params: { query: { page, limit: PAGE_SIZE } as never },
  } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to load channel plans');
  return (res as { data: unknown }).data as unknown as ChannelPlansResponse;
}

async function createChannelPlan(body: ChannelPlanBody): Promise<void> {
  const res = await api.POST('/wireless/channel-plans' as never, { body: body as never } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to create channel plan');
}

async function updateChannelPlan(id: number, body: Partial<ChannelPlanBody>): Promise<void> {
  const res = await api.PATCH('/wireless/channel-plans/{id}' as never, {
    params: { path: { id } },
    body: body as never,
  } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to update channel plan');
}

async function deleteChannelPlan(id: number): Promise<void> {
  const res = await api.DELETE('/wireless/channel-plans/{id}' as never, {
    params: { path: { id } },
  } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to delete channel plan');
}

// AP Commands
async function fetchApCommands(page: number): Promise<ApCommandsResponse> {
  const res = await api.GET('/wireless/ap-commands' as never, {
    params: { query: { page, limit: PAGE_SIZE } as never },
  } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to load AP commands');
  return (res as { data: unknown }).data as unknown as ApCommandsResponse;
}

async function createApCommand(body: ApCommandBody): Promise<void> {
  const res = await api.POST('/wireless/ap-commands' as never, { body: body as never } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to create AP command');
}

async function deleteApCommand(id: number): Promise<void> {
  const res = await api.DELETE('/wireless/ap-commands/{id}' as never, {
    params: { path: { id } },
  } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to delete AP command');
}

// Interference
async function fetchInterference(page: number): Promise<InterferenceResponse> {
  const res = await api.GET('/wireless/channel-interference' as never, {
    params: { query: { page, limit: PAGE_SIZE } as never },
  } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to load interference records');
  return (res as { data: unknown }).data as unknown as InterferenceResponse;
}

async function createInterference(body: InterferenceBody): Promise<void> {
  const res = await api.POST('/wireless/channel-interference' as never, { body: body as never } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to create interference record');
}

async function updateInterference(id: number, body: Partial<InterferenceBody>): Promise<void> {
  const res = await api.PATCH('/wireless/channel-interference/{id}' as never, {
    params: { path: { id } },
    body: body as never,
  } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to update interference record');
}

async function deleteInterference(id: number): Promise<void> {
  const res = await api.DELETE('/wireless/channel-interference/{id}' as never, {
    params: { path: { id } },
  } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to delete interference record');
}

// ---------------------------------------------------------------------------
// Helpers
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

function commandStatusColor(status: string): string {
  switch (status) {
    case 'pending': return '#6b7280';
    case 'queued': return '#2563eb';
    case 'in_progress': return '#d97706';
    case 'completed': return '#059669';
    case 'failed': return '#dc2626';
    case 'cancelled': return '#6b7280';
    default: return '#6b7280';
  }
}

function interferenceLevelColor(level: string | null): string {
  switch (level) {
    case 'low': return '#059669';
    case 'medium': return '#d97706';
    case 'high': return '#ea580c';
    case 'critical': return '#dc2626';
    default: return '#6b7280';
  }
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function WirelessManagementPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();

  const [tab, setTab] = useState<'apSectors' | 'channelPlans' | 'apCommands' | 'interference'>('apSectors');

  // Shared lookups
  const devicesQ = useQuery({ queryKey: ['devices', 'all'], queryFn: fetchDevices, staleTime: 120_000 });
  const sitesQ = useQuery({ queryKey: ['sites', 'all'], queryFn: fetchSites, staleTime: 120_000 });

  const deviceOptions = devicesQ.data?.data ?? [];
  const siteOptions = sitesQ.data?.data ?? [];

  // ============================== AP SECTORS ==============================

  const [apPage, setApPage] = useState(1);
  const apQ = useQuery({
    queryKey: ['wireless', 'apSectors', apPage],
    queryFn: () => fetchApSectors(apPage),
    enabled: tab === 'apSectors',
  });
  const [showApModal, setShowApModal] = useState(false);
  const [editingAp, setEditingAp] = useState<ApSector | null>(null);
  const [apForm, setApForm] = useState<Partial<ApSectorBody>>({});
  const [apErr, setApErr] = useState('');
  const [expandedApId, setExpandedApId] = useState<number | null>(null);

  const clientsQ = useQuery({
    queryKey: ['wireless', 'clients', expandedApId],
    queryFn: () => fetchApClients(expandedApId as number),
    enabled: expandedApId !== null,
  });

  function openApModal(ap?: ApSector) {
    setEditingAp(ap ?? null);
    setApForm(ap
      ? {
          device_id: ap.device_id ?? undefined,
          sector_azimuth_deg: ap.sector_azimuth_deg ?? undefined,
          sector_width_deg: ap.sector_width_deg ?? undefined,
          frequency_mhz: ap.frequency_mhz ?? undefined,
          channel_width_mhz: ap.channel_width_mhz ?? undefined,
          tx_power_dbm: ap.tx_power_dbm ?? undefined,
          encryption: ap.encryption ?? 'none',
          max_clients: ap.max_clients ?? undefined,
          status: ap.status,
          notes: ap.notes ?? '',
        }
      : { encryption: 'none', status: 'active' });
    setApErr('');
    setShowApModal(true);
  }

  const saveApMut = useMutation({
    mutationFn: () => editingAp
      ? updateApSector(editingAp.id, apForm)
      : createApSector(apForm as ApSectorBody),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['wireless', 'apSectors'] });
      setShowApModal(false);
    },
    onError: (e: unknown) => setApErr((e as { message?: string })?.message ?? 'Failed'),
  });

  const deleteApMut = useMutation({
    mutationFn: deleteApSector,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['wireless', 'apSectors'] }),
  });

  const apTotalPages = Math.ceil((apQ.data?.meta.total ?? 0) / PAGE_SIZE) || 1;

  // ============================== CHANNEL PLANS ==============================

  const [cpPage, setCpPage] = useState(1);
  const cpQ = useQuery({
    queryKey: ['wireless', 'channelPlans', cpPage],
    queryFn: () => fetchChannelPlans(cpPage),
    enabled: tab === 'channelPlans',
  });
  const [showCpModal, setShowCpModal] = useState(false);
  const [editingCp, setEditingCp] = useState<ChannelPlan | null>(null);
  const [cpForm, setCpForm] = useState<Partial<ChannelPlanBody>>({});
  const [cpErr, setCpErr] = useState('');

  function openCpModal(cp?: ChannelPlan) {
    setEditingCp(cp ?? null);
    setCpForm(cp
      ? {
          name: cp.name,
          site_id: cp.site_id ?? undefined,
          frequency_mhz: cp.frequency_mhz ?? undefined,
          channel_width_mhz: cp.channel_width_mhz ?? undefined,
          status: cp.status,
          notes: cp.notes ?? '',
        }
      : { status: 'active' });
    setCpErr('');
    setShowCpModal(true);
  }

  const saveCpMut = useMutation({
    mutationFn: () => editingCp
      ? updateChannelPlan(editingCp.id, cpForm)
      : createChannelPlan(cpForm as ChannelPlanBody),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['wireless', 'channelPlans'] });
      setShowCpModal(false);
    },
    onError: (e: unknown) => setCpErr((e as { message?: string })?.message ?? 'Failed'),
  });

  const deleteCpMut = useMutation({
    mutationFn: deleteChannelPlan,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['wireless', 'channelPlans'] }),
  });

  const cpTotalPages = Math.ceil((cpQ.data?.meta.total ?? 0) / PAGE_SIZE) || 1;

  // ============================== AP COMMANDS ==============================

  const [cmdPage, setCmdPage] = useState(1);
  const cmdQ = useQuery({
    queryKey: ['wireless', 'apCommands', cmdPage],
    queryFn: () => fetchApCommands(cmdPage),
    enabled: tab === 'apCommands',
  });
  const [showCmdModal, setShowCmdModal] = useState(false);
  const [cmdForm, setCmdForm] = useState<Partial<ApCommandBody>>({ command_type: 'power_adjust' });
  const [cmdErr, setCmdErr] = useState('');

  const createCmdMut = useMutation({
    mutationFn: () => createApCommand(cmdForm as ApCommandBody),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['wireless', 'apCommands'] });
      setShowCmdModal(false);
    },
    onError: (e: unknown) => setCmdErr((e as { message?: string })?.message ?? 'Failed'),
  });

  const deleteCmdMut = useMutation({
    mutationFn: deleteApCommand,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['wireless', 'apCommands'] }),
  });

  const cmdTotalPages = Math.ceil((cmdQ.data?.meta.total ?? 0) / PAGE_SIZE) || 1;

  // ============================== INTERFERENCE LOG ==============================

  const [intPage, setIntPage] = useState(1);
  const intQ = useQuery({
    queryKey: ['wireless', 'interference', intPage],
    queryFn: () => fetchInterference(intPage),
    enabled: tab === 'interference',
  });
  const [showIntModal, setShowIntModal] = useState(false);
  const [editingInt, setEditingInt] = useState<InterferenceRecord | null>(null);
  const [intForm, setIntForm] = useState<Partial<InterferenceBody>>({});
  const [intErr, setIntErr] = useState('');

  function openIntModal(rec?: InterferenceRecord) {
    setEditingInt(rec ?? null);
    setIntForm(rec
      ? {
          site_id: rec.site_id ?? undefined,
          frequency_mhz: rec.frequency_mhz ?? undefined,
          channel_width_mhz: rec.channel_width_mhz ?? undefined,
          interference_level: rec.interference_level ?? undefined,
          detected_at: rec.detected_at ?? undefined,
          notes: rec.notes ?? '',
        }
      : {});
    setIntErr('');
    setShowIntModal(true);
  }

  const saveIntMut = useMutation({
    mutationFn: () => editingInt
      ? updateInterference(editingInt.id, intForm)
      : createInterference(intForm as InterferenceBody),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['wireless', 'interference'] });
      setShowIntModal(false);
    },
    onError: (e: unknown) => setIntErr((e as { message?: string })?.message ?? 'Failed'),
  });

  const deleteIntMut = useMutation({
    mutationFn: deleteInterference,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['wireless', 'interference'] }),
  });

  const intTotalPages = Math.ceil((intQ.data?.meta.total ?? 0) / PAGE_SIZE) || 1;

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div style={styles.page}>
      {/* Page header */}
      <div style={styles.header}>
        <div>
          <h1 style={styles.pageTitle}>{t('wirelessManagement.title')}</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', margin: 0 }}>
            {t('wirelessManagement.subtitle')}
          </p>
        </div>
      </div>

      {/* Tab bar */}
      <div style={{ borderBottom: '1px solid var(--border)', marginBottom: '1.5rem', display: 'flex', gap: '0.25rem' }}>
        {(['apSectors', 'channelPlans', 'apCommands', 'interference'] as const).map(t2 => (
          <button key={t2} style={tabBtn(tab === t2)} onClick={() => setTab(t2)}>
            {t(`wirelessManagement.tabs.${t2}`)}
          </button>
        ))}
      </div>

      {/* ================================================================ */}
      {/* TAB: AP Sectors */}
      {/* ================================================================ */}
      {tab === 'apSectors' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '1rem' }}>
            <button style={styles.btnPrimary} onClick={() => openApModal()}>
              + {t('wirelessManagement.apSectors.new')}
            </button>
          </div>
          {apQ.isLoading && <p style={styles.msg}>{t('wirelessManagement.loading')}</p>}
          {apQ.isError && <p style={styles.msgError}>{t('wirelessManagement.apSectors.loadError')}</p>}
          {apQ.data && (
            <>
              <div style={styles.tableCard}>
                <table style={styles.table}>
                  <thead>
                    <tr>
                      <th style={styles.thNum}>ID</th>
                      <th style={styles.th}>{t('wirelessManagement.apSectors.device')}</th>
                      <th style={styles.thNum}>{t('wirelessManagement.apSectors.azimuth')}</th>
                      <th style={styles.thNum}>{t('wirelessManagement.apSectors.frequency')}</th>
                      <th style={styles.thNum}>{t('wirelessManagement.apSectors.channelWidth')}</th>
                      <th style={styles.thNum}>{t('wirelessManagement.apSectors.txPower')}</th>
                      <th style={styles.th}>{t('wirelessManagement.apSectors.encryption')}</th>
                      <th style={styles.thNum}>{t('wirelessManagement.apSectors.maxClients')}</th>
                      <th style={styles.th}>{t('wirelessManagement.apSectors.status')}</th>
                      <th style={styles.th}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {apQ.data.data.length === 0 && (
                      <tr><td colSpan={10} style={styles.msg}>{t('wirelessManagement.apSectors.noItems')}</td></tr>
                    )}
                    {apQ.data.data.map(ap => (
                      <>
                        <tr key={ap.id} style={styles.tr}>
                          <td style={styles.tdNum}>{ap.id}</td>
                          <td style={styles.td}><strong>{ap.device_name ?? (ap.device_id ? `#${ap.device_id}` : '—')}</strong></td>
                          <td style={styles.tdNum}>{ap.sector_azimuth_deg !== null ? `${ap.sector_azimuth_deg}°` : '—'}</td>
                          <td style={styles.tdNum}>{ap.frequency_mhz !== null ? `${ap.frequency_mhz}` : '—'}</td>
                          <td style={styles.tdNum}>{ap.channel_width_mhz !== null ? `${ap.channel_width_mhz}` : '—'}</td>
                          <td style={styles.tdNum}>{ap.tx_power_dbm !== null ? `${ap.tx_power_dbm}` : '—'}</td>
                          <td style={styles.td}>{ap.encryption ?? '—'}</td>
                          <td style={styles.tdNum}>{ap.max_clients ?? '—'}</td>
                          <td style={styles.td}>
                            <span style={{ color: ap.status === 'active' ? '#059669' : '#6b7280', fontWeight: 600, fontSize: '0.82rem' }}>
                              {ap.status}
                            </span>
                          </td>
                          <td style={styles.td}>
                            <button
                              style={styles.actionBtn}
                              onClick={() => setExpandedApId(expandedApId === ap.id ? null : ap.id)}
                            >
                              {t('wirelessManagement.apSectors.clients')}
                            </button>
                            <button style={styles.actionBtn} onClick={() => openApModal(ap)}>
                              {t('wirelessManagement.edit')}
                            </button>
                            <button
                              style={{ ...styles.actionBtn, color: 'var(--danger)' }}
                              onClick={() => {
                                if (window.confirm(t('wirelessManagement.confirmDelete'))) {
                                  deleteApMut.mutate(ap.id);
                                }
                              }}
                            >
                              {t('wirelessManagement.delete')}
                            </button>
                          </td>
                        </tr>
                        {expandedApId === ap.id && (
                          <tr key={`clients-${ap.id}`}>
                            <td colSpan={10} style={{ padding: '0.75rem 1rem', background: 'var(--bg-subtle, #f9fafb)' }}>
                              <div style={{ fontWeight: 700, fontSize: '0.85rem', marginBottom: '0.5rem', color: 'var(--text-primary)' }}>
                                {t('wirelessManagement.apSectors.clientsTitle')}
                              </div>
                              {clientsQ.isLoading && <p style={styles.msg}>{t('wirelessManagement.loading')}</p>}
                              {clientsQ.data && clientsQ.data.data.length === 0 && (
                                <p style={styles.msg}>{t('wirelessManagement.apSectors.noClients')}</p>
                              )}
                              {clientsQ.data && clientsQ.data.data.length > 0 && (
                                <table style={{ ...styles.table, fontSize: '0.8rem' }}>
                                  <thead>
                                    <tr>
                                      <th style={styles.th}>{t('wirelessManagement.apSectors.clientMac')}</th>
                                      <th style={styles.thNum}>{t('wirelessManagement.apSectors.clientSignal')}</th>
                                      <th style={styles.thNum}>{t('wirelessManagement.apSectors.clientSnr')}</th>
                                      <th style={styles.thNum}>{t('wirelessManagement.apSectors.clientCcq')}</th>
                                      <th style={styles.thNum}>{t('wirelessManagement.apSectors.clientDistance')}</th>
                                      <th style={styles.thNum}>{t('wirelessManagement.apSectors.clientRate')}</th>
                                      <th style={styles.th}>{t('wirelessManagement.apSectors.clientLastSeen')}</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {clientsQ.data.data.map(c => (
                                      <tr key={c.id} style={styles.tr}>
                                        <td style={styles.tdMono}>{c.client_mac}</td>
                                        <td style={styles.tdNum}>{c.signal_dbm !== null ? `${c.signal_dbm}` : '—'}</td>
                                        <td style={styles.tdNum}>{c.snr_db !== null ? `${c.snr_db}` : '—'}</td>
                                        <td style={styles.tdNum}>{c.ccq_percent !== null ? `${c.ccq_percent}` : '—'}</td>
                                        <td style={styles.tdNum}>{c.distance_m !== null ? `${c.distance_m}` : '—'}</td>
                                        <td style={styles.tdNum}>{c.tx_rate_mbps !== null ? `${c.tx_rate_mbps}` : '—'}</td>
                                        <td style={styles.td}>{fmtDate(c.last_seen)}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              )}
                            </td>
                          </tr>
                        )}
                      </>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={styles.pagination}>
                <button style={styles.pageBtn} onClick={() => setApPage(p => Math.max(1, p - 1))} disabled={apPage <= 1}>
                  &laquo; {t('wirelessManagement.prev')}
                </button>
                <span style={styles.pageInfo}>{apPage} / {apTotalPages}</span>
                <button style={styles.pageBtn} onClick={() => setApPage(p => p + 1)} disabled={apPage >= apTotalPages}>
                  {t('wirelessManagement.next')} &raquo;
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* ================================================================ */}
      {/* TAB: Channel Plans */}
      {/* ================================================================ */}
      {tab === 'channelPlans' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '1rem' }}>
            <button style={styles.btnPrimary} onClick={() => openCpModal()}>
              + {t('wirelessManagement.channelPlans.new')}
            </button>
          </div>
          {cpQ.isLoading && <p style={styles.msg}>{t('wirelessManagement.loading')}</p>}
          {cpQ.isError && <p style={styles.msgError}>{t('wirelessManagement.channelPlans.loadError')}</p>}
          {cpQ.data && (
            <>
              <div style={styles.tableCard}>
                <table style={styles.table}>
                  <thead>
                    <tr>
                      <th style={styles.thNum}>ID</th>
                      <th style={styles.th}>{t('wirelessManagement.channelPlans.name')}</th>
                      <th style={styles.th}>{t('wirelessManagement.channelPlans.site')}</th>
                      <th style={styles.thNum}>{t('wirelessManagement.channelPlans.frequency')}</th>
                      <th style={styles.thNum}>{t('wirelessManagement.channelPlans.channelWidth')}</th>
                      <th style={styles.th}>{t('wirelessManagement.channelPlans.status')}</th>
                      <th style={styles.th}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {cpQ.data.data.length === 0 && (
                      <tr><td colSpan={7} style={styles.msg}>{t('wirelessManagement.channelPlans.noItems')}</td></tr>
                    )}
                    {cpQ.data.data.map(cp => (
                      <tr key={cp.id} style={styles.tr}>
                        <td style={styles.tdNum}>{cp.id}</td>
                        <td style={styles.td}><strong>{cp.name}</strong></td>
                        <td style={styles.td}>{cp.site_name ?? (cp.site_id ? `#${cp.site_id}` : '—')}</td>
                        <td style={styles.tdNum}>{cp.frequency_mhz ?? '—'}</td>
                        <td style={styles.tdNum}>{cp.channel_width_mhz ?? '—'}</td>
                        <td style={styles.td}>
                          <span style={{ color: cp.status === 'active' ? '#059669' : '#6b7280', fontWeight: 600, fontSize: '0.82rem' }}>
                            {cp.status}
                          </span>
                        </td>
                        <td style={styles.td}>
                          <button style={styles.actionBtn} onClick={() => openCpModal(cp)}>
                            {t('wirelessManagement.edit')}
                          </button>
                          <button
                            style={{ ...styles.actionBtn, color: 'var(--danger)' }}
                            onClick={() => {
                              if (window.confirm(t('wirelessManagement.confirmDelete'))) {
                                deleteCpMut.mutate(cp.id);
                              }
                            }}
                          >
                            {t('wirelessManagement.delete')}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={styles.pagination}>
                <button style={styles.pageBtn} onClick={() => setCpPage(p => Math.max(1, p - 1))} disabled={cpPage <= 1}>
                  &laquo; {t('wirelessManagement.prev')}
                </button>
                <span style={styles.pageInfo}>{cpPage} / {cpTotalPages}</span>
                <button style={styles.pageBtn} onClick={() => setCpPage(p => p + 1)} disabled={cpPage >= cpTotalPages}>
                  {t('wirelessManagement.next')} &raquo;
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* ================================================================ */}
      {/* TAB: AP Commands */}
      {/* ================================================================ */}
      {tab === 'apCommands' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '1rem' }}>
            <button style={styles.btnPrimary} onClick={() => { setCmdErr(''); setCmdForm({ command_type: 'power_adjust' }); setShowCmdModal(true); }}>
              + {t('wirelessManagement.apCommands.new')}
            </button>
          </div>
          {cmdQ.isLoading && <p style={styles.msg}>{t('wirelessManagement.loading')}</p>}
          {cmdQ.isError && <p style={styles.msgError}>{t('wirelessManagement.apCommands.loadError')}</p>}
          {cmdQ.data && (
            <>
              <div style={styles.tableCard}>
                <table style={styles.table}>
                  <thead>
                    <tr>
                      <th style={styles.thNum}>ID</th>
                      <th style={styles.th}>{t('wirelessManagement.apCommands.device')}</th>
                      <th style={styles.th}>{t('wirelessManagement.apCommands.commandType')}</th>
                      <th style={styles.th}>{t('wirelessManagement.apCommands.targetValue')}</th>
                      <th style={styles.th}>{t('wirelessManagement.apCommands.status')}</th>
                      <th style={styles.th}>{t('wirelessManagement.apCommands.created')}</th>
                      <th style={styles.th}>{t('wirelessManagement.apCommands.completed')}</th>
                      <th style={styles.th}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {cmdQ.data.data.length === 0 && (
                      <tr><td colSpan={8} style={styles.msg}>{t('wirelessManagement.apCommands.noItems')}</td></tr>
                    )}
                    {cmdQ.data.data.map(cmd => (
                      <tr key={cmd.id} style={styles.tr}>
                        <td style={styles.tdNum}>{cmd.id}</td>
                        <td style={styles.td}>{cmd.device_name ?? (cmd.device_id ? `#${cmd.device_id}` : '—')}</td>
                        <td style={styles.tdMono}>{cmd.command_type}</td>
                        <td style={styles.tdMono}>{cmd.target_value ?? '—'}</td>
                        <td style={styles.td}>
                          <span style={{ color: commandStatusColor(cmd.status), fontWeight: 600, fontSize: '0.82rem' }}>
                            {cmd.status}
                          </span>
                        </td>
                        <td style={styles.td}>{fmtDate(cmd.created_at)}</td>
                        <td style={styles.td}>{fmtDate(cmd.completed_at)}</td>
                        <td style={styles.td}>
                          <button
                            style={{ ...styles.actionBtn, color: 'var(--danger)' }}
                            onClick={() => {
                              if (window.confirm(t('wirelessManagement.confirmDelete'))) {
                                deleteCmdMut.mutate(cmd.id);
                              }
                            }}
                          >
                            {t('wirelessManagement.delete')}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={styles.pagination}>
                <button style={styles.pageBtn} onClick={() => setCmdPage(p => Math.max(1, p - 1))} disabled={cmdPage <= 1}>
                  &laquo; {t('wirelessManagement.prev')}
                </button>
                <span style={styles.pageInfo}>{cmdPage} / {cmdTotalPages}</span>
                <button style={styles.pageBtn} onClick={() => setCmdPage(p => p + 1)} disabled={cmdPage >= cmdTotalPages}>
                  {t('wirelessManagement.next')} &raquo;
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* ================================================================ */}
      {/* TAB: Interference Log */}
      {/* ================================================================ */}
      {tab === 'interference' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '1rem' }}>
            <button style={styles.btnPrimary} onClick={() => openIntModal()}>
              + {t('wirelessManagement.interference.new')}
            </button>
          </div>
          {intQ.isLoading && <p style={styles.msg}>{t('wirelessManagement.loading')}</p>}
          {intQ.isError && <p style={styles.msgError}>{t('wirelessManagement.interference.loadError')}</p>}
          {intQ.data && (
            <>
              <div style={styles.tableCard}>
                <table style={styles.table}>
                  <thead>
                    <tr>
                      <th style={styles.thNum}>ID</th>
                      <th style={styles.th}>{t('wirelessManagement.interference.site')}</th>
                      <th style={styles.thNum}>{t('wirelessManagement.interference.frequency')}</th>
                      <th style={styles.thNum}>{t('wirelessManagement.interference.channelWidth')}</th>
                      <th style={styles.th}>{t('wirelessManagement.interference.level')}</th>
                      <th style={styles.th}>{t('wirelessManagement.interference.detectedAt')}</th>
                      <th style={styles.th}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {intQ.data.data.length === 0 && (
                      <tr><td colSpan={7} style={styles.msg}>{t('wirelessManagement.interference.noItems')}</td></tr>
                    )}
                    {intQ.data.data.map(rec => (
                      <tr key={rec.id} style={styles.tr}>
                        <td style={styles.tdNum}>{rec.id}</td>
                        <td style={styles.td}>{rec.site_name ?? (rec.site_id ? `#${rec.site_id}` : '—')}</td>
                        <td style={styles.tdNum}>{rec.frequency_mhz ?? '—'}</td>
                        <td style={styles.tdNum}>{rec.channel_width_mhz ?? '—'}</td>
                        <td style={styles.td}>
                          <span style={{ color: interferenceLevelColor(rec.interference_level), fontWeight: 600, fontSize: '0.82rem' }}>
                            {rec.interference_level ?? '—'}
                          </span>
                        </td>
                        <td style={styles.td}>{fmtDate(rec.detected_at)}</td>
                        <td style={styles.td}>
                          <button style={styles.actionBtn} onClick={() => openIntModal(rec)}>
                            {t('wirelessManagement.edit')}
                          </button>
                          <button
                            style={{ ...styles.actionBtn, color: 'var(--danger)' }}
                            onClick={() => {
                              if (window.confirm(t('wirelessManagement.confirmDelete'))) {
                                deleteIntMut.mutate(rec.id);
                              }
                            }}
                          >
                            {t('wirelessManagement.delete')}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={styles.pagination}>
                <button style={styles.pageBtn} onClick={() => setIntPage(p => Math.max(1, p - 1))} disabled={intPage <= 1}>
                  &laquo; {t('wirelessManagement.prev')}
                </button>
                <span style={styles.pageInfo}>{intPage} / {intTotalPages}</span>
                <button style={styles.pageBtn} onClick={() => setIntPage(p => p + 1)} disabled={intPage >= intTotalPages}>
                  {t('wirelessManagement.next')} &raquo;
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* ================================================================ */}
      {/* MODALS */}
      {/* ================================================================ */}

      {/* AP Sector Modal */}
      {showApModal && (
        <div style={modalStyles.backdrop}>
          <div style={modalStyles.panel}>
            <div style={modalStyles.header}>
              <h2 style={modalStyles.title}>
                {editingAp ? t('wirelessManagement.apSectors.edit') : t('wirelessManagement.apSectors.new')}
              </h2>
              <button style={modalStyles.closeBtn} onClick={() => setShowApModal(false)}>&#x2715;</button>
            </div>
            <div style={modalStyles.form}>
              <label style={modalStyles.label}>
                {t('wirelessManagement.apSectors.device')} <RequiredMark />
                <select
                  style={modalStyles.select}
                  value={apForm.device_id ?? ''}
                  onChange={e => setApForm(f => ({ ...f, device_id: e.target.value ? Number(e.target.value) : undefined }))}
                >
                  <option value="">—</option>
                  {deviceOptions.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </label>
              <label style={modalStyles.label}>
                {t('wirelessManagement.apSectors.azimuth')}
                <input
                  style={modalStyles.input}
                  type="number"
                  min={0}
                  max={360}
                  value={apForm.sector_azimuth_deg ?? ''}
                  onChange={e => setApForm(f => ({ ...f, sector_azimuth_deg: e.target.value ? Number(e.target.value) : undefined }))}
                />
              </label>
              <label style={modalStyles.label}>
                {t('wirelessManagement.apSectors.sectorWidth')}
                <input
                  style={modalStyles.input}
                  type="number"
                  min={0}
                  max={360}
                  value={apForm.sector_width_deg ?? ''}
                  onChange={e => setApForm(f => ({ ...f, sector_width_deg: e.target.value ? Number(e.target.value) : undefined }))}
                />
              </label>
              <label style={modalStyles.label}>
                {t('wirelessManagement.apSectors.frequency')}
                <input
                  style={modalStyles.input}
                  type="number"
                  placeholder="5180"
                  value={apForm.frequency_mhz ?? ''}
                  onChange={e => setApForm(f => ({ ...f, frequency_mhz: e.target.value ? Number(e.target.value) : undefined }))}
                />
              </label>
              <label style={modalStyles.label}>
                {t('wirelessManagement.apSectors.channelWidth')}
                <input
                  style={modalStyles.input}
                  type="number"
                  placeholder="20"
                  value={apForm.channel_width_mhz ?? ''}
                  onChange={e => setApForm(f => ({ ...f, channel_width_mhz: e.target.value ? Number(e.target.value) : undefined }))}
                />
              </label>
              <label style={modalStyles.label}>
                {t('wirelessManagement.apSectors.txPower')}
                <input
                  style={modalStyles.input}
                  type="number"
                  value={apForm.tx_power_dbm ?? ''}
                  onChange={e => setApForm(f => ({ ...f, tx_power_dbm: e.target.value ? Number(e.target.value) : undefined }))}
                />
              </label>
              <label style={modalStyles.label}>
                {t('wirelessManagement.apSectors.encryption')}
                <select
                  style={modalStyles.select}
                  value={apForm.encryption ?? 'none'}
                  onChange={e => setApForm(f => ({ ...f, encryption: e.target.value }))}
                >
                  {ENCRYPTION_OPTIONS.map(e => <option key={e} value={e}>{e}</option>)}
                </select>
              </label>
              <label style={modalStyles.label}>
                {t('wirelessManagement.apSectors.maxClients')}
                <input
                  style={modalStyles.input}
                  type="number"
                  min={1}
                  value={apForm.max_clients ?? ''}
                  onChange={e => setApForm(f => ({ ...f, max_clients: e.target.value ? Number(e.target.value) : undefined }))}
                />
              </label>
              <label style={modalStyles.label}>
                {t('wirelessManagement.apSectors.status')}
                <select
                  style={modalStyles.select}
                  value={apForm.status ?? 'active'}
                  onChange={e => setApForm(f => ({ ...f, status: e.target.value }))}
                >
                  {SECTOR_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </label>
              <label style={modalStyles.label}>
                {t('wirelessManagement.notes')}
                <input
                  style={modalStyles.input}
                  value={apForm.notes ?? ''}
                  onChange={e => setApForm(f => ({ ...f, notes: e.target.value }))}
                />
              </label>
            </div>
            {apErr && <p style={modalStyles.error}>{apErr}</p>}
            <div style={modalStyles.actions}>
              <button style={styles.btnSecondary} onClick={() => setShowApModal(false)}>
                {t('wirelessManagement.cancel')}
              </button>
              <button style={styles.btnPrimary} disabled={saveApMut.isPending} onClick={() => saveApMut.mutate()}>
                {t('wirelessManagement.save')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Channel Plan Modal */}
      {showCpModal && (
        <div style={modalStyles.backdrop}>
          <div style={modalStyles.panel}>
            <div style={modalStyles.header}>
              <h2 style={modalStyles.title}>
                {editingCp ? t('wirelessManagement.channelPlans.edit') : t('wirelessManagement.channelPlans.new')}
              </h2>
              <button style={modalStyles.closeBtn} onClick={() => setShowCpModal(false)}>&#x2715;</button>
            </div>
            <div style={modalStyles.form}>
              <label style={modalStyles.label}>
                {t('wirelessManagement.channelPlans.name')} <RequiredMark />
                <input
                  style={modalStyles.input}
                  value={cpForm.name ?? ''}
                  onChange={e => setCpForm(f => ({ ...f, name: e.target.value }))}
                />
              </label>
              <label style={modalStyles.label}>
                {t('wirelessManagement.channelPlans.site')}
                <select
                  style={modalStyles.select}
                  value={cpForm.site_id ?? ''}
                  onChange={e => setCpForm(f => ({ ...f, site_id: e.target.value ? Number(e.target.value) : undefined }))}
                >
                  <option value="">—</option>
                  {siteOptions.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </label>
              <label style={modalStyles.label}>
                {t('wirelessManagement.channelPlans.frequency')}
                <input
                  style={modalStyles.input}
                  type="number"
                  placeholder="5180"
                  value={cpForm.frequency_mhz ?? ''}
                  onChange={e => setCpForm(f => ({ ...f, frequency_mhz: e.target.value ? Number(e.target.value) : undefined }))}
                />
              </label>
              <label style={modalStyles.label}>
                {t('wirelessManagement.channelPlans.channelWidth')}
                <input
                  style={modalStyles.input}
                  type="number"
                  placeholder="20"
                  value={cpForm.channel_width_mhz ?? ''}
                  onChange={e => setCpForm(f => ({ ...f, channel_width_mhz: e.target.value ? Number(e.target.value) : undefined }))}
                />
              </label>
              <label style={modalStyles.label}>
                {t('wirelessManagement.channelPlans.status')}
                <select
                  style={modalStyles.select}
                  value={cpForm.status ?? 'active'}
                  onChange={e => setCpForm(f => ({ ...f, status: e.target.value }))}
                >
                  {PLAN_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </label>
              <label style={modalStyles.label}>
                {t('wirelessManagement.channelPlans.notes')}
                <input
                  style={modalStyles.input}
                  value={cpForm.notes ?? ''}
                  onChange={e => setCpForm(f => ({ ...f, notes: e.target.value }))}
                />
              </label>
            </div>
            {cpErr && <p style={modalStyles.error}>{cpErr}</p>}
            <div style={modalStyles.actions}>
              <button style={styles.btnSecondary} onClick={() => setShowCpModal(false)}>
                {t('wirelessManagement.cancel')}
              </button>
              <button style={styles.btnPrimary} disabled={saveCpMut.isPending} onClick={() => saveCpMut.mutate()}>
                {t('wirelessManagement.save')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* AP Command Modal */}
      {showCmdModal && (
        <div style={modalStyles.backdrop}>
          <div style={modalStyles.panel}>
            <div style={modalStyles.header}>
              <h2 style={modalStyles.title}>{t('wirelessManagement.apCommands.new')}</h2>
              <button style={modalStyles.closeBtn} onClick={() => setShowCmdModal(false)}>&#x2715;</button>
            </div>
            <div style={modalStyles.form}>
              <label style={modalStyles.label}>
                {t('wirelessManagement.apCommands.device')} <RequiredMark />
                <select
                  style={modalStyles.select}
                  value={cmdForm.device_id ?? ''}
                  onChange={e => setCmdForm(f => ({ ...f, device_id: e.target.value ? Number(e.target.value) : undefined }))}
                >
                  <option value="">—</option>
                  {deviceOptions.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </label>
              <label style={modalStyles.label}>
                {t('wirelessManagement.apCommands.commandType')} <RequiredMark />
                <select
                  style={modalStyles.select}
                  value={cmdForm.command_type ?? 'power_adjust'}
                  onChange={e => setCmdForm(f => ({ ...f, command_type: e.target.value }))}
                >
                  {COMMAND_TYPES.map(ct => <option key={ct} value={ct}>{ct}</option>)}
                </select>
              </label>
              <label style={modalStyles.label}>
                {t('wirelessManagement.apCommands.targetValue')}
                <input
                  style={modalStyles.input}
                  value={cmdForm.target_value ?? ''}
                  onChange={e => setCmdForm(f => ({ ...f, target_value: e.target.value || undefined }))}
                />
              </label>
              <label style={modalStyles.label}>
                {t('wirelessManagement.apCommands.notes')}
                <input
                  style={modalStyles.input}
                  value={cmdForm.notes ?? ''}
                  onChange={e => setCmdForm(f => ({ ...f, notes: e.target.value || undefined }))}
                />
              </label>
            </div>
            {cmdErr && <p style={modalStyles.error}>{cmdErr}</p>}
            <div style={modalStyles.actions}>
              <button style={styles.btnSecondary} onClick={() => setShowCmdModal(false)}>
                {t('wirelessManagement.cancel')}
              </button>
              <button style={styles.btnPrimary} disabled={createCmdMut.isPending} onClick={() => createCmdMut.mutate()}>
                {t('wirelessManagement.save')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Interference Modal */}
      {showIntModal && (
        <div style={modalStyles.backdrop}>
          <div style={modalStyles.panel}>
            <div style={modalStyles.header}>
              <h2 style={modalStyles.title}>
                {editingInt ? t('wirelessManagement.interference.edit') : t('wirelessManagement.interference.new')}
              </h2>
              <button style={modalStyles.closeBtn} onClick={() => setShowIntModal(false)}>&#x2715;</button>
            </div>
            <div style={modalStyles.form}>
              <label style={modalStyles.label}>
                {t('wirelessManagement.interference.site')}
                <select
                  style={modalStyles.select}
                  value={intForm.site_id ?? ''}
                  onChange={e => setIntForm(f => ({ ...f, site_id: e.target.value ? Number(e.target.value) : undefined }))}
                >
                  <option value="">—</option>
                  {siteOptions.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </label>
              <label style={modalStyles.label}>
                {t('wirelessManagement.interference.frequency')}
                <input
                  style={modalStyles.input}
                  type="number"
                  placeholder="5180"
                  value={intForm.frequency_mhz ?? ''}
                  onChange={e => setIntForm(f => ({ ...f, frequency_mhz: e.target.value ? Number(e.target.value) : undefined }))}
                />
              </label>
              <label style={modalStyles.label}>
                {t('wirelessManagement.interference.channelWidth')}
                <input
                  style={modalStyles.input}
                  type="number"
                  placeholder="20"
                  value={intForm.channel_width_mhz ?? ''}
                  onChange={e => setIntForm(f => ({ ...f, channel_width_mhz: e.target.value ? Number(e.target.value) : undefined }))}
                />
              </label>
              <label style={modalStyles.label}>
                {t('wirelessManagement.interference.level')}
                <select
                  style={modalStyles.select}
                  value={intForm.interference_level ?? ''}
                  onChange={e => setIntForm(f => ({ ...f, interference_level: e.target.value || undefined }))}
                >
                  <option value="">—</option>
                  {INTERFERENCE_LEVELS.map(l => <option key={l} value={l}>{l}</option>)}
                </select>
              </label>
              <label style={modalStyles.label}>
                {t('wirelessManagement.interference.detectedAt')}
                <input
                  style={modalStyles.input}
                  type="datetime-local"
                  value={intForm.detected_at ? intForm.detected_at.slice(0, 16) : ''}
                  onChange={e => setIntForm(f => ({ ...f, detected_at: e.target.value ? `${e.target.value}:00` : undefined }))}
                />
              </label>
              <label style={modalStyles.label}>
                {t('wirelessManagement.interference.notes')}
                <input
                  style={modalStyles.input}
                  value={intForm.notes ?? ''}
                  onChange={e => setIntForm(f => ({ ...f, notes: e.target.value }))}
                />
              </label>
            </div>
            {intErr && <p style={modalStyles.error}>{intErr}</p>}
            <div style={modalStyles.actions}>
              <button style={styles.btnSecondary} onClick={() => setShowIntModal(false)}>
                {t('wirelessManagement.cancel')}
              </button>
              <button style={styles.btnPrimary} disabled={saveIntMut.isPending} onClick={() => saveIntMut.mutate()}>
                {t('wirelessManagement.save')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
