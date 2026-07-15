// =============================================================================
// FireISP 5.0 — Inventory & Asset Management (§14)
// =============================================================================
// Tabbed page covering:
//   1. Stock           — inventory items + low-stock alerts
//   2. Assets          — asset lifecycle tracking (barcode, serial, warranty)
//   3. Vendors         — vendor CRUD
//   4. Purchase Orders — PO list with status
//   5. RMA             — return merchandise authorisation requests
//   6. Movements       — inventory_transactions ledger, read-only (Inventory
//                        Phase 2, §14.2) — the ledger has always been
//                        write-only (POST /inventory/transactions,
//                        purchase-order receive, sale drawdown) until now.
// =============================================================================

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';
import { styles } from './crudStyles';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface InventoryItem {
  id: number;
  name: string;
  sku: string | null;
  category: string | null;
  // quantity_on_hand lives in inventory_stock (separate table); the /inventory/items
  // endpoint (SELECT * on inventory_items) does not include it. Typed as optional
  // so renders show '—' rather than undefined when absent.
  quantity_on_hand?: number | null;
  reorder_level: number | null;
  unit_cost: number | null;
  status: string;
}

interface Asset {
  id: number;
  asset_tag: string | null;
  serial_number: string | null;
  name: string;
  category: string | null;
  lifecycle_status: string;
  warranty_expires_at: string | null;
  assigned_to_client_id: number | null;
}

interface Vendor {
  id: number;
  name: string;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  payment_terms: string | null;
  currency: string | null;
  status: string;
}

interface PurchaseOrder {
  id: number;
  po_number: string;
  vendor_id: number | null;
  order_date: string | null;
  expected_date: string | null;
  total: string | null;
  status: string;
}

interface RmaRequest {
  id: number;
  rma_number: string;
  asset_id: number | null;
  reason: string | null;
  status: string;
  created_at: string;
}

interface InventoryTransaction {
  id: number;
  stock_id: number;
  transaction_type: string;
  quantity: number;
  unit_price: string | null;
  reference: string | null;
  performed_by: number | null;
  created_at: string;
  item_name: string;
  item_sku: string | null;
  warehouse_name: string;
}

interface InventoryItemOption {
  id: number;
  name: string;
  sku: string | null;
}

interface ListResponse<T> {
  data: T[];
  meta: { total: number; page: number; limit: number; totalPages?: number };
}

interface LedgerResponse<T> {
  data: T[];
  meta: { total: number; limit: number; offset: number };
}

const TRANSACTION_TYPES = ['receive', 'assign_to_job', 'sell_to_client', 'transfer_out', 'transfer_in', 'return', 'adjustment'];

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PAGE_SIZE = 25;

// ---------------------------------------------------------------------------
// Tab styling helper
// ---------------------------------------------------------------------------

const tabBtn = (active: boolean): React.CSSProperties => ({
  padding: '0.4rem 1rem',
  border: 'none',
  borderBottom: active ? '2px solid var(--primary)' : '2px solid transparent',
  background: 'transparent',
  cursor: 'pointer',
  fontWeight: active ? 700 : 400,
  color: active ? 'var(--primary)' : 'var(--text-secondary)',
});

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

async function fetchInventoryItems(page: number): Promise<ListResponse<InventoryItem>> {
  const res = await api.GET('/inventory/items' as never, {
    params: { query: { page, limit: PAGE_SIZE } as never },
  } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to load inventory items');
  return (res as { data: unknown }).data as unknown as ListResponse<InventoryItem>;
}

async function fetchAssets(page: number): Promise<ListResponse<Asset>> {
  const res = await api.GET('/assets' as never, {
    params: { query: { page, limit: PAGE_SIZE } as never },
  } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to load assets');
  return (res as { data: unknown }).data as unknown as ListResponse<Asset>;
}

async function fetchVendors(page: number): Promise<ListResponse<Vendor>> {
  const res = await api.GET('/vendors' as never, {
    params: { query: { page, limit: PAGE_SIZE } as never },
  } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to load vendors');
  return (res as { data: unknown }).data as unknown as ListResponse<Vendor>;
}

async function fetchPurchaseOrders(page: number): Promise<ListResponse<PurchaseOrder>> {
  const res = await api.GET('/purchase-orders' as never, {
    params: { query: { page, limit: PAGE_SIZE } as never },
  } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to load purchase orders');
  return (res as { data: unknown }).data as unknown as ListResponse<PurchaseOrder>;
}

async function fetchRmaRequests(page: number): Promise<ListResponse<RmaRequest>> {
  const res = await api.GET('/rma-requests' as never, {
    params: { query: { page, limit: PAGE_SIZE } as never },
  } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to load RMA requests');
  return (res as { data: unknown }).data as unknown as ListResponse<RmaRequest>;
}

async function fetchInventoryTransactions(
  offset: number,
  itemId: string,
  transactionType: string,
): Promise<LedgerResponse<InventoryTransaction>> {
  const query: Record<string, unknown> = { limit: PAGE_SIZE, offset };
  if (itemId) query.item_id = Number(itemId);
  if (transactionType) query.transaction_type = transactionType;
  const res = await api.GET('/inventory/transactions' as never, { params: { query } as never } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to load inventory movements');
  return (res as { data: unknown }).data as unknown as LedgerResponse<InventoryTransaction>;
}

// Minimal item list for the Movements tab's filter dropdown — reuses the
// same endpoint the Stock tab does, but only the fields the filter needs.
async function fetchInventoryItemOptions(): Promise<InventoryItemOption[]> {
  const res = await api.GET('/inventory/items' as never, {
    params: { query: { page: 1, limit: 500 } as never },
  } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to load inventory items');
  const body = (res as { data: unknown }).data as unknown as ListResponse<InventoryItemOption>;
  return body.data;
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export function InventoryManagement() {
  const { t } = useTranslation();

  type Tab = 'stock' | 'assets' | 'vendors' | 'purchaseOrders' | 'rma' | 'movements';
  const [tab, setTab] = useState<Tab>('stock');

  // Stock tab
  const [stockPage, setStockPage] = useState(1);
  const stockQ = useQuery({
    queryKey: ['inventory', 'stock', stockPage],
    queryFn: () => fetchInventoryItems(stockPage),
    enabled: tab === 'stock',
  });
  const stockTotalPages = Math.ceil((stockQ.data?.meta.total ?? 0) / PAGE_SIZE) || 1;

  // Assets tab
  const [assetsPage, setAssetsPage] = useState(1);
  const assetsQ = useQuery({
    queryKey: ['inventory', 'assets', assetsPage],
    queryFn: () => fetchAssets(assetsPage),
    enabled: tab === 'assets',
  });
  const assetsTotalPages = assetsQ.data?.meta.totalPages ?? (Math.ceil((assetsQ.data?.meta.total ?? 0) / PAGE_SIZE) || 1);

  // Vendors tab
  const [vendorsPage, setVendorsPage] = useState(1);
  const vendorsQ = useQuery({
    queryKey: ['inventory', 'vendors', vendorsPage],
    queryFn: () => fetchVendors(vendorsPage),
    enabled: tab === 'vendors',
  });
  const vendorsTotalPages = Math.ceil((vendorsQ.data?.meta.total ?? 0) / PAGE_SIZE) || 1;

  // Purchase Orders tab
  const [poPage, setPoPage] = useState(1);
  const poQ = useQuery({
    queryKey: ['inventory', 'purchaseOrders', poPage],
    queryFn: () => fetchPurchaseOrders(poPage),
    enabled: tab === 'purchaseOrders',
  });
  const poTotalPages = Math.ceil((poQ.data?.meta.total ?? 0) / PAGE_SIZE) || 1;

  // RMA tab
  const [rmaPage, setRmaPage] = useState(1);
  const rmaQ = useQuery({
    queryKey: ['inventory', 'rma', rmaPage],
    queryFn: () => fetchRmaRequests(rmaPage),
    enabled: tab === 'rma',
  });
  const rmaTotalPages = Math.ceil((rmaQ.data?.meta.total ?? 0) / PAGE_SIZE) || 1;

  // Movements tab
  const [movementsPage, setMovementsPage] = useState(1);
  const [movementsItemFilter, setMovementsItemFilter] = useState('');
  const [movementsTypeFilter, setMovementsTypeFilter] = useState('');
  const movementsQ = useQuery({
    queryKey: ['inventory', 'movements', movementsPage, movementsItemFilter, movementsTypeFilter],
    queryFn: () => fetchInventoryTransactions((movementsPage - 1) * PAGE_SIZE, movementsItemFilter, movementsTypeFilter),
    enabled: tab === 'movements',
  });
  const movementsTotalPages = Math.ceil((movementsQ.data?.meta.total ?? 0) / PAGE_SIZE) || 1;
  const movementsItemsQ = useQuery({
    queryKey: ['inventory', 'movementsItemOptions'],
    queryFn: fetchInventoryItemOptions,
    enabled: tab === 'movements',
  });

  // ---------------------------------------------------------------------------
  // Render helpers
  // ---------------------------------------------------------------------------

  function statusBadge(status: string, activeColor = '#059669') {
    return (
      <span style={{ color: status === 'active' ? activeColor : '#6b7280', fontWeight: 600, fontSize: '0.82rem' }}>
        {status}
      </span>
    );
  }

  function lowStockColor(qty: number | null | undefined, reorder: number | null) {
    if (qty != null && reorder !== null && qty <= reorder) return '#dc2626';
    return 'inherit';
  }

  function formatCurrency(amount: string | number | null | undefined) {
    // purchase_orders.total is a DECIMAL column — mysql2 returns DECIMAL values
    // as strings, not numbers, so this must parse before formatting. Guards
    // both null (never fetched) and undefined (field absent) — the previous
    // version only guarded null and crashed on undefined with a TypeError.
    if (amount === null || amount === undefined) return '—';
    const num = typeof amount === 'string' ? parseFloat(amount) : amount;
    if (Number.isNaN(num)) return '—';
    return num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function formatDate(d: string | null) {
    if (!d) return '—';
    return d.slice(0, 10);
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div style={styles.page}>
      {/* Page header */}
      <div style={styles.header}>
        <h1 style={styles.pageTitle}>{t('inventoryManagement.title')}</h1>
      </div>

      {/* Tab bar */}
      <div
        role="tablist"
        aria-label={t('inventoryManagement.title')}
        style={{ borderBottom: '1px solid var(--border)', marginBottom: '1.5rem', display: 'flex', gap: '0.25rem' }}
      >
        {(['stock', 'assets', 'vendors', 'purchaseOrders', 'rma', 'movements'] as const).map(tabId => (
          <button
            key={tabId}
            role="tab"
            id={`tab-${tabId}`}
            aria-selected={tab === tabId}
            aria-controls={`tabpanel-${tabId}`}
            style={tabBtn(tab === tabId)}
            onClick={() => setTab(tabId)}
          >
            {t(`inventoryManagement.tabs.${tabId}`)}
          </button>
        ))}
      </div>

      {/* ================================================================ */}
      {/* TAB: Stock                                                        */}
      {/* ================================================================ */}
      {tab === 'stock' && (
        <div
          role="tabpanel"
          id="tabpanel-stock"
          aria-labelledby="tab-stock"
        >
          {stockQ.isLoading && <p style={styles.msg}>{t('inventoryManagement.loading')}</p>}
          {stockQ.isError && <p style={styles.msgError}>{t('inventoryManagement.loadError')}</p>}

          {/* Low-stock alert banner */}
          {stockQ.data && (() => {
            const lowItems = stockQ.data.data.filter(
              i => i.reorder_level !== null && i.quantity_on_hand != null && i.quantity_on_hand <= i.reorder_level,
            );
            return lowItems.length > 0 ? (
              <div style={{ background: '#fef3c7', border: '1px solid #fbbf24', borderRadius: 6, padding: '0.75rem 1rem', marginBottom: '1rem', fontSize: '0.875rem', color: '#92400e' }}>
                <strong>{t('inventoryManagement.stock.lowStock')}:</strong>{' '}
                {lowItems.map(i => i.name).join(', ')}
              </div>
            ) : null;
          })()}

          {stockQ.data && (
            <>
              <div style={styles.tableCard}>
                <table style={styles.table}>
                  <thead>
                    <tr>
                      <th style={styles.thNum}>ID</th>
                      <th style={styles.th}>{t('inventoryManagement.stock.itemName')}</th>
                      <th style={styles.th}>{t('inventoryManagement.stock.sku')}</th>
                      <th style={styles.th}>{t('inventoryManagement.category')}</th>
                      <th style={styles.thNum}>{t('inventoryManagement.stock.currentStock')}</th>
                      <th style={styles.thNum}>{t('inventoryManagement.stock.reorderLevel')}</th>
                      <th style={styles.th}>{t('inventoryManagement.status')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stockQ.data.data.length === 0 && (
                      <tr><td colSpan={7} style={styles.msg}>{t('inventoryManagement.noItems')}</td></tr>
                    )}
                    {stockQ.data.data.map(item => (
                      <tr key={item.id} style={styles.tr}>
                        <td style={styles.tdNum}>{item.id}</td>
                        <td style={styles.td}><strong>{item.name}</strong></td>
                        <td style={styles.tdMono}>{item.sku ?? '—'}</td>
                        <td style={styles.td}>{item.category ?? '—'}</td>
                        <td style={styles.tdNum}>
                          <span style={{ color: lowStockColor(item.quantity_on_hand, item.reorder_level), fontWeight: 700 }}>
                            {item.quantity_on_hand != null ? item.quantity_on_hand : '—'}
                          </span>
                        </td>
                        <td style={styles.tdNum}>{item.reorder_level ?? '—'}</td>
                        <td style={styles.td}>{statusBadge(item.status)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={styles.pagination}>
                <button style={styles.pageBtn} onClick={() => setStockPage(p => Math.max(1, p - 1))} disabled={stockPage <= 1}>
                  &laquo; {t('inventoryManagement.prev')}
                </button>
                <span style={styles.pageInfo}>{stockPage} / {stockTotalPages}</span>
                <button style={styles.pageBtn} onClick={() => setStockPage(p => p + 1)} disabled={stockPage >= stockTotalPages}>
                  {t('inventoryManagement.next')} &raquo;
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* ================================================================ */}
      {/* TAB: Assets                                                       */}
      {/* ================================================================ */}
      {tab === 'assets' && (
        <div
          role="tabpanel"
          id="tabpanel-assets"
          aria-labelledby="tab-assets"
        >
          {assetsQ.isLoading && <p style={styles.msg}>{t('inventoryManagement.loading')}</p>}
          {assetsQ.isError && <p style={styles.msgError}>{t('inventoryManagement.loadError')}</p>}
          {assetsQ.data && (
            <>
              <div style={styles.tableCard}>
                <table style={styles.table}>
                  <thead>
                    <tr>
                      <th style={styles.thNum}>ID</th>
                      <th style={styles.th}>{t('inventoryManagement.assets.assetTag')}</th>
                      <th style={styles.th}>{t('inventoryManagement.assets.serialNumber')}</th>
                      <th style={styles.th}>{t('inventoryManagement.name')}</th>
                      <th style={styles.th}>{t('inventoryManagement.assets.category')}</th>
                      <th style={styles.th}>{t('inventoryManagement.assets.lifecycleStatus')}</th>
                      <th style={styles.th}>{t('inventoryManagement.assets.warrantyExpires')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {assetsQ.data.data.length === 0 && (
                      <tr><td colSpan={7} style={styles.msg}>{t('inventoryManagement.noItems')}</td></tr>
                    )}
                    {assetsQ.data.data.map(item => (
                      <tr key={item.id} style={styles.tr}>
                        <td style={styles.tdNum}>{item.id}</td>
                        <td style={styles.tdMono}>{item.asset_tag ?? '—'}</td>
                        <td style={styles.tdMono}>{item.serial_number ?? '—'}</td>
                        <td style={styles.td}><strong>{item.name}</strong></td>
                        <td style={styles.td}>{item.category ?? '—'}</td>
                        <td style={styles.td}>
                          <span style={{
                            color: item.lifecycle_status === 'active' ? '#059669'
                              : item.lifecycle_status === 'retired' ? '#dc2626'
                              : '#d97706',
                            fontWeight: 600,
                            fontSize: '0.82rem',
                          }}>
                            {item.lifecycle_status}
                          </span>
                        </td>
                        <td style={styles.td}>{formatDate(item.warranty_expires_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={styles.pagination}>
                <button style={styles.pageBtn} onClick={() => setAssetsPage(p => Math.max(1, p - 1))} disabled={assetsPage <= 1}>
                  &laquo; {t('inventoryManagement.prev')}
                </button>
                <span style={styles.pageInfo}>{assetsPage} / {assetsTotalPages}</span>
                <button style={styles.pageBtn} onClick={() => setAssetsPage(p => p + 1)} disabled={assetsPage >= assetsTotalPages}>
                  {t('inventoryManagement.next')} &raquo;
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* ================================================================ */}
      {/* TAB: Vendors                                                      */}
      {/* ================================================================ */}
      {tab === 'vendors' && (
        <div
          role="tabpanel"
          id="tabpanel-vendors"
          aria-labelledby="tab-vendors"
        >
          {vendorsQ.isLoading && <p style={styles.msg}>{t('inventoryManagement.loading')}</p>}
          {vendorsQ.isError && <p style={styles.msgError}>{t('inventoryManagement.loadError')}</p>}
          {vendorsQ.data && (
            <>
              <div style={styles.tableCard}>
                <table style={styles.table}>
                  <thead>
                    <tr>
                      <th style={styles.thNum}>ID</th>
                      <th style={styles.th}>{t('inventoryManagement.name')}</th>
                      <th style={styles.th}>{t('inventoryManagement.vendors.contactName')}</th>
                      <th style={styles.th}>{t('inventoryManagement.email')}</th>
                      <th style={styles.th}>{t('inventoryManagement.vendors.paymentTerms')}</th>
                      <th style={styles.th}>{t('inventoryManagement.vendors.currency')}</th>
                      <th style={styles.th}>{t('inventoryManagement.status')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {vendorsQ.data.data.length === 0 && (
                      <tr><td colSpan={7} style={styles.msg}>{t('inventoryManagement.noItems')}</td></tr>
                    )}
                    {vendorsQ.data.data.map(item => (
                      <tr key={item.id} style={styles.tr}>
                        <td style={styles.tdNum}>{item.id}</td>
                        <td style={styles.td}><strong>{item.name}</strong></td>
                        <td style={styles.td}>{item.contact_name ?? '—'}</td>
                        <td style={styles.td}>{item.email ?? '—'}</td>
                        <td style={styles.td}>{item.payment_terms ?? '—'}</td>
                        <td style={styles.td}>{item.currency ?? '—'}</td>
                        <td style={styles.td}>{statusBadge(item.status)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={styles.pagination}>
                <button style={styles.pageBtn} onClick={() => setVendorsPage(p => Math.max(1, p - 1))} disabled={vendorsPage <= 1}>
                  &laquo; {t('inventoryManagement.prev')}
                </button>
                <span style={styles.pageInfo}>{vendorsPage} / {vendorsTotalPages}</span>
                <button style={styles.pageBtn} onClick={() => setVendorsPage(p => p + 1)} disabled={vendorsPage >= vendorsTotalPages}>
                  {t('inventoryManagement.next')} &raquo;
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* ================================================================ */}
      {/* TAB: Purchase Orders                                              */}
      {/* ================================================================ */}
      {tab === 'purchaseOrders' && (
        <div
          role="tabpanel"
          id="tabpanel-purchaseOrders"
          aria-labelledby="tab-purchaseOrders"
        >
          {poQ.isLoading && <p style={styles.msg}>{t('inventoryManagement.loading')}</p>}
          {poQ.isError && <p style={styles.msgError}>{t('inventoryManagement.loadError')}</p>}
          {poQ.data && (
            <>
              <div style={styles.tableCard}>
                <table style={styles.table}>
                  <thead>
                    <tr>
                      <th style={styles.thNum}>ID</th>
                      <th style={styles.th}>{t('inventoryManagement.purchaseOrders.poNumber')}</th>
                      <th style={styles.th}>{t('inventoryManagement.purchaseOrders.orderDate')}</th>
                      <th style={styles.th}>{t('inventoryManagement.purchaseOrders.expectedDate')}</th>
                      <th style={styles.thNum}>{t('inventoryManagement.purchaseOrders.total')}</th>
                      <th style={styles.th}>{t('inventoryManagement.status')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {poQ.data.data.length === 0 && (
                      <tr><td colSpan={6} style={styles.msg}>{t('inventoryManagement.noItems')}</td></tr>
                    )}
                    {poQ.data.data.map(item => (
                      <tr key={item.id} style={styles.tr}>
                        <td style={styles.tdNum}>{item.id}</td>
                        <td style={styles.td}><strong>{item.po_number}</strong></td>
                        <td style={styles.td}>{formatDate(item.order_date)}</td>
                        <td style={styles.td}>{formatDate(item.expected_date)}</td>
                        <td style={styles.tdNum}>{formatCurrency(item.total)}</td>
                        <td style={styles.td}>
                          <span style={{
                            color: item.status === 'received' ? '#059669'
                              : item.status === 'cancelled' ? '#dc2626'
                              : item.status === 'pending' ? '#d97706'
                              : '#6b7280',
                            fontWeight: 600,
                            fontSize: '0.82rem',
                          }}>
                            {item.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={styles.pagination}>
                <button style={styles.pageBtn} onClick={() => setPoPage(p => Math.max(1, p - 1))} disabled={poPage <= 1}>
                  &laquo; {t('inventoryManagement.prev')}
                </button>
                <span style={styles.pageInfo}>{poPage} / {poTotalPages}</span>
                <button style={styles.pageBtn} onClick={() => setPoPage(p => p + 1)} disabled={poPage >= poTotalPages}>
                  {t('inventoryManagement.next')} &raquo;
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* ================================================================ */}
      {/* TAB: RMA                                                          */}
      {/* ================================================================ */}
      {tab === 'rma' && (
        <div
          role="tabpanel"
          id="tabpanel-rma"
          aria-labelledby="tab-rma"
        >
          {rmaQ.isLoading && <p style={styles.msg}>{t('inventoryManagement.loading')}</p>}
          {rmaQ.isError && <p style={styles.msgError}>{t('inventoryManagement.loadError')}</p>}
          {rmaQ.data && (
            <>
              <div style={styles.tableCard}>
                <table style={styles.table}>
                  <thead>
                    <tr>
                      <th style={styles.thNum}>ID</th>
                      <th style={styles.th}>{t('inventoryManagement.rma.rmaNumber')}</th>
                      <th style={styles.th}>{t('inventoryManagement.rma.reason')}</th>
                      <th style={styles.th}>{t('inventoryManagement.rma.status')}</th>
                      <th style={styles.th}>{t('inventoryManagement.createdAt')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rmaQ.data.data.length === 0 && (
                      <tr><td colSpan={5} style={styles.msg}>{t('inventoryManagement.noItems')}</td></tr>
                    )}
                    {rmaQ.data.data.map(item => (
                      <tr key={item.id} style={styles.tr}>
                        <td style={styles.tdNum}>{item.id}</td>
                        <td style={styles.td}><strong>{item.rma_number}</strong></td>
                        <td style={styles.td}>{item.reason ?? '—'}</td>
                        <td style={styles.td}>
                          <span style={{
                            color: item.status === 'approved' ? '#059669'
                              : item.status === 'rejected' ? '#dc2626'
                              : '#d97706',
                            fontWeight: 600,
                            fontSize: '0.82rem',
                          }}>
                            {item.status}
                          </span>
                        </td>
                        <td style={styles.td}>{formatDate(item.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={styles.pagination}>
                <button style={styles.pageBtn} onClick={() => setRmaPage(p => Math.max(1, p - 1))} disabled={rmaPage <= 1}>
                  &laquo; {t('inventoryManagement.prev')}
                </button>
                <span style={styles.pageInfo}>{rmaPage} / {rmaTotalPages}</span>
                <button style={styles.pageBtn} onClick={() => setRmaPage(p => p + 1)} disabled={rmaPage >= rmaTotalPages}>
                  {t('inventoryManagement.next')} &raquo;
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* ================================================================ */}
      {/* TAB: Movements                                                    */}
      {/* ================================================================ */}
      {tab === 'movements' && (
        <div
          role="tabpanel"
          id="tabpanel-movements"
          aria-labelledby="tab-movements"
        >
          <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div>
              <label htmlFor="movements-item-filter" style={{ display: 'block', fontSize: '0.78rem', color: 'var(--text-secondary)', marginBottom: 4 }}>
                {t('inventoryManagement.movements.filterItem')}
              </label>
              <select
                id="movements-item-filter"
                value={movementsItemFilter}
                onChange={e => { setMovementsItemFilter(e.target.value); setMovementsPage(1); }}
                style={{ padding: '0.4rem 0.6rem', borderRadius: 4, border: '1px solid var(--border)', fontSize: '0.85rem' }}
              >
                <option value="">{t('inventoryManagement.movements.filterAllItems')}</option>
                {(movementsItemsQ.data ?? []).map(i => (
                  <option key={i.id} value={String(i.id)}>{i.name}{i.sku ? ` (${i.sku})` : ''}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="movements-type-filter" style={{ display: 'block', fontSize: '0.78rem', color: 'var(--text-secondary)', marginBottom: 4 }}>
                {t('inventoryManagement.movements.filterType')}
              </label>
              <select
                id="movements-type-filter"
                value={movementsTypeFilter}
                onChange={e => { setMovementsTypeFilter(e.target.value); setMovementsPage(1); }}
                style={{ padding: '0.4rem 0.6rem', borderRadius: 4, border: '1px solid var(--border)', fontSize: '0.85rem' }}
              >
                <option value="">{t('inventoryManagement.movements.filterAllTypes')}</option>
                {TRANSACTION_TYPES.map(tt => (
                  <option key={tt} value={tt}>{tt}</option>
                ))}
              </select>
            </div>
          </div>

          {movementsQ.isLoading && <p style={styles.msg}>{t('inventoryManagement.loading')}</p>}
          {movementsQ.isError && <p style={styles.msgError}>{t('inventoryManagement.loadError')}</p>}
          {movementsQ.data && (
            <>
              <div style={styles.tableCard}>
                <table style={styles.table}>
                  <thead>
                    <tr>
                      <th style={styles.th}>{t('inventoryManagement.movements.date')}</th>
                      <th style={styles.th}>{t('inventoryManagement.movements.type')}</th>
                      <th style={styles.th}>{t('inventoryManagement.movements.item')}</th>
                      <th style={styles.th}>{t('inventoryManagement.movements.warehouse')}</th>
                      <th style={styles.thNum}>{t('inventoryManagement.movements.qty')}</th>
                      <th style={styles.th}>{t('inventoryManagement.movements.reference')}</th>
                      <th style={styles.th}>{t('inventoryManagement.movements.performedBy')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {movementsQ.data.data.length === 0 && (
                      <tr><td colSpan={7} style={styles.msg}>{t('inventoryManagement.movements.noRows')}</td></tr>
                    )}
                    {movementsQ.data.data.map(row => (
                      <tr key={row.id} style={styles.tr}>
                        <td style={styles.td}>{formatDate(row.created_at)}</td>
                        <td style={styles.td}>{row.transaction_type}</td>
                        <td style={styles.td}>
                          <strong>{row.item_name}</strong>
                          {row.item_sku && <span style={{ color: 'var(--text-secondary)' }}> ({row.item_sku})</span>}
                        </td>
                        <td style={styles.td}>{row.warehouse_name}</td>
                        <td style={styles.tdNum}>{row.quantity}</td>
                        <td style={styles.td}>{row.reference ?? '—'}</td>
                        <td style={styles.td}>{row.performed_by ? `#${row.performed_by}` : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={styles.pagination}>
                <button style={styles.pageBtn} onClick={() => setMovementsPage(p => Math.max(1, p - 1))} disabled={movementsPage <= 1}>
                  &laquo; {t('inventoryManagement.prev')}
                </button>
                <span style={styles.pageInfo}>{movementsPage} / {movementsTotalPages}</span>
                <button style={styles.pageBtn} onClick={() => setMovementsPage(p => p + 1)} disabled={movementsPage >= movementsTotalPages}>
                  {t('inventoryManagement.next')} &raquo;
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
