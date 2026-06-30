// =============================================================================
// FireISP 5.0 — Service Order List (workflow) — §1.2
// =============================================================================
// Service order workflow: requested → approved → provisioning → activated.
// Work-entity wiring:
//   B. Service Order → Work Order (create WO pre-filled + show linked WOs)
//   C. Service Order → Contract   (create contract pre-filled + link back)
// =============================================================================

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, tokenStore } from '@/api/client';
import { Pagination } from '@/components/Pagination';
import { useAuth } from '@/auth/AuthContext';
import { can } from '@/auth/permissions';
import {
  extractApiError,
  overlay,
  modalBox,
  errorBox,
  labelStyle,
  inputStyle,
  submitBtn,
  cancelBtn,
} from '@/components/ClientFormModal';

const API_BASE = '/api/v1';

interface ServiceOrder {
  id: number;
  order_number: string;
  client_id: number | null;
  plan_id: number | null;
  contract_id: number | null;
  order_type: string;
  status: string;
  address: string | null;
  created_at: string;
}

interface OrdersResponse {
  data: ServiceOrder[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

interface OrderFormBody {
  client_id?: number;
  plan_id?: number;
  order_type: string;
  address?: string;
  notes?: string;
}

interface WorkOrderForSO {
  id: number;
  title: string;
  status: string;
  work_type: string;
}

const ORDER_TYPES = ['new_install', 'upgrade', 'downgrade', 'relocation', 'reconnect'];
const WORK_TYPES_SO = ['installation', 'maintenance', 'repair', 'survey', 'other'];

// Maps the current status to the transition action that may follow it.
const NEXT_ACTION: Record<string, { label: string; path: string } | null> = {
  requested: { label: 'Approve', path: 'approve' },
  approved: { label: 'Start provisioning', path: 'provision' },
  provisioning: { label: 'Activate', path: 'activate' },
  activated: null,
  cancelled: null,
};

async function fetchOrders(page: number, pageSize: number): Promise<OrdersResponse> {
  const res = await api.GET('/service-orders', {
    params: { query: { page, limit: pageSize } as never },
  });
  if (res.error) throw new Error('Failed to load service orders');
  return res.data as unknown as OrdersResponse;
}

async function fetchWorkOrdersBySO(serviceOrderId: number): Promise<WorkOrderForSO[]> {
  const token = tokenStore.getAccess();
  const res = await fetch(`${API_BASE}/work-orders?service_order_id=${serviceOrderId}&limit=50`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) return [];
  const body = await res.json() as { data: WorkOrderForSO[] };
  return body.data ?? [];
}

// ---------------------------------------------------------------------------
// New Service Order form modal
// ---------------------------------------------------------------------------

function OrderFormModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<OrderFormBody>({ order_type: 'new_install' });
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: async (body: OrderFormBody) => {
      const { error } = await api.POST('/service-orders', { body: body as never });
      if (error) throw new Error(extractApiError(error, 'Failed to create order'));
    },
    onSuccess: () => { onSaved(); onClose(); },
    onError: (err: unknown) => setError(err instanceof Error ? err.message : 'Failed to save order'),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const body: OrderFormBody = { order_type: form.order_type };
    if (form.client_id) body.client_id = Number(form.client_id);
    if (form.plan_id) body.plan_id = Number(form.plan_id);
    if (form.address && form.address.trim()) body.address = form.address.trim();
    if (form.notes && form.notes.trim()) body.notes = form.notes.trim();
    setError('');
    mutation.mutate(body);
  }

  return (
    <div style={overlay} role="dialog" aria-modal="true" aria-label="New Service Order">
      <div style={{ ...modalBox, width: 480, maxHeight: '90vh', overflowY: 'auto' }}>
        <h3 style={{ margin: '0 0 1rem' }}>New Service Order</h3>
        {error && <div style={errorBox}>{error}</div>}
        <form onSubmit={handleSubmit}>
          <label style={labelStyle}>Order type</label>
          <select style={inputStyle} value={form.order_type}
            onChange={e => setForm(p => ({ ...p, order_type: e.target.value }))}>
            {ORDER_TYPES.map(t => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}
          </select>

          <label style={labelStyle}>Client ID</label>
          <input style={inputStyle} type="number" min={1} value={form.client_id ?? ''}
            onChange={e => setForm(p => ({ ...p, client_id: e.target.value ? Number(e.target.value) : undefined }))} />

          <label style={labelStyle}>Plan ID</label>
          <input style={inputStyle} type="number" min={1} value={form.plan_id ?? ''}
            onChange={e => setForm(p => ({ ...p, plan_id: e.target.value ? Number(e.target.value) : undefined }))} />

          <label style={labelStyle}>Address</label>
          <input style={inputStyle} type="text" value={form.address ?? ''}
            onChange={e => setForm(p => ({ ...p, address: e.target.value }))} />

          <div style={{ display: 'flex', gap: 8, marginTop: '1.25rem', justifyContent: 'flex-end' }}>
            <button type="button" onClick={onClose} style={cancelBtn}>Cancel</button>
            <button type="submit" style={submitBtn} disabled={mutation.isPending}>
              {mutation.isPending ? 'Saving…' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// B — Work Orders modal for a service order
// ---------------------------------------------------------------------------

function WorkOrdersModal({ order, onClose, onCreated }: { order: ServiceOrder; onClose: () => void; onCreated: () => void }) {
  const { t } = useTranslation();
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState('');
  const [workType, setWorkType] = useState('installation');
  const [scheduledAt, setScheduledAt] = useState('');
  const [formErr, setFormErr] = useState('');

  const { data: workOrders = [], refetch, isLoading } = useQuery({
    queryKey: ['so-work-orders', order.id],
    queryFn: () => fetchWorkOrdersBySO(order.id),
  });

  const createMut = useMutation({
    mutationFn: async () => {
      const token = tokenStore.getAccess();
      const body: Record<string, unknown> = {
        service_order_id: order.id,
        title: title.trim(),
        work_type: workType,
      };
      if (order.client_id) body.client_id = order.client_id;
      if (scheduledAt) body.scheduled_at = scheduledAt;
      const res = await fetch(`${API_BASE}/work-orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(err.error || 'Failed to create work order');
      }
    },
    onSuccess: () => {
      setShowForm(false); setTitle(''); setScheduledAt(''); setFormErr('');
      void refetch();
      onCreated();
    },
    onError: (e: Error) => setFormErr(e.message),
  });

  return (
    <div style={overlay} role="dialog" aria-modal="true" aria-label={t('serviceOrders.workOrdersModalTitle', 'Work Orders')}>
      <div style={{ ...modalBox, width: 540, maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h3 style={{ margin: 0 }}>{t('serviceOrders.workOrdersModalTitle', 'Work Orders')} — {order.order_number}</h3>
          <button onClick={onClose} style={cancelBtn}>✕</button>
        </div>

        {isLoading ? (
          <p style={{ color: 'var(--text-secondary)' }}>{t('common.loading', 'Loading…')}</p>
        ) : workOrders.length === 0 ? (
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>{t('serviceOrders.workOrdersNone', 'No work orders for this service order yet.')}</p>
        ) : (
          <ul style={{ listStyle: 'none', margin: '0 0 1rem', padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {workOrders.map(wo => (
              <li key={wo.id} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: '0.85rem', padding: '6px 8px', background: 'var(--bg-subtle)', borderRadius: 6 }}>
                <span style={{ fontFamily: 'monospace', fontWeight: 600, color: 'var(--text-primary)' }}>#{wo.id}</span>
                <span style={{ flex: 1 }}>{wo.title}</span>
                <span style={{ textTransform: 'capitalize', color: 'var(--text-secondary)', fontSize: '0.78rem' }}>{wo.work_type}</span>
                <span style={{ textTransform: 'capitalize', color: 'var(--text-secondary)', fontSize: '0.78rem' }}>{wo.status}</span>
              </li>
            ))}
          </ul>
        )}

        {showForm ? (
          <div style={{ border: '1px solid var(--border)', borderRadius: 6, padding: '0.75rem' }}>
            {formErr && <div style={errorBox}>{formErr}</div>}
            <label style={labelStyle}>{t('serviceOrders.workOrderTitleField', 'Title')}</label>
            <input type="text" style={inputStyle} value={title} onChange={e => setTitle(e.target.value)} />
            <label style={labelStyle}>{t('serviceOrders.workOrderTypeField', 'Work Type')}</label>
            <select style={inputStyle} value={workType} onChange={e => setWorkType(e.target.value)}>
              {WORK_TYPES_SO.map(wt => <option key={wt} value={wt}>{wt}</option>)}
            </select>
            <label style={labelStyle}>{t('serviceOrders.workOrderScheduledField', 'Scheduled At')}</label>
            <input type="datetime-local" style={inputStyle} value={scheduledAt} onChange={e => setScheduledAt(e.target.value)} />
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button style={submitBtn} disabled={!title.trim() || createMut.isPending} onClick={() => createMut.mutate()}>
                {createMut.isPending ? t('common.saving', 'Saving…') : t('serviceOrders.workOrderCreate', 'Create Work Order')}
              </button>
              <button style={cancelBtn} onClick={() => { setShowForm(false); setFormErr(''); }}>
                {t('common.cancel', 'Cancel')}
              </button>
            </div>
          </div>
        ) : (
          <button style={{ ...submitBtn, width: '100%' }} onClick={() => setShowForm(true)}>
            + {t('serviceOrders.workOrderCreate', 'Create Work Order')}
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// C — Create Contract modal for a service order
// ---------------------------------------------------------------------------

function CreateContractModal({ order, onClose, onLinked }: { order: ServiceOrder; onClose: () => void; onLinked: () => void }) {
  const { t } = useTranslation();
  const [planId, setPlanId] = useState('');
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: async () => {
      if (!planId) throw new Error(t('serviceOrders.contractPlanRequired', 'Plan ID is required'));
      const token = tokenStore.getAccess();

      // 1. Create the contract pre-filled with client_id
      const createRes = await fetch(`${API_BASE}/contracts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ client_id: order.client_id, plan_id: Number(planId) }),
      });
      if (!createRes.ok) {
        const err = await createRes.json().catch(() => ({})) as { error?: string };
        throw new Error(err.error || t('serviceOrders.contractCreateFailed', 'Failed to create contract'));
      }
      const { data: newContract } = await createRes.json() as { data: { id: number } };

      // 2. Link the contract back to the service order
      const linkRes = await fetch(`${API_BASE}/service-orders/${order.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ contract_id: newContract.id }),
      });
      if (!linkRes.ok) {
        const err = await linkRes.json().catch(() => ({})) as { error?: string };
        throw new Error(err.error || t('serviceOrders.contractLinkFailed', 'Contract created but failed to link'));
      }
    },
    onSuccess: () => { onLinked(); onClose(); },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <div style={overlay} role="dialog" aria-modal="true" aria-label={t('serviceOrders.createContractTitle', 'Create Contract')}>
      <div style={{ ...modalBox, width: 420 }}>
        <h3 style={{ margin: '0 0 1rem' }}>{t('serviceOrders.createContractTitle', 'Create Contract')} — {order.order_number}</h3>
        {error && <div style={errorBox}>{error}</div>}

        <label style={labelStyle}>{t('serviceOrders.contractClientId', 'Client ID')} (pre-filled)</label>
        <input style={{ ...inputStyle, background: 'var(--bg-subtle)', color: 'var(--text-secondary)' }}
          type="number" value={order.client_id ?? ''} readOnly />

        <label style={labelStyle}>{t('serviceOrders.contractPlanId', 'Plan ID')}</label>
        <input style={inputStyle} type="number" min={1} value={planId}
          onChange={e => setPlanId(e.target.value)}
          placeholder={t('serviceOrders.contractPlanPlaceholder', 'Enter plan ID')} />

        <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: 8 }}>
          {t('serviceOrders.contractCreateNote', 'A new contract will be created and linked to this service order.')}
        </p>

        <div style={{ display: 'flex', gap: 8, marginTop: '1.25rem', justifyContent: 'flex-end' }}>
          <button type="button" onClick={onClose} style={cancelBtn}>{t('common.cancel', 'Cancel')}</button>
          <button type="button" style={submitBtn} disabled={!planId || mutation.isPending || !order.client_id}
            onClick={() => mutation.mutate()}>
            {mutation.isPending ? t('common.saving', 'Saving…') : t('serviceOrders.contractCreate', 'Create & Link')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page component
// ---------------------------------------------------------------------------

export function ServiceOrderList() {
  const { user } = useAuth();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  // B & C — selected order for sub-panels
  const [workOrdersFor, setWorkOrdersFor] = useState<ServiceOrder | null>(null);
  const [contractFor, setContractFor] = useState<ServiceOrder | null>(null);

  const canCreate = can(user?.role, 'service_orders.create');
  const canUpdate = can(user?.role, 'service_orders.update');

  const { data, isLoading, error } = useQuery({
    queryKey: ['service-orders', page, pageSize],
    queryFn: () => fetchOrders(page, pageSize),
  });

  const transition = useMutation({
    mutationFn: async ({ id, path }: { id: number; path: string }) => {
      const { error: e } = await api.POST(`/service-orders/{id}/${path}` as '/service-orders/{id}/approve', {
        params: { path: { id } },
        body: {} as never,
      });
      if (e) throw new Error(extractApiError(e, 'Transition failed'));
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['service-orders'] }),
  });

  const cancel = useMutation({
    mutationFn: async (id: number) => {
      const { error: e } = await api.POST('/service-orders/{id}/cancel', { params: { path: { id } }, body: {} as never });
      if (e) throw new Error(extractApiError(e, 'Cancel failed'));
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['service-orders'] }),
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ['service-orders'] });

  return (
    <div style={{ padding: '1.5rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
        <h2 style={{ margin: 0 }}>{t('serviceOrders.title', 'Service Orders')}</h2>
        {canCreate && (
          <button type="button" style={submitBtn} onClick={() => setShowCreate(true)}>+ {t('serviceOrders.new', 'New Order')}</button>
        )}
      </div>

      <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginTop: 0 }}>
        {t('serviceOrders.description', 'Track installation and change requests through the provisioning workflow.')}
      </p>

      {isLoading && <p>{t('common.loading', 'Loading…')}</p>}
      {error && <div style={errorBox}>{(error as Error).message}</div>}

      {data && (
        <>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border-strong)' }}>
              <th style={{ padding: '8px' }}>{t('serviceOrders.colOrder', 'Order')}</th>
              <th style={{ padding: '8px' }}>{t('serviceOrders.colType', 'Type')}</th>
              <th style={{ padding: '8px', textAlign: 'right' }}>{t('serviceOrders.colClient', 'Client')}</th>
              <th style={{ padding: '8px' }}>{t('serviceOrders.colStatus', 'Status')}</th>
              <th style={{ padding: '8px' }}>{t('serviceOrders.colContract', 'Contract')}</th>
              <th style={{ padding: '8px', textAlign: 'right' }}>{t('serviceOrders.colActions', 'Actions')}</th>
            </tr>
          </thead>
          <tbody>
            {data.data.length === 0 && (
              <tr><td colSpan={6} style={{ padding: '1rem', color: 'var(--text-secondary)' }}>{t('serviceOrders.empty', 'No service orders yet.')}</td></tr>
            )}
            {data.data.map(o => {
              const next = NEXT_ACTION[o.status];
              const terminal = o.status === 'activated' || o.status === 'cancelled';
              return (
                <tr key={o.id} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '8px', fontWeight: 600, fontFamily: 'monospace' }}>{o.order_number}</td>
                  <td style={{ padding: '8px', textTransform: 'capitalize' }}>{o.order_type.replace('_', ' ')}</td>
                  <td style={{ padding: '8px', textAlign: 'right', fontFamily: 'monospace' }}>{o.client_id ?? '—'}</td>
                  <td style={{ padding: '8px', textTransform: 'capitalize' }}>{o.status}</td>

                  {/* C — Contract column */}
                  <td style={{ padding: '8px', fontSize: '0.8rem' }}>
                    {o.contract_id ? (
                      <Link to={`/contracts/${o.contract_id}`} style={{ color: 'var(--link)', textDecoration: 'none', fontWeight: 600 }}>
                        #{o.contract_id}
                      </Link>
                    ) : (
                      canUpdate && (
                        <button type="button"
                          style={{ background: 'transparent', border: '1px dashed var(--border)', color: 'var(--text-secondary)', padding: '2px 8px', borderRadius: 4, cursor: 'pointer', fontSize: '0.78rem' }}
                          onClick={() => setContractFor(o)}>
                          {t('serviceOrders.linkContract', '+ Link Contract')}
                        </button>
                      )
                    )}
                  </td>

                  <td style={{ padding: '8px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {/* B — Work orders button */}
                    <button type="button"
                      style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-secondary)', padding: '3px 8px', borderRadius: 4, cursor: 'pointer', fontSize: '0.78rem', marginRight: 6 }}
                      onClick={() => setWorkOrdersFor(o)}>
                      {t('serviceOrders.workOrders', 'Work Orders')}
                    </button>

                    {/* Lifecycle transitions */}
                    {canUpdate && next && (
                      <button type="button" style={{ ...submitBtn, padding: '4px 10px', marginRight: 6 }}
                        disabled={transition.isPending}
                        onClick={() => transition.mutate({ id: o.id, path: next.path })}>{next.label}</button>
                    )}
                    {canUpdate && !terminal && (
                      <button type="button" style={{ ...cancelBtn, padding: '4px 10px' }}
                        disabled={cancel.isPending}
                        onClick={() => cancel.mutate(o.id)}>{t('serviceOrders.cancel', 'Cancel')}</button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {/* Pagination */}
        <Pagination
          page={page}
          totalPages={data?.meta?.totalPages ?? 1}
          total={data?.meta?.total}
          pageSize={pageSize}
          onPageChange={setPage}
          onPageSizeChange={(size) => { setPageSize(size); setPage(1); }}
        />
        </>
      )}

      {/* Modals */}
      {showCreate && (
        <OrderFormModal onClose={() => setShowCreate(false)} onSaved={refresh} />
      )}

      {/* B — Work Orders modal */}
      {workOrdersFor && (
        <WorkOrdersModal
          order={workOrdersFor}
          onClose={() => setWorkOrdersFor(null)}
          onCreated={refresh}
        />
      )}

      {/* C — Create Contract modal */}
      {contractFor && (
        <CreateContractModal
          order={contractFor}
          onClose={() => setContractFor(null)}
          onLinked={refresh}
        />
      )}
    </div>
  );
}
