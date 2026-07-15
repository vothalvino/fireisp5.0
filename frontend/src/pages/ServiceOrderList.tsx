// =============================================================================
// FireISP 5.0 — Service Order List (workflow) — §1.2
// =============================================================================
// Simplified service order workflow (migration 380): new → in_process → done,
// or cancelled (reachable from new/in_process).
//   • Start (new → in_process) auto-creates + provisions the contract from the
//     order's plan for new_install orders.
//   • Complete (in_process → done) asks whether the install is already paid or
//     an installation-fee invoice must be raised.
// Work-entity wiring (kept for non-auto-provisioned flows):
//   B. Service Order → Work Order (create WO pre-filled + show linked WOs)
//   C. Service Order → Contract   (manual create + link, for upgrade/relocation/
//      downgrade/reconnect orders, which do NOT auto-create a contract)
// =============================================================================

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, tokenStore } from '@/api/client';
import { readCsrfCookie } from '@/api/csrf';
import { Pagination } from '@/components/Pagination';
import { useAuth } from '@/auth/AuthContext';
import { can } from '@/auth/permissions';
import { ClientPicker } from '@/components/ClientPicker';
import { LeadPicker } from '@/components/LeadPicker';
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

const successBox: React.CSSProperties = {
  background: '#dcfce7', color: '#166534', padding: '8px 12px',
  borderRadius: 6, marginBottom: '0.75rem', fontSize: '0.85rem',
};

interface ServiceOrder {
  id: number;
  order_number: string;
  client_id: number | null;
  lead_id: number | null;
  plan_id: number | null;
  contract_id: number | null;
  order_type: string;
  status: string;
  address: string | null;
  created_at: string;
  // Populated by the dedicated GET /service-orders LEFT JOIN handler — resolves
  // a display name without a separate, page-capped client/lead lookup.
  client_name?: string | null;
  lead_name?: string | null;
}

interface OrdersResponse {
  data: ServiceOrder[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

interface OrderFormBody {
  client_id?: number;
  lead_id?: number;
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

interface AddressableEntity {
  id: number;
  name: string;
  address: string | null;
  city: string | null;
  state: string | null;
  zip_code: string | null;
}

interface PppoeCredentials {
  username: string;
  password: string;
}

interface InvoiceSummary {
  id: number;
  invoice_number: string;
  total: string | number;
}

// Inventory Phase 3 (migration 391) — equipment install
interface AssignedUnit {
  id: number;
  serial_number: string;
  lifecycle_state: string;
  ownership: 'rented' | 'sold' | null;
  item_name?: string | null;
}

interface InStockUnit {
  id: number;
  serial_number: string;
}

interface InventoryItemOptionSO { id: number; name: string; sku: string | null }

const TODAY_SO = new Date().toISOString().split('T')[0];

const ORDER_TYPES = ['new_install', 'upgrade', 'downgrade', 'relocation', 'reconnect'];
const WORK_TYPES_SO = ['installation', 'maintenance', 'repair', 'survey', 'other'];

const STATUS_KEYS: Record<string, string> = {
  new: 'statusNew',
  in_process: 'statusInProcess',
  done: 'statusDone',
  cancelled: 'statusCancelled',
};

interface Plan {
  id: number;
  name: string;
  price: string;
}

async function fetchPlansForSO(): Promise<Plan[]> {
  const res = await api.GET('/plans', {
    params: { query: { limit: 200, order_by: 'name', order: 'ASC' } as never },
  });
  if (res.error) throw new Error('Failed to load plans');
  return (res.data as unknown as { data: Plan[] }).data;
}

/** Fetch full client details (address/city/state/zip_code) once a ClientPicker selection is made. */
async function fetchClientDetail(id: number): Promise<AddressableEntity | null> {
  const res = await api.GET('/clients/{id}', { params: { path: { id } } });
  if (res.error) return null;
  return (res.data as unknown as { data: AddressableEntity }).data;
}

/** Fetch full lead details (address/city/state/zip_code) once a LeadPicker selection is made. */
async function fetchLeadDetail(id: number): Promise<AddressableEntity | null> {
  const res = await api.GET('/leads/{id}', { params: { path: { id } } });
  if (res.error) return null;
  return (res.data as unknown as { data: AddressableEntity }).data;
}

/** Comma-joined address line from a client/lead record, skipping blanks. */
function addressLine(entity: { address: string | null; city: string | null; state: string | null; zip_code: string | null } | null | undefined): string {
  if (!entity) return '';
  return [entity.address, entity.city, entity.state, entity.zip_code]
    .map(v => (v ?? '').trim())
    .filter(Boolean)
    .join(', ');
}

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
  const { t } = useTranslation();
  const [form, setForm] = useState<OrderFormBody>({ order_type: 'new_install' });
  const [clientId, setClientId] = useState<number | ''>('');
  const [leadId, setLeadId] = useState<number | ''>('');
  const [addressDirty, setAddressDirty] = useState(false);
  const [error, setError] = useState('');

  const { data: plans = [], isLoading: plansLoading, isError: plansError } = useQuery({ queryKey: ['plans-lookup'], queryFn: fetchPlansForSO, staleTime: 60_000 });

  // Auto-fill the address from whichever of client/lead is selected (once,
  // until the technician edits it manually — see addressDirty).
  const { data: selectedClientDetail } = useQuery({
    queryKey: ['client-detail-so', clientId],
    queryFn: () => fetchClientDetail(clientId as number),
    enabled: clientId !== '',
  });
  const { data: selectedLeadDetail } = useQuery({
    queryKey: ['lead-detail-so', leadId],
    queryFn: () => fetchLeadDetail(leadId as number),
    enabled: leadId !== '',
  });

  useEffect(() => {
    if (addressDirty || !selectedClientDetail) return;
    setForm(p => ({ ...p, address: addressLine(selectedClientDetail) }));
  }, [selectedClientDetail, addressDirty]);

  useEffect(() => {
    if (addressDirty || !selectedLeadDetail) return;
    setForm(p => ({ ...p, address: addressLine(selectedLeadDetail) }));
  }, [selectedLeadDetail, addressDirty]);

  // startOrder hard-requires a plan and a resolved client/lead (§ backend
  // validation), and there is no edit UI for a service order today — a bare
  // order with no plan or no client/lead would be permanently un-startable,
  // so creation itself requires exactly one of client/lead plus a plan.
  const hasClientXorLead = (clientId !== '') !== (leadId !== '');
  const canSubmit = form.plan_id !== undefined && hasClientXorLead;

  const mutation = useMutation({
    mutationFn: async (body: OrderFormBody) => {
      const { error } = await api.POST('/service-orders', { body: body as never });
      if (error) throw new Error(extractApiError(error, t('serviceOrders.createFailed', 'Failed to create order')));
    },
    onSuccess: () => { onSaved(); onClose(); },
    onError: (err: unknown) => setError(err instanceof Error ? err.message : t('serviceOrders.createFailed', 'Failed to create order')),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    const body: OrderFormBody = { order_type: form.order_type };
    if (clientId !== '') body.client_id = clientId;
    if (leadId !== '') body.lead_id = leadId;
    if (form.plan_id) body.plan_id = Number(form.plan_id);
    if (form.address && form.address.trim()) body.address = form.address.trim();
    if (form.notes && form.notes.trim()) body.notes = form.notes.trim();
    setError('');
    mutation.mutate(body);
  }

  function handleClientPick(id: number) {
    setClientId(id || '');
    if (id) setLeadId(''); // mutually exclusive — choosing one clears the other
  }

  function handleLeadPick(id: number) {
    setLeadId(id || '');
    if (id) setClientId('');
  }

  function handleAddressChange(e: React.ChangeEvent<HTMLInputElement>) {
    setAddressDirty(true);
    setForm(p => ({ ...p, address: e.target.value }));
  }

  return (
    <div style={overlay} role="dialog" aria-modal="true" aria-label={t('serviceOrders.createModalTitle', 'New Service Order')}>
      <div style={{ ...modalBox, width: 480, maxHeight: '90vh', overflowY: 'auto' }}>
        <h3 style={{ margin: '0 0 1rem' }}>{t('serviceOrders.createModalTitle', 'New Service Order')}</h3>
        {error && <div style={errorBox}>{error}</div>}
        <form onSubmit={handleSubmit}>
          <label style={labelStyle}>{t('serviceOrders.orderTypeField', 'Order type')}</label>
          <select style={inputStyle} value={form.order_type}
            onChange={e => setForm(p => ({ ...p, order_type: e.target.value }))}>
            {ORDER_TYPES.map(ot => <option key={ot} value={ot}>{ot.replace('_', ' ')}</option>)}
          </select>

          <ClientPicker value={clientId} onChange={handleClientPick} required={false} />
          <p style={{ fontSize: '0.74rem', color: 'var(--text-secondary)', margin: '2px 0 0' }}>
            {t('serviceOrders.clientOrLeadHint', 'Choose a client or a lead — exactly one is required to start the order.')}
          </p>
          <LeadPicker value={leadId} onChange={handleLeadPick} required={false} />

          <label style={labelStyle}>{t('serviceOrders.planField', 'Plan')} *</label>
          <select style={inputStyle} value={form.plan_id ?? ''} disabled={plansLoading}
            onChange={e => setForm(p => ({ ...p, plan_id: e.target.value ? Number(e.target.value) : undefined }))}>
            <option value="">
              {plansLoading ? t('common.loading', 'Loading…') : t('serviceOrders.planPlaceholder', '— select plan —')}
            </option>
            {plans.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          {plansError && (
            <p style={{ fontSize: '0.74rem', color: '#dc2626', margin: '2px 0 0' }}>
              {t('serviceOrders.plansLoadError', 'Failed to load plans — you may not have permission to view plans.')}
            </p>
          )}

          <label style={labelStyle}>{t('serviceOrders.addressField', 'Address')}</label>
          <input style={inputStyle} type="text" value={form.address ?? ''} onChange={handleAddressChange} />

          <label style={labelStyle}>{t('serviceOrders.notesField', 'Notes')}</label>
          <textarea style={{ ...inputStyle, minHeight: 70, resize: 'vertical' }} value={form.notes ?? ''}
            onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} />

          <div style={{ display: 'flex', gap: 8, marginTop: '1.25rem', justifyContent: 'flex-end' }}>
            <button type="button" onClick={onClose} style={cancelBtn}>{t('common.cancel', 'Cancel')}</button>
            <button type="submit" style={submitBtn} disabled={!canSubmit || mutation.isPending}>
              {mutation.isPending ? t('common.saving', 'Saving…') : t('serviceOrders.new', 'New Order')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Complete order modal — already-paid vs raise an installation-fee invoice
// ---------------------------------------------------------------------------

function CompleteOrderModal({
  order, onClose, onCompleted,
}: {
  order: ServiceOrder;
  onClose: () => void;
  onCompleted: (invoice: InvoiceSummary | null) => void;
}) {
  const { t } = useTranslation();
  const [billing, setBilling] = useState<'already_paid' | 'create_invoice'>('already_paid');
  const [fee, setFee] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState('');

  const feeNum = Number(fee);
  const feeValid = billing === 'already_paid' || (fee.trim() !== '' && feeNum > 0);

  const mutation = useMutation({
    mutationFn: async () => {
      const body: { billing: string; installation_fee?: number; description?: string } = { billing };
      if (billing === 'create_invoice') {
        body.installation_fee = feeNum;
        body.description = description.trim() || t('serviceOrders.installationFeeDefaultDescription', 'Installation fee');
      }
      const { data, error: e } = await api.POST('/service-orders/{id}/complete', {
        params: { path: { id: order.id } },
        body: body as never,
      });
      if (e) throw new Error(extractApiError(e, t('serviceOrders.completeFailed', 'Failed to complete service order')));
      return (data as unknown as { data: ServiceOrder & { invoice?: InvoiceSummary | null } }).data;
    },
    onSuccess: (data) => { onCompleted(data.invoice ?? null); onClose(); },
    onError: (err: unknown) => setError(err instanceof Error ? err.message : t('serviceOrders.completeFailed', 'Failed to complete service order')),
  });

  return (
    <div style={overlay} role="dialog" aria-modal="true" aria-label={t('serviceOrders.completeModalTitle', 'Complete Service Order')}>
      <div style={{ ...modalBox, width: 440, maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h3 style={{ margin: 0 }}>{t('serviceOrders.completeModalTitle', 'Complete Service Order')} — {order.order_number}</h3>
          <button type="button" onClick={onClose} style={cancelBtn}>✕</button>
        </div>
        {error && <div style={errorBox}>{error}</div>}

        <label style={{ ...labelStyle, marginTop: 4, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
          <input type="radio" name="so-billing" checked={billing === 'already_paid'}
            onChange={() => setBilling('already_paid')} />
          {t('serviceOrders.billingAlreadyPaid', 'Installation already paid')}
        </label>
        <label style={{ ...labelStyle, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
          <input type="radio" name="so-billing" checked={billing === 'create_invoice'}
            onChange={() => setBilling('create_invoice')} />
          {t('serviceOrders.billingCreateInvoice', 'Create installation invoice')}
        </label>

        {billing === 'create_invoice' && (
          <>
            <label style={labelStyle}>{t('serviceOrders.installationFeeField', 'Installation fee')} *</label>
            <input style={inputStyle} type="number" min={0.01} step="0.01" value={fee}
              onChange={e => setFee(e.target.value)} placeholder="0.00" />

            <label style={labelStyle}>{t('serviceOrders.descriptionField', 'Description')}</label>
            <input style={inputStyle} type="text" value={description}
              placeholder={t('serviceOrders.installationFeeDefaultDescription', 'Installation fee')}
              onChange={e => setDescription(e.target.value)} />
          </>
        )}

        <div style={{ display: 'flex', gap: 8, marginTop: '1.25rem', justifyContent: 'flex-end' }}>
          <button type="button" onClick={onClose} style={cancelBtn}>{t('common.cancel', 'Cancel')}</button>
          <button type="button" style={submitBtn} disabled={!feeValid || mutation.isPending}
            onClick={() => { setError(''); mutation.mutate(); }}>
            {mutation.isPending ? t('common.saving', 'Saving…') : t('serviceOrders.confirmComplete', 'Complete')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Post-Start provisioning credentials confirmation
// ---------------------------------------------------------------------------

function ProvisioningResultModal({ credentials, onClose }: { credentials: PppoeCredentials; onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <div style={overlay} role="dialog" aria-modal="true" aria-label={t('serviceOrders.provisioningModalTitle', 'PPPoE Credentials')}>
      <div style={{ ...modalBox, width: 380 }}>
        <h3 style={{ margin: '0 0 0.5rem' }}>{t('serviceOrders.provisioningModalTitle', 'PPPoE Credentials')}</h3>
        <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginTop: 0 }}>
          {t('serviceOrders.provisioningModalHint', "Configure the CPE with these credentials — they won't be shown again.")}
        </p>
        <div style={{
          background: 'var(--bg-subtle)', border: '1px solid var(--border)', borderRadius: 6,
          padding: '0.6rem 0.75rem', fontFamily: 'monospace', fontSize: '0.85rem', display: 'flex', flexDirection: 'column', gap: 4,
        }}>
          <div>{t('serviceOrders.usernameLabel', 'Username')}: <strong>{credentials.username}</strong></div>
          <div>{t('serviceOrders.passwordLabel', 'Password')}: <strong>{credentials.password}</strong></div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1rem' }}>
          <button type="button" style={submitBtn} onClick={onClose}>{t('serviceOrders.close', 'Close')}</button>
        </div>
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
      const csrf = readCsrfCookie();
      const res = await fetch(`${API_BASE}/work-orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(csrf ? { 'X-CSRF-Token': csrf } : {}) },
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
// D — Equipment modal (Inventory Phase 3, migration 391) — the install
// drawdown moment: pick an in-stock serial for a product (or type a new one
// off the box) and choose rent/buy. Only usable once the order has a linked
// contract (installs are recorded against a contract, not a service order).
// ---------------------------------------------------------------------------

async function fetchAssignedUnits(contractId: number): Promise<AssignedUnit[]> {
  const res = await api.GET('/cpe-management/devices' as never, {
    params: { query: { contract_id: contractId, limit: 100 } as never },
  } as never);
  if (res.error) return [];
  return ((res.data as unknown as { data: AssignedUnit[] }).data) ?? [];
}

async function fetchInventoryItemsSO(): Promise<InventoryItemOptionSO[]> {
  const res = await api.GET('/inventory/items' as never, { params: { query: { limit: 200, status: 'active' } as never } } as never);
  if (res.error) return [];
  return ((res.data as unknown as { data: InventoryItemOptionSO[] }).data) ?? [];
}

async function fetchInStockUnits(itemId: number): Promise<InStockUnit[]> {
  const res = await api.GET('/cpe-management/devices' as never, {
    params: { query: { inventory_item_id: itemId, lifecycle_state: 'in_stock', limit: 200 } as never },
  } as never);
  if (res.error) return [];
  return ((res.data as unknown as { data: InStockUnit[] }).data) ?? [];
}

function EquipmentModal({ order, onClose, onAssigned }: { order: ServiceOrder; onClose: () => void; onAssigned: () => void }) {
  const { t } = useTranslation();
  const [itemId, setItemId] = useState('');
  const [serialMode, setSerialMode] = useState<'existing' | 'new'>('existing');
  const [cpeDeviceId, setCpeDeviceId] = useState('');
  const [newSerial, setNewSerial] = useState('');
  const [ownership, setOwnership] = useState<'rented' | 'sold'>('rented');
  const [formErr, setFormErr] = useState('');

  const { data: assigned = [], refetch: refetchAssigned } = useQuery({
    queryKey: ['so-assigned-units', order.contract_id],
    queryFn: () => fetchAssignedUnits(order.contract_id as number),
    enabled: !!order.contract_id,
  });
  const { data: catalogItems = [] } = useQuery({ queryKey: ['inventory-items-lookup-so'], queryFn: fetchInventoryItemsSO });
  const { data: inStockUnits = [] } = useQuery({
    queryKey: ['so-in-stock-units', itemId],
    queryFn: () => fetchInStockUnits(Number(itemId)),
    enabled: !!itemId,
  });

  const installMut = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = { contract_id: order.contract_id, service_order_id: order.id, ownership };
      if (serialMode === 'existing') {
        if (!cpeDeviceId) throw new Error(t('serviceOrders.equipmentPickSerial', 'Select a serial'));
        body.cpe_device_id = Number(cpeDeviceId);
      } else {
        if (!newSerial.trim()) throw new Error(t('serviceOrders.equipmentEnterSerial', 'Enter a serial number'));
        if (!itemId) throw new Error(t('serviceOrders.equipmentPickProduct', 'Select a product'));
        body.new_serial = newSerial.trim();
        body.inventory_item_id = Number(itemId);
      }
      const { error } = await api.POST('/cpe-management/devices/install' as never, { body: body as never } as never);
      if (error) throw new Error(extractApiError(error, t('serviceOrders.equipmentInstallFailed', 'Failed to install equipment')));
    },
    onSuccess: () => {
      setFormErr('');
      setCpeDeviceId(''); setNewSerial('');
      void refetchAssigned();
      onAssigned();
    },
    onError: (e: Error) => setFormErr(e.message),
  });

  return (
    <div style={overlay} role="dialog" aria-modal="true" aria-label={t('serviceOrders.equipmentModalTitle', 'Equipment')}>
      <div style={{ ...modalBox, width: 560, maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h3 style={{ margin: 0 }}>{t('serviceOrders.equipmentModalTitle', 'Equipment')} — {order.order_number}</h3>
          <button onClick={onClose} style={cancelBtn}>✕</button>
        </div>

        {assigned.length > 0 && (
          <div style={{ marginBottom: '1rem' }}>
            <strong style={{ fontSize: '0.85rem' }}>{t('serviceOrders.equipmentAssigned', 'Assigned equipment')}</strong>
            <ul style={{ listStyle: 'none', margin: '6px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {assigned.map(u => (
                <li key={u.id} style={{ display: 'flex', gap: 10, fontSize: '0.82rem', padding: '5px 8px', background: 'var(--bg-subtle)', borderRadius: 6 }}>
                  <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{u.serial_number}</span>
                  <span style={{ flex: 1 }}>{u.item_name ?? ''}</span>
                  <span style={{ textTransform: 'capitalize', color: 'var(--text-secondary)' }}>{u.lifecycle_state}</span>
                  {u.ownership && <span style={{ textTransform: 'capitalize', color: 'var(--text-secondary)' }}>{u.ownership}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div style={{ border: '1px solid var(--border)', borderRadius: 6, padding: '0.75rem' }}>
          {formErr && <div style={errorBox}>{formErr}</div>}

          <label style={labelStyle} htmlFor="equipment-product">{t('serviceOrders.equipmentProduct', 'Product')}</label>
          <select id="equipment-product" style={inputStyle} value={itemId} onChange={e => { setItemId(e.target.value); setCpeDeviceId(''); }}>
            <option value="">— {t('serviceOrders.equipmentSelectProduct', 'select product')} —</option>
            {catalogItems.map(i => <option key={i.id} value={i.id}>{i.name}{i.sku ? ` (${i.sku})` : ''}</option>)}
          </select>

          <div style={{ display: 'flex', gap: 12, margin: '8px 0' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.85rem' }}>
              <input type="radio" name="equipment-serial-mode" checked={serialMode === 'existing'} onChange={() => setSerialMode('existing')} />
              {t('serviceOrders.equipmentExistingSerial', 'Pick in-stock serial')}
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.85rem' }}>
              <input type="radio" name="equipment-serial-mode" checked={serialMode === 'new'} onChange={() => setSerialMode('new')} />
              {t('serviceOrders.equipmentNewSerial', 'Type a new serial')}
            </label>
          </div>

          {serialMode === 'existing' ? (
            <>
              <label style={labelStyle} htmlFor="equipment-serial">{t('serviceOrders.equipmentSerial', 'Serial')}</label>
              <select id="equipment-serial" style={inputStyle} value={cpeDeviceId} onChange={e => setCpeDeviceId(e.target.value)} disabled={!itemId}>
                <option value="">— {itemId ? t('serviceOrders.equipmentSelectSerial', 'select serial') : t('serviceOrders.equipmentSelectProductFirst', 'select a product first')} —</option>
                {inStockUnits.map(u => <option key={u.id} value={u.id}>{u.serial_number}</option>)}
              </select>
            </>
          ) : (
            <>
              <label style={labelStyle} htmlFor="equipment-new-serial">{t('serviceOrders.equipmentNewSerialLabel', 'New serial number')}</label>
              <input id="equipment-new-serial" type="text" style={inputStyle} value={newSerial} onChange={e => setNewSerial(e.target.value)} placeholder={t('serviceOrders.equipmentNewSerialPlaceholder', 'Read from the box')} />
            </>
          )}

          <label style={labelStyle}>{t('serviceOrders.equipmentOwnership', 'Rent or buy')}</label>
          <div style={{ display: 'flex', gap: 12, marginBottom: 8 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.85rem' }}>
              <input type="radio" name="equipment-ownership" checked={ownership === 'rented'} onChange={() => setOwnership('rented')} />
              {t('serviceOrders.equipmentRented', 'Rented (no invoice)')}
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.85rem' }}>
              <input type="radio" name="equipment-ownership" checked={ownership === 'sold'} onChange={() => setOwnership('sold')} />
              {t('serviceOrders.equipmentSold', 'Sold (raises an invoice)')}
            </label>
          </div>

          <button
            style={{ ...submitBtn, width: '100%' }}
            disabled={installMut.isPending}
            onClick={() => installMut.mutate()}
          >
            {installMut.isPending ? t('common.saving', 'Saving…') : t('serviceOrders.equipmentInstall', 'Install Equipment')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// C — Create Contract modal for a service order (manual link — non-new_install
// order types only; new_install auto-creates the contract on Start)
// ---------------------------------------------------------------------------

function CreateContractModal({ order, onClose, onLinked }: { order: ServiceOrder; onClose: () => void; onLinked: () => void }) {
  const { t } = useTranslation();
  const [form, setForm] = useState({
    plan_id: '',
    connection_type: 'pppoe',
    start_date: TODAY_SO,
    billing_day: '',
    price_override: '',
  });
  const [error, setError] = useState('');

  const { data: plans = [], isLoading: plansLoading } = useQuery({
    queryKey: ['plans-lookup'],
    queryFn: fetchPlansForSO,
    staleTime: 60_000,
  });

  const mutation = useMutation({
    mutationFn: async () => {
      if (!form.plan_id) throw new Error(t('serviceOrders.contractPlanRequired', 'Plan is required'));
      const token = tokenStore.getAccess();
      const csrf = readCsrfCookie();
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      if (csrf) headers['X-CSRF-Token'] = csrf;

      const body: Record<string, unknown> = {
        client_id: order.client_id,
        plan_id: Number(form.plan_id),
        connection_type: form.connection_type,
        start_date: form.start_date,
      };
      if (form.billing_day) body['billing_day'] = Math.min(28, Math.max(1, Number(form.billing_day)));
      if (form.price_override) body['price_override'] = Number(form.price_override);

      // 1. Create contract
      const createRes = await fetch(`${API_BASE}/contracts`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });
      if (!createRes.ok) {
        const err = await createRes.json().catch(() => ({})) as { error?: string };
        throw new Error(err.error || t('serviceOrders.contractCreateFailed', 'Failed to create contract'));
      }
      const { data: newContract } = await createRes.json() as { data: { id: number } };

      // 2. Link contract back to the service order
      const linkRes = await fetch(`${API_BASE}/service-orders/${order.id}`, {
        method: 'PATCH',
        headers,
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
      <div style={{ ...modalBox, width: 480, maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h3 style={{ margin: 0 }}>{t('serviceOrders.createContractTitle', 'Create Contract')} — {order.order_number}</h3>
          <button type="button" onClick={onClose} style={cancelBtn}>✕</button>
        </div>
        {error && <div style={errorBox}>{error}</div>}

        {/* Client — read-only display */}
        <label style={labelStyle}>{t('serviceOrders.contractClientId', 'Client')} (pre-filled)</label>
        <input
          style={{ ...inputStyle, background: 'var(--bg-subtle)', color: 'var(--text-secondary)' }}
          type="text"
          value={order.client_id != null ? `#${order.client_id}` : '—'}
          readOnly
        />

        {/* Plan — dropdown of active org plans */}
        <label style={labelStyle}>{t('serviceOrders.contractPlanId', 'Plan')} *</label>
        <select
          style={inputStyle}
          value={form.plan_id}
          onChange={e => setForm(p => ({ ...p, plan_id: e.target.value }))}
          disabled={plansLoading}
        >
          <option value="">
            {plansLoading ? t('common.loading', 'Loading…') : t('serviceOrders.contractPlanPlaceholder', '— select plan —')}
          </option>
          {plans.map(p => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>

        {/* Connection type */}
        <label style={labelStyle}>{t('serviceOrders.contractConnectionType', 'Connection Type')}</label>
        <select
          style={inputStyle}
          value={form.connection_type}
          onChange={e => setForm(p => ({ ...p, connection_type: e.target.value }))}
        >
          <option value="pppoe">PPPoE</option>
          <option value="pppoe_dual">PPPoE Dual</option>
          <option value="static">Static</option>
          <option value="dual">Dual</option>
        </select>

        {/* Start date */}
        <label style={labelStyle}>{t('serviceOrders.contractStartDate', 'Start Date')} *</label>
        <input
          style={inputStyle}
          type="date"
          value={form.start_date}
          onChange={e => setForm(p => ({ ...p, start_date: e.target.value }))}
        />

        {/* Billing day (optional) */}
        <label style={labelStyle}>{t('serviceOrders.contractBillingDay', 'Billing Day (1–28)')}</label>
        <input
          style={inputStyle}
          type="number"
          min={1}
          max={28}
          value={form.billing_day}
          onChange={e => setForm(p => ({ ...p, billing_day: e.target.value }))}
          placeholder="e.g. 1"
        />

        {/* Price override (optional) */}
        <label style={labelStyle}>{t('serviceOrders.contractPriceOverride', 'Price Override (leave blank for plan default)')}</label>
        <input
          style={inputStyle}
          type="number"
          min={0}
          step="0.01"
          value={form.price_override}
          onChange={e => setForm(p => ({ ...p, price_override: e.target.value }))}
          placeholder="e.g. 350.00"
        />

        <div style={{ display: 'flex', gap: 8, marginTop: '1.25rem', justifyContent: 'flex-end' }}>
          <button type="button" onClick={onClose} style={cancelBtn}>{t('common.cancel', 'Cancel')}</button>
          <button
            type="button"
            style={submitBtn}
            disabled={!form.plan_id || !form.start_date || mutation.isPending || !order.client_id}
            onClick={() => { setError(''); mutation.mutate(); }}
          >
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
  const [actionError, setActionError] = useState('');

  // B, C & D — selected order for sub-panels
  const [workOrdersFor, setWorkOrdersFor] = useState<ServiceOrder | null>(null);
  const [contractFor, setContractFor] = useState<ServiceOrder | null>(null);
  const [equipmentFor, setEquipmentFor] = useState<ServiceOrder | null>(null);
  const [completeFor, setCompleteFor] = useState<ServiceOrder | null>(null);
  const [provisioningResult, setProvisioningResult] = useState<PppoeCredentials | null>(null);
  const [invoiceResult, setInvoiceResult] = useState<InvoiceSummary | null>(null);

  const canCreate = can(user, 'service_orders.create');
  const canUpdate = can(user, 'service_orders.update');

  const { data, isLoading, error } = useQuery({
    queryKey: ['service-orders', page, pageSize],
    queryFn: () => fetchOrders(page, pageSize),
  });

  const start = useMutation({
    mutationFn: async (id: number) => {
      const { data, error: e } = await api.POST('/service-orders/{id}/start', {
        params: { path: { id } },
        body: {} as never,
      });
      if (e) throw new Error(extractApiError(e, t('serviceOrders.startFailed', 'Failed to start service order')));
      return (data as unknown as { data: ServiceOrder & { provisioning?: { pppoe?: PppoeCredentials } } }).data;
    },
    onSuccess: (order) => {
      qc.invalidateQueries({ queryKey: ['service-orders'] });
      setActionError('');
      if (order.provisioning?.pppoe) setProvisioningResult(order.provisioning.pppoe);
    },
    onError: (err: unknown) => setActionError(err instanceof Error ? err.message : t('serviceOrders.startFailed', 'Failed to start service order')),
  });

  const cancel = useMutation({
    mutationFn: async (id: number) => {
      const { error: e } = await api.POST('/service-orders/{id}/cancel', { params: { path: { id } }, body: {} as never });
      if (e) throw new Error(extractApiError(e, t('serviceOrders.cancelFailed', 'Failed to cancel service order')));
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['service-orders'] }); setActionError(''); },
    onError: (err: unknown) => setActionError(err instanceof Error ? err.message : t('serviceOrders.cancelFailed', 'Failed to cancel service order')),
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

      {actionError && <div style={errorBox}>{actionError}</div>}
      {isLoading && <p>{t('common.loading', 'Loading…')}</p>}
      {error && <div style={errorBox}>{(error as Error).message}</div>}

      {data && (
        <>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border-strong)' }}>
              <th style={{ padding: '8px' }}>{t('serviceOrders.colOrder', 'Order')}</th>
              <th style={{ padding: '8px' }}>{t('serviceOrders.colType', 'Type')}</th>
              <th style={{ padding: '8px' }}>{t('serviceOrders.colClient', 'Client')}</th>
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
              const terminal = o.status === 'done' || o.status === 'cancelled';
              return (
                <tr key={o.id} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '8px', fontWeight: 600, fontFamily: 'monospace' }}>{o.order_number}</td>
                  <td style={{ padding: '8px', textTransform: 'capitalize' }}>{o.order_type.replace('_', ' ')}</td>
                  <td style={{ padding: '8px' }}>
                    {o.client_id ? (o.client_name ?? `#${o.client_id}`) : o.lead_id ? (
                      <span title={t('serviceOrders.leadSourcedHint', 'This order came from a lead, not a client yet.')}>
                        {o.lead_name ?? `#${o.lead_id}`} <em style={{ color: 'var(--text-secondary)', fontStyle: 'normal', fontSize: '0.75rem' }}>({t('serviceOrders.leadTag', 'lead')})</em>
                      </span>
                    ) : '—'}
                  </td>
                  <td style={{ padding: '8px' }}>{t(`serviceOrders.${STATUS_KEYS[o.status] ?? 'statusNew'}`, o.status)}</td>

                  {/* C — Contract column */}
                  <td style={{ padding: '8px', fontSize: '0.8rem' }}>
                    {o.contract_id ? (
                      <Link to={`/contracts/${o.contract_id}`} style={{ color: 'var(--link)', textDecoration: 'none', fontWeight: 600 }}>
                        #{o.contract_id}
                      </Link>
                    ) : (
                      canUpdate && o.order_type !== 'new_install' && (
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

                    {/* D — Equipment button (Inventory Phase 3, migration 391) —
                        install is recorded against a contract, so this only
                        appears once one is linked (auto-created by Start for
                        new_install orders, or manually linked above). */}
                    {o.contract_id && (
                      <button type="button"
                        style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-secondary)', padding: '3px 8px', borderRadius: 4, cursor: 'pointer', fontSize: '0.78rem', marginRight: 6 }}
                        onClick={() => setEquipmentFor(o)}>
                        {t('serviceOrders.equipment', 'Equipment')}
                      </button>
                    )}

                    {/* Lifecycle transitions */}
                    {canUpdate && o.status === 'new' && (
                      <button type="button" style={{ ...submitBtn, padding: '4px 10px', marginRight: 6 }}
                        disabled={start.isPending}
                        onClick={() => start.mutate(o.id)}>{t('serviceOrders.start', 'Start')}</button>
                    )}
                    {canUpdate && o.status === 'in_process' && (
                      <button type="button" style={{ ...submitBtn, padding: '4px 10px', marginRight: 6 }}
                        onClick={() => setCompleteFor(o)}>{t('serviceOrders.complete', 'Complete')}</button>
                    )}
                    {canUpdate && !terminal && (
                      <button type="button" style={{ ...cancelBtn, padding: '4px 10px' }}
                        disabled={cancel.isPending}
                        onClick={() => {
                          if (window.confirm(t('serviceOrders.confirmCancel', 'Cancel this service order? This cannot be undone.'))) {
                            cancel.mutate(o.id);
                          }
                        }}>{t('serviceOrders.cancel', 'Cancel')}</button>
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

      {/* D — Equipment modal (Inventory Phase 3, migration 391) */}
      {equipmentFor && (
        <EquipmentModal
          order={equipmentFor}
          onClose={() => setEquipmentFor(null)}
          onAssigned={refresh}
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

      {/* Complete order modal */}
      {completeFor && (
        <CompleteOrderModal
          order={completeFor}
          onClose={() => setCompleteFor(null)}
          onCompleted={(invoice) => { refresh(); if (invoice) setInvoiceResult(invoice); }}
        />
      )}

      {/* Post-Start PPPoE credentials */}
      {provisioningResult && (
        <ProvisioningResultModal credentials={provisioningResult} onClose={() => setProvisioningResult(null)} />
      )}

      {/* Post-Complete installation invoice confirmation */}
      {invoiceResult && (
        <div style={overlay} role="dialog" aria-modal="true" aria-label={t('serviceOrders.invoiceCreatedModalTitle', 'Installation Invoice Created')}>
          <div style={{ ...modalBox, width: 380 }}>
            <h3 style={{ margin: '0 0 0.5rem' }}>{t('serviceOrders.invoiceCreatedModalTitle', 'Installation Invoice Created')}</h3>
            <div style={successBox}>
              {t('serviceOrders.invoiceCreatedHint', 'An installation-fee invoice was created for this order.')}
            </div>
            <p style={{ fontSize: '0.85rem' }}>
              <strong>{invoiceResult.invoice_number}</strong> — {invoiceResult.total}
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: '1rem' }}>
              {/* Complete is primarily a technician action, and technicians
                  typically lack invoices.view — a Link here would just 403.
                  Show the invoice number as plain text (already above) for them. */}
              {can(user, 'invoices.view') && (
                <Link to={`/invoices/${invoiceResult.id}`} style={{ ...submitBtn, textDecoration: 'none', display: 'inline-block' }}>
                  {t('serviceOrders.viewInvoice', 'View invoice')}
                </Link>
              )}
              <button type="button" style={cancelBtn} onClick={() => setInvoiceResult(null)}>{t('serviceOrders.close', 'Close')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
