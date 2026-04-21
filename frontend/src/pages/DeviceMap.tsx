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
import { useQuery } from '@tanstack/react-query';
import { tokenStore } from '@/api/client';

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

async function fetchAll<T>(path: string): Promise<T[]> {
  const token = tokenStore.getAccess();
  const res = await fetch(`${API_BASE}${path}?limit=1000`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error(`Failed to load ${path}`);
  const json = (await res.json()) as ListResponse<T>;
  return json.data;
}

async function fetchSites(): Promise<Site[]> {
  return fetchAll<Site>('/sites');
}

async function fetchDevices(): Promise<Device[]> {
  return fetchAll<Device>('/devices');
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

function DeviceChip({ device }: { device: Device }) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      style={{
        border: '1px solid #e5e7eb',
        borderRadius: 8,
        padding: '8px 10px',
        background: hovered ? '#f0f4ff' : '#fff',
        cursor: 'default',
        minWidth: 160,
        transition: 'background .15s',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div style={{ fontWeight: 600, fontSize: '0.82rem', marginBottom: 3 }}>
        {deviceIcon(device.type)}&nbsp;{device.name}
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
        <DeviceStatusBadge status={device.status} />
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
    </div>
  );
}

// ---------------------------------------------------------------------------
// Site card — shows site info + its devices
// ---------------------------------------------------------------------------

interface SiteCardProps {
  site: Site;
  devices: Device[];
}

function SiteCard({ site, devices }: SiteCardProps) {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <div style={{
      border: '1px solid #e5e7eb',
      borderRadius: 10,
      background: '#fff',
      boxShadow: '0 1px 4px rgba(0,0,0,.06)',
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
            {site.name}
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
              {devices.map(d => <DeviceChip key={d.id} device={d} />)}
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
    fiber:    '#1d4ed8',
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
// Main Page
// ---------------------------------------------------------------------------

export function DeviceMap() {
  const [siteFilter, setSiteFilter] = useState('');
  const [deviceStatusFilter, setDeviceStatusFilter] = useState('');

  const sitesQuery = useQuery({ queryKey: ['sites'], queryFn: fetchSites });
  const devicesQuery = useQuery({ queryKey: ['devices-all'], queryFn: fetchDevices });
  const linksQuery = useQuery({ queryKey: ['network-links'], queryFn: fetchLinks });

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
          <option value="online">Online</option>
          <option value="offline">Offline</option>
          <option value="maintenance">Maintenance</option>
        </select>
        {(siteFilter || deviceStatusFilter) && (
          <button style={btnSecondary} onClick={() => { setSiteFilter(''); setDeviceStatusFilter(''); }}>
            Clear
          </button>
        )}
      </div>

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
              />
            </div>
          )}

          {/* Network links */}
          <LinksTable links={allLinks} deviceMap={deviceMap} />
        </>
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
const tableStyle: React.CSSProperties = {
  width: '100%', borderCollapse: 'collapse', background: '#fff',
  borderRadius: 8, overflow: 'hidden',
  boxShadow: '0 1px 3px rgba(0,0,0,.08)',
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
