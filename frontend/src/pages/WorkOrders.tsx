// =============================================================================
// FireISP 5.0 — Work Orders (§12)
// =============================================================================
// List, create, and manage field work orders.  Supports status transitions
// (dispatch → start → complete/cancel) and materials sub-resource.
// =============================================================================

import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, authedFetch } from '@/api/client';
import { styles, modalStyles } from './crudStyles';
import { ClientPicker } from '@/components/ClientPicker';
import { useTableSort, SortableTh } from '@/components/SortableTh';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface WorkOrder {
  id: number;
  ticket_id: number | null;
  assigned_to: number | null;
  status: string;
  title: string;
  description: string | null;
  scheduled_at: string | null;
  completed_at: string | null;
  organization_id: number;
  created_at: string;
  // Target links (work_orders is the single field-work table since migration 363)
  client_id: number | null;
  site_id: number | null;
  device_id: number | null;
  contract_id: number | null;
  service_order_id: number | null;
  work_type: string | null;
  client_name: string | null;
  site_name: string | null;
  device_name: string | null;
  assigned_first: string | null;
  assigned_last: string | null;
}

interface WorkOrderBody {
  title: string;
  description?: string;
  ticket_id?: number;
  assigned_to?: number;
  status?: string;
  scheduled_at?: string;
  client_id?: number;
  site_id?: number;
  device_id?: number;
  contract_id?: number;
  service_order_id?: number;
  work_type?: string;
}

interface Option { id: number; name: string }

interface UserOption { id: number; first_name: string; last_name: string }

interface WorkOrderMaterial {
  id: number;
  item_name: string;
  quantity: number;
  unit: string | null;
  unit_cost: number | null;
  notes: string | null;
}

interface WorkOrderMaterialBody {
  item_name: string;
  quantity: number;
  unit?: string;
  unit_cost?: number;
  notes?: string;
}

interface ListResponse<T> {
  data: T[];
  meta: { total: number; page: number; limit: number };
}

const PAGE_SIZE = 25;
const STATUSES = ['pending', 'assigned', 'in_progress', 'completed', 'cancelled'];
const WORK_TYPES = ['installation', 'maintenance', 'repair', 'survey', 'other'];

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

async function fetchWorkOrders(page: number, statusFilter: string, orderBy: string, order: string): Promise<ListResponse<WorkOrder>> {
  const query: Record<string, string | number> = { page, limit: PAGE_SIZE, order_by: orderBy, order };
  if (statusFilter) query.status = statusFilter;
  const res = await api.GET('/work-orders' as never, {
    params: { query: query as never },
  } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to load work orders');
  return (res as { data: unknown }).data as unknown as ListResponse<WorkOrder>;
}

async function fetchOptions(pathname: '/sites' | '/devices'): Promise<Option[]> {
  const res = await api.GET(pathname as never, { params: { query: { limit: 200 } as never } } as never);
  if ((res as { error?: unknown }).error) return [];
  return (((res as { data: unknown }).data as { data: Option[] }).data) ?? [];
}

async function fetchUsers(): Promise<UserOption[]> {
  const res = await api.GET('/users' as never, { params: { query: { limit: 200 } as never } } as never);
  if ((res as { error?: unknown }).error) return [];
  return (((res as { data: unknown }).data as { data: UserOption[] }).data) ?? [];
}

async function createWorkOrder(body: WorkOrderBody): Promise<WorkOrder> {
  const resp = await authedFetch('/api/v1/work-orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw new Error('Failed to create work order');
  const json = await resp.json() as { data: WorkOrder };
  return json.data;
}

async function patchWorkOrder(id: number, body: Partial<WorkOrderBody>): Promise<void> {
  const resp = await authedFetch(`/api/v1/work-orders/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw new Error('Failed to update work order');
}

async function fetchMaterials(workOrderId: number): Promise<WorkOrderMaterial[]> {
  const res = await api.GET('/work-orders/{id}/materials' as never, {
    params: { path: { id: workOrderId } as never },
  } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to load materials');
  return ((res as { data: unknown }).data as { data: WorkOrderMaterial[] }).data;
}

async function addMaterial(workOrderId: number, body: WorkOrderMaterialBody): Promise<void> {
  const resp = await authedFetch(`/api/v1/work-orders/${workOrderId}/materials`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw new Error('Failed to add material');
}

async function removeMaterial(workOrderId: number, materialId: number): Promise<void> {
  const resp = await authedFetch(`/api/v1/work-orders/${workOrderId}/materials/${materialId}`, {
    method: 'DELETE',
  });
  if (!resp.ok && resp.status !== 204) throw new Error('Failed to remove material');
}

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, { bg: string; color: string }> = {
    pending:     { bg: '#fef3c7', color: '#92400e' },
    assigned:    { bg: '#dbeafe', color: '#1e40af' },
    in_progress: { bg: '#ede9fe', color: '#5b21b6' },
    completed:   { bg: '#d1fae5', color: '#065f46' },
    cancelled:   { bg: '#f3f4f6', color: '#6b7280' },
  };
  const s = colors[status] ?? { bg: '#f3f4f6', color: '#374151' };
  return (
    <span style={{
      background: s.bg,
      color: s.color,
      padding: '2px 8px',
      borderRadius: 12,
      fontSize: '0.72rem',
      fontWeight: 600,
      textTransform: 'capitalize',
    }}>
      {status.replace(/_/g, ' ')}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Materials panel (shown inline when a row is expanded)
// ---------------------------------------------------------------------------

function MaterialsPanel({ workOrderId }: { workOrderId: number }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState<Partial<WorkOrderMaterialBody>>({ quantity: 1 });
  const [addErr, setAddErr] = useState('');

  const materialsQ = useQuery({
    queryKey: ['workOrders', workOrderId, 'materials'],
    queryFn: () => fetchMaterials(workOrderId),
  });

  const addMut = useMutation({
    mutationFn: () => addMaterial(workOrderId, form as WorkOrderMaterialBody),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['workOrders', workOrderId, 'materials'] });
      setShowAdd(false);
      setForm({ quantity: 1 });
    },
    onError: (e: unknown) => setAddErr((e as { message?: string })?.message ?? 'Failed'),
  });

  const removeMut = useMutation({
    mutationFn: (materialId: number) => removeMaterial(workOrderId, materialId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['workOrders', workOrderId, 'materials'] }),
  });

  return (
    <div style={{ padding: '12px 16px', background: 'var(--bg-secondary)', borderTop: '1px solid var(--border)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <strong style={{ fontSize: '0.85rem' }}>{t('workOrders.materials')}</strong>
        <button style={styles.btnPrimary} onClick={() => setShowAdd(v => !v)}>
          {t('workOrders.addMaterial')}
        </button>
      </div>

      {showAdd && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
          <input
            style={styles.input}
            placeholder="Item name"
            value={form.item_name ?? ''}
            onChange={e => setForm(f => ({ ...f, item_name: e.target.value }))}
          />
          <input
            style={{ ...styles.input, width: 80 }}
            type="number"
            placeholder="Qty"
            value={form.quantity ?? 1}
            onChange={e => setForm(f => ({ ...f, quantity: Number(e.target.value) }))}
          />
          <input
            style={{ ...styles.input, width: 80 }}
            placeholder="Unit"
            value={form.unit ?? ''}
            onChange={e => setForm(f => ({ ...f, unit: e.target.value }))}
          />
          <button
            style={styles.btnPrimary}
            disabled={!form.item_name || addMut.isPending}
            onClick={() => { setAddErr(''); addMut.mutate(); }}
          >
            {addMut.isPending ? t('common.saving') : t('common.save')}
          </button>
          {addErr && <span style={{ color: '#dc2626', fontSize: '0.8rem' }}>{addErr}</span>}
        </div>
      )}

      {materialsQ.isLoading ? (
        <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>{t('common.loading')}</span>
      ) : (
        <table style={styles.table}>
          <tbody>
            {(materialsQ.data ?? []).map(m => (
              <tr key={m.id}>
                <td style={styles.td}>{m.item_name}</td>
                <td style={styles.td}>{m.quantity} {m.unit ?? ''}</td>
                <td style={styles.td}>{m.unit_cost !== null ? `$${m.unit_cost}` : '—'}</td>
                <td style={styles.td}>
                  <button
                    style={styles.btnDanger}
                    onClick={() => removeMut.mutate(m.id)}
                    disabled={removeMut.isPending}
                  >
                    {t('common.delete')}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function WorkOrders() {
  const { t } = useTranslation();
  const qc = useQueryClient();

  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('');
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState<Partial<WorkOrderBody>>({});
  const [formErr, setFormErr] = useState('');
  const sort = useTableSort('created_at', 'DESC');

  useEffect(() => { setPage(1); }, [sort.sortBy, sort.sortDir]);

  const workOrdersQ = useQuery({
    queryKey: ['workOrders', page, statusFilter, sort.sortBy, sort.sortDir],
    queryFn: () => fetchWorkOrders(page, statusFilter, sort.order_by, sort.order),
  });

  const sitesQ = useQuery({ queryKey: ['workOrders', 'siteOptions'], queryFn: () => fetchOptions('/sites') });
  const devicesQ = useQuery({ queryKey: ['workOrders', 'deviceOptions'], queryFn: () => fetchOptions('/devices') });
  const usersQ = useQuery({ queryKey: ['workOrders', 'userOptions'], queryFn: fetchUsers });

  const createMut = useMutation({
    mutationFn: () => createWorkOrder(form as WorkOrderBody),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['workOrders'] });
      setShowModal(false);
      setForm({});
    },
    onError: (e: unknown) => setFormErr((e as { message?: string })?.message ?? 'Failed'),
  });

  const patchMut = useMutation({
    mutationFn: ({ id, body }: { id: number; body: Partial<WorkOrderBody> }) => patchWorkOrder(id, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['workOrders'] }),
  });

  const totalPages = Math.ceil((workOrdersQ.data?.meta.total ?? 0) / PAGE_SIZE) || 1;

  const statusLabel = (s: string): string => {
    const map: Record<string, string> = {
      pending: t('workOrders.status.pending'),
      assigned: t('workOrders.status.assigned'),
      in_progress: t('workOrders.status.inProgress'),
      completed: t('workOrders.status.completed'),
      cancelled: t('workOrders.status.cancelled'),
    };
    return map[s] ?? s;
  };

  const workTypeLabel = (w: string | null): string =>
    w ? t(`workOrders.workType.${w}`, w) : t('workOrders.none');

  const targetLabel = (wo: WorkOrder): string =>
    wo.client_name || wo.site_name || wo.device_name || t('workOrders.none');

  const assigneeName = (wo: WorkOrder): string => {
    const name = `${wo.assigned_first ?? ''} ${wo.assigned_last ?? ''}`.trim();
    return name || t('workOrders.none');
  };

  const hasTarget = Boolean(form.client_id || form.site_id || form.device_id);

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.pageTitle}>{t('workOrders.title')}</h1>
        <button style={styles.btnPrimary} onClick={() => { setForm({}); setFormErr(''); setShowModal(true); }}>
          {t('workOrders.new')}
        </button>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <select
          style={styles.input}
          value={statusFilter}
          onChange={e => { setStatusFilter(e.target.value); setPage(1); }}
        >
          <option value="">All statuses</option>
          {STATUSES.map(s => (
            <option key={s} value={s}>{statusLabel(s)}</option>
          ))}
        </select>
      </div>

      {/* Table */}
      {workOrdersQ.isLoading ? (
        <p>{t('common.loading')}</p>
      ) : workOrdersQ.error ? (
        <p style={{ color: '#dc2626' }}>{t('common.loadError')}</p>
      ) : (
        <>
          {(workOrdersQ.data?.data ?? []).length === 0 ? (
            <p style={{ color: 'var(--text-secondary)' }}>{t('workOrders.noOrders')}</p>
          ) : (
            <div style={styles.tableCard}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    <SortableTh label={t('common.id')} col="id" sort={sort} style={styles.th} />
                    <SortableTh label="Title" col="title" sort={sort} style={styles.th} />
                    <SortableTh label={t('workOrders.type')} col="work_type" sort={sort} style={styles.th} />
                    {/* target is a derived label from joined client/site/device name — non-sortable */}
                    <th style={styles.th}>{t('workOrders.target')}</th>
                    {/* assigned_to name comes from a JOIN on users — non-sortable by name; assigned_to FK is own-table */}
                    <th style={styles.th}>Assigned To</th>
                    <SortableTh label="Status" col="status" sort={sort} style={styles.th} />
                    <SortableTh label="Scheduled" col="scheduled_at" sort={sort} style={styles.th} />
                    <th style={styles.th}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {(workOrdersQ.data?.data ?? []).map(wo => (
                    <>
                      <tr key={wo.id} style={{ cursor: 'pointer' }} onClick={() => setExpandedId(v => v === wo.id ? null : wo.id)}>
                        <td style={styles.td}>{wo.id}</td>
                        <td style={styles.td}>{wo.title}</td>
                        <td style={{ ...styles.td, textTransform: 'capitalize' }}>{workTypeLabel(wo.work_type)}</td>
                        <td style={styles.td}>{targetLabel(wo)}</td>
                        <td style={styles.td}>{assigneeName(wo)}</td>
                        <td style={styles.td}><StatusBadge status={wo.status} /></td>
                        <td style={styles.td}>{wo.scheduled_at ? wo.scheduled_at.slice(0, 10) : t('common.na')}</td>
                        <td style={styles.td} onClick={e => e.stopPropagation()}>
                          {wo.status === 'pending' && (
                            <button
                              style={{ ...styles.btnPrimary, marginRight: 4 }}
                              onClick={() => patchMut.mutate({ id: wo.id, body: { status: 'assigned' } })}
                            >
                              Dispatch
                            </button>
                          )}
                          {wo.status === 'assigned' && (
                            <button
                              style={{ ...styles.btnPrimary, marginRight: 4 }}
                              onClick={() => patchMut.mutate({ id: wo.id, body: { status: 'in_progress' } })}
                            >
                              Start
                            </button>
                          )}
                          {wo.status === 'in_progress' && (
                            <>
                              <button
                                style={{ ...styles.btnPrimary, marginRight: 4 }}
                                onClick={() => patchMut.mutate({ id: wo.id, body: { status: 'completed' } })}
                              >
                                Complete
                              </button>
                              <button
                                style={styles.btnDanger}
                                onClick={() => patchMut.mutate({ id: wo.id, body: { status: 'cancelled' } })}
                              >
                                Cancel
                              </button>
                            </>
                          )}
                        </td>
                      </tr>
                      {expandedId === wo.id && (
                        <tr key={`${wo.id}-materials`}>
                          <td colSpan={8} style={{ padding: 0 }}>
                            <MaterialsPanel workOrderId={wo.id} />
                          </td>
                        </tr>
                      )}
                    </>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination */}
          <div style={styles.pagination}>
            <button style={styles.btnSecondary} disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
              {t('common.prev')}
            </button>
            <span>{page} / {totalPages}</span>
            <button style={styles.btnSecondary} disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>
              {t('common.next')}
            </button>
          </div>
        </>
      )}

      {/* Create modal */}
      {showModal && (
        <div style={modalStyles.backdrop} onClick={() => setShowModal(false)}>
          <div style={modalStyles.panel} onClick={e => e.stopPropagation()}>
            <div style={modalStyles.header}>
              <h2 style={modalStyles.title}>{t('workOrders.new')}</h2>
            </div>
            <div style={modalStyles.form}>
              <label style={modalStyles.label}>
                Title *
                <input
                  style={modalStyles.input}
                  value={form.title ?? ''}
                  onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                />
              </label>
              <label style={modalStyles.label}>
                Description
                <textarea
                  style={{ ...modalStyles.input, height: 80 }}
                  value={form.description ?? ''}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                />
              </label>
              <label style={modalStyles.label}>
                Status
                <select
                  style={modalStyles.select}
                  value={form.status ?? 'pending'}
                  onChange={e => setForm(f => ({ ...f, status: e.target.value }))}
                >
                  {STATUSES.map(s => <option key={s} value={s}>{statusLabel(s)}</option>)}
                </select>
              </label>
              <label style={modalStyles.label}>
                {t('workOrders.type')}
                <select
                  style={modalStyles.select}
                  value={form.work_type ?? 'other'}
                  onChange={e => setForm(f => ({ ...f, work_type: e.target.value }))}
                >
                  {WORK_TYPES.map(w => <option key={w} value={w}>{workTypeLabel(w)}</option>)}
                </select>
              </label>

              {/* Target — a work order links to AT LEAST ONE of client / site /
                  device (none is individually required; client is not mandatory). */}
              <div style={{ marginTop: '0.25rem' }}>
                <div style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-secondary)' }}>{t('workOrders.target')}</div>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{t('workOrders.targetRequired')}</div>
              </div>
              <ClientPicker
                required={false}
                value={form.client_id ?? ''}
                onChange={(id) => setForm(f => ({ ...f, client_id: id || undefined }))}
              />
              <label style={modalStyles.label}>
                {t('workOrders.site')}
                <select
                  style={modalStyles.select}
                  value={form.site_id ?? ''}
                  onChange={e => setForm(f => ({ ...f, site_id: e.target.value ? Number(e.target.value) : undefined }))}
                >
                  <option value="">{t('workOrders.none')}</option>
                  {(sitesQ.data ?? []).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </label>
              <label style={modalStyles.label}>
                {t('workOrders.device')}
                <select
                  style={modalStyles.select}
                  value={form.device_id ?? ''}
                  onChange={e => setForm(f => ({ ...f, device_id: e.target.value ? Number(e.target.value) : undefined }))}
                >
                  <option value="">{t('workOrders.none')}</option>
                  {(devicesQ.data ?? []).map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </label>

              <label style={modalStyles.label}>
                Assigned To
                <select
                  style={modalStyles.select}
                  value={form.assigned_to ?? ''}
                  onChange={e => setForm(f => ({ ...f, assigned_to: e.target.value ? Number(e.target.value) : undefined }))}
                >
                  <option value="">Unassigned</option>
                  {(usersQ.data ?? []).map(u => <option key={u.id} value={u.id}>{u.first_name} {u.last_name}</option>)}
                </select>
              </label>
              {formErr && <p style={modalStyles.error}>{formErr}</p>}
              <div style={modalStyles.actions}>
                <button style={styles.btnSecondary} onClick={() => setShowModal(false)}>{t('common.cancel')}</button>
                <button
                  style={styles.btnPrimary}
                  disabled={!form.title || !hasTarget || createMut.isPending}
                  onClick={() => { setFormErr(''); createMut.mutate(); }}
                >
                  {createMut.isPending ? t('common.saving') : t('common.save')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
