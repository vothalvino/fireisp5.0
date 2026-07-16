// =============================================================================
// FireISP 5.0 — Site Detail
// =============================================================================
// Route: /sites/:id
// Data: GET /sites/{id} via REST api client
// =============================================================================

import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, authedFetch } from '@/api/client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SiteRecord {
  id: number;
  name: string;
  site_type: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip_code: string | null;
  country: string | null;
  latitude: string | number | null;
  longitude: string | number | null;
  status: string;
  notes: string | null;
}

interface DeviceRow {
  id: number;
  name: string;
  type: string | null;
  status: string;
  ip_address: string | null;
}

interface NasRow {
  id: number;
  name: string;
  ip_address: string;
  status: string;
}

interface IpPoolRow {
  id: number;
  name: string;
  network: string | null;
  cidr: number | null;
  status: string;
}

interface WorkOrderRow {
  id: number;
  title: string;
  work_type: string | null;
  status: string;
}

interface OutageRow {
  id: number;
  title: string;
  severity: string | null;
  status: string;
  started_at: string | null;
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
    active:   { bg: '#d1fae5', color: '#065f46' },
    inactive: { bg: '#f3f4f6', color: '#6b7280' },
    online:   { bg: '#d1fae5', color: '#065f46' },
    offline:  { bg: '#fee2e2', color: '#991b1b' },
  };
  const s = colorMap[status] ?? { bg: '#f3f4f6', color: '#374151' };
  return (
    <span style={{ background: s.bg, color: s.color, padding: '2px 8px', borderRadius: 12, fontSize: '0.72rem', fontWeight: 600, textTransform: 'capitalize' }}>
      {status}
    </span>
  );
}

function InfoRow({ label, value, mono }: { label: string; value: string | null | undefined; mono?: boolean }) {
  if (!value) return null;
  return (
    <div style={styles.infoRow}>
      <span style={styles.infoLabel}>{label}</span>
      <span style={{ ...styles.infoValue, ...(mono ? { fontFamily: 'monospace' } : {}) }}>{value}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Work order creation (inline, from the site's Work Orders tab)
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
    const j = await resp.json() as { error?: string };
    if (j && typeof j.error === 'string') return j.error;
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

function SiteWorkOrderCreateForm({ siteId, onCreated }: { siteId: number; onCreated: () => void }) {
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
      site_id: siteId,
    }),
    onSuccess: () => {
      setOpen(false);
      setTitle(''); setDescription(''); setWorkType('other'); setPriority('medium');
      setScheduledAt(''); setAssignedTo(''); setFormErr('');
      onCreated();
    },
    onError: (e: unknown) => setFormErr(e instanceof Error ? e.message : t('siteDetail.workOrders.createForm.saveFailed')),
  });

  return (
    <div style={{ marginBottom: '1rem' }}>
      <button type="button" style={open ? styles.woBtnSecondary : styles.woBtnPrimary} onClick={() => setOpen(v => !v)}>
        {open ? t('common.cancel') : t('workOrders.new')}
      </button>
      {open && (
        <div style={styles.woFormPanel}>
          <label style={styles.woFormLabel}>
            {t('siteDetail.workOrders.createForm.title')} *
            <input
              style={styles.woFormInput}
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder={t('siteDetail.workOrders.createForm.titlePlaceholder')}
            />
          </label>
          <label style={styles.woFormLabel}>
            {t('siteDetail.workOrders.createForm.description')}
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
            {t('siteDetail.workOrders.createForm.priority')}
            <select style={styles.woFormInput} value={priority} onChange={e => setPriority(e.target.value)}>
              {WO_PRIORITIES.map(p => <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>)}
            </select>
          </label>
          <label style={styles.woFormLabel}>
            {t('siteDetail.workOrders.createForm.scheduledAt')}
            <input
              type="datetime-local"
              style={styles.woFormInput}
              value={scheduledAt}
              onChange={e => setScheduledAt(e.target.value)}
            />
          </label>
          <label style={styles.woFormLabel}>
            {t('siteDetail.workOrders.createForm.assignedTo')}
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
              {createMut.isPending ? t('common.saving') : t('siteDetail.workOrders.createForm.submit')}
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
// Tabs
// ---------------------------------------------------------------------------

type TabId = 'overview' | 'devices' | 'nas' | 'ipPools' | 'workOrders' | 'outages' | 'timeline';

interface TimelineEvent {
  event_type: 'work_order' | 'outage' | 'maintenance_window';
  id: number;
  title: string;
  subtype: string | null;
  status: string;
  assigned_to: number | null;
  occurred_at: string;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function SiteDetail() {
  const { id } = useParams<{ id: string }>();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState<TabId>('overview');

  const TABS: { id: TabId; label: string }[] = [
    { id: 'overview',   label: t('siteDetail.tabs.overview') },
    { id: 'devices',    label: t('siteDetail.tabs.devices') },
    { id: 'nas',        label: t('siteDetail.tabs.nas') },
    { id: 'ipPools',    label: t('siteDetail.tabs.ipPools') },
    { id: 'workOrders', label: t('siteDetail.tabs.workOrders') },
    { id: 'outages',    label: t('siteDetail.tabs.outages') },
    { id: 'timeline',   label: t('siteDetail.tabs.timeline', 'Timeline') },
  ];

  const { data: site, isLoading, error } = useQuery({
    queryKey: ['site-detail', id],
    queryFn: async () => {
      const res = await api.GET('/sites/{id}' as never, { params: { path: { id: Number(id) } } } as never);
      if ((res as { error?: unknown }).error) throw new Error('Site not found');
      const d = (res as { data: unknown }).data;
      return (((d as { data?: SiteRecord }).data) ?? d) as SiteRecord;
    },
    enabled: Boolean(id),
  });

  const { data: devices } = useQuery({
    queryKey: ['site-devices', id],
    queryFn: async () => {
      const res = await api.GET('/devices' as never, { params: { query: { site_id: Number(id), limit: 100 } as never } } as never);
      if ((res as { error?: unknown }).error) return [];
      const d = (res as { data: unknown }).data as ListResp<DeviceRow> | DeviceRow[];
      return Array.isArray(d) ? d : (d as ListResp<DeviceRow>).data ?? [];
    },
    enabled: Boolean(id) && activeTab === 'devices',
  });

  const { data: nasList } = useQuery({
    queryKey: ['site-nas', id],
    queryFn: async () => {
      const res = await api.GET('/nas' as never, { params: { query: { site_id: Number(id), limit: 100 } as never } } as never);
      if ((res as { error?: unknown }).error) return [];
      const d = (res as { data: unknown }).data as ListResp<NasRow> | NasRow[];
      return Array.isArray(d) ? d : (d as ListResp<NasRow>).data ?? [];
    },
    enabled: Boolean(id) && activeTab === 'nas',
  });

  const { data: ipPools } = useQuery({
    queryKey: ['site-ip-pools', id],
    queryFn: async () => {
      const res = await api.GET('/ip-pools' as never, { params: { query: { site_id: Number(id), limit: 100 } as never } } as never);
      if ((res as { error?: unknown }).error) return [];
      const d = (res as { data: unknown }).data as ListResp<IpPoolRow> | IpPoolRow[];
      return Array.isArray(d) ? d : (d as ListResp<IpPoolRow>).data ?? [];
    },
    enabled: Boolean(id) && activeTab === 'ipPools',
  });

  const { data: workOrders } = useQuery({
    queryKey: ['site-work-orders', id],
    queryFn: async () => {
      const res = await api.GET('/work-orders' as never, { params: { query: { site_id: Number(id), limit: 50 } as never } } as never);
      if ((res as { error?: unknown }).error) return [];
      const d = (res as { data: unknown }).data as ListResp<WorkOrderRow> | WorkOrderRow[];
      return Array.isArray(d) ? d : (d as ListResp<WorkOrderRow>).data ?? [];
    },
    enabled: Boolean(id) && activeTab === 'workOrders',
  });

  const { data: outages } = useQuery({
    queryKey: ['site-outages', id],
    queryFn: async () => {
      const res = await api.GET('/outages' as never, { params: { query: { site_id: Number(id), limit: 50 } as never } } as never);
      if ((res as { error?: unknown }).error) return [];
      const d = (res as { data: unknown }).data as ListResp<OutageRow> | OutageRow[];
      return Array.isArray(d) ? d : (d as ListResp<OutageRow>).data ?? [];
    },
    enabled: Boolean(id) && activeTab === 'outages',
  });

  const { data: timeline } = useQuery({
    queryKey: ['site-timeline', id],
    queryFn: async () => {
      const res = await api.GET('/sites/{id}/timeline' as never, { params: { path: { id: Number(id) }, query: { limit: 100 } as never } } as never);
      if ((res as { error?: unknown }).error) return [];
      return (((res as { data?: { data?: { events?: TimelineEvent[] } } }).data?.data?.events) ?? []);
    },
    enabled: Boolean(id) && activeTab === 'timeline',
  });

  if (isLoading) {
    return <div style={styles.page}><p style={styles.msg}>{t('siteDetail.loading')}</p></div>;
  }

  if (error || !site) {
    return (
      <div style={styles.page}>
        <p style={styles.msgError}>{t('siteDetail.notFound')}</p>
        <Link to="/sites" style={styles.backLink}>← {t('siteDetail.backToList')}</Link>
      </div>
    );
  }

  const location = [site.address, site.city, site.state, site.zip_code, site.country].filter(Boolean).join(', ');

  return (
    <div style={styles.page}>
      {/* Breadcrumb */}
      <div style={styles.breadcrumb}>
        <Link to="/sites" style={styles.breadcrumbLink}>Sites</Link>
        <span style={styles.breadcrumbSep}>›</span>
        <span style={styles.breadcrumbCurrent}>{site.name}</span>
      </div>

      {/* Header */}
      <div style={styles.header}>
        <div>
          <h1 style={styles.title}>{site.name}</h1>
          <div style={styles.headerMeta}>
            <StatusBadge status={site.status} />
            <span style={styles.idLabel}>ID #{site.id}</span>
          </div>
        </div>
      </div>

      {/* Info card */}
      <div style={styles.infoCard}>
        <div style={styles.infoGrid}>
          <InfoRow label={t('siteDetail.fields.siteType')}  value={site.site_type} />
          <InfoRow label={t('siteDetail.fields.location')}  value={location || null} />
          <InfoRow label={t('siteDetail.fields.latitude')}  value={site.latitude != null ? String(site.latitude) : null} />
          <InfoRow label={t('siteDetail.fields.longitude')} value={site.longitude != null ? String(site.longitude) : null} />
        </div>
        {site.notes && (
          <div style={styles.notesRow}>
            <span style={styles.noteLabel}>Notes: </span>{site.notes}
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
          <p style={styles.msg}>{t('siteDetail.overview.hint')}</p>
        )}

        {activeTab === 'devices' && (
          <div style={{ overflowX: 'auto' }}>
            {!devices?.length ? (
              <p style={styles.msg}>{t('siteDetail.devices.empty')}</p>
            ) : (
              <table style={styles.table}>
                <thead>
                  <tr>
                    {[t('siteDetail.devices.name'), t('siteDetail.devices.type'), t('siteDetail.devices.status'), t('siteDetail.devices.ipAddress')].map(h => (
                      <th key={h} style={styles.th}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(devices ?? []).map(d => (
                    <tr key={d.id} style={styles.tr}>
                      <td style={styles.td}>
                        <Link to={`/devices/${d.id}`} style={{ color: 'var(--accent)', textDecoration: 'none', fontWeight: 600 }}>
                          {d.name}
                        </Link>
                      </td>
                      <td style={styles.td}>{d.type ?? '—'}</td>
                      <td style={styles.td}><StatusBadge status={d.status} /></td>
                      <td style={{ ...styles.td, fontFamily: 'monospace' }}>{d.ip_address ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {activeTab === 'nas' && (
          <div style={{ overflowX: 'auto' }}>
            {!nasList?.length ? (
              <p style={styles.msg}>{t('siteDetail.nas.empty')}</p>
            ) : (
              <table style={styles.table}>
                <thead>
                  <tr>
                    {[t('siteDetail.nas.name'), t('siteDetail.nas.ipAddress'), t('siteDetail.nas.status')].map(h => (
                      <th key={h} style={styles.th}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(nasList ?? []).map(n => (
                    <tr key={n.id} style={styles.tr}>
                      <td style={styles.td}>
                        <Link to={`/nas/${n.id}`} style={{ color: 'var(--accent)', textDecoration: 'none', fontWeight: 600 }}>
                          {n.name}
                        </Link>
                      </td>
                      <td style={{ ...styles.td, fontFamily: 'monospace' }}>{n.ip_address}</td>
                      <td style={styles.td}><StatusBadge status={n.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {activeTab === 'ipPools' && (
          <div style={{ overflowX: 'auto' }}>
            {!ipPools?.length ? (
              <p style={styles.msg}>{t('siteDetail.ipPools.empty')}</p>
            ) : (
              <table style={styles.table}>
                <thead>
                  <tr>
                    {[t('siteDetail.ipPools.name'), t('siteDetail.ipPools.network'), t('siteDetail.ipPools.status')].map(h => (
                      <th key={h} style={styles.th}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(ipPools ?? []).map(p => (
                    <tr key={p.id} style={styles.tr}>
                      <td style={styles.td}>{p.name}</td>
                      <td style={{ ...styles.td, fontFamily: 'monospace' }}>
                        {p.network ? (p.cidr ? `${p.network}/${p.cidr}` : p.network) : '—'}
                      </td>
                      <td style={styles.td}><StatusBadge status={p.status} /></td>
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
              <SiteWorkOrderCreateForm
                siteId={Number(id)}
                onCreated={() => {
                  qc.invalidateQueries({ queryKey: ['site-work-orders', id] });
                  qc.invalidateQueries({ queryKey: ['site-timeline', id] });
                }}
              />
            </div>
            <div style={{ overflowX: 'auto' }}>
              {!workOrders?.length ? (
                <p style={styles.msg}>{t('siteDetail.workOrders.empty')}</p>
              ) : (
                <table style={styles.table}>
                  <thead>
                    <tr>
                      {[t('siteDetail.workOrders.id'), t('siteDetail.workOrders.title'), t('siteDetail.workOrders.workType'), t('siteDetail.workOrders.status')].map(h => (
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
              <p style={styles.msg}>{t('siteDetail.outages.empty')}</p>
            ) : (
              <table style={styles.table}>
                <thead>
                  <tr>
                    {[t('siteDetail.outages.title'), t('siteDetail.outages.severity'), t('siteDetail.outages.status'), t('siteDetail.outages.startedAt')].map(h => (
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
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
        {activeTab === 'timeline' && (
          <div style={{ overflowX: 'auto' }}>
            {!timeline?.length ? (
              <p style={styles.msg}>{t('siteDetail.timeline.empty', 'No activity recorded for this site yet.')}</p>
            ) : (
              <table style={styles.table}>
                <thead>
                  <tr>
                    {[
                      t('siteDetail.timeline.when', 'When'),
                      t('siteDetail.timeline.kind', 'Kind'),
                      t('siteDetail.timeline.what', 'What'),
                      t('siteDetail.timeline.status', 'Status'),
                    ].map(h => (
                      <th key={h} style={styles.th}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(timeline ?? []).map(ev => (
                    <tr key={`${ev.event_type}-${ev.id}`} style={styles.tr}>
                      <td style={styles.td}>{fmt(ev.occurred_at)}</td>
                      <td style={styles.td}>
                        {ev.event_type === 'work_order'
                          ? t('siteDetail.timeline.workOrder', 'Work order')
                          : ev.event_type === 'outage'
                            ? t('siteDetail.timeline.outage', 'Outage')
                            : t('siteDetail.timeline.maintenance', 'Maintenance window')}
                        {ev.subtype ? ` · ${ev.subtype}` : ''}
                      </td>
                      <td style={styles.td}>#{ev.id} — {ev.title}</td>
                      <td style={styles.td}><StatusBadge status={ev.status} /></td>
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
  woFormPanel: { background: 'var(--bg-secondary, #f8fafc)', border: '1px solid var(--border)', borderRadius: 8, padding: '0.85rem 1rem', marginTop: '0.6rem', display: 'flex' as const, flexDirection: 'column' as const, gap: '0.55rem', maxWidth: 420 },
  woFormLabel: { display: 'flex' as const, flexDirection: 'column' as const, gap: '0.3rem', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)' },
  woFormInput: { padding: '0.5rem 0.6rem', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: '0.85rem', fontFamily: 'var(--font-sans)' },
  woFormActions: { display: 'flex' as const, gap: 8, marginTop: '0.25rem' },
  woFormError: { color: '#ef4444', fontSize: '0.8rem', margin: 0 },
  woBtnPrimary: { padding: '0.45rem 1.1rem', borderRadius: 6, border: 'none', background: 'var(--accent)', color: '#fff', fontWeight: 600, fontSize: '0.82rem', cursor: 'pointer' },
  woBtnSecondary: { padding: '0.45rem 1.1rem', borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-secondary)', fontWeight: 600, fontSize: '0.82rem', cursor: 'pointer' },
};
