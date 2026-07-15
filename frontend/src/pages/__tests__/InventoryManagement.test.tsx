// =============================================================================
// FireISP 5.0 — InventoryManagement page tests (§14.2 — Inventory Phase 1)
// =============================================================================
// Regression coverage for two crash/silent-hide bugs fixed in this PR:
//   1. The Purchase Orders tab read item.total_amount (schema column is
//      `total`) — formatCurrency(undefined) threw a TypeError, crashing the
//      whole tab render for any org with a real PO.
//   2. The Assets tab read item.warranty_expires (schema column is
//      `warranty_expires_at`) — didn't crash, but silently always rendered
//      '—' instead of the real warranty date.
// =============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { InventoryManagement } from '../InventoryManagement';

const mockApiGet = vi.fn();
vi.mock('@/api/client', () => ({
  api: { GET: (...a: unknown[]) => mockApiGet(...a) },
  tokenStore: { getAccess: () => 'tok', setAccess: vi.fn(), getRefresh: () => null, setRefresh: vi.fn(), clear: vi.fn() },
}));

const realPo = {
  id: 1, po_number: 'PO-2026-0001', vendor_id: 1, order_date: '2026-01-01',
  expected_date: '2026-01-15', total: '1160.00', status: 'received',
};
const realAsset = {
  id: 1, asset_tag: 'AST-001', serial_number: 'SN12345', name: 'MikroTik hAP',
  category: 'router', lifecycle_status: 'active', warranty_expires_at: '2027-06-01',
  assigned_to_client_id: null,
};

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <InventoryManagement />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockApiGet.mockImplementation((path: string) => {
    if (path === '/purchase-orders')
      return Promise.resolve({ data: { data: [realPo], meta: { total: 1, page: 1, limit: 25 } }, error: undefined });
    if (path === '/assets')
      return Promise.resolve({ data: { data: [realAsset], meta: { total: 1, page: 1, limit: 25, totalPages: 1 } }, error: undefined });
    return Promise.resolve({ data: { data: [], meta: { total: 0, page: 1, limit: 25 } }, error: undefined });
  });
});

describe('InventoryManagement page — Purchase Orders tab crash fix', () => {
  it('renders a real PO row with a formatted total instead of crashing', async () => {
    renderPage();
    fireEvent.click(screen.getByRole('tab', { name: /Purchase Orders/ }));

    await waitFor(() => expect(screen.getByText('PO-2026-0001')).toBeInTheDocument());
    // Was undefined.toLocaleString() -> TypeError before the total_amount ->
    // total column-name fix; now renders the formatted DECIMAL string.
    expect(screen.getByText('1,160.00')).toBeInTheDocument();
  });
});

// =============================================================================
// Stock tab — quantity_on_hand (Inventory follow-up). Previously GET
// /inventory/items never included this field at all (a bare SELECT * on
// inventory_items), so the column always rendered "—" and the low-stock
// banner never fired. Now it's a SUM() aggregate, which mysql2 returns as a
// STRING — fetchInventoryItems must normalize it to a real number.
// =============================================================================
const lowStockItem = {
  id: 5, name: 'ONU Splitter', sku: 'SPL-1', category: 'other',
  quantity_on_hand: '2', reorder_level: 5, unit_cost: '10.00', status: 'active',
};
const healthyItem = {
  id: 6, name: 'CAT6 Cable Roll', sku: 'CBL-1', category: 'cable',
  quantity_on_hand: 40, reorder_level: 10, unit_cost: '25.00', status: 'active',
};

describe('InventoryManagement page — Stock tab quantity_on_hand', () => {
  beforeEach(() => {
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/inventory/items')
        return Promise.resolve({ data: { data: [lowStockItem, healthyItem], meta: { total: 2, page: 1, limit: 25, totalPages: 1 } }, error: undefined });
      return Promise.resolve({ data: { data: [], meta: { total: 0, page: 1, limit: 25 } }, error: undefined });
    });
  });

  it('renders the real quantity_on_hand (normalized from a string) instead of always showing —', async () => {
    renderPage();
    // "ONU Splitter" appears BOTH in the low-stock banner and its own table
    // row — getByText would be ambiguous, so wait on the table cell instead.
    await waitFor(() => expect(screen.getByText('SPL-1')).toBeInTheDocument());
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('40')).toBeInTheDocument();
  });

  it('surfaces the low-stock banner once quantity_on_hand is a real number', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText(/Low Stock/i)).toBeInTheDocument());
    expect(screen.getAllByText('ONU Splitter').length).toBeGreaterThan(0);
  });
});

describe('InventoryManagement page — Assets tab warranty column fix', () => {
  it('renders the real warranty_expires_at date instead of always showing —', async () => {
    renderPage();
    fireEvent.click(screen.getByRole('tab', { name: 'Assets' }));

    await waitFor(() => expect(screen.getByText('MikroTik hAP')).toBeInTheDocument());
    expect(screen.getByText('2027-06-01')).toBeInTheDocument();
  });
});

// =============================================================================
// Movements tab (Inventory Phase 2, §14.2) — the ledger has always been
// write-only; this is the first UI that can ever read it back.
// =============================================================================
const movementRow = {
  id: 900, stock_id: 55, transaction_type: 'sell_to_client', quantity: 2,
  unit_price: '500.00', reference: 'INV-000005', performed_by: 1,
  created_at: '2026-07-01T12:00:00Z', item_name: 'MikroTik hAP', item_sku: 'RB-1',
  warehouse_name: 'Main Warehouse',
};

describe('InventoryManagement page — Movements tab', () => {
  beforeEach(() => {
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/inventory/transactions')
        return Promise.resolve({ data: { data: [movementRow], meta: { total: 1, limit: 25, offset: 0 } }, error: undefined });
      if (path === '/inventory/items')
        return Promise.resolve({ data: { data: [{ id: 7, name: 'MikroTik hAP', sku: 'RB-1' }], meta: { total: 1, page: 1, limit: 500 } }, error: undefined });
      return Promise.resolve({ data: { data: [], meta: { total: 0, page: 1, limit: 25 } }, error: undefined });
    });
  });

  it('renders ledger rows enriched with item/warehouse names', async () => {
    renderPage();
    fireEvent.click(screen.getByRole('tab', { name: 'Movements' }));

    // 'INV-000005' (the reference) only ever comes from the loaded ledger
    // row — unlike 'sell_to_client', it can't false-positive-match the
    // static transaction-type filter's <option> list.
    await waitFor(() => expect(screen.getByText('INV-000005')).toBeInTheDocument());
    expect(screen.getByText('MikroTik hAP')).toBeInTheDocument();
    expect(screen.getByText('(RB-1)')).toBeInTheDocument();
    expect(screen.getByText('Main Warehouse')).toBeInTheDocument();
  });

  it('re-queries with the item filter applied', async () => {
    renderPage();
    fireEvent.click(screen.getByRole('tab', { name: 'Movements' }));
    await waitFor(() => expect(screen.getByText('INV-000005')).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText('Item'), { target: { value: '7' } });

    await waitFor(() => expect(mockApiGet).toHaveBeenCalledWith(
      '/inventory/transactions',
      expect.objectContaining({ params: { query: expect.objectContaining({ item_id: 7 }) } }),
    ));
  });
});
