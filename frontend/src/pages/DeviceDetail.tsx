// =============================================================================
// FireISP 5.0 — Device Detail
// =============================================================================
// Route: /devices/:id
// Data: GET /devices/{id} via REST api client
// =============================================================================

import { useEffect, useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, authedFetch } from '@/api/client';
import { ClientPicker } from '@/components/ClientPicker';
import { extractApiError } from '@/components/ClientFormModal';
import { fmtPct, fmtSignal, fmtLatency, fmtUptimeTicks } from './snmpMetrics/format';

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
  // NB: the real column is `firmware` (schema.sql line 784) — there is no
  // `firmware_version` column on `devices`. GET /devices/{id} is an
  // unaliased `SELECT *`, so a mismatched interface field silently renders
  // nothing (InfoRow returns null for a falsy value) rather than erroring.
  firmware: string | null;
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

// AP sector RF-threshold record (migration 388) — only the 2 fields this
// tab edits, plus the identity fields needed to resolve create-vs-update.
// link_capacity_min_mbps is DECIMAL(8,2) — the API may return it as a
// numeric string, so it's typed loosely and normalized on read.
interface ApSectorRecord {
  id: number;
  device_id: number;
  signal_min_dbm: number | null;
  link_capacity_min_mbps: string | number | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Devices whose serving-sector RF thresholds (migration 388) are editable
// from this page — AP/PTP radios, the only devices ap_sector_configs models.
function isApOrPtpDevice(type: string | null): boolean {
  return type === 'ptmp_ap' || type === 'ptp';
}

function fmt(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  const s = String(dateStr).trim();
  const n = Number(s);
  const d = /^\d{10,}$/.test(s) ? new Date(n < 1e12 ? n * 1000 : n) : new Date(s);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('es-MX', { year: 'numeric', month: 'short', day: 'numeric' });
}

// GET /devices/{id}/snmp-metrics returns EVERY row (device-level scalar rows
// AND per-interface rows) newest-first, interleaved — a per-interface row
// has null cpu_usage/memory_usage/signal_strength/uptime_ticks, so row[0] is
// frequently an interface row and blindly reading it renders "—" for every
// field even when a real, recent device-level reading exists a few rows
// down. Scan forward (rows are already newest-first) for the first row that
// actually has a value for this specific field.
function firstNonNull(rows: SnmpMetric[], key: string): unknown {
  for (const row of rows) {
    if (row[key] != null) return row[key];
  }
  return null;
}

// Known units for the SNMP columns the "all readings" expandable dump
// surfaces — environmental/power/error counters the compact 6-field summary
// above doesn't show (temperature, voltage, fan speed, UPS, PoE, humidity,
// SFP optics, interface errors/discards). Anything not listed here still
// renders, just without a unit suffix.
const SNMP_COLUMN_UNITS: Record<string, string> = {
  cpu_usage: ' %',
  memory_usage: ' %',
  signal_strength: ' dBm',
  latency_ms: ' ms',
  temperature_c: ' °C',
  voltage_mv: ' mV',
  fan_speed_rpm: ' RPM',
  ups_battery_pct: ' %',
  ups_runtime_min: ' min',
  poe_power_mw: ' mW',
  humidity_pct: ' %',
  sfp_tx_power_dbm: ' dBm',
  sfp_rx_power_dbm: ' dBm',
  sfp_temperature_c: ' °C',
};

function fmtRawSnmpValue(key: string, value: unknown): string {
  if (value == null) return '—';
  return `${String(value)}${SNMP_COLUMN_UNITS[key] ?? ''}`;
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
// Work order creation (inline, from the device's Work Orders tab)
// ---------------------------------------------------------------------------
// A work order's `assigned_to` may only be a user authorized to work with
// work orders (work_orders.update — enforced server-side in
// routes/workOrders.js's assigneeAuthError). The generic /users list is NOT
// scoped to that permission, so the assignee picker here is populated from
// the dedicated GET /work-orders/assignable-users endpoint, matching
// WorkOrders.tsx's own create form.

interface WoAssignableUser { id: number; first_name: string; last_name: string }

async function fetchWoAssignableUsers(): Promise<WoAssignableUser[]> {
  const res = await api.GET('/work-orders/assignable-users' as never, {} as never);
  if ((res as { error?: unknown }).error) return [];
  return (((res as { data: unknown }).data as { data: WoAssignableUser[] }).data) ?? [];
}

interface CreateWoBody {
  title: string;
  description?: string;
  work_type?: string;
  priority?: string;
  scheduled_at?: string;
  assigned_to?: number;
  site_id?: number;
  device_id?: number;
  client_id?: number;
}

async function woErrorMessage(resp: Response, fallback: string): Promise<string> {
  try {
    // Route-level guards respond { error: '<string>' }; the validate()
    // middleware and global handler respond { error: { code, message } }.
    const j = await resp.json() as { error?: string | { message?: string } };
    if (typeof j?.error === 'string') return j.error;
    if (j?.error && typeof j.error.message === 'string') return j.error.message;
  } catch { /* non-JSON / empty body */ }
  return fallback;
}

async function createWo(body: CreateWoBody): Promise<void> {
  const resp = await authedFetch('/api/v1/work-orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw new Error(await woErrorMessage(resp, 'Failed to create work order'));
}

// 'YYYY-MM-DDTHH:mm' (datetime-local input) → 'YYYY-MM-DD HH:mm:00' for the API.
function woToSqlDateTime(v: string): string {
  return v.replace('T', ' ') + (v.length === 16 ? ':00' : '');
}

const WO_WORK_TYPES = ['installation', 'maintenance', 'repair', 'survey', 'other'];
const WO_PRIORITIES = ['low', 'medium', 'high', 'critical'];

// `clientId` is the device's own client_id (if any) — carried onto the work
// order automatically so a technician dispatched to service this device also
// sees the right subscriber context on the resulting work order.
function DeviceWorkOrderCreateForm({ deviceId, clientId, onCreated }: { deviceId: number; clientId: number | null; onCreated: () => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [workType, setWorkType] = useState('other');
  const [priority, setPriority] = useState('medium');
  const [scheduledAt, setScheduledAt] = useState('');
  const [assignedTo, setAssignedTo] = useState('');
  const [formErr, setFormErr] = useState('');

  const { data: assignableUsers = [] } = useQuery({
    queryKey: ['work-order-assignable-users'],
    queryFn: fetchWoAssignableUsers,
    enabled: open,
  });

  const createMut = useMutation({
    mutationFn: () => createWo({
      title: title.trim(),
      description: description.trim() || undefined,
      work_type: workType,
      priority,
      scheduled_at: scheduledAt ? woToSqlDateTime(scheduledAt) : undefined,
      assigned_to: assignedTo ? Number(assignedTo) : undefined,
      device_id: deviceId,
      ...(clientId != null ? { client_id: clientId } : {}),
    }),
    onSuccess: () => {
      setOpen(false);
      setTitle(''); setDescription(''); setWorkType('other'); setPriority('medium');
      setScheduledAt(''); setAssignedTo(''); setFormErr('');
      onCreated();
    },
    onError: (e: unknown) => setFormErr(e instanceof Error ? e.message : t('deviceDetail.workOrders.createForm.saveFailed')),
  });

  return (
    <div style={{ marginBottom: '1rem' }}>
      <button type="button" style={open ? styles.woBtnSecondary : styles.woBtnPrimary} onClick={() => setOpen(v => !v)}>
        {open ? t('common.cancel') : t('workOrders.new')}
      </button>
      {open && (
        <div style={styles.woFormPanel}>
          <label style={styles.woFormLabel}>
            {t('deviceDetail.workOrders.createForm.title')} *
            <input
              style={styles.woFormInput}
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder={t('deviceDetail.workOrders.createForm.titlePlaceholder')}
            />
          </label>
          <label style={styles.woFormLabel}>
            {t('deviceDetail.workOrders.createForm.description')}
            <textarea
              style={{ ...styles.woFormInput, height: 70 }}
              value={description}
              onChange={e => setDescription(e.target.value)}
            />
          </label>
          <label style={styles.woFormLabel}>
            {t('workOrders.type')}
            <select style={styles.woFormInput} value={workType} onChange={e => setWorkType(e.target.value)}>
              {WO_WORK_TYPES.map(w => <option key={w} value={w}>{t(`workOrders.workType.${w}`, w)}</option>)}
            </select>
          </label>
          <label style={styles.woFormLabel}>
            {t('deviceDetail.workOrders.createForm.priority')}
            <select style={styles.woFormInput} value={priority} onChange={e => setPriority(e.target.value)}>
              {WO_PRIORITIES.map(p => <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>)}
            </select>
          </label>
          <label style={styles.woFormLabel}>
            {t('deviceDetail.workOrders.createForm.scheduledAt')}
            <input
              type="datetime-local"
              style={styles.woFormInput}
              value={scheduledAt}
              onChange={e => setScheduledAt(e.target.value)}
            />
          </label>
          <label style={styles.woFormLabel}>
            {t('deviceDetail.workOrders.createForm.assignedTo')}
            <select style={styles.woFormInput} value={assignedTo} onChange={e => setAssignedTo(e.target.value)}>
              <option value="">{t('common.unassigned')}</option>
              {assignableUsers.map(u => <option key={u.id} value={u.id}>{u.first_name} {u.last_name}</option>)}
            </select>
          </label>
          {formErr && <p style={styles.woFormError}>{formErr}</p>}
          <div style={styles.woFormActions}>
            <button
              type="button"
              style={styles.woBtnPrimary}
              disabled={!title.trim() || createMut.isPending}
              onClick={() => { setFormErr(''); createMut.mutate(); }}
            >
              {createMut.isPending ? t('common.saving') : t('deviceDetail.workOrders.createForm.submit')}
            </button>
            <button type="button" style={styles.woBtnSecondary} onClick={() => setOpen(false)}>
              {t('common.cancel')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab types
// ---------------------------------------------------------------------------

type TabId = 'overview' | 'snmp' | 'backups' | 'workOrders' | 'outages' | 'rfThresholds';

// ---------------------------------------------------------------------------
// RF Thresholds tab (migration 388) — AP/PTP-only. Edits the serving
// sector's per-sector diagnostic-threshold defaults (signal_min_dbm,
// link_capacity_min_mbps) via the existing /wireless/ap-sectors CRUD,
// matching WirelessManagementPage's fetch pattern. There is no
// server-enforced 1:1 between a device and its sector config row
// (ap_sector_configs.device_id has a non-unique index only) — when more
// than one row exists for this device, the last one returned is treated as
// "the" sector, mirroring the backend's own `ORDER BY id DESC LIMIT 1`
// idiom (diagnosticEngineService._getApSectorThresholds). No row yet ->
// Save creates one (POST); a row already exists -> Save updates it (PUT).
// ---------------------------------------------------------------------------
function RfThresholdsTab({ deviceId }: { deviceId: number }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [signalMinDbm, setSignalMinDbm] = useState('');
  const [linkCapacityMinMbps, setLinkCapacityMinMbps] = useState('');
  const [saveError, setSaveError] = useState('');
  const [saved, setSaved] = useState(false);
  const primedRef = useRef(false);

  const { data: sectors, isLoading } = useQuery({
    queryKey: ['device-ap-sector', deviceId],
    queryFn: async () => {
      const res = await api.GET('/wireless/ap-sectors' as never, {
        params: { query: { device_id: deviceId } as never },
      } as never);
      if ((res as { error?: unknown }).error) return [];
      const d = (res as { data: unknown }).data as { data?: ApSectorRecord[] } | ApSectorRecord[];
      return Array.isArray(d) ? d : (d as { data?: ApSectorRecord[] })?.data ?? [];
    },
  });

  const sector: ApSectorRecord | null = sectors && sectors.length > 0 ? sectors[sectors.length - 1] : null;

  // Prime the form once from whatever the first fetch resolves (an existing
  // sector's values, or blanks if none exists yet) — a one-shot init so a
  // later refetch (e.g. after Save) doesn't clobber in-progress edits.
  useEffect(() => {
    if (!primedRef.current && sectors !== undefined) {
      setSignalMinDbm(sector?.signal_min_dbm != null ? String(sector.signal_min_dbm) : '');
      setLinkCapacityMinMbps(sector?.link_capacity_min_mbps != null ? String(sector.link_capacity_min_mbps) : '');
      primedRef.current = true;
    }
    // Intentionally one-shot: only re-run when `sectors` first resolves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sectors]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      // Blank input explicitly sends `null` (not omitted) so a previously-set
      // threshold can be cleared back to "use the org-wide/no default" —
      // validate() forwards an explicit null through untouched, and
      // BaseModel/buildUpdate both SET the column to NULL for it.
      const body = {
        signal_min_dbm: signalMinDbm === '' ? null : Number(signalMinDbm),
        link_capacity_min_mbps: linkCapacityMinMbps === '' ? null : Number(linkCapacityMinMbps),
      };
      if (sector) {
        const { error: putErr } = await api.PUT('/wireless/ap-sectors/{id}' as never, {
          params: { path: { id: sector.id } },
          body: body as never,
        } as never);
        if (putErr) throw new Error(extractApiError(putErr, t('deviceDetail.rfThresholds.saveFailed')));
      } else {
        const { error: postErr } = await api.POST('/wireless/ap-sectors' as never, {
          body: { device_id: deviceId, ...body } as never,
        } as never);
        if (postErr) throw new Error(extractApiError(postErr, t('deviceDetail.rfThresholds.saveFailed')));
      }
    },
    onSuccess: () => {
      setSaveError('');
      setSaved(true);
      qc.invalidateQueries({ queryKey: ['device-ap-sector', deviceId] });
    },
    onError: (err: unknown) => {
      setSaved(false);
      setSaveError(err instanceof Error ? err.message : t('deviceDetail.rfThresholds.saveFailed'));
    },
  });

  if (isLoading) return <p style={styles.msg}>{t('deviceDetail.loading')}</p>;

  return (
    <div style={styles.rfThresholdsPanel}>
      <p style={styles.rfThresholdsIntro}>
        {sector ? t('deviceDetail.rfThresholds.introExisting') : t('deviceDetail.rfThresholds.introNew')}
      </p>

      <label style={styles.rfThresholdsLabel}>
        {t('deviceDetail.rfThresholds.signalMinDbm')}
        <input
          style={styles.rfThresholdsInput}
          type="number"
          step="1"
          min={-100}
          max={0}
          placeholder="-75"
          value={signalMinDbm}
          onChange={e => { setSaved(false); setSignalMinDbm(e.target.value); }}
        />
      </label>
      <p style={styles.rfThresholdsHint}>{t('deviceDetail.rfThresholds.signalMinDbmHint')}</p>

      <label style={styles.rfThresholdsLabel}>
        {t('deviceDetail.rfThresholds.linkCapacityMinMbps')}
        <input
          style={styles.rfThresholdsInput}
          type="number"
          step="0.1"
          min={0.1}
          max={10000}
          placeholder={t('deviceDetail.rfThresholds.linkCapacityPlaceholder')}
          value={linkCapacityMinMbps}
          onChange={e => { setSaved(false); setLinkCapacityMinMbps(e.target.value); }}
        />
      </label>
      <p style={styles.rfThresholdsHint}>{t('deviceDetail.rfThresholds.linkCapacityMinMbpsHint')}</p>

      {saveError && <p style={styles.msgError}>{saveError}</p>}
      {saved && !saveError && <p style={styles.rfThresholdsSaved}>{t('deviceDetail.rfThresholds.saved')}</p>}

      <button
        type="button"
        disabled={saveMutation.isPending}
        onClick={() => { setSaveError(''); saveMutation.mutate(); }}
        style={styles.rfThresholdsSaveBtn}
      >
        {saveMutation.isPending ? t('common.saving') : t('common.save')}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function DeviceDetail() {
  const { id } = useParams<{ id: string }>();
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<TabId>('overview');
  const [snmpAllReadingsOpen, setSnmpAllReadingsOpen] = useState(false);

  const qc = useQueryClient();

  const { data: device, isLoading, error } = useQuery({
    queryKey: ['device-detail', id],
    queryFn: async () => {
      const res = await api.GET('/devices/{id}' as never, { params: { path: { id: Number(id) } } } as never);
      if ((res as { error?: unknown }).error) throw new Error('Device not found');
      return ((res as { data: { data?: DeviceRecord } }).data?.data ?? (res as { data: DeviceRecord }).data) as DeviceRecord;
    },
    enabled: Boolean(id),
  });

  // RF Thresholds tab (migration 388) only makes sense for AP/PTP radios —
  // ap_sector_configs models one row per such device. `device` is
  // undefined until the query above resolves; the tab list is only ever
  // rendered after the loading/error guards below, by which point it's
  // guaranteed defined.
  const TABS: { id: TabId; label: string }[] = [
    { id: 'overview',    label: t('deviceDetail.tabs.overview') },
    { id: 'snmp',        label: t('deviceDetail.tabs.snmpMetrics') },
    { id: 'backups',     label: t('deviceDetail.tabs.configBackups') },
    { id: 'workOrders',  label: t('deviceDetail.tabs.workOrders') },
    { id: 'outages',     label: t('deviceDetail.tabs.outages') },
    ...(isApOrPtpDevice(device?.type ?? null)
      ? [{ id: 'rfThresholds' as TabId, label: t('deviceDetail.tabs.rfThresholds') }]
      : []),
  ];

  // device.client_id is a raw FK with no join — resolve the linked client's
  // name so the UI never shows a bare internal id with no context.
  const { data: linkedClient } = useQuery({
    queryKey: ['device-linked-client', device?.client_id],
    queryFn: async () => {
      const res = await api.GET('/clients/{id}' as never, { params: { path: { id: device!.client_id! } } } as never);
      if ((res as { error?: unknown }).error) return null;
      return ((res as { data: { data?: { id: number; name: string } } }).data?.data ?? null);
    },
    enabled: device?.client_id != null,
  });

  // Same resolution for device.site_id, so the info card and Overview tab can
  // link to the site by name instead of a bare id.
  const { data: linkedSite } = useQuery({
    queryKey: ['device-linked-site', device?.site_id],
    queryFn: async () => {
      const res = await api.GET('/sites/{id}' as never, { params: { path: { id: device!.site_id! } } } as never);
      if ((res as { error?: unknown }).error) return null;
      const d = (res as { data: unknown }).data;
      return (((d as { data?: { id: number; name: string } }).data) ?? d ?? null) as { id: number; name: string } | null;
    },
    enabled: device?.site_id != null,
  });

  const [editingClient, setEditingClient] = useState(false);
  const [pickerValue, setPickerValue] = useState<number | ''>('');
  const [pickerName, setPickerName] = useState('');
  const [clientError, setClientError] = useState('');

  const assignClientMutation = useMutation({
    mutationFn: async (nextClientId: number | null) => {
      const { error: e } = await api.PATCH('/devices/{id}' as never, {
        params: { path: { id: Number(id) } },
        body: { client_id: nextClientId },
      } as never);
      if (e) throw new Error(extractApiError(e, t('deviceDetail.clientAssign.saveFailed')));
    },
    onSuccess: () => {
      setEditingClient(false);
      setClientError('');
      qc.invalidateQueries({ queryKey: ['device-detail', id] });
      qc.invalidateQueries({ queryKey: ['device-linked-client'] });
    },
    onError: (err: unknown) => setClientError(err instanceof Error ? err.message : t('deviceDetail.clientAssign.saveFailed')),
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
          <InfoRow label={t('deviceDetail.fields.firmwareVersion')} value={device.firmware}          mono />
          <InfoRow label={t('deviceDetail.fields.snmpVersion')}     value={device.snmp_version}      />
          {device.site_id != null && (
            <div style={styles.infoRow}>
              <span style={styles.infoLabel}>{t('deviceDetail.fields.siteId')}</span>
              <span style={styles.infoValue}>
                <Link to={`/sites/${device.site_id}`} style={{ color: 'var(--accent)' }}>
                  {linkedSite?.name ?? `#${device.site_id}`}
                </Link>
              </span>
            </div>
          )}
          <div style={styles.infoRow}>
            <span style={styles.infoLabel}>{t('deviceDetail.fields.clientId')}</span>
            {!editingClient ? (
              <span style={styles.infoValue}>
                {device.client_id != null ? (
                  <Link to={`/clients/${device.client_id}`} style={{ color: 'var(--accent)' }}>
                    {linkedClient?.name ?? `#${device.client_id}`}
                  </Link>
                ) : (
                  <span style={{ color: 'var(--text-dimmed)', fontStyle: 'italic' }}>
                    {t('deviceDetail.clientAssign.unassigned')}
                  </span>
                )}
                {' '}
                <button
                  type="button"
                  style={styles.changeLinkStyle}
                  onClick={() => {
                    setPickerValue(device.client_id ?? '');
                    setPickerName(linkedClient?.name ?? '');
                    setClientError('');
                    setEditingClient(true);
                  }}
                >
                  {device.client_id != null ? t('deviceDetail.clientAssign.change') : t('deviceDetail.clientAssign.assign')}
                </button>
              </span>
            ) : (
              <div style={{ flex: 1 }}>
                <ClientPicker
                  value={pickerValue}
                  initialName={pickerName}
                  required={false}
                  onChange={(cid, name) => { setPickerValue(cid || ''); setPickerName(name); }}
                />
                {clientError && <p style={styles.clientErrorText}>{clientError}</p>}
                <div style={{ display: 'flex', gap: 8, marginTop: '0.5rem' }}>
                  <button
                    type="button"
                    disabled={assignClientMutation.isPending}
                    onClick={() => assignClientMutation.mutate(pickerValue === '' || pickerValue === 0 ? null : pickerValue)}
                  >
                    {t('deviceDetail.clientAssign.save')}
                  </button>
                  <button type="button" onClick={() => { setEditingClient(false); setClientError(''); }}>
                    {t('common.cancel')}
                  </button>
                </div>
              </div>
            )}
          </div>
          {device.contract_id != null && (
            <div style={styles.infoRow}>
              <span style={styles.infoLabel}>{t('deviceDetail.fields.contractId')}</span>
              <span style={styles.infoValue}>
                <Link to={`/contracts/${device.contract_id}`} style={{ color: 'var(--accent)' }}>
                  #{device.contract_id}
                </Link>
              </span>
            </div>
          )}
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
          <div style={styles.overviewPanel}>
            <div style={styles.infoGrid}>
              <div style={styles.infoRow}>
                <span style={styles.infoLabel}>{t('deviceDetail.overview.status')}</span>
                <span style={styles.infoValue}><StatusBadge status={device.status} /></span>
              </div>
              <InfoRow label={t('deviceDetail.fields.type')} value={device.type} capitalize />
              <InfoRow
                label={t('deviceDetail.overview.vendorModel')}
                value={[device.manufacturer, device.model].filter(Boolean).join(' ') || null}
              />
              <InfoRow
                label={t('deviceDetail.overview.mgmtAddress')}
                value={[device.ip_address, device.ipv6_address].filter(Boolean).join(' · ') || null}
                mono
              />
              <div style={styles.infoRow}>
                <span style={styles.infoLabel}>{t('deviceDetail.overview.site')}</span>
                <span style={styles.infoValue}>
                  {device.site_id != null ? (
                    <Link to={`/sites/${device.site_id}`} style={{ color: 'var(--accent)' }}>
                      {linkedSite?.name ?? `#${device.site_id}`}
                    </Link>
                  ) : (
                    <span style={{ color: 'var(--text-dimmed)', fontStyle: 'italic' }}>
                      {t('deviceDetail.overview.noSite')}
                    </span>
                  )}
                </span>
              </div>
              <div style={styles.infoRow}>
                <span style={styles.infoLabel}>{t('deviceDetail.overview.client')}</span>
                <span style={styles.infoValue}>
                  {device.client_id != null ? (
                    <Link to={`/clients/${device.client_id}`} style={{ color: 'var(--accent)' }}>
                      {linkedClient?.name ?? `#${device.client_id}`}
                    </Link>
                  ) : (
                    <span style={{ color: 'var(--text-dimmed)', fontStyle: 'italic' }}>
                      {t('deviceDetail.clientAssign.unassigned')}
                    </span>
                  )}
                </span>
              </div>
              <div style={styles.infoRow}>
                <span style={styles.infoLabel}>{t('deviceDetail.overview.contract')}</span>
                <span style={styles.infoValue}>
                  {device.contract_id != null ? (
                    <Link to={`/contracts/${device.contract_id}`} style={{ color: 'var(--accent)' }}>
                      #{device.contract_id}
                    </Link>
                  ) : (
                    <span style={{ color: 'var(--text-dimmed)', fontStyle: 'italic' }}>
                      {t('deviceDetail.overview.noContract')}
                    </span>
                  )}
                </span>
              </div>
              <InfoRow label={t('deviceDetail.fields.lastPolledAt')} value={fmt(device.last_polled_at)} />
            </div>
            {device.last_poll_error && (
              <div style={styles.overviewError}>
                <strong>{t('deviceDetail.fields.lastPollError')}:</strong> {device.last_poll_error}
              </div>
            )}
          </div>
        )}

        {activeTab === 'snmp' && (
          <div>
            <div style={{ marginBottom: '1.25rem' }}>
              <Link to={`/snmp-metrics?device_id=${id}`} style={styles.snmpHistoryLink}>
                {t('deviceDetail.snmp.viewHistory')} →
              </Link>
            </div>
            {!snmpMetrics?.length ? (
              <p style={styles.msg}>{t('deviceDetail.snmp.empty')}</p>
            ) : (
              <>
                <div style={styles.infoLabel}>{t('deviceDetail.snmp.latestReadings')}</div>
                <div style={styles.snmpSummaryGrid}>
                  <InfoRow label={t('deviceDetail.fields.lastPolledAt')} value={fmt(snmpMetrics[0].polled_at)} />
                  <InfoRow label={t('snmpMetrics.fleet.cpu')} value={fmtPct(firstNonNull(snmpMetrics, 'cpu_usage') as number | string | null)} />
                  <InfoRow label={t('snmpMetrics.fleet.memory')} value={fmtPct(firstNonNull(snmpMetrics, 'memory_usage') as number | string | null)} />
                  <InfoRow label={t('snmpMetrics.history.summary.signal')} value={fmtSignal(firstNonNull(snmpMetrics, 'signal_strength') as number | string | null)} />
                  <InfoRow label={t('snmpMetrics.history.summary.latency')} value={fmtLatency(firstNonNull(snmpMetrics, 'latency_ms') as number | string | null)} />
                  <InfoRow label={t('snmpMetrics.fleet.uptime')} value={fmtUptimeTicks(firstNonNull(snmpMetrics, 'uptime_ticks') as number | string | null)} />
                </div>

                <button
                  type="button"
                  onClick={() => setSnmpAllReadingsOpen(o => !o)}
                  style={styles.snmpExpandToggle}
                >
                  {snmpAllReadingsOpen ? '▾ ' : '▸ '}{t('deviceDetail.snmp.allReadings')}
                </button>

                {snmpAllReadingsOpen && (() => {
                  // Every column seen across the fetched rows, minus id/polled_at
                  // (already shown as its own column) — then keep only the
                  // columns that are non-null on AT LEAST one row, so a column
                  // that's always null on this device doesn't clutter the table
                  // with a wall of "—". This is the environmental/power/error
                  // detail (temperature, voltage, fan, UPS, PoE, SFP optics,
                  // interface errors/discards) that the compact summary above
                  // doesn't show — nothing is lost, just collapsed by default.
                  const allKeys = Array.from(
                    new Set(snmpMetrics.flatMap(m => Object.keys(m))),
                  ).filter(k => k !== 'id' && k !== 'polled_at');
                  const nonNullKeys = allKeys.filter(k => snmpMetrics.some(m => m[k] != null));

                  return (
                    <div style={{ overflowX: 'auto', marginTop: '0.75rem' }}>
                      <table style={styles.table}>
                        <thead>
                          <tr>
                            <th style={styles.th}>{t('deviceDetail.snmp.polledAt')}</th>
                            {nonNullKeys.map(k => (
                              <th key={k} style={styles.th}>{k}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {snmpMetrics.map(m => (
                            <tr key={m.id} style={styles.tr}>
                              <td style={styles.td}>{fmt(m.polled_at)}</td>
                              {nonNullKeys.map(k => (
                                <td key={k} style={styles.td}>{fmtRawSnmpValue(k, m[k])}</td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  );
                })()}
              </>
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
          <>
            <div style={{ padding: '1rem 1rem 0' }}>
              <DeviceWorkOrderCreateForm
                deviceId={device.id}
                clientId={device.client_id}
                onCreated={() => qc.invalidateQueries({ queryKey: ['device-work-orders', id] })}
              />
            </div>
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
          </>
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

        {/* Re-check isApOrPtpDevice here too, not just when building TABS:
            `activeTab` is component state that can outlive a `device.type`
            change (e.g. a client-side nav from an AP device to a router
            without DeviceDetail unmounting) — without this guard the panel
            (and its Save button, which would then POST/PUT against a device
            the backend rejects with 400) could render for a non-AP device
            even though no RF Thresholds tab button is shown for it. */}
        {activeTab === 'rfThresholds' && isApOrPtpDevice(device.type) && (
          <div style={{ padding: '1.25rem' }}>
            {/* key={device.id} forces a full remount (fresh useState/useRef,
                including the one-shot form-priming ref) if a caller ever
                navigates directly between two AP/PTP devices' detail pages
                without an intervening unmount — React Router does not
                remount on a route-param change alone, so without this key a
                stale primedRef could leave device A's threshold values
                showing while device B's data has already loaded. */}
            <RfThresholdsTab key={device.id} deviceId={device.id} />
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
  changeLinkStyle: { background: 'transparent', color: 'var(--accent)', border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: '0.8rem', padding: 0 },
  clientErrorText: { color: '#ef4444', fontSize: '0.78rem', margin: '0.35rem 0' },
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
  snmpHistoryLink: { color: 'var(--accent)', fontWeight: 600, fontSize: '0.9rem', textDecoration: 'none' as const },
  snmpSummaryGrid: { display: 'grid' as const, gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0.5rem 1.5rem', marginTop: '0.5rem' },
  snmpExpandToggle: {
    marginTop: '1rem', padding: 0, border: 'none', background: 'none',
    color: 'var(--text-secondary)', fontSize: '0.82rem', fontWeight: 600, cursor: 'pointer',
  },
  rfThresholdsPanel: { maxWidth: 420, display: 'flex' as const, flexDirection: 'column' as const, gap: '0.35rem' },
  rfThresholdsIntro: { fontSize: '0.85rem', color: 'var(--text-muted)', margin: '0 0 0.75rem' },
  rfThresholdsLabel: { display: 'flex' as const, flexDirection: 'column' as const, gap: '0.3rem', fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)', marginTop: '0.5rem' },
  rfThresholdsInput: { padding: '0.5rem 0.6rem', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: '0.9rem', fontFamily: 'var(--font-sans)' },
  rfThresholdsHint: { fontSize: '0.75rem', color: 'var(--text-dimmed)', margin: '0 0 0.25rem' },
  rfThresholdsSaved: { fontSize: '0.8rem', color: '#16a34a', margin: '0.25rem 0' },
  rfThresholdsSaveBtn: { marginTop: '0.75rem', alignSelf: 'flex-start' as const, padding: '0.5rem 1.2rem', borderRadius: 6, border: 'none', background: 'var(--accent)', color: '#fff', fontWeight: 600, fontSize: '0.85rem', cursor: 'pointer' },
  overviewPanel: { padding: '1.25rem' },
  overviewError: { marginTop: '1rem', padding: '0.6rem 0.8rem', background: 'var(--warning-soft, #fef3c7)', color: '#92400e', borderRadius: 6, fontSize: '0.82rem' },
  woFormPanel: { background: 'var(--bg-secondary, #f8fafc)', border: '1px solid var(--border)', borderRadius: 8, padding: '0.85rem 1rem', marginTop: '0.6rem', display: 'flex' as const, flexDirection: 'column' as const, gap: '0.55rem', maxWidth: 420 },
  woFormLabel: { display: 'flex' as const, flexDirection: 'column' as const, gap: '0.3rem', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)' },
  woFormInput: { padding: '0.5rem 0.6rem', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: '0.85rem', fontFamily: 'var(--font-sans)' },
  woFormActions: { display: 'flex' as const, gap: 8, marginTop: '0.25rem' },
  woFormError: { color: '#ef4444', fontSize: '0.8rem', margin: 0 },
  woBtnPrimary: { padding: '0.45rem 1.1rem', borderRadius: 6, border: 'none', background: 'var(--accent)', color: '#fff', fontWeight: 600, fontSize: '0.82rem', cursor: 'pointer' },
  woBtnSecondary: { padding: '0.45rem 1.1rem', borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-secondary)', fontWeight: 600, fontSize: '0.82rem', cursor: 'pointer' },
};
