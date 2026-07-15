// =============================================================================
// FireISP 5.0 — Purchase Order Detail (§14.2 — Inventory Phase 1)
// =============================================================================
// Shows a single purchase order at /purchase-orders/:id, mirroring
// QuoteDetail's structure:
//   • PO metadata (number, vendor, warehouse, dates, status, amounts)
//   • Line items table with an "Add Line Item" form (inventory item picker +
//     quantity_ordered + unit_cost) — each add recomputes subtotal/total from
//     the items and persists it via PUT /purchase-orders/{id}, the same
//     pattern QuoteDetail uses for its running total.
//   • "Receive" action — opens a modal listing each line with an editable
//     "receive now" quantity (defaults to the full remaining amount) and
//     posts to POST /purchase-orders/{id}/receive. This is what makes stock
//     actually land in the PO's warehouse AND writes the inventory_transactions
//     ledger row for each received line (fixed on the backend as part of this
//     same change — receiving used to bypass the ledger entirely).
// =============================================================================

import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';
import { extractApiError } from '@/components/ClientFormModal';
import { styles as crudStyles, modalStyles, RequiredMark } from './crudStyles';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PurchaseOrder {
  id: number;
  vendor_id: number | null;
  warehouse_id: number | null;
  po_number: string;
  status: string;
  order_date: string | null;
  expected_date: string | null;
  received_date: string | null;
  subtotal: string | number | null;
  tax_amount: string | number | null;
  total: string | number | null;
  currency: string | null;
  reference: string | null;
  notes: string | null;
  created_at: string;
}

interface PoItem {
  id: number;
  po_id: number;
  inventory_item_id: number | null;
  item_name?: string | null;
  sku?: string | null;
  // Inventory Phase 3 (migration 391) — MySQL TINYINT(1) round-trips as 0/1.
  serial_required?: number | boolean;
  description: string;
  quantity_ordered: number;
  quantity_received: number;
  unit_cost: string | number;
  total_cost: string | number;
  notes: string | null;
}

interface Vendor { id: number; name: string; status: string }
interface Warehouse { id: number; name: string; status: string }
interface InventoryItemOption { id: number; name: string; sku: string | null; unit_cost: string | null; status: string }

// ---------------------------------------------------------------------------
// Fetch / mutate helpers
// ---------------------------------------------------------------------------

async function fetchPo(id: string): Promise<PurchaseOrder> {
  const res = await api.GET('/purchase-orders/{id}' as never, { params: { path: { id: Number(id) } as never } } as never);
  if ((res as { error?: unknown }).error) throw new Error('Purchase order not found');
  return (res as { data: { data: PurchaseOrder } }).data.data;
}

async function fetchPoItems(id: string): Promise<PoItem[]> {
  const res = await api.GET('/purchase-orders/{id}/items' as never, { params: { path: { id: Number(id) } as never } } as never);
  if ((res as { error?: unknown }).error) return [];
  return ((res as { data: { data: PoItem[] } }).data?.data) ?? [];
}

async function fetchVendor(id: number): Promise<Vendor> {
  const res = await api.GET('/vendors/{id}' as never, { params: { path: { id } as never } } as never);
  if ((res as { error?: unknown }).error) throw new Error('Vendor not found');
  return (res as { data: { data: Vendor } }).data.data;
}

async function fetchWarehouse(id: number): Promise<Warehouse> {
  const res = await api.GET('/warehouses/{id}' as never, { params: { path: { id } as never } } as never);
  if ((res as { error?: unknown }).error) throw new Error('Warehouse not found');
  return (res as { data: { data: Warehouse } }).data.data;
}

async function fetchInventoryItems(): Promise<InventoryItemOption[]> {
  const res = await api.GET('/inventory/items' as never, { params: { query: { limit: 200, status: 'active' } as never } } as never);
  if ((res as { error?: unknown }).error) return [];
  return ((res as { data: { data: InventoryItemOption[] } }).data?.data) ?? [];
}

interface AddItemBody {
  inventory_item_id?: number;
  description: string;
  quantity_ordered: number;
  unit_cost?: number;
}

async function addPoItem(poId: number, body: AddItemBody): Promise<PoItem> {
  const res = await api.POST('/purchase-orders/{id}/items' as never, {
    params: { path: { id: poId } as never },
    body: body as never,
  } as never);
  if ((res as { error?: unknown }).error) {
    throw new Error(extractApiError((res as { error: unknown }).error, 'Failed to add line item'));
  }
  return (res as { data: { data: PoItem } }).data.data;
}

interface UpdatePoBody {
  subtotal?: number;
  total?: number;
}

async function updatePo(id: number, body: UpdatePoBody): Promise<void> {
  const res = await api.PUT('/purchase-orders/{id}' as never, {
    params: { path: { id } as never },
    body: body as never,
  } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to update purchase order');
}

interface ReceiveItemInput { id: number; quantity_received: number }

async function receivePo(id: number, items: ReceiveItemInput[], serials?: Record<number, string[]>): Promise<PurchaseOrder> {
  const body: { items: ReceiveItemInput[]; serials?: Record<number, string[]> } = { items };
  if (serials && Object.keys(serials).length > 0) body.serials = serials;
  const res = await api.POST('/purchase-orders/{id}/receive' as never, {
    params: { path: { id } as never },
    body: body as never,
  } as never);
  if ((res as { error?: unknown }).error) {
    throw new Error(extractApiError((res as { error: unknown }).error, 'Failed to receive purchase order'));
  }
  return (res as { data: { data: PurchaseOrder } }).data.data;
}

// ---------------------------------------------------------------------------
// Totals — recompute subtotal/total from line items (mirrors QuoteDetail's
// computeTotals). Purchase orders have no tax_rate field (unlike quotes), so
// tax_amount is left as whatever it currently is and simply carried into the
// new total.
// ---------------------------------------------------------------------------

function computeTotals(items: PoItem[], currentTaxAmount: number) {
  const rawSubtotal = items.reduce((sum, item) => sum + Number(item.total_cost ?? 0), 0);
  const subtotal = Math.round(rawSubtotal * 100) / 100;
  const total = Math.round((subtotal + currentTaxAmount) * 100) / 100;
  return { subtotal, total };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmt(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('es-MX', { year: 'numeric', month: 'short', day: 'numeric' });
}

function fmtAmount(amount: string | number | null | undefined, currency: string): string {
  if (amount === null || amount === undefined || amount === '') return '—';
  const num = typeof amount === 'string' ? parseFloat(amount) : amount;
  if (Number.isNaN(num)) return '—';
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency: currency || 'MXN' }).format(num);
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; color: string }> = {
    draft:     { bg: '#f3f4f6', color: '#6b7280' },
    sent:      { bg: '#dbeafe', color: '#1e40af' },
    partial:   { bg: '#fef3c7', color: '#92400e' },
    received:  { bg: '#d1fae5', color: '#065f46' },
    cancelled: { bg: '#fee2e2', color: '#991b1b' },
  };
  const s = map[status] ?? { bg: '#f3f4f6', color: '#374151' };
  return (
    <span style={{ background: s.bg, color: s.color, padding: '3px 10px', borderRadius: 12, fontSize: '0.78rem', fontWeight: 600, textTransform: 'capitalize' }}>
      {status}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Add Line Item form (inline card — the primary "build the PO" interaction)
// ---------------------------------------------------------------------------

interface AddItemFormProps {
  onAdd: (form: { inventoryItemId: string; description: string; quantity: string; unitCost: string }) => void;
  pending: boolean;
  error: string;
}

function AddItemForm({ onAdd, pending, error }: AddItemFormProps) {
  const { t } = useTranslation();
  const itemsQ = useQuery({ queryKey: ['inventory-items-lookup'], queryFn: fetchInventoryItems });
  const [inventoryItemId, setInventoryItemId] = useState('');
  const [description, setDescription] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [unitCost, setUnitCost] = useState('');

  function handleItemChange(id: string) {
    setInventoryItemId(id);
    const item = (itemsQ.data ?? []).find(i => String(i.id) === id);
    if (item) {
      setDescription(item.name);
      if (item.unit_cost) setUnitCost(item.unit_cost);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onAdd({ inventoryItemId, description, quantity, unitCost });
    setInventoryItemId('');
    setDescription('');
    setQuantity('1');
    setUnitCost('');
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap', marginTop: '0.75rem', paddingTop: '0.75rem', borderTop: '1px solid var(--border-subtle)' }}>
      <div style={{ flex: '1 1 220px' }}>
        <label style={labelStyle} htmlFor="po-item-inventory-item">{t('purchaseOrderDetail.form.inventoryItem')}</label>
        <select id="po-item-inventory-item" style={inputStyle} value={inventoryItemId} onChange={e => handleItemChange(e.target.value)}>
          <option value="">{t('purchaseOrderDetail.form.selectItem')}</option>
          {(itemsQ.data ?? []).map(i => (
            <option key={i.id} value={String(i.id)}>{i.name}{i.sku ? ` (${i.sku})` : ''}</option>
          ))}
        </select>
      </div>
      <div style={{ flex: '2 1 200px' }}>
        <label style={labelStyle} htmlFor="po-item-description">{t('purchaseOrderDetail.form.description')} <RequiredMark /></label>
        <input id="po-item-description" style={inputStyle} type="text" maxLength={255} required value={description} onChange={e => setDescription(e.target.value)} />
      </div>
      <div style={{ flex: '1 1 90px' }}>
        <label style={labelStyle} htmlFor="po-item-quantity">{t('purchaseOrderDetail.form.quantityOrdered')} <RequiredMark /></label>
        <input id="po-item-quantity" style={inputStyle} type="number" min="1" step="1" required value={quantity} onChange={e => setQuantity(e.target.value)} />
      </div>
      <div style={{ flex: '1 1 120px' }}>
        <label style={labelStyle} htmlFor="po-item-unit-cost">{t('purchaseOrderDetail.form.unitCost')}</label>
        <input id="po-item-unit-cost" style={inputStyle} type="number" min="0" step="0.01" value={unitCost} onChange={e => setUnitCost(e.target.value)} />
      </div>
      <button type="submit" style={submitBtn} disabled={pending}>
        {pending ? t('purchaseOrderDetail.actions.adding') : t('purchaseOrderDetail.actions.add')}
      </button>
      {error && <p style={{ ...errorText, flexBasis: '100%' }}>{error}</p>}
    </form>
  );
}

// ---------------------------------------------------------------------------
// Receive Modal — per-line editable "receive now" quantity, defaulting to the
// full remaining amount so a plain "click Receive" still fully-receives every
// line (backward compatible with the simplest flow).
// ---------------------------------------------------------------------------

interface ReceiveModalProps {
  po: PurchaseOrder;
  items: PoItem[];
  onClose: () => void;
  onReceived: () => void;
}

// Parses a textarea's raw text into one serial per non-blank line.
function parseSerials(raw: string): string[] {
  return raw.split('\n').map(s => s.trim()).filter(Boolean);
}

function ReceiveModal({ po, items, onClose, onReceived }: ReceiveModalProps) {
  const { t } = useTranslation();
  const [quantities, setQuantities] = useState<Record<number, string>>(
    Object.fromEntries(items.map(i => [i.id, String(i.quantity_ordered - i.quantity_received)])),
  );
  // Inventory Phase 3 (migration 391) — one serial per line, only rendered
  // for lines whose item has serial_required ON.
  const [serialText, setSerialText] = useState<Record<number, string>>({});
  const [error, setError] = useState('');

  function receiveNowFor(item: PoItem): number {
    const remaining = item.quantity_ordered - item.quantity_received;
    return Math.min(Math.max(Number(quantities[item.id] ?? remaining), 0), remaining);
  }

  // A line blocks submit when it's serial_required, receiving something this
  // pass, and the serial count doesn't exactly match that delta.
  const serialMismatches = items.filter(item => {
    if (!item.serial_required) return false;
    const receiveNow = receiveNowFor(item);
    if (receiveNow <= 0) return false;
    return parseSerials(serialText[item.id] ?? '').length !== receiveNow;
  });
  const canSubmit = serialMismatches.length === 0;

  const mutation = useMutation({
    mutationFn: () => {
      const serials: Record<number, string[]> = {};
      const payload: ReceiveItemInput[] = items.map(item => {
        // The input is a per-shipment "receive now" delta (defaults to the full
        // remaining amount). The backend's quantity_received is the CUMULATIVE
        // total received, so add the delta to what's already on the line —
        // otherwise a second receive re-sends the delta as an absolute total and
        // silently under-counts (or no-ops) the stock that just arrived.
        const receiveNow = receiveNowFor(item);
        if (item.serial_required && receiveNow > 0) {
          serials[item.id] = parseSerials(serialText[item.id] ?? '');
        }
        return { id: item.id, quantity_received: item.quantity_received + receiveNow };
      });
      return receivePo(po.id, payload, serials);
    },
    onSuccess: () => { onReceived(); onClose(); },
    onError: (err: unknown) => setError(err instanceof Error ? err.message : t('purchaseOrderDetail.receiveModal.genericError')),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!canSubmit) return;
    mutation.mutate();
  }

  return (
    <div style={modalStyles.backdrop} role="dialog" aria-modal="true" aria-label={t('purchaseOrderDetail.receiveModal.title')}>
      <div style={{ ...modalStyles.panel, maxWidth: 640 }}>
        <div style={modalStyles.header}>
          <h3 style={modalStyles.title}>{t('purchaseOrderDetail.receiveModal.title')}</h3>
          <button type="button" style={modalStyles.closeBtn} onClick={onClose} aria-label="Close">✕</button>
        </div>
        {error && <p style={modalStyles.error}>{error}</p>}
        <form onSubmit={handleSubmit}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem', marginBottom: '1rem' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid var(--border-subtle)' }}>
                <th style={{ textAlign: 'left', padding: '6px 8px' }}>{t('purchaseOrderDetail.table.description')}</th>
                <th style={{ textAlign: 'right', padding: '6px 8px' }}>{t('purchaseOrderDetail.table.quantityOrdered')}</th>
                <th style={{ textAlign: 'right', padding: '6px 8px' }}>{t('purchaseOrderDetail.table.quantityReceived')}</th>
                <th style={{ textAlign: 'right', padding: '6px 8px' }}>{t('purchaseOrderDetail.receiveModal.receiveNow')}</th>
              </tr>
            </thead>
            <tbody>
              {items.map(item => {
                const remaining = item.quantity_ordered - item.quantity_received;
                const receiveNow = receiveNowFor(item);
                const serialCount = parseSerials(serialText[item.id] ?? '').length;
                const mismatch = !!item.serial_required && receiveNow > 0 && serialCount !== receiveNow;
                return (
                  <tr key={item.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                    <td style={{ padding: '6px 8px' }}>{item.description}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'right' }}>{item.quantity_ordered}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'right' }}>{item.quantity_received}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'right' }}>
                      <input
                        type="number"
                        min={0}
                        max={remaining}
                        step="1"
                        disabled={remaining <= 0}
                        style={{ ...inputStyle, marginBottom: 0, width: 90, textAlign: 'right' }}
                        value={quantities[item.id] ?? String(remaining)}
                        onChange={e => setQuantities(q => ({ ...q, [item.id]: e.target.value }))}
                      />
                      {!!item.serial_required && receiveNow > 0 && (
                        <div style={{ textAlign: 'left', marginTop: 6 }}>
                          <label style={{ display: 'block', fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: 2 }}>
                            {t('purchaseOrderDetail.receiveModal.serialsLabel', { count: receiveNow })}
                          </label>
                          <textarea
                            style={{ ...inputStyle, marginBottom: 0, width: 220, minHeight: 60, fontFamily: 'monospace', fontSize: '0.78rem' }}
                            placeholder={t('purchaseOrderDetail.receiveModal.serialsPlaceholder')}
                            value={serialText[item.id] ?? ''}
                            onChange={e => setSerialText(s => ({ ...s, [item.id]: e.target.value }))}
                          />
                          <div style={{ fontSize: '0.72rem', color: mismatch ? '#dc2626' : 'var(--text-muted)' }}>
                            {t('purchaseOrderDetail.receiveModal.serialsCount', { entered: serialCount, needed: receiveNow })}
                          </div>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p style={{ margin: '0 0 1rem', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
            {t('purchaseOrderDetail.receiveModal.hint')}
          </p>
          {!canSubmit && (
            <p style={{ margin: '0 0 1rem', fontSize: '0.8rem', color: '#dc2626' }}>
              {t('purchaseOrderDetail.receiveModal.serialsMismatchError')}
            </p>
          )}
          <div style={modalStyles.actions}>
            <button type="button" onClick={onClose} style={crudStyles.btnSecondary} disabled={mutation.isPending}>
              {t('purchaseOrderDetail.actions.cancel')}
            </button>
            <button type="submit" style={crudStyles.btnPrimary} disabled={mutation.isPending || !canSubmit}>
              {mutation.isPending ? t('purchaseOrderDetail.receiveModal.receiving') : t('purchaseOrderDetail.receiveModal.confirm')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export function PurchaseOrderDetail() {
  const { id } = useParams<{ id: string }>();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [addItemError, setAddItemError] = useState('');
  const [showReceive, setShowReceive] = useState(false);
  const [toastMsg, setToastMsg] = useState('');

  const poQ = useQuery({ queryKey: ['purchase-order', id], queryFn: () => fetchPo(id!), enabled: !!id });
  const itemsQ = useQuery({ queryKey: ['purchase-order-items', id], queryFn: () => fetchPoItems(id!), enabled: !!id });
  const vendorQ = useQuery({
    queryKey: ['vendor', poQ.data?.vendor_id],
    queryFn: () => fetchVendor(poQ.data!.vendor_id!),
    enabled: !!poQ.data?.vendor_id,
  });
  const warehouseQ = useQuery({
    queryKey: ['warehouse', poQ.data?.warehouse_id],
    queryFn: () => fetchWarehouse(poQ.data!.warehouse_id!),
    enabled: !!poQ.data?.warehouse_id,
  });

  function showToast(msg: string) {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(''), 4000);
  }

  const po = poQ.data;

  const addItemMutation = useMutation({
    mutationFn: async (form: { inventoryItemId: string; description: string; quantity: string; unitCost: string }) => {
      const quantityOrdered = parseInt(form.quantity, 10);
      const unitCost = form.unitCost ? parseFloat(form.unitCost) : undefined;
      const body: AddItemBody = { description: form.description.trim(), quantity_ordered: quantityOrdered };
      if (form.inventoryItemId) body.inventory_item_id = Number(form.inventoryItemId);
      if (unitCost !== undefined) body.unit_cost = unitCost;
      await addPoItem(Number(id), body);

      const freshItems = await fetchPoItems(id!);
      const currentTaxAmount = po ? Number(po.tax_amount ?? 0) : 0;
      const { subtotal, total } = computeTotals(freshItems, currentTaxAmount);
      await updatePo(Number(id), { subtotal, total });
    },
    onSuccess: () => {
      setAddItemError('');
      qc.invalidateQueries({ queryKey: ['purchase-order', id] });
      qc.invalidateQueries({ queryKey: ['purchase-order-items', id] });
      qc.invalidateQueries({ queryKey: ['purchaseOrderList'] });
      showToast(t('purchaseOrderDetail.toasts.itemAdded'));
    },
    onError: (err: Error) => setAddItemError(err.message),
  });

  const items = itemsQ.data ?? [];
  const canReceive = !!po && ['draft', 'sent', 'partial'].includes(po.status) && items.length > 0;
  const canAddItems = !!po && po.status !== 'received' && po.status !== 'cancelled';

  return (
    <div style={{ padding: '1.5rem', maxWidth: 900 }}>
      <div style={{ fontSize: '0.8rem', color: '#9ca3af', marginBottom: '0.75rem' }}>
        <Link to="/purchase-orders" style={{ color: '#6b7280', textDecoration: 'none' }}>📑 {t('purchaseOrderDetail.breadcrumb')}</Link>
        {po && <> / {po.po_number}</>}
      </div>

      {poQ.isLoading && <p style={{ color: '#888' }}>{t('purchaseOrderDetail.loading')}</p>}
      {poQ.isError && <p style={{ color: 'var(--accent)' }}>{t('purchaseOrderDetail.notFound')}</p>}

      {po && (
        <>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '1.25rem', gap: 12, flexWrap: 'wrap' }}>
            <div>
              <h1 style={{ margin: 0, fontSize: '1.4rem', fontWeight: 700 }}>{po.po_number}</h1>
              {vendorQ.data && (
                <div style={{ marginTop: 4, fontSize: '0.875rem', color: '#6b7280' }}>
                  {t('purchaseOrderDetail.vendorLabel')} <strong>{vendorQ.data.name}</strong>
                </div>
              )}
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {canReceive && (
                <button onClick={() => setShowReceive(true)} style={actionBtn('var(--accent)')}>
                  📥 {t('purchaseOrderDetail.actions.receive')}
                </button>
              )}
            </div>
          </div>

          {toastMsg && (
            <div style={{ background: 'var(--sidebar-bg)', color: '#fff', padding: '10px 16px', borderRadius: 6, marginBottom: '1rem', fontSize: '0.85rem' }}>
              {toastMsg}
            </div>
          )}

          <div style={card}>
            <div style={metaGrid}>
              <MetaRow label={t('purchaseOrderDetail.meta.status')} value={<StatusBadge status={po.status} />} />
              <MetaRow label={t('purchaseOrderDetail.meta.warehouse')} value={warehouseQ.data?.name ?? '—'} />
              <MetaRow label={t('purchaseOrderDetail.meta.total')} value={<strong style={{ fontSize: '1.05rem' }}>{fmtAmount(po.total, po.currency ?? 'MXN')}</strong>} />
              <MetaRow label={t('purchaseOrderDetail.meta.subtotal')} value={fmtAmount(po.subtotal, po.currency ?? 'MXN')} />
              <MetaRow label={t('purchaseOrderDetail.meta.tax')} value={fmtAmount(po.tax_amount, po.currency ?? 'MXN')} />
              <MetaRow label={t('purchaseOrderDetail.meta.orderDate')} value={fmt(po.order_date)} />
              <MetaRow label={t('purchaseOrderDetail.meta.expectedDate')} value={fmt(po.expected_date)} />
              {po.received_date && <MetaRow label={t('purchaseOrderDetail.meta.receivedDate')} value={fmt(po.received_date)} />}
              {po.reference && <MetaRow label={t('purchaseOrderDetail.meta.reference')} value={po.reference} />}
            </div>
            {po.notes && (
              <p style={{ margin: '0.75rem 0 0', fontSize: '0.85rem', color: '#6b7280', borderTop: '1px solid #f3f4f6', paddingTop: '0.75rem' }}>
                <strong>{t('purchaseOrderDetail.notesLabel')}</strong> {po.notes}
              </p>
            )}
          </div>

          <h3 style={{ marginTop: '1.5rem', marginBottom: '0.5rem', fontSize: '1rem' }}>{t('purchaseOrderDetail.lineItems')}</h3>
          <div style={card}>
            {itemsQ.isLoading && <p style={{ color: '#888', margin: 0 }}>{t('purchaseOrderDetail.loadingItems')}</p>}
            {!itemsQ.isLoading && items.length === 0 && (
              <p style={{ color: '#9ca3af', margin: 0, fontSize: '0.85rem' }}>{t('purchaseOrderDetail.noItems')}</p>
            )}
            {items.length > 0 && (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid #f3f4f6' }}>
                    {[
                      t('purchaseOrderDetail.table.description'), t('purchaseOrderDetail.table.quantityOrdered'),
                      t('purchaseOrderDetail.table.quantityReceived'), t('purchaseOrderDetail.table.unitCost'),
                      t('purchaseOrderDetail.table.totalCost'),
                    ].map(h => <th key={h} style={{ padding: '6px 10px', textAlign: 'left', fontWeight: 600, color: '#374151' }}>{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {items.map(item => (
                    <tr key={item.id} style={{ borderBottom: '1px solid #f9fafb' }}>
                      <td style={{ padding: '8px 10px' }}>
                        {item.description}
                        {item.sku && <span style={{ marginLeft: 6, color: '#9ca3af', fontSize: '0.75rem' }}>({item.sku})</span>}
                      </td>
                      <td style={{ padding: '8px 10px' }}>{item.quantity_ordered}</td>
                      <td style={{ padding: '8px 10px' }}>
                        <span style={{ color: item.quantity_received >= item.quantity_ordered ? '#059669' : item.quantity_received > 0 ? '#d97706' : 'inherit', fontWeight: 600 }}>
                          {item.quantity_received}
                        </span>
                      </td>
                      <td style={{ padding: '8px 10px', fontVariantNumeric: 'tabular-nums' }}>{fmtAmount(item.unit_cost, po.currency ?? 'MXN')}</td>
                      <td style={{ padding: '8px 10px', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{fmtAmount(item.total_cost, po.currency ?? 'MXN')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {canAddItems && (
              <AddItemForm
                onAdd={(form) => addItemMutation.mutate(form)}
                pending={addItemMutation.isPending}
                error={addItemError}
              />
            )}
          </div>

          {showReceive && (
            <ReceiveModal
              po={po}
              items={items}
              onClose={() => setShowReceive(false)}
              onReceived={() => {
                qc.invalidateQueries({ queryKey: ['purchase-order', id] });
                qc.invalidateQueries({ queryKey: ['purchase-order-items', id] });
                qc.invalidateQueries({ queryKey: ['purchaseOrderList'] });
                // Stock landed in the PO's warehouse — refresh any open
                // warehouse/item stock views elsewhere in the app.
                qc.invalidateQueries({ queryKey: ['warehouseStock'] });
                qc.invalidateQueries({ queryKey: ['itemStock'] });
                showToast(t('purchaseOrderDetail.toasts.received'));
              }}
            />
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components & styles (mirrors QuoteDetail.tsx)
// ---------------------------------------------------------------------------

function MetaRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: 'contents' }}>
      <dt style={{ color: '#6b7280', fontWeight: 600, fontSize: '0.8rem', padding: '5px 0' }}>{label}</dt>
      <dd style={{ margin: 0, padding: '5px 0', fontSize: '0.875rem', color: '#111827' }}>{value}</dd>
    </div>
  );
}

const card: React.CSSProperties = {
  background: 'var(--bg-card)', borderRadius: 8, padding: '1rem',
  boxShadow: '0 0 0 1px var(--border)', marginBottom: '0.25rem',
};
const metaGrid: React.CSSProperties = {
  display: 'grid', gridTemplateColumns: 'auto 1fr', columnGap: '1.5rem', rowGap: 0,
};
const labelStyle: React.CSSProperties = {
  display: 'block', fontWeight: 600, fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: 4,
};
const inputStyle: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', padding: '7px 10px',
  border: '1px solid var(--input-border)', borderRadius: 6, fontSize: '0.875rem',
};
const submitBtn: React.CSSProperties = {
  background: 'var(--accent)', color: '#fff', border: 'none',
  padding: '7px 18px', borderRadius: 6, cursor: 'pointer', fontWeight: 600, fontSize: '0.875rem',
};
const errorText: React.CSSProperties = { color: '#dc2626', fontSize: '0.8rem', margin: '4px 0 0' };

function actionBtn(bg: string): React.CSSProperties {
  return {
    background: bg, color: '#fff', border: 'none', padding: '7px 14px',
    borderRadius: 6, cursor: 'pointer', fontWeight: 600, fontSize: '0.8rem',
  };
}
