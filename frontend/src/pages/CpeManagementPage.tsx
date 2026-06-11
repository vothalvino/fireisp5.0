// =============================================================================
// FireISP 5.0 — CPE Management Page (§8.1)
// =============================================================================
// Tabbed page:
//   Tab 1: CPE Devices  — list with status badge, manufacturer, model, last inform
//   Tab 2: Firmware Versions — list/create/delete
//   Tab 3: Firmware Campaigns — list/create with status tracking
// =============================================================================

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';
import { styles, modalStyles, RequiredMark } from './crudStyles';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CpeDevice {
  id: number;
  serial_number: string;
  oui: string;
  manufacturer: string | null;
  model_name: string | null;
  status: string;
  last_inform_at: string | null;
  last_inform_ip: string | null;
  wan_ip: string | null;
  cpe_profile_id: number | null;
  contract_id: number | null;
  organization_id: number | null;
}

interface CpeDeviceListResponse {
  data: CpeDevice[];
  meta: { total: number; page: number; limit: number };
}

interface FirmwareVersion {
  id: number;
  manufacturer: string;
  model_name: string;
  version: string;
  firmware_url: string;
  is_stable: number;
  checksum_type: string | null;
  release_notes: string | null;
}

interface FirmwareVersionListResponse {
  data: FirmwareVersion[];
  meta: { total: number; page: number; limit: number };
}

interface FirmwareCampaign {
  id: number;
  name: string;
  firmware_version_id: number;
  firmware_version_label?: string;
  status: string;
  scheduled_at: string | null;
  total_devices: number;
  completed_devices: number;
  failed_devices: number;
}

interface FirmwareCampaignListResponse {
  data: FirmwareCampaign[];
  meta: { total: number; page: number; limit: number };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PAGE_SIZE = 25;
function statusColor(status: string): string {
  switch (status) {
    case 'active': return '#16a34a';
    case 'provisioning': return '#2563eb';
    case 'new': return '#9ca3af';
    case 'error': return '#dc2626';
    case 'offline': return '#6b7280';
    case 'running': return '#2563eb';
    case 'done': return '#16a34a';
    case 'failed': return '#dc2626';
    case 'cancelled': return '#9ca3af';
    default: return '#9ca3af';
  }
}

// ---------------------------------------------------------------------------
// Tab bar
// ---------------------------------------------------------------------------

const tabStyle = (active: boolean) => ({
  padding: '8px 20px',
  borderRadius: 6,
  border: 'none',
  cursor: 'pointer',
  fontWeight: active ? 600 : 400,
  background: active ? '#2563eb' : '#f3f4f6',
  color: active ? '#fff' : '#374151',
  marginRight: 8,
});

// ---------------------------------------------------------------------------
// Devices Tab
// ---------------------------------------------------------------------------

function DevicesTab() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ serial_number: '', oui: '', manufacturer: '', model_name: '' });
  const [createError, setCreateError] = useState('');

  const { data, isLoading, error } = useQuery<CpeDeviceListResponse>({
    queryKey: ['cpe-devices', page],
    queryFn: async () => {
      const res = await api.GET('/cpe-management/devices' as never, {
        params: { query: { page, limit: PAGE_SIZE } as never },
      } as never);
      if ((res as { error?: unknown }).error) throw new Error('Failed to load devices');
      return (res as { data: unknown }).data as unknown as CpeDeviceListResponse;
    },
  });

  const createMut = useMutation({
    mutationFn: async (body: typeof form) => {
      const res = await api.POST('/cpe-management/devices' as never, { body } as never);
      if ((res as { error?: unknown }).error) throw new Error('Create failed');
      return (res as { data: unknown }).data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cpe-devices'] });
      setShowCreate(false);
      setForm({ serial_number: '', oui: '', manufacturer: '', model_name: '' });
    },
    onError: (e: Error) => setCreateError(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: async (id: number) => {
      await api.DELETE('/cpe-management/devices/{id}' as never, { params: { path: { id } } } as never);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cpe-devices'] }),
  });

  const devices = data?.data ?? [];
  const total = data?.meta?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <span style={{ color: '#6b7280' }}>{total} {t('cpeManagement.devices.title')}</span>
        <button style={styles.btnPrimary} onClick={() => setShowCreate(true)}>
          + {t('cpeManagement.devices.newDevice')}
        </button>
      </div>

      {isLoading && <p>{t('common.loading')}</p>}
      {error && <p style={{ color: '#dc2626' }}>{t('cpeManagement.devices.error')}</p>}

      {!isLoading && devices.length === 0 && (
        <p style={{ color: '#6b7280' }}>{t('cpeManagement.devices.empty')}</p>
      )}

      {devices.length > 0 && (
        <div style={styles.tableCard}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>ID</th>
                <th style={styles.th}>{t('cpeManagement.devices.serialNumber')}</th>
                <th style={styles.th}>{t('cpeManagement.devices.oui')}</th>
                <th style={styles.th}>{t('cpeManagement.devices.manufacturer')}</th>
                <th style={styles.th}>{t('cpeManagement.devices.model')}</th>
                <th style={styles.th}>{t('cpeManagement.devices.status')}</th>
                <th style={styles.th}>{t('cpeManagement.devices.lastInform')}</th>
                <th style={styles.th}></th>
              </tr>
            </thead>
            <tbody>
              {devices.map(d => (
                <tr key={d.id} style={styles.tr}>
                  <td style={styles.td}>{d.id}</td>
                  <td style={styles.td}><code>{d.serial_number}</code></td>
                  <td style={styles.td}><code>{d.oui}</code></td>
                  <td style={styles.td}>{d.manufacturer ?? '—'}</td>
                  <td style={styles.td}>{d.model_name ?? '—'}</td>
                  <td style={styles.td}>
                    <span style={{ color: statusColor(d.status), fontWeight: 600 }}>{d.status}</span>
                  </td>
                  <td style={styles.td}>
                    {d.last_inform_at ? new Date(d.last_inform_at).toLocaleString() : '—'}
                  </td>
                  <td style={styles.td}>
                    <button
                      style={styles.btnDanger}
                      onClick={() => { if (confirm('Delete this CPE device?')) deleteMut.mutate(d.id); }}
                    >
                      {t('common.delete')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 && (
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <button style={styles.btnSecondary} disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
            {t('common.prev')}
          </button>
          <span style={{ padding: '6px 12px' }}>{page} / {totalPages}</span>
          <button style={styles.btnSecondary} disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>
            {t('common.next')}
          </button>
        </div>
      )}

      {showCreate && (
        <div style={modalStyles.backdrop}>
          <div style={modalStyles.panel}>
            <h3 style={{ marginTop: 0 }}>{t('cpeManagement.devices.createTitle')}</h3>
            {createError && <p style={{ color: '#dc2626' }}>{createError}</p>}
            <label style={modalStyles.label}>{t('cpeManagement.devices.serialNumber')}<RequiredMark /></label>
            <input style={modalStyles.input} value={form.serial_number} onChange={e => setForm(f => ({ ...f, serial_number: e.target.value }))} />
            <label style={modalStyles.label}>{t('cpeManagement.devices.oui')}<RequiredMark /></label>
            <input style={modalStyles.input} placeholder="EC1724" maxLength={6} value={form.oui} onChange={e => setForm(f => ({ ...f, oui: e.target.value }))} />
            <label style={modalStyles.label}>{t('cpeManagement.devices.manufacturer')}</label>
            <input style={modalStyles.input} value={form.manufacturer} onChange={e => setForm(f => ({ ...f, manufacturer: e.target.value }))} />
            <label style={modalStyles.label}>{t('cpeManagement.devices.model')}</label>
            <input style={modalStyles.input} value={form.model_name} onChange={e => setForm(f => ({ ...f, model_name: e.target.value }))} />
            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
              <button style={styles.btnPrimary} disabled={createMut.isPending} onClick={() => createMut.mutate(form)}>
                {createMut.isPending ? t('common.saving') : t('common.save')}
              </button>
              <button style={styles.btnSecondary} onClick={() => { setShowCreate(false); setCreateError(''); }}>
                {t('common.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Firmware Versions Tab
// ---------------------------------------------------------------------------

function FirmwareTab() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ manufacturer: '', model_name: '', version: '', firmware_url: '' });
  const [createError, setCreateError] = useState('');

  const { data, isLoading, error } = useQuery<FirmwareVersionListResponse>({
    queryKey: ['cpe-firmware-versions', page],
    queryFn: async () => {
      const res = await api.GET('/cpe-management/firmware-versions' as never, {
        params: { query: { page, limit: PAGE_SIZE } as never },
      } as never);
      if ((res as { error?: unknown }).error) throw new Error('Failed to load firmware versions');
      return (res as { data: unknown }).data as unknown as FirmwareVersionListResponse;
    },
  });

  const createMut = useMutation({
    mutationFn: async (body: typeof form) => {
      const res = await api.POST('/cpe-management/firmware-versions' as never, { body } as never);
      if ((res as { error?: unknown }).error) throw new Error('Create failed');
      return (res as { data: unknown }).data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cpe-firmware-versions'] });
      setShowCreate(false);
      setForm({ manufacturer: '', model_name: '', version: '', firmware_url: '' });
    },
    onError: (e: Error) => setCreateError(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: async (id: number) => {
      await api.DELETE('/cpe-management/firmware-versions/{id}' as never, { params: { path: { id } } } as never);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cpe-firmware-versions'] }),
  });

  const versions = data?.data ?? [];
  const total = data?.meta?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <span style={{ color: '#6b7280' }}>{total} {t('cpeManagement.firmware.title')}</span>
        <button style={styles.btnPrimary} onClick={() => setShowCreate(true)}>
          + {t('cpeManagement.firmware.newVersion')}
        </button>
      </div>

      {isLoading && <p>{t('common.loading')}</p>}
      {error && <p style={{ color: '#dc2626' }}>{t('cpeManagement.firmware.error')}</p>}

      {!isLoading && versions.length === 0 && (
        <p style={{ color: '#6b7280' }}>{t('cpeManagement.firmware.empty')}</p>
      )}

      {versions.length > 0 && (
        <div style={styles.tableCard}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>ID</th>
                <th style={styles.th}>{t('cpeManagement.firmware.manufacturer')}</th>
                <th style={styles.th}>{t('cpeManagement.firmware.model')}</th>
                <th style={styles.th}>{t('cpeManagement.firmware.version')}</th>
                <th style={styles.th}>{t('cpeManagement.firmware.stable')}</th>
                <th style={styles.th}></th>
              </tr>
            </thead>
            <tbody>
              {versions.map(v => (
                <tr key={v.id} style={styles.tr}>
                  <td style={styles.td}>{v.id}</td>
                  <td style={styles.td}>{v.manufacturer}</td>
                  <td style={styles.td}>{v.model_name}</td>
                  <td style={styles.td}><code>{v.version}</code></td>
                  <td style={styles.td}>{v.is_stable ? '✓' : '—'}</td>
                  <td style={styles.td}>
                    <button style={styles.btnDanger} onClick={() => { if (confirm('Delete?')) deleteMut.mutate(v.id); }}>
                      {t('common.delete')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 && (
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <button style={styles.btnSecondary} disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
            {t('common.prev')}
          </button>
          <span style={{ padding: '6px 12px' }}>{page} / {totalPages}</span>
          <button style={styles.btnSecondary} disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>
            {t('common.next')}
          </button>
        </div>
      )}

      {showCreate && (
        <div style={modalStyles.backdrop}>
          <div style={modalStyles.panel}>
            <h3 style={{ marginTop: 0 }}>{t('cpeManagement.firmware.createTitle')}</h3>
            {createError && <p style={{ color: '#dc2626' }}>{createError}</p>}
            <label style={modalStyles.label}>{t('cpeManagement.firmware.manufacturer')}<RequiredMark /></label>
            <input style={modalStyles.input} value={form.manufacturer} onChange={e => setForm(f => ({ ...f, manufacturer: e.target.value }))} />
            <label style={modalStyles.label}>{t('cpeManagement.firmware.model')}<RequiredMark /></label>
            <input style={modalStyles.input} value={form.model_name} onChange={e => setForm(f => ({ ...f, model_name: e.target.value }))} />
            <label style={modalStyles.label}>{t('cpeManagement.firmware.version')}<RequiredMark /></label>
            <input style={modalStyles.input} value={form.version} onChange={e => setForm(f => ({ ...f, version: e.target.value }))} />
            <label style={modalStyles.label}>{t('cpeManagement.firmware.url')}<RequiredMark /></label>
            <input style={modalStyles.input} value={form.firmware_url} onChange={e => setForm(f => ({ ...f, firmware_url: e.target.value }))} />
            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
              <button style={styles.btnPrimary} disabled={createMut.isPending} onClick={() => createMut.mutate(form)}>
                {createMut.isPending ? t('common.saving') : t('common.save')}
              </button>
              <button style={styles.btnSecondary} onClick={() => { setShowCreate(false); setCreateError(''); }}>
                {t('common.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Campaigns Tab
// ---------------------------------------------------------------------------

function CampaignsTab() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: '', firmware_version_id: '' });
  const [createError, setCreateError] = useState('');

  const { data, isLoading, error } = useQuery<FirmwareCampaignListResponse>({
    queryKey: ['cpe-firmware-campaigns', page],
    queryFn: async () => {
      const res = await api.GET('/cpe-management/firmware-campaigns' as never, {
        params: { query: { page, limit: PAGE_SIZE } as never },
      } as never);
      if ((res as { error?: unknown }).error) throw new Error('Failed to load campaigns');
      return (res as { data: unknown }).data as unknown as FirmwareCampaignListResponse;
    },
  });

  const createMut = useMutation({
    mutationFn: async (body: { name: string; firmware_version_id: number }) => {
      const res = await api.POST('/cpe-management/firmware-campaigns' as never, { body } as never);
      if ((res as { error?: unknown }).error) throw new Error('Create failed');
      return (res as { data: unknown }).data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cpe-firmware-campaigns'] });
      setShowCreate(false);
      setForm({ name: '', firmware_version_id: '' });
    },
    onError: (e: Error) => setCreateError(e.message),
  });

  const campaigns = data?.data ?? [];
  const total = data?.meta?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <span style={{ color: '#6b7280' }}>{total} {t('cpeManagement.campaigns.title')}</span>
        <button style={styles.btnPrimary} onClick={() => setShowCreate(true)}>
          + {t('cpeManagement.campaigns.newCampaign')}
        </button>
      </div>

      {isLoading && <p>{t('common.loading')}</p>}
      {error && <p style={{ color: '#dc2626' }}>{t('cpeManagement.campaigns.error')}</p>}

      {!isLoading && campaigns.length === 0 && (
        <p style={{ color: '#6b7280' }}>{t('cpeManagement.campaigns.empty')}</p>
      )}

      {campaigns.length > 0 && (
        <div style={styles.tableCard}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>ID</th>
                <th style={styles.th}>{t('cpeManagement.campaigns.name')}</th>
                <th style={styles.th}>{t('cpeManagement.campaigns.firmwareVersion')}</th>
                <th style={styles.th}>{t('cpeManagement.campaigns.status')}</th>
                <th style={styles.th}>{t('cpeManagement.campaigns.scheduledAt')}</th>
                <th style={styles.th}>{t('cpeManagement.campaigns.devices')}</th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map(c => (
                <tr key={c.id} style={styles.tr}>
                  <td style={styles.td}>{c.id}</td>
                  <td style={styles.td}>{c.name}</td>
                  <td style={styles.td}>{c.firmware_version_label ?? c.firmware_version_id}</td>
                  <td style={styles.td}>
                    <span style={{ color: statusColor(c.status), fontWeight: 600 }}>{c.status}</span>
                  </td>
                  <td style={styles.td}>{c.scheduled_at ? new Date(c.scheduled_at).toLocaleString() : '—'}</td>
                  <td style={styles.td}>{c.completed_devices}/{c.total_devices}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 && (
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <button style={styles.btnSecondary} disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
            {t('common.prev')}
          </button>
          <span style={{ padding: '6px 12px' }}>{page} / {totalPages}</span>
          <button style={styles.btnSecondary} disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>
            {t('common.next')}
          </button>
        </div>
      )}

      {showCreate && (
        <div style={modalStyles.backdrop}>
          <div style={modalStyles.panel}>
            <h3 style={{ marginTop: 0 }}>{t('cpeManagement.campaigns.createTitle')}</h3>
            {createError && <p style={{ color: '#dc2626' }}>{createError}</p>}
            <label style={modalStyles.label}>{t('cpeManagement.campaigns.name')}<RequiredMark /></label>
            <input style={modalStyles.input} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
            <label style={modalStyles.label}>{t('cpeManagement.campaigns.firmwareVersion')}<RequiredMark /></label>
            <input style={modalStyles.input} type="number" placeholder="Firmware Version ID" value={form.firmware_version_id} onChange={e => setForm(f => ({ ...f, firmware_version_id: e.target.value }))} />
            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
              <button
                style={styles.btnPrimary}
                disabled={createMut.isPending}
                onClick={() => createMut.mutate({ name: form.name, firmware_version_id: Number(form.firmware_version_id) })}
              >
                {createMut.isPending ? t('common.saving') : t('common.save')}
              </button>
              <button style={styles.btnSecondary} onClick={() => { setShowCreate(false); setCreateError(''); }}>
                {t('common.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

type TabKey = 'devices' | 'firmware' | 'campaigns';

export function CpeManagementPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<TabKey>('devices');

  return (
    <div style={{ padding: 24 }}>
      <h1 style={{ margin: '0 0 4px' }}>{t('cpeManagement.title')}</h1>
      <p style={{ color: '#6b7280', marginTop: 0, marginBottom: 24 }}>{t('cpeManagement.subtitle')}</p>

      <div style={{ marginBottom: 24 }}>
        {(['devices', 'firmware', 'campaigns'] as TabKey[]).map(k => (
          <button key={k} style={tabStyle(tab === k)} onClick={() => setTab(k)}>
            {t(`cpeManagement.tabs.${k}`)}
          </button>
        ))}
      </div>

      {tab === 'devices' && <DevicesTab />}
      {tab === 'firmware' && <FirmwareTab />}
      {tab === 'campaigns' && <CampaignsTab />}
    </div>
  );
}
