// =============================================================================
// FireISP 5.0 — Purchase Order Management (§14.2 — Inventory Phase 1)
// =============================================================================
// Page at /purchase-orders. Lists purchase orders with:
//   • Status filter
//   • Paginated table (PO number, vendor, warehouse, order date, status, total),
//     each row linking to /purchase-orders/:id (PurchaseOrderDetail) — mirrors
//     QuoteList → QuoteDetail.
//   • "New Purchase Order" opens a header-only create modal (vendor, warehouse,
//     PO number, dates, reference/notes) → POST /purchase-orders, then
//     navigates straight to PurchaseOrderDetail where line items are added and
//     the PO is received — mirrors how QuoteList creates a header then
//     QuoteDetail builds it out.
// The backend (src/routes/purchaseOrders.js) has had full CRUD + receive since
// §14.2; this page (+ PurchaseOrderDetail) is the first UI that can reach it.
// =============================================================================

import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';
import { extractApiError } from '@/components/ClientFormModal';
import { styles, modalStyles, fmtMoney, fmtDate, capitalize, RequiredMark } from './crudStyles';
import { Pagination } from '@/components/Pagination';

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
}

interface PurchaseOrderListResponse {
  data: PurchaseOrder[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

interface Vendor { id: number; name: string; status: string }
interface Warehouse { id: number; name: string; status: string }

const STATUSES = ['draft', 'sent', 'partial', 'received', 'cancelled'];

// ---------------------------------------------------------------------------
// Fetch / mutate helpers
// ---------------------------------------------------------------------------

async function fetchPurchaseOrders(page: number, pageSize: number, statusFilter: string): Promise<PurchaseOrderListResponse> {
  const query: Record<string, string | number> = { page, limit: pageSize };
  if (statusFilter) query.status = statusFilter;
  const res = await api.GET('/purchase-orders' as never, { params: { query: query as never } } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to load purchase orders');
  return (res as { data: unknown }).data as unknown as PurchaseOrderListResponse;
}

async function fetchVendors(): Promise<Vendor[]> {
  const res = await api.GET('/vendors' as never, { params: { query: { limit: 200, status: 'active' } as never } } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to load vendors');
  return ((res as { data: { data: Vendor[] } }).data?.data) ?? [];
}

async function fetchWarehouses(): Promise<Warehouse[]> {
  const res = await api.GET('/warehouses' as never, { params: { query: { limit: 200, status: 'active' } as never } } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to load warehouses');
  return ((res as { data: { data: Warehouse[] } }).data?.data) ?? [];
}

interface CreatePoBody {
  po_number: string;
  vendor_id?: number;
  warehouse_id?: number;
  order_date?: string;
  expected_date?: string;
  reference?: string;
  notes?: string;
}

async function createPurchaseOrder(body: CreatePoBody): Promise<PurchaseOrder> {
  const res = await api.POST('/purchase-orders' as never, { body: body as never } as never);
  if ((res as { error?: unknown }).error) {
    throw new Error(extractApiError((res as { error: unknown }).error, 'Failed to create purchase order'));
  }
  return (res as { data: { data: PurchaseOrder } }).data.data;
}

async function deletePurchaseOrder(id: number): Promise<void> {
  const res = await api.DELETE('/purchase-orders/{id}' as never, { params: { path: { id } as never } } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to delete purchase order');
}

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; color: string }> = {
    draft:     { bg: '#f3f4f6', color: '#374151' },
    sent:      { bg: '#dbeafe', color: '#1e40af' },
    partial:   { bg: '#fef3c7', color: '#92400e' },
    received:  { bg: '#d1fae5', color: '#065f46' },
    cancelled: { bg: '#fee2e2', color: '#991b1b' },
  };
  const s = map[status] ?? { bg: '#f3f4f6', color: '#374151' };
  return (
    <span style={{ background: s.bg, color: s.color, padding: '2px 8px', borderRadius: 12, fontSize: '0.72rem', fontWeight: 600, textTransform: 'capitalize' }}>
      {status}
    </span>
  );
}

// ---------------------------------------------------------------------------
// New Purchase Order Modal — header only; line items are added on the detail
// page (mirrors GenerateQuoteModal creating a header vs. QuoteDetail building
// it out, except a PO has no auto-number sequence — po_number is a free-text
// field the backend requires, pre-filled with a timestamp-based default the
// user can overwrite).
// ---------------------------------------------------------------------------

interface NewPoModalProps {
  onClose: () => void;
  onCreated: (po: PurchaseOrder) => void;
}

function defaultPoNumber(): string {
  const now = new Date();
  const stamp = now.toISOString().slice(0, 10).replace(/-/g, '');
  const seq = String(now.getTime()).slice(-4);
  return `PO-${stamp}-${seq}`;
}

function NewPoModal({ onClose, onCreated }: NewPoModalProps) {
  const { t } = useTranslation();
  const [poNumber, setPoNumber] = useState(defaultPoNumber());
  const [vendorId, setVendorId] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [orderDate, setOrderDate] = useState(new Date().toISOString().slice(0, 10));
  const [expectedDate, setExpectedDate] = useState('');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');

  const vendorsQ = useQuery({ queryKey: ['vendors-lookup'], queryFn: fetchVendors });
  const warehousesQ = useQuery({ queryKey: ['warehouses-lookup'], queryFn: fetchWarehouses });

  const mutation = useMutation({
    mutationFn: () => {
      const body: CreatePoBody = { po_number: poNumber.trim() };
      if (vendorId) body.vendor_id = Number(vendorId);
      if (warehouseId) body.warehouse_id = Number(warehouseId);
      if (orderDate) body.order_date = orderDate;
      if (expectedDate) body.expected_date = expectedDate;
      if (reference) body.reference = reference;
      if (notes) body.notes = notes;
      return createPurchaseOrder(body);
    },
    onSuccess: (po) => onCreated(po),
    onError: (err: unknown) => setError(err instanceof Error ? err.message : t('purchaseOrders.form.genericError')),
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    mutation.mutate();
  }

  return (
    <div style={modalStyles.backdrop} role="dialog" aria-modal="true" aria-label={t('purchaseOrders.newTitle')}>
      <div style={modalStyles.panel}>
        <div style={modalStyles.header}>
          <h3 style={modalStyles.title}>{t('purchaseOrders.newTitle')}</h3>
          <button type="button" style={modalStyles.closeBtn} onClick={onClose} aria-label="Close">✕</button>
        </div>
        {error && <p style={modalStyles.error}>{error}</p>}
        <form onSubmit={handleSubmit} style={modalStyles.form}>
          <label style={modalStyles.label}>
            {t('purchaseOrders.form.poNumber')} <RequiredMark />
            <input style={modalStyles.input} required maxLength={100} value={poNumber}
              onChange={e => setPoNumber(e.target.value)} />
          </label>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 12px' }}>
            <label style={modalStyles.label}>
              {t('purchaseOrders.form.vendor')}
              <select style={modalStyles.select} value={vendorId} onChange={e => setVendorId(e.target.value)}>
                <option value="">{t('purchaseOrders.form.selectVendor')}</option>
                {(vendorsQ.data ?? []).map(v => <option key={v.id} value={String(v.id)}>{v.name}</option>)}
              </select>
            </label>
            <label style={modalStyles.label}>
              {t('purchaseOrders.form.warehouse')}
              <select style={modalStyles.select} value={warehouseId} onChange={e => setWarehouseId(e.target.value)}>
                <option value="">{t('purchaseOrders.form.selectWarehouse')}</option>
                {(warehousesQ.data ?? []).map(w => <option key={w.id} value={String(w.id)}>{w.name}</option>)}
              </select>
            </label>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 12px' }}>
            <label style={modalStyles.label}>
              {t('purchaseOrders.form.orderDate')}
              <input style={modalStyles.input} type="date" value={orderDate} onChange={e => setOrderDate(e.target.value)} />
            </label>
            <label style={modalStyles.label}>
              {t('purchaseOrders.form.expectedDate')}
              <input style={modalStyles.input} type="date" value={expectedDate} onChange={e => setExpectedDate(e.target.value)} />
            </label>
          </div>

          <label style={modalStyles.label}>
            {t('purchaseOrders.form.reference')}
            <input style={modalStyles.input} maxLength={255} value={reference} onChange={e => setReference(e.target.value)} />
          </label>

          <label style={modalStyles.label}>
            {t('purchaseOrders.form.notes')}
            <textarea style={{ ...modalStyles.input, minHeight: 60, resize: 'vertical' as const }} value={notes}
              onChange={e => setNotes(e.target.value)} />
          </label>

          <div style={modalStyles.actions}>
            <button type="button" onClick={onClose} style={styles.btnSecondary} disabled={mutation.isPending}>
              {t('purchaseOrders.actions.cancel')}
            </button>
            <button type="submit" style={styles.btnPrimary} disabled={mutation.isPending}>
              {mutation.isPending ? t('purchaseOrders.actions.creating') : t('purchaseOrders.actions.create')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Confirm dialog
// ---------------------------------------------------------------------------

type Confirmable = { type: 'delete'; id: number; label: string };

function ConfirmDialog({ message, onConfirm, onCancel }: { message: string; onConfirm: () => void; onCancel: () => void }) {
  const { t } = useTranslation();
  return (
    <div style={modalStyles.backdrop} onClick={onCancel}>
      <div style={{ ...modalStyles.panel, maxWidth: 380 }} onClick={e => e.stopPropagation()} role="alertdialog" aria-label="Confirm">
        <p style={{ margin: '0 0 1.25rem', fontSize: '0.95rem', color: 'var(--text-primary)' }}>{message}</p>
        <div style={modalStyles.actions}>
          <button onClick={onCancel} style={styles.btnSecondary}>{t('purchaseOrders.actions.cancel')}</button>
          <button onClick={onConfirm} style={styles.btnDanger}>{t('purchaseOrders.actions.delete')}</button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export function PurchaseOrderList() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [statusFilter, setStatusFilter] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [confirm, setConfirm] = useState<Confirmable | null>(null);

  const poQ = useQuery({
    queryKey: ['purchaseOrderList', page, pageSize, statusFilter],
    queryFn: () => fetchPurchaseOrders(page, pageSize, statusFilter),
    placeholderData: (prev: PurchaseOrderListResponse | undefined) => prev,
  });

  const vendorsQ = useQuery({ queryKey: ['vendors-lookup'], queryFn: fetchVendors, staleTime: 60_000 });
  const warehousesQ = useQuery({ queryKey: ['warehouses-lookup'], queryFn: fetchWarehouses, staleTime: 60_000 });
  const vendorName = (id: number | null) => (id ? (vendorsQ.data ?? []).find(v => v.id === id)?.name ?? `#${id}` : '—');
  const warehouseName = (id: number | null) => (id ? (warehousesQ.data ?? []).find(w => w.id === id)?.name ?? `#${id}` : '—');

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deletePurchaseOrder(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['purchaseOrderList'] }),
    onError: (err: unknown) => alert(err instanceof Error ? err.message : t('purchaseOrders.deleteFailed')),
  });

  const pos = poQ.data?.data ?? [];

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.pageTitle}>📑 {t('purchaseOrders.title')}</h1>
        {poQ.data && <span style={styles.countBadge}>{poQ.data.meta.total} {t('purchaseOrders.total')}</span>}
        <button style={{ ...styles.btnPrimary, marginLeft: 'auto' }} onClick={() => setShowNew(true)}>
          + {t('purchaseOrders.newPo')}
        </button>
      </div>

      <div style={styles.filterRow}>
        <label style={styles.filterLabel}>{t('purchaseOrders.filters.status')}</label>
        <select style={styles.filterSelect} value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(1); }}>
          <option value="">{t('purchaseOrders.filters.all')}</option>
          {STATUSES.map(s => <option key={s} value={s}>{capitalize(s)}</option>)}
        </select>
      </div>

      <div style={styles.tableCard}>
        {poQ.isLoading ? (
          <p style={styles.msg}>{t('purchaseOrders.loading')}</p>
        ) : poQ.isError ? (
          <p style={styles.msgError}>{t('purchaseOrders.loadError')}</p>
        ) : pos.length === 0 ? (
          <p style={styles.msg}>{t('purchaseOrders.noItems')}</p>
        ) : (
          <>
            <div style={{ overflowX: 'auto' }}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    {[
                      t('purchaseOrders.table.poNumber'), t('purchaseOrders.table.vendor'), t('purchaseOrders.table.warehouse'),
                      t('purchaseOrders.table.orderDate'), t('purchaseOrders.table.total'), t('purchaseOrders.table.status'),
                      t('purchaseOrders.table.actions'),
                    ].map(h => <th key={h} style={styles.th}>{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {pos.map(po => (
                    <tr key={po.id} style={styles.tr}>
                      <td style={{ ...styles.td, fontWeight: 600 }}>
                        <Link to={`/purchase-orders/${po.id}`} style={{ color: 'var(--link)', textDecoration: 'none', fontWeight: 600 }}>
                          {po.po_number}
                        </Link>
                      </td>
                      <td style={styles.td}>{vendorName(po.vendor_id)}</td>
                      <td style={styles.td}>{warehouseName(po.warehouse_id)}</td>
                      <td style={styles.td}>{fmtDate(po.order_date)}</td>
                      <td style={styles.td}>{fmtMoney(po.total, po.currency ?? 'MXN')}</td>
                      <td style={styles.td}><StatusBadge status={po.status} /></td>
                      <td style={{ ...styles.td, whiteSpace: 'nowrap' }}>
                        {po.status === 'draft' && (
                          <button
                            style={{ ...styles.actionBtn, color: '#991b1b' }}
                            onClick={() => setConfirm({ type: 'delete', id: po.id, label: po.po_number })}
                          >
                            {t('purchaseOrders.actions.delete')}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <Pagination
              page={page}
              totalPages={poQ.data?.meta.totalPages ?? 1}
              total={poQ.data?.meta.total}
              pageSize={pageSize}
              onPageChange={setPage}
              onPageSizeChange={(size) => { setPageSize(size); setPage(1); }}
            />
          </>
        )}
      </div>

      {showNew && (
        <NewPoModal
          onClose={() => setShowNew(false)}
          onCreated={(po) => {
            qc.invalidateQueries({ queryKey: ['purchaseOrderList'] });
            setShowNew(false);
            navigate(`/purchase-orders/${po.id}`);
          }}
        />
      )}

      {confirm && (
        <ConfirmDialog
          message={t('purchaseOrders.deleteConfirmMessage', { number: confirm.label })}
          onConfirm={() => { deleteMutation.mutate(confirm.id); setConfirm(null); }}
          onCancel={() => setConfirm(null)}
        />
      )}
    </div>
  );
}
