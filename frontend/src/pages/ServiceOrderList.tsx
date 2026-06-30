// =============================================================================
// FireISP 5.0 — Service Order List (workflow) — §1.2
// =============================================================================
// Service order workflow: requested → approved → provisioning → activated.
// =============================================================================

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
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

const ORDER_TYPES = ['new_install', 'upgrade', 'downgrade', 'relocation', 'reconnect'];

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

export function ServiceOrderList() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

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
        <h2 style={{ margin: 0 }}>Service Orders</h2>
        {canCreate && (
          <button type="button" style={submitBtn} onClick={() => setShowCreate(true)}>+ New Order</button>
        )}
      </div>

      <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginTop: 0 }}>
        Track installation and change requests through the provisioning workflow.
      </p>

      {isLoading && <p>Loading…</p>}
      {error && <div style={errorBox}>{(error as Error).message}</div>}

      {data && (
        <>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border-strong)' }}>
              <th style={{ padding: '8px' }}>Order</th>
              <th style={{ padding: '8px' }}>Type</th>
              <th style={{ padding: '8px', textAlign: 'right' }}>Client</th>
              <th style={{ padding: '8px' }}>Status</th>
              <th style={{ padding: '8px', textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {data.data.length === 0 && (
              <tr><td colSpan={5} style={{ padding: '1rem', color: 'var(--text-secondary)' }}>No service orders yet.</td></tr>
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
                  <td style={{ padding: '8px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {canUpdate && next && (
                      <button type="button" style={{ ...submitBtn, padding: '4px 10px', marginRight: 6 }}
                        disabled={transition.isPending}
                        onClick={() => transition.mutate({ id: o.id, path: next.path })}>{next.label}</button>
                    )}
                    {canUpdate && !terminal && (
                      <button type="button" style={{ ...cancelBtn, padding: '4px 10px' }}
                        disabled={cancel.isPending}
                        onClick={() => cancel.mutate(o.id)}>Cancel</button>
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

      {showCreate && (
        <OrderFormModal onClose={() => setShowCreate(false)} onSaved={refresh} />
      )}
    </div>
  );
}
