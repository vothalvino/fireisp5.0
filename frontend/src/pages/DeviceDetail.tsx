// =============================================================================
// FireISP 5.0 — Device Detail
// =============================================================================
// Route: /devices/:id
// Data: GET /devices/{id} via REST api client
// =============================================================================

import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DeviceRecord {
  id: number;
  site_id: number | null;
  client_id: number | null;
  contract_id: number | null;
  category: string | null;
  name: string;
  type: string | null;
  manufacturer: string | null;
  model: string | null;
  serial_number: string | null;
  mac_address: string | null;
  ip_address: string | null;
  ipv6_address: string | null;
  firmware_version: string | null;
  snmp_enabled: boolean | number | null;
  snmp_version: string | null;
  status: string;
  notes: string | null;
  last_polled_at: string | null;
  last_poll_error: string | null;
}

interface SnmpMetric {
  id: number;
  polled_at: string;
  [key: string]: unknown;
}

interface ConfigBackup {
  id: number;
  version: number | null;
  config_type: string | null;
  capture_method: string | null;
  created_at: string;
}

interface WorkOrderRecord {
  id: number;
  title: string;
  work_type: string | null;
  status: string;
  scheduled_at: string | null;
}

interface OutageRecord {
  id: number;
  title: string;
  severity: string | null;
  status: string;
  started_at: string | null;
  resolved_at: string | null;
}

interface ListResp<T> { data: T[]; }

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmt(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  const s = String(dateStr).trim();
  const n = Number(s);
  const d = /^\d{10,}$/.test(s) ? new Date(n < 1e12 ? n * 1000 : n) : new Date(s);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('es-MX', { year: 'numeric', month: 'short', day: 'numeric' });
}

function StatusBadge({ status }: { status: string }) {
  const colorMap: Record<string, { bg: string; color: string }> = {
    online:      { bg: '#d1fae5', color: '#065f46' },
    offline:     { bg: '#fee2e2', color: '#991b1b' },
    maintenance: { bg: '#fef9c3', color: '#854d0e' },
    active:      { bg: '#d1fae5', color: '#065f46' },
    inactive:    { bg: '#f3f4f6', color: '#6b7280' },
  };
  const s = colorMap[status] ?? { bg: '#f3f4f6', color: '#374151' };
  return (
    <span style={{ background: s.bg, color: s.color, padding: '2px 8px', borderRadius: 12, fontSize: '0.72rem', fontWeight: 600, textTransform: 'capitalize' }}>
      {status}
    </span>
  );
}

function InfoRow({ label, value, mono, capitalize }: { label: string; value: string | null | undefined; mono?: boolean; capitalize?: boolean }) {
  if (!value) return null;
  return (
    <div style={styles.infoRow}>
      <span style={styles.infoLabel}>{label}</span>
      <span style={{ ...styles.infoValue, ...(mono ? { fontFamily: 'monospace' } : {}), ...(capitalize ? { textTransform: 'capitalize' as const } : {}) }}>
        {value}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab types
// ---------------------------------------------------------------------------

type TabId = 'overview' | 'snmp' | 'backups' | 'workOrders' | 'outages';

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function DeviceDetail() {
  const { id } = useParams<{ id: string }>();
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<TabId>('overview');

  const TABS: { id: TabId; label: string }[] = [
    { id: 'overview',    label: t('deviceDetail.tabs.overview') },
    { id: 'snmp',        label: t('deviceDetail.tabs.snmpMetrics') },
    { id: 'backups',     label: t('deviceDetail.tabs.configBackups') },
    { id: 'workOrders',  label: t('deviceDetail.tabs.workOrders') },
    { id: 'outages',     label: t('deviceDetail.tabs.outages') },
  ];

  const { data: device, isLoading, error } = useQuery({
    queryKey: ['device-detail', id],
    queryFn: async () => {
      const res = await api.GET('/devices/{id}' as never, { params: { path: { id: Number(id) } } } as never);
      if ((res as { error?: unknown }).error) throw new Error('Device not found');
      return ((res as { data: { data?: DeviceRecord } }).data?.data ?? (res as { data: DeviceRecord }).data) as DeviceRecord;
    },
    enabled: Boolean(id),
  });

  const { data: snmpMetrics } = useQuery({
    queryKey: ['device-snmp-metrics', id],
    queryFn: async () => {
      const res = await api.GET('/devices/{id}/snmp-metrics' as never, { params: { path: { id: Number(id) }, query: { limit: 50 } as never } } as never);
      if ((res as { error?: unknown }).error) return [];
      const d = (res as { data: unknown }).data as ListResp<SnmpMetric> | SnmpMetric[];
      return Array.isArray(d) ? d : (d as ListResp<SnmpMetric>).data ?? [];
    },
    enabled: Boolean(id) && activeTab === 'snmp',
  });

  const { data: configBackups } = useQuery({
    queryKey: ['device-config-backups', id],
    queryFn: async () => {
      const res = await api.GET('/device-config-backups' as never, { params: { query: { device_id: Number(id), limit: 50 } as never } } as never);
      if ((res as { error?: unknown }).error) return [];
      const d = (res as { data: unknown }).data as ListResp<ConfigBackup> | ConfigBackup[];
      return Array.isArray(d) ? d : (d as ListResp<ConfigBackup>).data ?? [];
    },
    enabled: Boolean(id) && activeTab === 'backups',
  });

  const { data: workOrders } = useQuery({
    queryKey: ['device-work-orders', id],
    queryFn: async () => {
      const res = await api.GET('/work-orders' as never, { params: { query: { device_id: Number(id), limit: 50 } as never } } as never);
      if ((res as { error?: unknown }).error) return [];
      const d = (res as { data: unknown }).data as ListResp<WorkOrderRecord> | WorkOrderRecord[];
      return Array.isArray(d) ? d : (d as ListResp<WorkOrderRecord>).data ?? [];
    },
    enabled: Boolean(id) && activeTab === 'workOrders',
  });

  const { data: outages } = useQuery({
    queryKey: ['device-outages', id],
    queryFn: async () => {
      const res = await api.GET('/outages' as never, { params: { query: { device_id: Number(id), limit: 50 } as never } } as never);
      if ((res as { error?: unknown }).error) return [];
      const d = (res as { data: unknown }).data as ListResp<OutageRecord> | OutageRecord[];
      return Array.isArray(d) ? d : (d as ListResp<OutageRecord>).data ?? [];
    },
    enabled: Boolean(id) && activeTab === 'outages',
  });

  if (isLoading) {
    return <div style={styles.page}><p style={styles.msg}>{t('deviceDetail.loading')}</p></div>;
  }

  if (error || !device) {
    return (
      <div style={styles.page}>
        <p style={styles.msgError}>{t('deviceDetail.notFound')}</p>
        <Link to="/devices" style={styles.backLink}>← {t('deviceDetail.backToList')}</Link>
      </div>
    );
  }

  return (
    <div style={styles.page}>
      {/* Breadcrumb */}
      <div style={styles.breadcrumb}>
        <Link to="/devices" style={styles.breadcrumbLink}>Devices</Link>
        <span style={styles.breadcrumbSep}>›</span>
        <span style={styles.breadcrumbCurrent}>{device.name}</span>
      </div>

      {/* Header */}
      <div style={styles.header}>
        <div>
          <h1 style={styles.title}>{device.name}</h1>
          <div style={styles.headerMeta}>
            <StatusBadge status={device.status} />
            <span style={styles.idLabel}>ID #{device.id}</span>
          </div>
        </div>
      </div>

      {/* Info card */}
      <div style={styles.infoCard}>
        <div style={styles.infoGrid}>
          <InfoRow label={t('deviceDetail.fields.category')}        value={device.category}          capitalize />
          <InfoRow label={t('deviceDetail.fields.type')}            value={device.type}              capitalize />
          <InfoRow label={t('deviceDetail.fields.manufacturer')}    value={device.manufacturer}      />
          <InfoRow label={t('deviceDetail.fields.model')}           value={device.model}             />
          <InfoRow label={t('deviceDetail.fields.serialNumber')}    value={device.serial_number}     mono />
          <InfoRow label={t('deviceDetail.fields.macAddress')}      value={device.mac_address}       mono />
          <InfoRow label={t('deviceDetail.fields.ipAddress')}       value={device.ip_address}        mono />
          <InfoRow label={t('deviceDetail.fields.ipv6Address')}     value={device.ipv6_address}      mono />
          <InfoRow label={t('deviceDetail.fields.firmwareVersion')} value={device.firmware_version}  mono />
          <InfoRow label={t('deviceDetail.fields.snmpVersion')}     value={device.snmp_version}      />
          <InfoRow label={t('deviceDetail.fields.siteId')}          value={device.site_id != null ? String(device.site_id) : null} />
          <InfoRow label={t('deviceDetail.fields.clientId')}        value={device.client_id != null ? String(device.client_id) : null} />
          <InfoRow label={t('deviceDetail.fields.contractId')}      value={device.contract_id != null ? String(device.contract_id) : null} />
          <InfoRow label={t('deviceDetail.fields.snmpEnabled')}     value={device.snmp_enabled ? 'Yes' : device.snmp_enabled === false ? 'No' : null} />
          <InfoRow label={t('deviceDetail.fields.lastPolledAt')}    value={fmt(device.last_polled_at)} />
          {device.last_poll_error && <InfoRow label={t('deviceDetail.fields.lastPollError')} value={device.last_poll_error} />}
        </div>
        {device.notes && (
          <div style={styles.notesRow}>
            <span style={styles.noteLabel}>Notes: </span>{device.notes}
          </div>
        )}
      </div>

      {/* Tabs */}
      <div style={styles.tabBar}>
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{ ...styles.tabBtn, ...(activeTab === tab.id ? styles.tabBtnActive : {}) }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div style={styles.tabContent}>
        {activeTab === 'overview' && (
          <p style={styles.msg}>{t('deviceDetail.overview.hint')}</p>
        )}

        {activeTab === 'snmp' && (
          <div style={{ overflowX: 'auto' }}>
            {!snmpMetrics?.length ? (
              <p style={styles.msg}>{t('deviceDetail.snmp.empty')}</p>
            ) : (
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>{t('deviceDetail.snmp.polledAt')}</th>
                    {Object.keys(snmpMetrics[0]).filter(k => k !== 'id' && k !== 'polled_at').map(k => (
                      <th key={k} style={styles.th}>{k}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {snmpMetrics.map(m => (
                    <tr key={m.id} style={styles.tr}>
                      <td style={styles.td}>{fmt(m.polled_at)}</td>
                      {Object.keys(m).filter(k => k !== 'id' && k !== 'polled_at').map(k => (
                        <td key={k} style={styles.td}>{String(m[k] ?? '—')}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {activeTab === 'backups' && (
          <div style={{ overflowX: 'auto' }}>
            {!configBackups?.length ? (
              <p style={styles.msg}>{t('deviceDetail.backups.empty')}</p>
            ) : (
              <table style={styles.table}>
                <thead>
                  <tr>
                    {[t('deviceDetail.backups.version'), t('deviceDetail.backups.configType'), t('deviceDetail.backups.captureMethod'), t('deviceDetail.backups.createdAt')].map(h => (
                      <th key={h} style={styles.th}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(configBackups ?? []).map(b => (
                    <tr key={b.id} style={styles.tr}>
                      <td style={styles.td}>{b.version ?? '—'}</td>
                      <td style={styles.td}>{b.config_type ?? '—'}</td>
                      <td style={styles.td}>{b.capture_method ?? '—'}</td>
                      <td style={styles.td}>{fmt(b.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {activeTab === 'workOrders' && (
          <div style={{ overflowX: 'auto' }}>
            {!workOrders?.length ? (
              <p style={styles.msg}>{t('deviceDetail.workOrders.empty')}</p>
            ) : (
              <table style={styles.table}>
                <thead>
                  <tr>
                    {[t('deviceDetail.workOrders.id'), t('deviceDetail.workOrders.title'), t('deviceDetail.workOrders.workType'), t('deviceDetail.workOrders.status'), t('deviceDetail.workOrders.scheduledAt')].map(h => (
                      <th key={h} style={styles.th}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(workOrders ?? []).map(wo => (
                    <tr key={wo.id} style={styles.tr}>
                      <td style={styles.td}>#{wo.id}</td>
                      <td style={styles.td}>{wo.title}</td>
                      <td style={styles.td}>{wo.work_type ?? '—'}</td>
                      <td style={styles.td}><StatusBadge status={wo.status} /></td>
                      <td style={styles.td}>{fmt(wo.scheduled_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {activeTab === 'outages' && (
          <div style={{ overflowX: 'auto' }}>
            {!outages?.length ? (
              <p style={styles.msg}>{t('deviceDetail.outages.empty')}</p>
            ) : (
              <table style={styles.table}>
                <thead>
                  <tr>
                    {[t('deviceDetail.outages.title'), t('deviceDetail.outages.severity'), t('deviceDetail.outages.status'), t('deviceDetail.outages.startedAt'), t('deviceDetail.outages.resolvedAt')].map(h => (
                      <th key={h} style={styles.th}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(outages ?? []).map(o => (
                    <tr key={o.id} style={styles.tr}>
                      <td style={styles.td}>{o.title}</td>
                      <td style={styles.td}>{o.severity ?? '—'}</td>
                      <td style={styles.td}><StatusBadge status={o.status} /></td>
                      <td style={styles.td}>{fmt(o.started_at)}</td>
                      <td style={styles.td}>{fmt(o.resolved_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = {
  page: { padding: '2rem', fontFamily: 'var(--font-sans)', maxWidth: 1100 },
  breadcrumb: { display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '1.25rem', fontSize: '0.85rem' },
  breadcrumbLink: { color: 'var(--accent)', textDecoration: 'none', fontWeight: 500 },
  breadcrumbSep:  { color: 'var(--text-dimmed)' },
  breadcrumbCurrent: { color: 'var(--text-secondary)' },
  backLink: { color: 'var(--accent)', textDecoration: 'none', fontWeight: 500, fontSize: '0.85rem' },
  header: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '1rem' },
  title:  { margin: '0 0 0.35rem', color: 'var(--text-primary)', fontSize: '1.6rem', fontWeight: 700 },
  headerMeta: { display: 'flex', alignItems: 'center', gap: '0.75rem' },
  idLabel: { color: 'var(--text-dimmed)', fontSize: '0.8rem' },
  infoCard: { background: 'var(--bg-card)', borderRadius: 8, boxShadow: '0 0 0 1px var(--border)', padding: '1rem 1.25rem', marginBottom: '1.5rem' },
  infoGrid: { display: 'grid' as const, gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '0.5rem 1.5rem' },
  infoRow:  { display: 'flex', gap: '0.5rem', alignItems: 'baseline', fontSize: '0.85rem' },
  infoLabel: { color: 'var(--text-dimmed)', fontSize: '0.75rem', textTransform: 'uppercase' as const, letterSpacing: '0.04em', minWidth: 80 },
  infoValue: { color: 'var(--text-secondary)' },
  notesRow: { marginTop: '0.75rem', fontSize: '0.82rem', color: 'var(--text-muted)', borderTop: '1px solid var(--border-subtle)', paddingTop: '0.75rem' },
  noteLabel: { fontWeight: 600, color: 'var(--text-secondary)' },
  tabBar: { display: 'flex', gap: '0.25rem', borderBottom: '2px solid var(--border)', marginBottom: '0' },
  tabBtn: { padding: '0.6rem 1rem', border: 'none', background: 'transparent', cursor: 'pointer', fontSize: '0.85rem', color: 'var(--text-muted)', borderBottom: '2px solid transparent', marginBottom: '-2px', fontFamily: 'var(--font-sans)', fontWeight: 500, whiteSpace: 'nowrap' as const, transition: 'color .15s' },
  tabBtnActive: { color: 'var(--accent)', borderBottom: '2px solid var(--accent)', fontWeight: 600 },
  tabContent: { background: 'var(--bg-card)', borderRadius: '0 0 8px 8px', boxShadow: '0 0 0 1px var(--border)', minHeight: 200 },
  table: { width: '100%', borderCollapse: 'collapse' as const, fontSize: '0.85rem' },
  th: { padding: '0.6rem 0.75rem', textAlign: 'left' as const, color: 'var(--text-muted)', fontSize: '0.75rem', textTransform: 'uppercase' as const, letterSpacing: '0.04em', borderBottom: '2px solid var(--border-subtle)', whiteSpace: 'nowrap' as const },
  tr: { borderBottom: '1px solid var(--border-subtle)' },
  td: { padding: '0.65rem 0.75rem', color: 'var(--text-secondary)', verticalAlign: 'middle' as const },
  msg:      { padding: '2rem 1.5rem', color: 'var(--text-muted)', fontStyle: 'italic' as const, margin: 0 },
  msgError: { padding: '2rem 1.5rem', color: '#ef4444', margin: 0 },
};
