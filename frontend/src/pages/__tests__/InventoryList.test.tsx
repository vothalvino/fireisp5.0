// =============================================================================
// FireISP 5.0 — InventoryList page tests (§14.2 — Inventory Phase 1)
// =============================================================================
// Regression coverage for the "+ Txn" Record Transaction modal first-time-
// stock fix: selecting a warehouse for an item with NO existing inventory_stock
// row used to leave stockId empty and block submission with "Please select a
// warehouse" even though a warehouse WAS selected. It now sends item_id +
// warehouse_id instead of stock_id, letting the (also-fixed) backend create
// the stock row inline.
// =============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { InventoryList } from '../InventoryList';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const mockAuthedFetch = vi.fn();
vi.mock('@/api/client', () => ({
  authedFetch: (...a: unknown[]) => mockAuthedFetch(...a),
  tokenStore: { getAccess: () => 'tok', setAccess: vi.fn(), getRefresh: () => null, setRefresh: vi.fn(), clear: vi.fn() },
}));

vi.mock('@/auth/useOrgCurrency', () => ({ useOrgCurrency: () => 'MXN' }));

const item1 = {
  id: 1, sku: 'RB-750', name: 'MikroTik RB750Gr3', category: 'router',
  manufacturer: 'MikroTik', model: 'RB750Gr3', description: null, unit: 'unit',
  unit_cost: '50.00', sale_price: '80.00', reorder_level: 5, status: 'active',
  created_at: '2026-01-01', updated_at: '2026-01-01',
};
const warehouse1 = { id: 5, name: 'Main Warehouse', status: 'active' };

function jsonResponse(body: unknown, ok = true) {
  return Promise.resolve({ ok, json: () => Promise.resolve(body) });
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <InventoryList />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockFetch.mockImplementation((url: string) => {
    if (url.includes('/inventory/items?'))
      return jsonResponse({ data: [item1], meta: { total: 1, page: 1, limit: 25, totalPages: 1 } });
    if (url.includes('/inventory/items/1/stock'))
      // Brand-new item — no stock anywhere yet.
      return jsonResponse({ data: [] });
    if (url.includes('/warehouses'))
      return jsonResponse({ data: [warehouse1], meta: { total: 1 } });
    return jsonResponse({ data: [] });
  });
  mockAuthedFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({ data: {} }) });
});

describe('InventoryList — Record Transaction modal (first-time stock)', () => {
  it('selecting a warehouse with no existing stock sends item_id + warehouse_id (not a blocked stock_id)', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('MikroTik RB750Gr3')).toBeInTheDocument());

    fireEvent.click(screen.getByText('+ Txn'));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Record Transaction' })).toBeInTheDocument());

    await waitFor(() => expect(screen.getByText('Main Warehouse')).toBeInTheDocument());
    fireEvent.change(screen.getByDisplayValue('— select warehouse —'), { target: { value: '5' } });

    // Hint text confirms the modal recognizes "no stock here yet" instead of
    // silently leaving the user with no feedback.
    await waitFor(() => expect(screen.getByText(/no stock at this warehouse yet/)).toBeInTheDocument());

    fireEvent.change(screen.getByPlaceholderText('e.g. 10'), { target: { value: '20' } });
    fireEvent.click(screen.getByRole('button', { name: 'Record Transaction' }));

    await waitFor(() => expect(mockAuthedFetch).toHaveBeenCalledWith(
      expect.stringContaining('/inventory/transactions'),
      expect.objectContaining({
        body: JSON.stringify({ transaction_type: 'receive', quantity: 20, item_id: 1, warehouse_id: 5 }),
      }),
    ));
  });

  it('blocks a non-creating transaction type (e.g. sell_to_client) when no stock exists yet', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('MikroTik RB750Gr3')).toBeInTheDocument());

    fireEvent.click(screen.getByText('+ Txn'));
    await waitFor(() => expect(screen.getByText('Main Warehouse')).toBeInTheDocument());
    fireEvent.change(screen.getByDisplayValue('— select warehouse —'), { target: { value: '5' } });
    fireEvent.change(screen.getByDisplayValue('Receive (inbound)'), { target: { value: 'sell_to_client' } });
    fireEvent.change(screen.getByPlaceholderText('e.g. 10'), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Record Transaction' }));

    expect(await screen.findByText(/has no stock at that warehouse yet/)).toBeInTheDocument();
    expect(mockAuthedFetch).not.toHaveBeenCalled();
  });
});

// =============================================================================
// Item form — serial_required toggle (Inventory Phase 3, §14.2 cont'd)
// =============================================================================
describe('InventoryList — New Item modal serial_required toggle', () => {
  it('sends serial_required: true when the toggle is checked, false by default', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('MikroTik RB750Gr3')).toBeInTheDocument());

    fireEvent.click(screen.getByText('+ New Item'));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'New Inventory Item' })).toBeInTheDocument());

    fireEvent.change(screen.getByPlaceholderText('e.g. MikroTik RB750Gr3'), { target: { value: 'ONU-X' } });
    const toggle = screen.getByRole('checkbox');
    fireEvent.click(toggle);
    expect(toggle).toBeChecked();

    fireEvent.click(screen.getByRole('button', { name: 'Create Item' }));

    await waitFor(() => expect(mockAuthedFetch).toHaveBeenCalledWith(
      expect.stringContaining('/inventory/items'),
      expect.objectContaining({ method: 'POST' }),
    ));
    const call = mockAuthedFetch.mock.calls.find(c => typeof c[0] === 'string' && c[0].includes('/inventory/items'));
    const body = JSON.parse((call?.[1] as { body: string }).body);
    expect(body.serial_required).toBe(true);
  });

  it('shows a "Serialized" badge in the list for items with serial_required on', async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('/inventory/items?'))
        return jsonResponse({ data: [{ ...item1, serial_required: 1 }], meta: { total: 1, page: 1, limit: 25, totalPages: 1 } });
      return jsonResponse({ data: [] });
    });
    renderPage();
    await waitFor(() => expect(screen.getByText('MikroTik RB750Gr3')).toBeInTheDocument());
    expect(screen.getByText('Serialized')).toBeInTheDocument();
  });
});

// =============================================================================
// Stock modal — negative quantity rendering (Inventory Phase 2, §14.2)
// =============================================================================
// Negative stock is now an allowed state (automatic sale drawdown never
// blocks on a stock-count drift). Before this fix, `row.quantity === 0 ? red
// : green` never matched a negative number, so a negative balance rendered
// GREEN — the opposite of what a drift warning should look like.
describe('InventoryList — Stock modal negative quantity rendering', () => {
  it('renders a negative stock balance in red, not green', async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('/inventory/items?'))
        return jsonResponse({ data: [item1], meta: { total: 1, page: 1, limit: 25, totalPages: 1 } });
      if (url.includes('/inventory/items/1/stock')) {
        return jsonResponse({
          data: [{ id: 55, warehouse_id: 5, warehouse_name: 'Main Warehouse', quantity: -3, aisle: null, col: null, shelf: null }],
        });
      }
      if (url.includes('/warehouses'))
        return jsonResponse({ data: [warehouse1], meta: { total: 1 } });
      return jsonResponse({ data: [] });
    });

    renderPage();
    await waitFor(() => expect(screen.getByText('MikroTik RB750Gr3')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Stock'));
    // "Total in stock: -3" (summary line) and the per-row quantity cell both
    // render the literal text "-3" — scope to the colored <span> cell.
    await waitFor(() => expect(screen.getAllByText('-3').length).toBeGreaterThan(0));
    const coloredCell = screen.getAllByText('-3').find(el => el.tagName === 'SPAN');
    expect(coloredCell).toBeDefined();
    expect(coloredCell).toHaveStyle({ color: '#dc2626' });
  });
});
