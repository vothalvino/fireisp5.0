// =============================================================================
// FireISP 5.0 — Inventory Management
// =============================================================================
// Page at /inventory. Shows all inventory items for the org with:
//   • Filtering by category and status
//   • Paginated table with SKU, name, category, stock summary, unit price
//   • Per-row actions: Edit, View Stock, Record Transaction
//   • New Item modal and Edit Item modal
//   • Stock levels modal (stock across all warehouses for an item)
//   • Record Transaction modal (receive, assign, transfer, return, adjustment)
// =============================================================================

import { useState } from 'react';
import type { CSSProperties, FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { authedFetch, tokenStore } from '@/api/client';
import { useOrgCurrency } from '@/auth/useOrgCurrency';
import { Pagination } from '@/components/Pagination';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface InventoryItem {
  id: number;
  sku: string | null;
  name: string;
  category: string | null;
  manufacturer: string | null;
  model: string | null;
  description: string | null;
  unit: string | null;
  unit_cost: string | null;
  sale_price: string | null;
  reorder_level: number | null;
  status: string;
  created_at: string;
  updated_at: string;
}

interface InventoryListResponse {
  data: InventoryItem[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

interface StockRow {
  id: number;
  warehouse_id: number;
  warehouse_name: string;
  quantity: number;
  aisle: string | null;
  col: string | null;
  shelf: string | null;
}

interface StockResponse {
  data: StockRow[];
}

interface Warehouse {
  id: number;
  name: string;
  status: string;
}

interface WarehouseListResponse {
  data: Warehouse[];
  meta: { total: number };
}

// ---------------------------------------------------------------------------
// Constants & helpers
// ---------------------------------------------------------------------------

const API_BASE = '/api/v1';

const CATEGORIES = [
  'antenna', 'cable', 'router', 'switch', 'onu', 'olt', 'cpe',
  'connector', 'power_supply', 'enclosure', 'tool', 'other',
];

const TRANSACTION_TYPES = [
  { value: 'receive', label: 'Receive (inbound)' },
  { value: 'transfer_in', label: 'Transfer In' },
  { value: 'return', label: 'Return' },
  { value: 'assign_to_job', label: 'Assign to Job (outbound)' },
  { value: 'sell_to_client', label: 'Sell to Client (outbound)' },
  { value: 'transfer_out', label: 'Transfer Out' },
  { value: 'adjustment', label: 'Adjustment' },
];

function authHeaders(): Record<string, string> {
  const token = tokenStore.getAccess();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function fetchItems(
  page: number,
  pageSize: number,
  categoryFilter: string,
  statusFilter: string,
): Promise<InventoryListResponse> {
  const params = new URLSearchParams({ page: String(page), limit: String(pageSize) });
  if (categoryFilter) params.set('category', categoryFilter);
  if (statusFilter) params.set('status', statusFilter);
  const res = await fetch(`${API_BASE}/inventory/items?${params}`, { headers: authHeaders() });
  if (!res.ok) throw new Error('Failed to load inventory items');
  return res.json() as Promise<InventoryListResponse>;
}

async function fetchItemStock(itemId: number): Promise<StockResponse> {
  const res = await fetch(`${API_BASE}/inventory/items/${itemId}/stock`, { headers: authHeaders() });
  if (!res.ok) throw new Error('Failed to load stock');
  return res.json() as Promise<StockResponse>;
}

async function fetchWarehouses(): Promise<WarehouseListResponse> {
  const res = await fetch(`${API_BASE}/warehouses?limit=200`, { headers: authHeaders() });
  if (!res.ok) throw new Error('Failed to load warehouses');
  return res.json() as Promise<WarehouseListResponse>;
}

async function createItem(body: Record<string, unknown>): Promise<void> {
  const res = await authedFetch(`${API_BASE}/inventory/items`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({})) as { error?: { message?: string } };
    throw new Error(data.error?.message ?? 'Failed to create item');
  }
}

async function updateItem(id: number, body: Record<string, unknown>): Promise<void> {
  const res = await authedFetch(`${API_BASE}/inventory/items/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({})) as { error?: { message?: string } };
    throw new Error(data.error?.message ?? 'Failed to update item');
  }
}

async function recordTransaction(body: Record<string, unknown>): Promise<void> {
  const res = await authedFetch(`${API_BASE}/inventory/transactions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({})) as { error?: { message?: string } };
    throw new Error(data.error?.message ?? 'Failed to record transaction');
  }
}

async function deleteItem(id: number): Promise<void> {
  const res = await authedFetch(`${API_BASE}/inventory/items/${id}`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({})) as { error?: { message?: string } };
    throw new Error(data.error?.message ?? 'Failed to delete item');
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFmtCurrency(currency: string) {
  return function fmtCurrency(amount: string | null | undefined): string {
    if (!amount) return '—';
    return new Intl.NumberFormat('es-MX', { style: 'currency', currency }).format(parseFloat(amount));
  };
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ');
}

// ---------------------------------------------------------------------------
// Status Badge
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; color: string }> = {
    active:        { bg: '#d1fae5', color: '#065f46' },
    discontinued:  { bg: '#fee2e2', color: '#991b1b' },
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

// ---------------------------------------------------------------------------
// Item Form Modal (New / Edit)
// ---------------------------------------------------------------------------

interface ItemFormValues {
  name: string;
  sku: string;
  category: string;
  manufacturer: string;
  model: string;
  description: string;
  unit: string;
  unit_cost: string;
  sale_price: string;
  reorder_level: string;
  status: string;
}

const EMPTY_ITEM_FORM: ItemFormValues = {
  name: '', sku: '', category: '', manufacturer: '', model: '',
  description: '', unit: 'unit', unit_cost: '', sale_price: '',
  reorder_level: '', status: 'active',
};

interface ItemFormModalProps {
  item?: InventoryItem | null;
  onClose: () => void;
  onSaved: () => void;
}

function ItemFormModal({ item, onClose, onSaved }: ItemFormModalProps) {
  const orgCurrency = useOrgCurrency();
  const isEdit = !!item;
  const [form, setForm] = useState<ItemFormValues>(
    item
      ? {
          name: item.name,
          sku: item.sku ?? '',
          category: item.category ?? '',
          manufacturer: item.manufacturer ?? '',
          model: item.model ?? '',
          description: item.description ?? '',
          unit: item.unit ?? 'unit',
          unit_cost: item.unit_cost ?? '',
          sale_price: item.sale_price ?? '',
          reorder_level: item.reorder_level != null ? String(item.reorder_level) : '',
          status: item.status,
        }
      : { ...EMPTY_ITEM_FORM },
  );
  const [error, setError] = useState('');
  const qc = useQueryClient();

  function set(field: keyof ItemFormValues, value: string) {
    setForm(f => ({ ...f, [field]: value }));
  }

  const mutation = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = {
        name: form.name,
        status: form.status,
      };
      if (form.sku) body.sku = form.sku;
      if (form.category) body.category = form.category;
      if (form.manufacturer) body.manufacturer = form.manufacturer;
      if (form.model) body.model = form.model;
      if (form.description) body.description = form.description;
      if (form.unit) body.unit = form.unit;
      if (form.unit_cost) body.unit_cost = parseFloat(form.unit_cost);
      if (form.sale_price) body.sale_price = parseFloat(form.sale_price);
      if (form.reorder_level) body.reorder_level = parseInt(form.reorder_level, 10);
      return isEdit && item ? updateItem(item.id, body) : createItem(body);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['inventoryItems'] });
      onSaved();
      onClose();
    },
    onError: (err: unknown) => setError(err instanceof Error ? err.message : 'An error occurred'),
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    mutation.mutate();
  }

  return (
    <div style={overlay}>
      <div style={{ ...modalBox, maxWidth: 560 }}>
        <h3 style={{ margin: '0 0 1rem' }}>{isEdit ? 'Edit Item' : 'New Inventory Item'}</h3>
        {error && <div style={errorBox}>{error}</div>}
        <form onSubmit={handleSubmit}>
          <div style={formGrid}>
            <div>
              <label style={labelStyle}>Name *</label>
              <input style={inputStyle} required value={form.name}
                onChange={e => set('name', e.target.value)} placeholder="e.g. MikroTik RB750Gr3" />
            </div>
            <div>
              <label style={labelStyle}>SKU</label>
              <input style={inputStyle} value={form.sku}
                onChange={e => set('sku', e.target.value)} placeholder="e.g. RB-750GR3" />
            </div>
            <div>
              <label style={labelStyle}>Category</label>
              <select style={inputStyle} value={form.category} onChange={e => set('category', e.target.value)}>
                <option value="">— select —</option>
                {CATEGORIES.map(c => (
                  <option key={c} value={c}>{capitalize(c)}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Unit</label>
              <input style={inputStyle} value={form.unit}
                onChange={e => set('unit', e.target.value)} placeholder="unit / m / roll" />
            </div>
            <div>
              <label style={labelStyle}>Manufacturer</label>
              <input style={inputStyle} value={form.manufacturer}
                onChange={e => set('manufacturer', e.target.value)} />
            </div>
            <div>
              <label style={labelStyle}>Model</label>
              <input style={inputStyle} value={form.model}
                onChange={e => set('model', e.target.value)} />
            </div>
            <div>
              <label style={labelStyle}>Unit Cost ({orgCurrency})</label>
              <input style={inputStyle} type="number" min="0" step="0.01" value={form.unit_cost}
                onChange={e => set('unit_cost', e.target.value)} placeholder="0.00" />
            </div>
            <div>
              <label style={labelStyle}>Sale Price ({orgCurrency})</label>
              <input style={inputStyle} type="number" min="0" step="0.01" value={form.sale_price}
                onChange={e => set('sale_price', e.target.value)} placeholder="0.00" />
            </div>
            <div>
              <label style={labelStyle}>Reorder Level</label>
              <input style={inputStyle} type="number" min="0" value={form.reorder_level}
                onChange={e => set('reorder_level', e.target.value)} placeholder="5" />
            </div>
            <div>
              <label style={labelStyle}>Status</label>
              <select style={inputStyle} value={form.status} onChange={e => set('status', e.target.value)}>
                <option value="active">Active</option>
                <option value="discontinued">Discontinued</option>
              </select>
            </div>
          </div>
          <div style={{ gridColumn: '1 / -1', marginTop: 4 }}>
            <label style={labelStyle}>Description</label>
            <textarea style={{ ...inputStyle, minHeight: 64, resize: 'vertical' }} value={form.description}
              onChange={e => set('description', e.target.value)} placeholder="Optional description…" />
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: '1rem', justifyContent: 'flex-end' }}>
            <button type="button" onClick={onClose} style={cancelBtn} disabled={mutation.isPending}>Dismiss</button>
            <button type="submit" style={submitBtn} disabled={mutation.isPending}>
              {mutation.isPending ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Item'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stock Levels Modal
// ---------------------------------------------------------------------------

interface StockModalProps {
  item: InventoryItem;
  onClose: () => void;
  onRecord: (stockId: number, warehouseId: number) => void;
}

function StockModal({ item, onClose, onRecord }: StockModalProps) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['itemStock', item.id],
    queryFn: () => fetchItemStock(item.id),
  });

  const totalQty = data?.data.reduce((acc, r) => acc + r.quantity, 0) ?? 0;

  return (
    <div style={overlay}>
      <div style={{ ...modalBox, maxWidth: 580 }}>
        <h3 style={{ margin: '0 0 0.25rem' }}>Stock Levels — {item.name}</h3>
        <p style={{ margin: '0 0 1rem', color: '#6b7280', fontSize: '0.8rem' }}>
          SKU: {item.sku ?? '—'} &nbsp;|&nbsp; Total in stock: <strong>{totalQty}</strong>
        </p>

        {isLoading && <p style={{ color: '#6b7280' }}>Loading…</p>}
        {isError && <p style={{ color: '#dc2626' }}>Failed to load stock data.</p>}

        {data && data.data.length === 0 && (
          <p style={{ color: '#6b7280', fontStyle: 'italic' }}>No stock records found.</p>
        )}

        {data && data.data.length > 0 && (
          <table style={tbl}>
            <thead>
              <tr>
                {['Warehouse', 'Location', 'Qty', ''].map(h => (
                  <th key={h} style={th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.data.map(row => (
                <tr key={row.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                  <td style={td}>{row.warehouse_name}</td>
                  <td style={td}>
                    {[row.aisle, row.col, row.shelf].filter(Boolean).join(' / ') || '—'}
                  </td>
                  <td style={{ ...td, fontWeight: 600 }}>
                    <span style={{
                      color: row.quantity < 0
                        ? '#dc2626'
                        : row.quantity <= (item.reorder_level ?? 0) && row.quantity > 0
                          ? '#d97706' : row.quantity === 0 ? '#dc2626' : '#065f46',
                    }}>
                      {row.quantity}
                    </span>
                  </td>
                  <td style={td}>
                    <button
                      style={actionBtn}
                      onClick={() => onRecord(row.id, row.warehouse_id)}
                    >
                      + Txn
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1rem' }}>
          <button onClick={onClose} style={cancelBtn}>Close</button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Record Transaction Modal
// ---------------------------------------------------------------------------

interface TransactionModalProps {
  item: InventoryItem;
  preselectedStockId?: number | null;
  onClose: () => void;
  onRecorded: () => void;
}

function TransactionModal({ item, preselectedStockId, onClose, onRecorded }: TransactionModalProps) {
  const orgCurrency = useOrgCurrency();
  const { data: warehouseData } = useQuery({
    queryKey: ['warehouseList'],
    queryFn: fetchWarehouses,
  });

  const [warehouseId, setWarehouseId] = useState('');
  const [txType, setTxType] = useState('receive');
  const [quantity, setQuantity] = useState('');
  const [unitPrice, setUnitPrice] = useState('');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [stockId, setStockId] = useState(preselectedStockId ? String(preselectedStockId) : '');
  const [error, setError] = useState('');
  const qc = useQueryClient();

  // Transaction types that can legally create a NEW inventory_stock row (the
  // backend upserts item_id+warehouse_id for these — see POST
  // /inventory/transactions). Anything else (assign_to_job, sell_to_client,
  // transfer_out) can only move stock that already exists somewhere.
  const CAN_CREATE_STOCK = ['receive', 'adjustment'];

  const mutation = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = {
        transaction_type: txType,
        quantity: parseFloat(quantity),
      };
      if (stockId) {
        // Existing stock location — move/adjust it directly.
        body.stock_id = parseInt(stockId, 10);
      } else {
        // No stock row exists yet for this item at the chosen warehouse. Send
        // item_id + warehouse_id instead — the backend creates the stock row
        // (starting at 0) before applying the transaction, so a brand-new item
        // can receive its first-ever stock through this same modal.
        body.item_id = item.id;
        body.warehouse_id = parseInt(warehouseId, 10);
      }
      if (unitPrice) body.unit_price = parseFloat(unitPrice);
      if (reference) body.reference = reference;
      if (notes) body.notes = notes;
      return recordTransaction(body);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['itemStock', item.id] });
      onRecorded();
      onClose();
    },
    onError: (err: unknown) => setError(err instanceof Error ? err.message : 'An error occurred'),
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!preselectedStockId && !stockId && !warehouseId) {
      setError('Please select a warehouse.');
      return;
    }
    if (!stockId && !CAN_CREATE_STOCK.includes(txType)) {
      setError('This item has no stock at that warehouse yet. Use "Receive" or "Adjustment" to add first-time stock before recording other movements.');
      return;
    }
    setError('');
    mutation.mutate();
  }

  // Load stock rows to pick a stock_id when warehouse is chosen
  const { data: stockData } = useQuery({
    queryKey: ['itemStock', item.id],
    queryFn: () => fetchItemStock(item.id),
    enabled: !preselectedStockId,
  });

  function handleWarehouseChange(wId: string) {
    setWarehouseId(wId);
    const stockRow = stockData?.data.find(s => String(s.warehouse_id) === wId);
    setStockId(stockRow ? String(stockRow.id) : '');
  }

  return (
    <div style={overlay}>
      <div style={{ ...modalBox, maxWidth: 480 }}>
        <h3 style={{ margin: '0 0 0.25rem' }}>Record Transaction</h3>
        <p style={{ margin: '0 0 1rem', color: '#6b7280', fontSize: '0.8rem' }}>
          Item: <strong>{item.name}</strong>
        </p>
        {error && <div style={errorBox}>{error}</div>}
        <form onSubmit={handleSubmit}>
          {!preselectedStockId && (
            <>
              <label style={labelStyle}>Warehouse</label>
              <select
                style={inputStyle}
                value={warehouseId}
                onChange={e => handleWarehouseChange(e.target.value)}
              >
                <option value="">— select warehouse —</option>
                {warehouseData?.data.filter(w => w.status === 'active').map(w => (
                  <option key={w.id} value={String(w.id)}>{w.name}</option>
                ))}
              </select>
              {warehouseId && !stockId && (
                <p style={{ margin: '-0.5rem 0 0.75rem', fontSize: '0.75rem', color: '#6b7280' }}>
                  This item has no stock at this warehouse yet — a "Receive" or "Adjustment" transaction will create it.
                </p>
              )}
            </>
          )}

          <label style={labelStyle}>Transaction Type *</label>
          <select style={inputStyle} value={txType} onChange={e => setTxType(e.target.value)} required>
            {TRANSACTION_TYPES.map(t => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>

          <label style={labelStyle}>Quantity *{txType === 'adjustment' ? ' (use negative to decrease stock)' : ''}</label>
          <input
            style={inputStyle}
            type="number"
            min={txType === 'adjustment' ? undefined : '1'}
            step="1"
            value={quantity}
            onChange={e => setQuantity(e.target.value)}
            required
            placeholder={txType === 'adjustment' ? 'e.g. -5 or 10' : 'e.g. 10'}
          />

          <label style={labelStyle}>Unit Price ({orgCurrency})</label>
          <input
            style={inputStyle}
            type="number"
            min="0"
            step="0.01"
            value={unitPrice}
            onChange={e => setUnitPrice(e.target.value)}
            placeholder="0.00"
          />

          <label style={labelStyle}>Reference</label>
          <input
            style={inputStyle}
            value={reference}
            onChange={e => setReference(e.target.value)}
            placeholder="PO number, ticket ID, etc."
          />

          <label style={labelStyle}>Notes</label>
          <textarea
            style={{ ...inputStyle, minHeight: 52, resize: 'vertical' }}
            value={notes}
            onChange={e => setNotes(e.target.value)}
          />

          <div style={{ display: 'flex', gap: 8, marginTop: '1rem', justifyContent: 'flex-end' }}>
            <button type="button" onClick={onClose} style={cancelBtn} disabled={mutation.isPending}>Dismiss</button>
            <button type="submit" style={submitBtn} disabled={mutation.isPending}>
              {mutation.isPending ? 'Saving…' : 'Record Transaction'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export function InventoryList() {
  const qc = useQueryClient();
  const orgCurrency = useOrgCurrency();
  const fmtCurrency = makeFmtCurrency(orgCurrency);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [categoryFilter, setCategoryFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('active');

  const [showNewModal, setShowNewModal] = useState(false);
  const [editItem, setEditItem] = useState<InventoryItem | null>(null);
  const [stockItem, setStockItem] = useState<InventoryItem | null>(null);
  const [txItem, setTxItem] = useState<InventoryItem | null>(null);
  const [txStockId, setTxStockId] = useState<number | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['inventoryItems', page, pageSize, categoryFilter, statusFilter],
    queryFn: () => fetchItems(page, pageSize, categoryFilter, statusFilter),
    placeholderData: (prev: InventoryListResponse | undefined) => prev,
  });

  function invalidate() {
    void qc.invalidateQueries({ queryKey: ['inventoryItems'] });
  }

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteItem(id),
    onSuccess: invalidate,
    onError: (err: unknown) => alert(err instanceof Error ? err.message : 'Failed to delete item'),
  });

  function handleDelete(item: InventoryItem) {
    if (window.confirm(`Delete item "${item.name}"? This cannot be undone.`)) {
      deleteMutation.mutate(item.id);
    }
  }

  function openTxFromStock(stockId: number, item: InventoryItem) {
    setStockItem(null);
    setTxStockId(stockId);
    setTxItem(item);
  }

  return (
    <div style={{ padding: '1.5rem', fontFamily: 'var(--font-sans)' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', flexWrap: 'wrap', gap: 8 }}>
        <h1 style={{ margin: 0, fontSize: '1.4rem' }}>📦 Inventory</h1>
        <button style={primaryBtn} onClick={() => setShowNewModal(true)}>+ New Item</button>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 8, marginBottom: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ color: '#6b7280', fontSize: '0.85rem' }}>Category:</span>
        {(['', ...CATEGORIES]).map(c => (
          <button
            key={c}
            style={{ ...filterBtn, ...(categoryFilter === c ? filterBtnActive : {}) }}
            onClick={() => { setCategoryFilter(c); setPage(1); }}
          >
            {c === '' ? 'All' : capitalize(c)}
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: '1.25rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ color: '#6b7280', fontSize: '0.85rem' }}>Status:</span>
        {[['', 'All'], ['active', 'Active'], ['discontinued', 'Discontinued']].map(([v, l]) => (
          <button
            key={v}
            style={{ ...filterBtn, ...(statusFilter === v ? filterBtnActive : {}) }}
            onClick={() => { setStatusFilter(v); setPage(1); }}
          >
            {l}
          </button>
        ))}
      </div>

      {/* Table */}
      {isLoading && <p style={{ color: '#6b7280' }}>Loading inventory…</p>}
      {isError && <p style={{ color: '#dc2626' }}>Failed to load inventory. Please try again.</p>}

      {data && (
        <>
          <div style={{ overflowX: 'auto' }}>
            <table style={tbl}>
              <thead>
                <tr>
                  {['SKU', 'Name', 'Category', 'Unit Cost', 'Sale Price', 'Reorder Lvl', 'Status', 'Actions'].map(h => (
                    <th key={h} style={th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.data.length === 0 && (
                  <tr>
                    <td colSpan={8} style={{ ...td, color: '#6b7280', fontStyle: 'italic', textAlign: 'center' }}>
                      No items found.
                    </td>
                  </tr>
                )}
                {data.data.map(item => (
                  <tr key={item.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                    <td style={{ ...td, color: '#6b7280', fontSize: '0.8rem' }}>{item.sku ?? '—'}</td>
                    <td style={{ ...td, fontWeight: 600, maxWidth: 220 }}>
                      {item.name}
                      {item.manufacturer && (
                        <div style={{ fontWeight: 400, color: '#9ca3af', fontSize: '0.75rem' }}>
                          {item.manufacturer}{item.model ? ` · ${item.model}` : ''}
                        </div>
                      )}
                    </td>
                    <td style={td}>{item.category ? capitalize(item.category) : '—'}</td>
                    <td style={td}>{fmtCurrency(item.unit_cost)}</td>
                    <td style={td}>{fmtCurrency(item.sale_price)}</td>
                    <td style={td}>{item.reorder_level ?? '—'}</td>
                    <td style={td}><StatusBadge status={item.status} /></td>
                    <td style={{ ...td, whiteSpace: 'nowrap' }}>
                      <button style={actionBtn} onClick={() => setEditItem(item)}>Edit</button>
                      {' '}
                      <button style={actionBtn} onClick={() => setStockItem(item)}>Stock</button>
                      {' '}
                      <button style={actionBtn} onClick={() => { setTxItem(item); setTxStockId(null); }}>+ Txn</button>
                      {' '}
                      <button
                        style={deleteBtn}
                        onClick={() => handleDelete(item)}
                        disabled={deleteMutation.isPending}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <Pagination
            page={page}
            totalPages={data.meta.totalPages ?? 1}
            total={data.meta.total}
            pageSize={pageSize}
            onPageChange={setPage}
            onPageSizeChange={(size) => { setPageSize(size); setPage(1); }}
          />
        </>
      )}

      {/* Modals */}
      {showNewModal && (
        <ItemFormModal
          onClose={() => setShowNewModal(false)}
          onSaved={invalidate}
        />
      )}

      {editItem && (
        <ItemFormModal
          item={editItem}
          onClose={() => setEditItem(null)}
          onSaved={invalidate}
        />
      )}

      {stockItem && (
        <StockModal
          item={stockItem}
          onClose={() => setStockItem(null)}
          onRecord={(stockId) => openTxFromStock(stockId, stockItem)}
        />
      )}

      {txItem && (
        <TransactionModal
          item={txItem}
          preselectedStockId={txStockId}
          onClose={() => { setTxItem(null); setTxStockId(null); }}
          onRecorded={() => { invalidate(); void qc.invalidateQueries({ queryKey: ['itemStock', txItem.id] }); }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const overlay: CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
};

const modalBox: CSSProperties = {
  background: '#fff', borderRadius: 8, padding: '1.5rem',
  width: '92vw', maxWidth: 480, maxHeight: '90vh', overflowY: 'auto',
  boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
};

const inputStyle: CSSProperties = {
  width: '100%', boxSizing: 'border-box', padding: '0.45rem 0.6rem',
  border: '1px solid #d1d5db', borderRadius: 4, fontSize: '0.85rem',
  fontFamily: 'var(--font-sans)', marginBottom: '0.75rem',
};

const labelStyle: CSSProperties = {
  display: 'block', marginBottom: 3, fontSize: '0.8rem',
  color: '#374151', fontWeight: 600,
};

const formGrid: CSSProperties = {
  display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 1rem',
};

const errorBox: CSSProperties = {
  background: '#fef2f2', border: '1px solid #fca5a5', color: '#dc2626',
  padding: '0.5rem 0.75rem', borderRadius: 4, marginBottom: '0.75rem', fontSize: '0.85rem',
};

const submitBtn: CSSProperties = {
  background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 4,
  padding: '0.45rem 1.1rem', cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem',
};

const cancelBtn: CSSProperties = {
  background: '#f3f4f6', color: '#374151', border: '1px solid #d1d5db',
  borderRadius: 4, padding: '0.45rem 1rem', cursor: 'pointer', fontSize: '0.85rem',
};

const primaryBtn: CSSProperties = {
  background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 4,
  padding: '0.5rem 1.1rem', cursor: 'pointer', fontWeight: 600, fontSize: '0.875rem',
};

const filterBtn: CSSProperties = {
  background: '#f3f4f6', color: '#374151', border: '1px solid #e5e7eb',
  borderRadius: 4, padding: '3px 10px', cursor: 'pointer', fontSize: '0.78rem',
};

const filterBtnActive: CSSProperties = {
  background: 'var(--accent)', color: '#fff', borderColor: 'var(--accent)',
};

const actionBtn: CSSProperties = {
  background: '#f3f4f6', color: '#374151', border: '1px solid #e5e7eb',
  borderRadius: 4, padding: '2px 8px', cursor: 'pointer', fontSize: '0.78rem',
};

const deleteBtn: CSSProperties = {
  background: '#fef2f2', color: '#dc2626', border: '1px solid #fca5a5',
  borderRadius: 4, padding: '2px 8px', cursor: 'pointer', fontSize: '0.78rem',
};


const tbl: CSSProperties = {
  width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem',
  background: '#fff', borderRadius: 6, overflow: 'hidden',
  boxShadow: '0 0 0 1px var(--border)',
};

const th: CSSProperties = {
  textAlign: 'left', padding: '0.6rem 0.75rem',
  background: '#f9fafb', color: '#374151', fontWeight: 600,
  borderBottom: '2px solid #e5e7eb', whiteSpace: 'nowrap', fontSize: '0.8rem',
};

const td: CSSProperties = {
  padding: '0.55rem 0.75rem', color: '#374151', verticalAlign: 'middle',
};
