// =============================================================================
// FireISP 5.0 — Work Orders (§12)
// =============================================================================
// List, create, and manage field work orders.  Supports status transitions
// (dispatch → start → complete/cancel) and materials sub-resource.
// =============================================================================

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';
import { styles, modalStyles } from './crudStyles';
import { tokenStore } from '@/api/client';

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
}

interface WorkOrderBody {
  title: string;
  description?: string;
  ticket_id?: number;
  assigned_to?: number;
  status?: string;
  scheduled_at?: string;
}

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

// ---------------------------------------------------------------------------
// Auth header helpers
// ---------------------------------------------------------------------------

function getAuthHeaders(): Record<string, string> {
  const token = tokenStore.getAccess();
  const orgId = sessionStorage.getItem('orgId') || localStorage.getItem('orgId') || '';
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(orgId ? { 'X-Org-Id': orgId } : {}),
  };
}

function getBearerHeaders(): Record<string, string> {
  const token = tokenStore.getAccess();
  const orgId = sessionStorage.getItem('orgId') || localStorage.getItem('orgId') || '';
  return {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(orgId ? { 'X-Org-Id': orgId } : {}),
  };
}

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

async function fetchWorkOrders(page: number, statusFilter: string): Promise<ListResponse<WorkOrder>> {
  const query: Record<string, string | number> = { page, limit: PAGE_SIZE };
  if (statusFilter) query.status = statusFilter;
  const res = await api.GET('/work-orders' as never, {
    params: { query: query as never },
  } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to load work orders');
  return (res as { data: unknown }).data as unknown as ListResponse<WorkOrder>;
}

async function createWorkOrder(body: WorkOrderBody): Promise<WorkOrder> {
  const resp = await fetch('/api/v1/work-orders', {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw new Error('Failed to create work order');
  const json = await resp.json() as { data: WorkOrder };
  return json.data;
}

async function patchWorkOrder(id: number, body: Partial<WorkOrderBody>): Promise<void> {
  const resp = await fetch(`/api/v1/work-orders/${id}`, {
    method: 'PATCH',
    headers: getAuthHeaders(),
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
  const resp = await fetch(`/api/v1/work-orders/${workOrderId}/materials`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw new Error('Failed to add material');
}

async function removeMaterial(workOrderId: number, materialId: number): Promise<void> {
  const resp = await fetch(`/api/v1/work-orders/${workOrderId}/materials/${materialId}`, {
    method: 'DELETE',
    headers: getBearerHeaders(),
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

  const workOrdersQ = useQuery({
    queryKey: ['workOrders', page, statusFilter],
    queryFn: () => fetchWorkOrders(page, statusFilter),
  });

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
                    <th style={styles.th}>{t('common.id')}</th>
                    <th style={styles.th}>Title</th>
                    <th style={styles.th}>Status</th>
                    <th style={styles.th}>Scheduled</th>
                    <th style={styles.th}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {(workOrdersQ.data?.data ?? []).map(wo => (
                    <>
                      <tr key={wo.id} style={{ cursor: 'pointer' }} onClick={() => setExpandedId(v => v === wo.id ? null : wo.id)}>
                        <td style={styles.td}>{wo.id}</td>
                        <td style={styles.td}>{wo.title}</td>
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
                          <td colSpan={5} style={{ padding: 0 }}>
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
              {formErr && <p style={modalStyles.error}>{formErr}</p>}
              <div style={modalStyles.actions}>
                <button style={styles.btnSecondary} onClick={() => setShowModal(false)}>{t('common.cancel')}</button>
                <button
                  style={styles.btnPrimary}
                  disabled={!form.title || createMut.isPending}
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
