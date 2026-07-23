// =============================================================================
// FireISP 5.0 — Device / Network Map
// =============================================================================
// Shows the ISP's physical/logical network topology:
//   • Sites section — site cards with devices grouped under each site
//   • SNMP status badge per device (online / offline / maintenance + SNMP indicator)
//   • Network Links table — device-to-device connections with type, capacity, status
//   • "Unassigned" group for devices not linked to any site
// All data fetched from:
//   GET /api/v1/sites          — site list
//   GET /api/v1/devices        — device list (with site_id)
//   GET /api/v1/network-links  — link list (device_a_id, device_b_id)
// =============================================================================

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, tokenStore } from '@/api/client';
import { useAuth } from '@/auth/AuthContext';
import { can } from '@/auth/permissions';
import {
  extractApiError,
  overlay,
  modalBox,
  errorBox,
  labelStyle,
  inputStyle,
  twoCol,
  submitBtn,
  cancelBtn,
  dangerBtn,
} from '@/components/ClientFormModal';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Site {
  id: number;
  name: string;
  site_type: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  status: string;
  latitude: number | null;
  longitude: number | null;
}

interface Device {
  id: number;
  site_id: number | null;
  name: string;
  type: string;
  manufacturer: string | null;
  model: string | null;
  ip_address: string | null;
  status: string;
  snmp_enabled: boolean | number;
  snmp_community?: string | null;
  snmp_version?: string | null;
  snmp_port?: number | null;
  snmp_profile_id?: number | null;
  deleted_at?: string | null;
  serial_number?: string | null;
  mac_address?: string | null;
}

interface NetworkLink {
  id: number;
  device_a_id: number;
  device_b_id: number;
  link_type: string;
  capacity_mbps: number | null;
  interface_a: string | null;
  interface_b: string | null;
  status: string;
}

interface ListResponse<T> {
  data: T[];
  meta?: { total: number; page: number; limit: number; totalPages: number };
}

// ---------------------------------------------------------------------------
// Fetch helpers
// ---------------------------------------------------------------------------

const API_BASE = '/api/v1';

async function fetchAll<T>(path: string, query = ''): Promise<T[]> {
  const token = tokenStore.getAccess();
  const res = await fetch(`${API_BASE}${path}?limit=1000${query}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error(`Failed to load ${path}`);
  const json = (await res.json()) as ListResponse<T>;
  return json.data;
}

async function fetchSites(): Promise<Site[]> {
  return fetchAll<Site>('/sites');
}

async function fetchDevices(includeDeleted = false): Promise<Device[]> {
  return fetchAll<Device>('/devices', includeDeleted ? '&include_deleted=true' : '');
}

async function fetchLinks(): Promise<NetworkLink[]> {
  return fetchAll<NetworkLink>('/network-links');
}

// ---------------------------------------------------------------------------
// Status badge helpers
// ---------------------------------------------------------------------------

function DeviceStatusBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; color: string }> = {
    online:      { bg: '#d1fae5', color: '#065f46' },
    offline:     { bg: '#fee2e2', color: '#991b1b' },
    maintenance: { bg: '#fef9c3', color: '#854d0e' },
  };
  const s = map[status] ?? { bg: '#f3f4f6', color: '#374151' };
  return (
    <span style={{
      background: s.bg, color: s.color,
      padding: '1px 7px', borderRadius: 10,
      fontSize: '0.7rem', fontWeight: 600, textTransform: 'capitalize',
    }}>
      {status}
    </span>
  );
}

function SiteStatusDot({ status }: { status: string }) {
  const color = status === 'active' ? '#22c55e' : status === 'inactive' ? '#f87171' : '#fbbf24';
  return (
    <span style={{
      display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
      background: color, marginRight: 5, verticalAlign: 'middle',
    }} />
  );
}

function LinkStatusBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; color: string }> = {
    active:         { bg: '#d1fae5', color: '#065f46' },
    down:           { bg: '#fee2e2', color: '#991b1b' },
    maintenance:    { bg: '#fef9c3', color: '#854d0e' },
    decommissioned: { bg: '#f3f4f6', color: '#9ca3af' },
  };
  const s = map[status] ?? { bg: '#f3f4f6', color: '#374151' };
  return (
    <span style={{
      background: s.bg, color: s.color,
      padding: '2px 8px', borderRadius: 12,
      fontSize: '0.72rem', fontWeight: 600, textTransform: 'capitalize',
    }}>
      {status}
    </span>
  );
}

const DEVICE_ICON: Record<string, string> = {
  router:      '🔀',
  switch:      '🔄',
  olt:         '💡',
  onu:         '🔌',
  ptp:         '📡',
  ptmp_ap:     '📶',
  outdoor_cpe: '🛰️',
  indoor_cpe:  '📺',
  other:       '🖧',
};

function deviceIcon(type: string): string {
  return DEVICE_ICON[type] ?? '🖧';
}

// ---------------------------------------------------------------------------
// Device chip — compact card for a device inside a site
// ---------------------------------------------------------------------------

interface DeviceChipActions {
  canEdit: boolean;
  canDelete: boolean;
  onEdit: (d: Device) => void;
  onDelete: (d: Device) => void;
  onRestore: (d: Device) => void;
}

function DeviceChip({ device, actions }: { device: Device; actions?: DeviceChipActions }) {
  const [hovered, setHovered] = useState(false);
  const archived = Boolean(device.deleted_at);
  return (
    <div
      style={{
        border: '1px solid #e5e7eb',
        borderRadius: 8,
        padding: '8px 10px',
        background: archived ? '#f9fafb' : hovered ? '#f0f4ff' : '#fff',
        opacity: archived ? 0.7 : 1,
        cursor: 'default',
        minWidth: 160,
        transition: 'background .15s',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div style={{ fontWeight: 600, fontSize: '0.82rem', marginBottom: 3 }}>
        {deviceIcon(device.type)}&nbsp;
        <Link to={`/devices/${device.id}`} style={{ color: 'inherit', textDecoration: 'none' }}>
          {device.name}
        </Link>
      </div>
      <div style={{ fontSize: '0.72rem', color: '#6b7280', marginBottom: 3 }}>
        {device.manufacturer ? `${device.manufacturer} ` : ''}
        {device.model ?? device.type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
      </div>
      {device.ip_address && (
        <div style={{ fontSize: '0.72rem', color: '#6b7280', fontFamily: 'monospace', marginBottom: 4 }}>
          {device.ip_address}
        </div>
      )}
      <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
        {archived ? (
          <span style={{
            background: '#f3f4f6', color: '#6b7280',
            padding: '1px 7px', borderRadius: 10, fontSize: '0.68rem', fontWeight: 600,
          }}>
            Archived
          </span>
        ) : (
          <DeviceStatusBadge status={device.status} />
        )}
        {(device.snmp_enabled === true || device.snmp_enabled === 1) && (
          <span style={{
            background: '#ede9fe', color: '#5b21b6',
            padding: '1px 7px', borderRadius: 10,
            fontSize: '0.68rem', fontWeight: 600,
          }}>
            SNMP
          </span>
        )}
      </div>
      {actions && (actions.canEdit || actions.canDelete) && (
        <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
          {archived ? (
            actions.canEdit && (
              <button type="button" style={chipBtn} onClick={() => actions.onRestore(device)}>↩ Restore</button>
            )
          ) : (
            <>
              {actions.canEdit && (
                <button type="button" style={chipBtn} onClick={() => actions.onEdit(device)}>✏️ Edit</button>
              )}
              {actions.canDelete && (
                <button type="button" style={chipDangerBtn} onClick={() => actions.onDelete(device)}>🗑 Archive</button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Site card — shows site info + its devices
// ---------------------------------------------------------------------------

interface SiteCardProps {
  site: Site;
  devices: Device[];
  actions?: DeviceChipActions;
}

function SiteCard({ site, devices, actions }: SiteCardProps) {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <div style={{
      border: '1px solid #e5e7eb',
      borderRadius: 10,
      background: '#fff',
      boxShadow: '0 0 0 1px var(--border)',
      overflow: 'hidden',
    }}>
      {/* Site header */}
      <div
        style={{
          background: '#f9fafb',
          padding: '10px 14px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          cursor: 'pointer',
          borderBottom: collapsed ? 'none' : '1px solid #e5e7eb',
        }}
        onClick={() => setCollapsed(c => !c)}
      >
        <div>
          <span style={{ fontWeight: 700, fontSize: '0.9rem', marginRight: 6 }}>
            <SiteStatusDot status={site.status} />
            {site.id > 0 ? (
              <Link to={`/sites/${site.id}`} style={{ color: 'inherit', textDecoration: 'none', fontWeight: 700 }}>
                {site.name}
              </Link>
            ) : site.name}
          </span>
          {site.site_type && (
            <span style={{ fontSize: '0.73rem', color: '#6b7280' }}>
              ({site.site_type})
            </span>
          )}
          {(site.city || site.state) && (
            <span style={{ fontSize: '0.73rem', color: '#9ca3af', marginLeft: 8 }}>
              📍 {[site.city, site.state].filter(Boolean).join(', ')}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: '0.75rem', color: '#9ca3af' }}>
            {devices.length} device{devices.length !== 1 ? 's' : ''}
          </span>
          <span style={{ color: '#9ca3af', fontSize: '0.8rem' }}>{collapsed ? '▶' : '▼'}</span>
        </div>
      </div>

      {/* Device chips */}
      {!collapsed && (
        <div style={{ padding: 12 }}>
          {devices.length === 0 ? (
            <p style={{ margin: 0, color: '#9ca3af', fontSize: '0.8rem', fontStyle: 'italic' }}>
              No devices assigned to this site.
            </p>
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {devices.map(d => <DeviceChip key={d.id} device={d} actions={actions} />)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Network Links Table
// ---------------------------------------------------------------------------

interface LinksTableProps {
  links: NetworkLink[];
  deviceMap: Map<number, Device>;
}

function LinksTable({ links, deviceMap }: LinksTableProps) {
  function devLabel(id: number): string {
    const d = deviceMap.get(id);
    return d ? d.name : `#${id}`;
  }

  const LINK_TYPE_COLOR: Record<string, string> = {
    fiber:    'var(--link)',
    wireless: '#059669',
    copper:   '#b45309',
    virtual:  '#7c3aed',
    other:    '#6b7280',
  };

  return (
    <div style={{ overflowX: 'auto', marginTop: '1.5rem' }}>
      <h2 style={{ fontSize: '1rem', fontWeight: 700, margin: '0 0 0.75rem' }}>🔗 Network Links</h2>
      {links.length === 0 ? (
        <p style={{ color: '#9ca3af', fontStyle: 'italic', fontSize: '0.85rem' }}>No network links defined.</p>
      ) : (
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={th}>#</th>
              <th style={th}>Device A</th>
              <th style={th}>Interface A</th>
              <th style={th}>Device B</th>
              <th style={th}>Interface B</th>
              <th style={th}>Type</th>
              <th style={th}>Capacity</th>
              <th style={th}>Status</th>
            </tr>
          </thead>
          <tbody>
            {links.map(l => (
              <tr key={l.id}>
                <td style={td}>{l.id}</td>
                <td style={{ ...td, fontWeight: 500 }}>{devLabel(l.device_a_id)}</td>
                <td style={{ ...td, fontFamily: 'monospace', fontSize: '0.8rem' }}>{l.interface_a ?? '—'}</td>
                <td style={{ ...td, fontWeight: 500 }}>{devLabel(l.device_b_id)}</td>
                <td style={{ ...td, fontFamily: 'monospace', fontSize: '0.8rem' }}>{l.interface_b ?? '—'}</td>
                <td style={td}>
                  <span style={{
                    background: '#f3f4f6', color: LINK_TYPE_COLOR[l.link_type] ?? '#374151',
                    padding: '2px 7px', borderRadius: 10, fontSize: '0.72rem', fontWeight: 600,
                    textTransform: 'capitalize',
                  }}>
                    {l.link_type}
                  </span>
                </td>
                <td style={td}>{l.capacity_mbps ? `${l.capacity_mbps} Mbps` : '—'}</td>
                <td style={td}><LinkStatusBadge status={l.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Summary bar
// ---------------------------------------------------------------------------

interface SummaryBarProps {
  sites: Site[];
  devices: Device[];
  links: NetworkLink[];
}

function SummaryBar({ sites, devices, links }: SummaryBarProps) {
  const online = devices.filter(d => d.status === 'online').length;
  const offline = devices.filter(d => d.status === 'offline').length;
  const snmpEnabled = devices.filter(d => d.snmp_enabled === true || d.snmp_enabled === 1).length;
  const activeLinks = links.filter(l => l.status === 'active').length;

  const stat = (label: string, value: string | number, color?: string) => (
    <div style={{
      background: '#fff',
      border: '1px solid #e5e7eb',
      borderRadius: 8,
      padding: '10px 16px',
      minWidth: 120,
    }}>
      <div style={{ fontSize: '1.3rem', fontWeight: 700, color: color ?? '#111' }}>{value}</div>
      <div style={{ fontSize: '0.72rem', color: '#6b7280', marginTop: 1 }}>{label}</div>
    </div>
  );

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: '1.5rem' }}>
      {stat('Sites', sites.length)}
      {stat('Devices', devices.length)}
      {stat('Online', online, '#059669')}
      {stat('Offline', offline, offline > 0 ? '#dc2626' : '#059669')}
      {stat('SNMP Monitored', snmpEnabled, '#7c3aed')}
      {stat('Active Links', activeLinks)}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Device create/edit modal
// ---------------------------------------------------------------------------

// MUST mirror the backend enums exactly (schemas/devices.js ↔ devices table).
// The previous lists ('ap'/'antenna'/'server'/'cpe' types; 'active'/'inactive'/
// 'decommissioned' statuses) matched NEITHER — and since the form always sends
// status (defaulting to the invalid 'active'), EVERY create from this modal
// failed with "Validation failed".
const DEVICE_TYPES: { value: string; label: string }[] = [
  { value: 'outdoor_cpe', label: 'Outdoor CPE' },
  { value: 'indoor_cpe', label: 'Indoor CPE' },
  { value: 'ptp', label: 'PtP link' },
  { value: 'ptmp_ap', label: 'PtMP AP' },
  { value: 'olt', label: 'OLT' },
  { value: 'router', label: 'Router' },
  { value: 'switch', label: 'Switch' },
  { value: 'onu', label: 'ONU' },
  { value: 'other', label: 'Other' },
];
const DEVICE_STATUSES = ['online', 'offline', 'maintenance'];

interface DeviceFormProps {
  mode: 'create' | 'edit';
  device?: Device;
  sites: Site[];
  onClose: () => void;
  onSaved: () => void;
}

function DeviceFormModal({ mode, device, sites, onClose, onSaved }: DeviceFormProps) {
  const [form, setForm] = useState({
    name: device?.name ?? '',
    type: device?.type ?? 'router',
    status: device?.status ?? 'offline',
    site_id: device?.site_id != null ? String(device.site_id) : '',
    manufacturer: device?.manufacturer ?? '',
    model: device?.model ?? '',
    serial_number: device?.serial_number ?? '',
    mac_address: device?.mac_address ?? '',
    ip_address: device?.ip_address ?? '',
    snmp_enabled: Boolean(device?.snmp_enabled),
    snmp_community: device?.snmp_community ?? '',
    snmp_version: device?.snmp_version ?? 'v2c',
    snmp_port: device?.snmp_port != null ? String(device.snmp_port) : '161',
    snmp_profile_id: device?.snmp_profile_id != null ? String(device.snmp_profile_id) : '',
  });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // SNMP profiles decide WHAT gets recorded (each profile is an OID→metric
  // list, incl. the per-model CPE templates seeded by migration 413).
  const profilesQ = useQuery({
    queryKey: ['snmp-profiles-for-device-form'],
    queryFn: async () => {
      const res = await api.GET('/snmp-profiles', { params: { query: { limit: 100 } as never } });
      if ((res as { error?: unknown }).error) return [] as { id: number; name: string }[];
      return (((res as unknown as { data: { data: { id: number; name: string }[] } }).data?.data) ?? []);
    },
  });

  const set = (k: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm(f => ({ ...f, [k]: e.target.value }));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) { setError('Name is required.'); return; }
    setSaving(true);
    setError(null);
    const body: Record<string, string | number | boolean> = {
      name: form.name.trim(),
      type: form.type,
      status: form.status,
    };
    if (form.site_id) body.site_id = Number(form.site_id);
    (['manufacturer', 'model', 'serial_number', 'mac_address', 'ip_address'] as const).forEach(k => {
      const v = form[k].trim();
      if (v) body[k] = v;
    });
    body.snmp_enabled = form.snmp_enabled;
    if (form.snmp_enabled) {
      body.snmp_version = form.snmp_version;
      if (form.snmp_community.trim()) body.snmp_community = form.snmp_community.trim();
      if (form.snmp_port) body.snmp_port = Number(form.snmp_port);
      if (form.snmp_profile_id) body.snmp_profile_id = Number(form.snmp_profile_id);
    }

    const { error: apiError } = mode === 'create'
      ? await api.POST('/devices', { body: body as never })
      : await api.PUT('/devices/{id}', { params: { path: { id: device!.id } }, body: body as never });

    setSaving(false);
    if (apiError) { setError(extractApiError(apiError, 'Failed to save device.')); return; }
    onSaved();
  }

  const title = mode === 'create' ? 'New Device' : `Edit ${device?.name ?? 'Device'}`;

  return (
    <div style={overlay} role="dialog" aria-modal="true" aria-label={title}>
      <div style={{ ...modalBox, width: 540, maxHeight: '90vh', overflowY: 'auto' }}>
        <h3 style={{ margin: '0 0 1rem' }}>{title}</h3>
        {error && <div style={errorBox}>{error}</div>}
        <form onSubmit={handleSubmit}>
          <label style={labelStyle}>Name *</label>
          <input style={inputStyle} type="text" value={form.name} onChange={set('name')} required autoFocus />

          <div style={twoCol}>
            <div>
              <label style={labelStyle}>Type</label>
              <select style={inputStyle} value={form.type} onChange={set('type')}>
                {DEVICE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Status</label>
              <select style={inputStyle} value={form.status} onChange={set('status')}>
                {DEVICE_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>

          <label style={labelStyle}>Site</label>
          <select style={inputStyle} value={form.site_id} onChange={set('site_id')}>
            <option value="">— Unassigned —</option>
            {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>

          <div style={twoCol}>
            <div>
              <label style={labelStyle}>Manufacturer</label>
              <input style={inputStyle} type="text" value={form.manufacturer} onChange={set('manufacturer')} />
            </div>
            <div>
              <label style={labelStyle}>Model</label>
              <input style={inputStyle} type="text" value={form.model} onChange={set('model')} />
            </div>
          </div>

          <div style={twoCol}>
            <div>
              <label style={labelStyle}>MAC Address</label>
              <input style={inputStyle} type="text" value={form.mac_address} onChange={set('mac_address')} maxLength={17} />
            </div>
            <div>
              <label style={labelStyle}>IP Address</label>
              <input style={inputStyle} type="text" value={form.ip_address} onChange={set('ip_address')} maxLength={45} />
            </div>
          </div>

          <label style={labelStyle}>Serial Number</label>
          <input style={inputStyle} type="text" value={form.serial_number} onChange={set('serial_number')} maxLength={100} />

          {/* SNMP monitoring — the profile decides WHAT metrics get recorded */}
          <div style={{ borderTop: '1px solid var(--border-color, #e5e7eb)', marginTop: '1rem', paddingTop: '0.75rem' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600, fontSize: '0.85rem', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={form.snmp_enabled}
                onChange={e => setForm(f => ({ ...f, snmp_enabled: e.target.checked }))}
              />
              SNMP monitoring
            </label>
            {form.snmp_enabled && (
              <div style={{ marginTop: 8 }}>
                <div style={twoCol}>
                  <div>
                    <label style={labelStyle}>Version</label>
                    <select style={inputStyle} value={form.snmp_version} onChange={set('snmp_version')}>
                      <option value="v1">v1</option>
                      <option value="v2c">v2c</option>
                      <option value="v3">v3</option>
                    </select>
                  </div>
                  <div>
                    <label style={labelStyle}>Port</label>
                    <input style={inputStyle} type="number" min={1} max={65535} value={form.snmp_port} onChange={set('snmp_port')} />
                  </div>
                </div>
                <label style={labelStyle}>Community</label>
                <input style={inputStyle} type="text" value={form.snmp_community} onChange={set('snmp_community')} maxLength={100} placeholder="public" />
                <label style={labelStyle}>Profile (what to record)</label>
                <select style={inputStyle} value={form.snmp_profile_id} onChange={set('snmp_profile_id')}>
                  <option value="">— No profile (not polled) —</option>
                  {(profilesQ.data ?? []).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <p style={{ fontSize: '0.72rem', color: 'var(--text-muted, #6b7280)', margin: '4px 0 0' }}>
                  The profile is the OID→metric list the poller records (traffic, errors, signal, CCQ, CPU…).
                  Model templates exist for LiteBeam 5AC Gen2, PowerBeam M5-400 and airCube ISP.
                  (The RG-EW1300G has no SNMP agent — it is cloud-managed and cannot be SNMP-monitored.)
                </p>
              </div>
            )}
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: '1.25rem' }}>
            <button type="button" style={cancelBtn} onClick={onClose} disabled={saving}>Cancel</button>
            <button type="submit" style={submitBtn} disabled={saving}>{saving ? 'Saving…' : (mode === 'create' ? 'Create Device' : 'Save Changes')}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Delete device confirmation modal
// ---------------------------------------------------------------------------

function DeleteDeviceModal({
  device,
  onClose,
  onDeleted,
}: {
  device: Device;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleDelete() {
    setSaving(true);
    setError(null);
    const { error: apiError } = await api.DELETE('/devices/{id}', {
      params: { path: { id: device.id } },
    });
    setSaving(false);
    if (apiError) { setError(extractApiError(apiError, 'Failed to archive device.')); return; }
    onDeleted();
  }

  return (
    <div style={overlay} role="dialog" aria-modal="true" aria-label="Archive device">
      <div style={modalBox}>
        <h3 style={{ margin: '0 0 1rem' }}>Archive Device</h3>
        {error && <div style={errorBox}>{error}</div>}
        <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
          Archive <strong>{device.name}</strong>? It can be restored later from the archived view.
        </p>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: '1.25rem' }}>
          <button type="button" style={cancelBtn} onClick={onClose} disabled={saving}>Cancel</button>
          <button type="button" style={dangerBtn} onClick={handleDelete} disabled={saving}>{saving ? 'Archiving…' : 'Archive'}</button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export function DeviceMap() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [siteFilter, setSiteFilter] = useState('');
  const [deviceStatusFilter, setDeviceStatusFilter] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [formTarget, setFormTarget] = useState<{ mode: 'create' | 'edit'; device?: Device } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Device | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const canCreate = can(user, 'devices.create');
  const canEditDevice = can(user, 'devices.update');
  const canDeleteDevice = can(user, 'devices.delete');

  const sitesQuery = useQuery({ queryKey: ['sites'], queryFn: fetchSites });
  const devicesQuery = useQuery({
    queryKey: ['devices-all', showArchived],
    queryFn: () => fetchDevices(showArchived),
  });
  const linksQuery = useQuery({ queryKey: ['network-links'], queryFn: fetchLinks });

  const refreshDevices = () => queryClient.invalidateQueries({ queryKey: ['devices-all'] });

  async function handleRestore(device: Device) {
    setActionError(null);
    const { error: apiError } = await api.POST('/devices/{id}/restore', {
      params: { path: { id: device.id } },
    });
    if (apiError) { setActionError(extractApiError(apiError, 'Failed to restore device.')); return; }
    refreshDevices();
  }

  const deviceActions: DeviceChipActions = {
    canEdit: canEditDevice,
    canDelete: canDeleteDevice,
    onEdit: (d) => setFormTarget({ mode: 'edit', device: d }),
    onDelete: (d) => setDeleteTarget(d),
    onRestore: handleRestore,
  };

  const isLoading = sitesQuery.isLoading || devicesQuery.isLoading || linksQuery.isLoading;
  const error = sitesQuery.error ?? devicesQuery.error ?? linksQuery.error;

  const allSites: Site[] = sitesQuery.data ?? [];
  const allDevices: Device[] = devicesQuery.data ?? [];
  const allLinks: NetworkLink[] = linksQuery.data ?? [];

  // Filtered sites
  const sites = allSites.filter(s =>
    !siteFilter || s.name.toLowerCase().includes(siteFilter.toLowerCase()),
  );

  // Filtered devices
  const devices = allDevices.filter(d =>
    !deviceStatusFilter || d.status === deviceStatusFilter,
  );

  const deviceMap = new Map<number, Device>(allDevices.map(d => [d.id, d]));

  // Group devices by site
  const devicesBySite = new Map<number | null, Device[]>();
  devices.forEach(d => {
    const key = d.site_id ?? null;
    if (!devicesBySite.has(key)) devicesBySite.set(key, []);
    devicesBySite.get(key)!.push(d);
  });

  const unassigned = devicesBySite.get(null) ?? [];

  return (
    <div style={{ padding: '1.5rem', maxWidth: 1200 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
        <h1 style={{ margin: 0, fontSize: '1.4rem' }}>🖧 Device / Network Map</h1>
        {canCreate && (
          <button style={btnPrimary} onClick={() => setFormTarget({ mode: 'create' })}>
            + New Device
          </button>
        )}
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 8, marginBottom: '1.25rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          style={filterInput}
          placeholder="Filter sites by name…"
          value={siteFilter}
          onChange={e => setSiteFilter(e.target.value)}
        />
        <select
          style={filterSelect}
          value={deviceStatusFilter}
          onChange={e => setDeviceStatusFilter(e.target.value)}
        >
          <option value="">All device statuses</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="maintenance">Maintenance</option>
          <option value="decommissioned">Decommissioned</option>
        </select>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.82rem', color: '#6b7280', cursor: 'pointer' }}>
          <input type="checkbox" checked={showArchived} onChange={e => setShowArchived(e.target.checked)} />
          Show archived
        </label>
        {(siteFilter || deviceStatusFilter) && (
          <button style={btnSecondary} onClick={() => { setSiteFilter(''); setDeviceStatusFilter(''); }}>
            Clear
          </button>
        )}
      </div>

      {actionError && <p style={{ color: '#e00', fontSize: '0.85rem' }}>{actionError}</p>}

      {isLoading && <p style={{ color: '#888' }}>Loading network map…</p>}
      {error && <p style={{ color: '#e00' }}>Failed to load network data.</p>}

      {!isLoading && !error && (
        <>
          {/* Summary bar */}
          <SummaryBar sites={allSites} devices={allDevices} links={allLinks} />

          {/* Sites + their devices */}
          <h2 style={{ fontSize: '1rem', fontWeight: 700, margin: '0 0 0.75rem' }}>📍 Sites</h2>
          {sites.length === 0 && !siteFilter && (
            <p style={{ color: '#9ca3af', fontStyle: 'italic', fontSize: '0.85rem' }}>No sites defined.</p>
          )}
          {sites.length === 0 && siteFilter && (
            <p style={{ color: '#9ca3af', fontStyle: 'italic', fontSize: '0.85rem' }}>No sites match "{siteFilter}".</p>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {sites.map(site => (
              <SiteCard
                key={site.id}
                site={site}
                devices={devicesBySite.get(site.id) ?? []}
                actions={deviceActions}
              />
            ))}
          </div>

          {/* Unassigned devices */}
          {unassigned.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <SiteCard
                site={{
                  id: -1,
                  name: 'Unassigned',
                  site_type: null,
                  address: null,
                  city: null,
                  state: null,
                  status: 'active',
                  latitude: null,
                  longitude: null,
                }}
                devices={unassigned}
                actions={deviceActions}
              />
            </div>
          )}

          {/* Network links */}
          <LinksTable links={allLinks} deviceMap={deviceMap} />
        </>
      )}

      {/* Modals */}
      {formTarget && (
        <DeviceFormModal
          mode={formTarget.mode}
          device={formTarget.device}
          sites={allSites}
          onClose={() => setFormTarget(null)}
          onSaved={() => { setFormTarget(null); refreshDevices(); }}
        />
      )}
      {deleteTarget && (
        <DeleteDeviceModal
          device={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onDeleted={() => { setDeleteTarget(null); refreshDevices(); }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const filterInput: React.CSSProperties = {
  padding: '6px 10px', borderRadius: 6, border: '1px solid #d1d5db',
  fontSize: '0.85rem', background: '#fff', minWidth: 200,
};
const filterSelect: React.CSSProperties = {
  padding: '6px 10px', borderRadius: 6, border: '1px solid #d1d5db',
  fontSize: '0.85rem', background: '#fff',
};
const btnSecondary: React.CSSProperties = {
  background: '#fff', color: '#374151', border: '1px solid #d1d5db',
  padding: '6px 14px', borderRadius: 6, cursor: 'pointer', fontSize: '0.85rem',
};
const btnPrimary: React.CSSProperties = {
  background: 'var(--accent)', color: '#fff', border: 'none',
  padding: '7px 16px', borderRadius: 6, cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600,
};
const chipBtn: React.CSSProperties = {
  background: '#fff', color: '#374151', border: '1px solid #d1d5db',
  padding: '2px 8px', borderRadius: 6, cursor: 'pointer', fontSize: '0.7rem',
};
const chipDangerBtn: React.CSSProperties = {
  background: '#fff', color: '#dc2626', border: '1px solid #fecaca',
  padding: '2px 8px', borderRadius: 6, cursor: 'pointer', fontSize: '0.7rem',
};
const tableStyle: React.CSSProperties = {
  width: '100%', borderCollapse: 'collapse', background: '#fff',
  borderRadius: 8, overflow: 'hidden',
  boxShadow: '0 0 0 1px var(--border)',
};
const th: React.CSSProperties = {
  padding: '10px 12px', textAlign: 'left', fontSize: '0.78rem',
  fontWeight: 700, color: '#555', background: '#f9fafb',
  borderBottom: '1px solid #e5e7eb',
};
const td: React.CSSProperties = {
  padding: '10px 12px', fontSize: '0.85rem', color: '#374151',
  borderBottom: '1px solid #f3f4f6',
};
