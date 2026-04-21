// =============================================================================
// FireISP 5.0 — Warehouse Management
// =============================================================================
// Page at /warehouses. Shows all warehouses for the org with:
//   • Filtering by status
//   • Paginated table with name, address, city, status
//   • Per-row actions: Edit, View Stock
//   • New Warehouse modal and Edit Warehouse modal
//   • Stock Levels modal showing all inventory stock at a warehouse
// =============================================================================

import { useState } from 'react';
import type { CSSProperties, FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { tokenStore } from '@/api/client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Warehouse {
  id: number;
  name: string;
  address: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  zip_code: string | null;
  notes: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

interface WarehouseListResponse {
  data: Warehouse[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

interface WarehouseStockRow {
  id: number;
  item_id: number;
  item_name: string;
  sku: string | null;
  category: string | null;
  quantity: number;
  aisle: string | null;
  col: string | null;
  shelf: string | null;
}

interface WarehouseStockResponse {
  data: WarehouseStockRow[];
}

// ---------------------------------------------------------------------------
// Constants & helpers
// ---------------------------------------------------------------------------

const PAGE_SIZE = 25;
const API_BASE = '/api/v1';

function authHeaders(): Record<string, string> {
  const token = tokenStore.getAccess();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function fetchWarehouses(page: number, statusFilter: string): Promise<WarehouseListResponse> {
  const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
  if (statusFilter) params.set('status', statusFilter);
  const res = await fetch(`${API_BASE}/warehouses?${params}`, { headers: authHeaders() });
  if (!res.ok) throw new Error('Failed to load warehouses');
  return res.json() as Promise<WarehouseListResponse>;
}

async function fetchWarehouseStock(warehouseId: number): Promise<WarehouseStockResponse> {
  const res = await fetch(`${API_BASE}/warehouses/${warehouseId}/stock`, { headers: authHeaders() });
  if (!res.ok) throw new Error('Failed to load warehouse stock');
  return res.json() as Promise<WarehouseStockResponse>;
}

async function createWarehouse(body: Record<string, unknown>): Promise<void> {
  const res = await fetch(`${API_BASE}/warehouses`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({})) as { error?: { message?: string } };
    throw new Error(data.error?.message ?? 'Failed to create warehouse');
  }
}

async function updateWarehouse(id: number, body: Record<string, unknown>): Promise<void> {
  const res = await fetch(`${API_BASE}/warehouses/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({})) as { error?: { message?: string } };
    throw new Error(data.error?.message ?? 'Failed to update warehouse');
  }
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ');
}

// ---------------------------------------------------------------------------
// Status Badge
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; color: string }> = {
    active:   { bg: '#d1fae5', color: '#065f46' },
    inactive: { bg: '#fee2e2', color: '#991b1b' },
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
// Warehouse Form Modal (New / Edit)
// ---------------------------------------------------------------------------

interface WarehouseFormValues {
  name: string;
  address: string;
  city: string;
  state: string;
  country: string;
  zip_code: string;
  notes: string;
  status: string;
}

const EMPTY_FORM: WarehouseFormValues = {
  name: '', address: '', city: '', state: '',
  country: 'MX', zip_code: '', notes: '', status: 'active',
};

interface WarehouseFormModalProps {
  warehouse?: Warehouse | null;
  onClose: () => void;
  onSaved: () => void;
}

function WarehouseFormModal({ warehouse, onClose, onSaved }: WarehouseFormModalProps) {
  const isEdit = !!warehouse;
  const [form, setForm] = useState<WarehouseFormValues>(
    warehouse
      ? {
          name: warehouse.name,
          address: warehouse.address ?? '',
          city: warehouse.city ?? '',
          state: warehouse.state ?? '',
          country: warehouse.country ?? 'MX',
          zip_code: warehouse.zip_code ?? '',
          notes: warehouse.notes ?? '',
          status: warehouse.status,
        }
      : { ...EMPTY_FORM },
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  function set(field: keyof WarehouseFormValues, value: string) {
    setForm(f => ({ ...f, [field]: value }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    const body: Record<string, unknown> = { name: form.name, status: form.status };
    if (form.address) body.address = form.address;
    if (form.city) body.city = form.city;
    if (form.state) body.state = form.state;
    if (form.country) body.country = form.country;
    if (form.zip_code) body.zip_code = form.zip_code;
    if (form.notes) body.notes = form.notes;

    try {
      if (isEdit && warehouse) {
        await updateWarehouse(warehouse.id, body);
      } else {
        await createWarehouse(body);
      }
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={overlay}>
      <div style={{ ...modalBox, maxWidth: 500 }}>
        <h3 style={{ margin: '0 0 1rem' }}>{isEdit ? 'Edit Warehouse' : 'New Warehouse'}</h3>
        {error && <div style={errorBox}>{error}</div>}
        <form onSubmit={handleSubmit}>
          <label style={labelStyle}>Name *</label>
          <input style={inputStyle} required value={form.name}
            onChange={e => set('name', e.target.value)} placeholder="e.g. Main Warehouse" />

          <label style={labelStyle}>Address</label>
          <input style={inputStyle} value={form.address}
            onChange={e => set('address', e.target.value)} placeholder="Street and number" />

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 1rem' }}>
            <div>
              <label style={labelStyle}>City</label>
              <input style={inputStyle} value={form.city}
                onChange={e => set('city', e.target.value)} />
            </div>
            <div>
              <label style={labelStyle}>State</label>
              <input style={inputStyle} value={form.state}
                onChange={e => set('state', e.target.value)} />
            </div>
            <div>
              <label style={labelStyle}>ZIP Code</label>
              <input style={inputStyle} value={form.zip_code}
                onChange={e => set('zip_code', e.target.value)} />
            </div>
            <div>
              <label style={labelStyle}>Country</label>
              <input style={inputStyle} value={form.country}
                onChange={e => set('country', e.target.value)} placeholder="MX" />
            </div>
          </div>

          <label style={labelStyle}>Status</label>
          <select style={inputStyle} value={form.status} onChange={e => set('status', e.target.value)}>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>

          <label style={labelStyle}>Notes</label>
          <textarea style={{ ...inputStyle, minHeight: 60, resize: 'vertical' }} value={form.notes}
            onChange={e => set('notes', e.target.value)} placeholder="Optional notes…" />

          <div style={{ display: 'flex', gap: 8, marginTop: '0.75rem', justifyContent: 'flex-end' }}>
            <button type="button" onClick={onClose} style={cancelBtn} disabled={submitting}>Dismiss</button>
            <button type="submit" style={submitBtn} disabled={submitting}>
              {submitting ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Warehouse'}
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

interface WarehouseStockModalProps {
  warehouse: Warehouse;
  onClose: () => void;
}

function WarehouseStockModal({ warehouse, onClose }: WarehouseStockModalProps) {
  const [search, setSearch] = useState('');

  const { data, isLoading, isError } = useQuery({
    queryKey: ['warehouseStock', warehouse.id],
    queryFn: () => fetchWarehouseStock(warehouse.id),
  });

  const rows = data?.data ?? [];
  const filtered = search
    ? rows.filter(r =>
        r.item_name.toLowerCase().includes(search.toLowerCase()) ||
        (r.sku ?? '').toLowerCase().includes(search.toLowerCase()),
      )
    : rows;

  const totalItems = rows.length;
  const lowStockCount = rows.filter(r => r.quantity <= 0).length;

  return (
    <div style={overlay}>
      <div style={{ ...modalBox, maxWidth: 640, maxHeight: '85vh' }}>
        <h3 style={{ margin: '0 0 0.25rem' }}>Stock — {warehouse.name}</h3>
        <p style={{ margin: '0 0 1rem', color: '#6b7280', fontSize: '0.8rem' }}>
          {warehouse.city ? `${warehouse.city}, ` : ''}{warehouse.state ?? ''}
          &nbsp;|&nbsp; {totalItems} SKUs &nbsp;|&nbsp;
          <span style={{ color: lowStockCount > 0 ? '#dc2626' : '#065f46' }}>
            {lowStockCount} out of stock
          </span>
        </p>

        <input
          style={{ ...inputStyle, marginBottom: '0.75rem' }}
          placeholder="Search by item name or SKU…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />

        {isLoading && <p style={{ color: '#6b7280' }}>Loading…</p>}
        {isError && <p style={{ color: '#dc2626' }}>Failed to load stock data.</p>}

        {data && filtered.length === 0 && (
          <p style={{ color: '#6b7280', fontStyle: 'italic' }}>No stock records found.</p>
        )}

        {filtered.length > 0 && (
          <div style={{ overflowX: 'auto', maxHeight: 380, overflowY: 'auto' }}>
            <table style={{ ...tbl, fontSize: '0.82rem' }}>
              <thead>
                <tr>
                  {['SKU', 'Item', 'Category', 'Location', 'Qty'].map(h => (
                    <th key={h} style={th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(row => (
                  <tr key={row.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                    <td style={{ ...td, color: '#9ca3af', fontSize: '0.78rem' }}>{row.sku ?? '—'}</td>
                    <td style={{ ...td, fontWeight: 600 }}>{row.item_name}</td>
                    <td style={td}>{row.category ? capitalize(row.category) : '—'}</td>
                    <td style={td}>
                      {[row.aisle, row.col, row.shelf].filter(Boolean).join(' / ') || '—'}
                    </td>
                    <td style={{ ...td, fontWeight: 700 }}>
                      {/* Use qty<=0 as red; qty<=5 as amber warning (reorder_level not in this response) */}
                      <span style={{ color: row.quantity <= 0 ? '#dc2626' : row.quantity <= 5 ? '#d97706' : '#065f46' }}>
                        {row.quantity}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1rem' }}>
          <button onClick={onClose} style={cancelBtn}>Close</button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export function WarehouseList() {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('active');

  const [showNewModal, setShowNewModal] = useState(false);
  const [editWarehouse, setEditWarehouse] = useState<Warehouse | null>(null);
  const [stockWarehouse, setStockWarehouse] = useState<Warehouse | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['warehouseList', page, statusFilter],
    queryFn: () => fetchWarehouses(page, statusFilter),
    placeholderData: (prev: WarehouseListResponse | undefined) => prev,
  });

  function invalidate() {
    void qc.invalidateQueries({ queryKey: ['warehouseList'] });
  }

  const totalPages = data?.meta.totalPages ?? 1;

  return (
    <div style={{ padding: '1.5rem', fontFamily: 'system-ui, sans-serif' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', flexWrap: 'wrap', gap: 8 }}>
        <h1 style={{ margin: 0, fontSize: '1.4rem' }}>🏭 Warehouses</h1>
        <button style={primaryBtn} onClick={() => setShowNewModal(true)}>+ New Warehouse</button>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 8, marginBottom: '1.25rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ color: '#6b7280', fontSize: '0.85rem' }}>Status:</span>
        {[['', 'All'], ['active', 'Active'], ['inactive', 'Inactive']].map(([v, l]) => (
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
      {isLoading && <p style={{ color: '#6b7280' }}>Loading warehouses…</p>}
      {isError && <p style={{ color: '#dc2626' }}>Failed to load warehouses. Please try again.</p>}

      {data && (
        <>
          <div style={{ overflowX: 'auto' }}>
            <table style={tbl}>
              <thead>
                <tr>
                  {['Name', 'City', 'State', 'Country', 'ZIP', 'Status', 'Actions'].map(h => (
                    <th key={h} style={th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.data.length === 0 && (
                  <tr>
                    <td colSpan={7} style={{ ...td, color: '#6b7280', fontStyle: 'italic', textAlign: 'center' }}>
                      No warehouses found.
                    </td>
                  </tr>
                )}
                {data.data.map(wh => (
                  <tr key={wh.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                    <td style={{ ...td, fontWeight: 600 }}>
                      {wh.name}
                      {wh.address && (
                        <div style={{ fontWeight: 400, color: '#9ca3af', fontSize: '0.75rem' }}>
                          {wh.address}
                        </div>
                      )}
                    </td>
                    <td style={td}>{wh.city ?? '—'}</td>
                    <td style={td}>{wh.state ?? '—'}</td>
                    <td style={td}>{wh.country ?? '—'}</td>
                    <td style={td}>{wh.zip_code ?? '—'}</td>
                    <td style={td}><StatusBadge status={wh.status} /></td>
                    <td style={{ ...td, whiteSpace: 'nowrap' }}>
                      <button style={actionBtn} onClick={() => setEditWarehouse(wh)}>Edit</button>
                      {' '}
                      <button style={actionBtn} onClick={() => setStockWarehouse(wh)}>Stock</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: '1rem', color: '#6b7280', fontSize: '0.85rem' }}>
            <button style={pageBtn} disabled={page === 1} onClick={() => setPage(p => p - 1)}>← Prev</button>
            <span>Page {page} of {totalPages} ({data.meta.total} warehouses)</span>
            <button style={pageBtn} disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>Next →</button>
          </div>
        </>
      )}

      {/* Modals */}
      {showNewModal && (
        <WarehouseFormModal
          onClose={() => setShowNewModal(false)}
          onSaved={invalidate}
        />
      )}

      {editWarehouse && (
        <WarehouseFormModal
          warehouse={editWarehouse}
          onClose={() => setEditWarehouse(null)}
          onSaved={invalidate}
        />
      )}

      {stockWarehouse && (
        <WarehouseStockModal
          warehouse={stockWarehouse}
          onClose={() => setStockWarehouse(null)}
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
  fontFamily: 'system-ui, sans-serif', marginBottom: '0.75rem',
};

const labelStyle: CSSProperties = {
  display: 'block', marginBottom: 3, fontSize: '0.8rem',
  color: '#374151', fontWeight: 600,
};

const errorBox: CSSProperties = {
  background: '#fef2f2', border: '1px solid #fca5a5', color: '#dc2626',
  padding: '0.5rem 0.75rem', borderRadius: 4, marginBottom: '0.75rem', fontSize: '0.85rem',
};

const submitBtn: CSSProperties = {
  background: '#e25822', color: '#fff', border: 'none', borderRadius: 4,
  padding: '0.45rem 1.1rem', cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem',
};

const cancelBtn: CSSProperties = {
  background: '#f3f4f6', color: '#374151', border: '1px solid #d1d5db',
  borderRadius: 4, padding: '0.45rem 1rem', cursor: 'pointer', fontSize: '0.85rem',
};

const primaryBtn: CSSProperties = {
  background: '#e25822', color: '#fff', border: 'none', borderRadius: 4,
  padding: '0.5rem 1.1rem', cursor: 'pointer', fontWeight: 600, fontSize: '0.875rem',
};

const filterBtn: CSSProperties = {
  background: '#f3f4f6', color: '#374151', border: '1px solid #e5e7eb',
  borderRadius: 4, padding: '3px 10px', cursor: 'pointer', fontSize: '0.78rem',
};

const filterBtnActive: CSSProperties = {
  background: '#e25822', color: '#fff', borderColor: '#e25822',
};

const actionBtn: CSSProperties = {
  background: '#f3f4f6', color: '#374151', border: '1px solid #e5e7eb',
  borderRadius: 4, padding: '2px 8px', cursor: 'pointer', fontSize: '0.78rem',
};

const pageBtn: CSSProperties = {
  background: '#f3f4f6', color: '#374151', border: '1px solid #e5e7eb',
  borderRadius: 4, padding: '4px 12px', cursor: 'pointer', fontSize: '0.8rem',
};

const tbl: CSSProperties = {
  width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem',
  background: '#fff', borderRadius: 6, overflow: 'hidden',
  boxShadow: '0 1px 4px rgba(0,0,0,0.07)',
};

const th: CSSProperties = {
  textAlign: 'left', padding: '0.6rem 0.75rem',
  background: '#f9fafb', color: '#374151', fontWeight: 600,
  borderBottom: '2px solid #e5e7eb', whiteSpace: 'nowrap', fontSize: '0.8rem',
};

const td: CSSProperties = {
  padding: '0.55rem 0.75rem', color: '#374151', verticalAlign: 'middle',
};
