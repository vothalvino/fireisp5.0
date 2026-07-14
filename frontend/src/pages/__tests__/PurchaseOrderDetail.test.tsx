// =============================================================================
// FireISP 5.0 — PurchaseOrderDetail page tests (§14.2 — Inventory Phase 1)
// =============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { PurchaseOrderDetail } from '../PurchaseOrderDetail';

const mockApiGet = vi.fn();
const mockApiPost = vi.fn();
const mockApiPut = vi.fn();
vi.mock('@/api/client', () => ({
  api: {
    GET: (...a: unknown[]) => mockApiGet(...a),
    POST: (...a: unknown[]) => mockApiPost(...a),
    PUT: (...a: unknown[]) => mockApiPut(...a),
  },
  tokenStore: { getAccess: () => 'tok', setAccess: vi.fn(), getRefresh: () => null, setRefresh: vi.fn(), clear: vi.fn() },
}));

function makePo(status: string) {
  return {
    id: 7, vendor_id: 1, warehouse_id: 5, po_number: 'PO-2026-0007', status,
    order_date: '2026-01-01', expected_date: null, received_date: null,
    subtotal: '1000.00', tax_amount: '0.00', total: '1000.00', currency: 'MXN',
    reference: null, notes: null, created_at: '2026-01-01',
  };
}
const vendor1 = { id: 1, name: 'Ubiquiti Networks', status: 'active' };
const warehouse1 = { id: 5, name: 'Main Warehouse', status: 'active' };
const item1 = {
  id: 1, po_id: 7, inventory_item_id: 2, item_name: 'MikroTik hAP', sku: 'RB-HAP',
  description: 'MikroTik hAP', quantity_ordered: 10, quantity_received: 0,
  unit_cost: '100.0000', total_cost: '1000.0000', notes: null,
};
const inventoryItem1 = { id: 2, name: 'MikroTik hAP', sku: 'RB-HAP', unit_cost: '100.00', status: 'active' };

let currentStatus: string;
let currentItems: object[];

function setupMocks(initialStatus = 'sent', items: object[] = [item1]) {
  currentStatus = initialStatus;
  currentItems = items;
  mockApiGet.mockImplementation((path: string) => {
    if (path === '/purchase-orders/{id}') return Promise.resolve({ data: { data: makePo(currentStatus) }, error: undefined });
    if (path === '/purchase-orders/{id}/items') return Promise.resolve({ data: { data: currentItems }, error: undefined });
    if (path === '/vendors/{id}') return Promise.resolve({ data: { data: vendor1 }, error: undefined });
    if (path === '/warehouses/{id}') return Promise.resolve({ data: { data: warehouse1 }, error: undefined });
    if (path === '/inventory/items') return Promise.resolve({ data: { data: [inventoryItem1] }, error: undefined });
    return Promise.resolve({ data: { data: [] }, error: undefined });
  });
  mockApiPost.mockImplementation((path: string) => {
    if (path === '/purchase-orders/{id}/items') {
      return Promise.resolve({
        data: { data: { id: 2, po_id: 7, inventory_item_id: 2, description: 'MikroTik hAP', quantity_ordered: 5, quantity_received: 0, unit_cost: '100.0000', total_cost: '500.0000', notes: null } },
        error: undefined,
      });
    }
    if (path === '/purchase-orders/{id}/receive') {
      currentStatus = 'received';
      return Promise.resolve({ data: { data: makePo('received') }, error: undefined });
    }
    return Promise.resolve({ data: {}, error: undefined });
  });
  mockApiPut.mockResolvedValue({ data: { data: makePo(currentStatus) }, error: undefined });
}

function renderDetail() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/purchase-orders/7']}>
        <Routes>
          <Route path="/purchase-orders/:id" element={<PurchaseOrderDetail />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  setupMocks();
});

describe('PurchaseOrderDetail page', () => {
  it('renders PO header, vendor, warehouse, and line items', async () => {
    renderDetail();
    await waitFor(() => expect(screen.getByRole('heading', { name: 'PO-2026-0007' })).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText('Ubiquiti Networks')).toBeInTheDocument());
    expect(screen.getByText('Main Warehouse')).toBeInTheDocument();
    expect(screen.getByText('MikroTik hAP')).toBeInTheDocument();
  });

  it('shows a Receive button for a sent PO with line items', async () => {
    renderDetail();
    await waitFor(() => expect(screen.getByRole('heading', { name: 'PO-2026-0007' })).toBeInTheDocument());
    expect(await screen.findByRole('button', { name: /Receive/ })).toBeInTheDocument();
  });

  it('hides the Receive button once the PO is fully received', async () => {
    setupMocks('received');
    renderDetail();
    await waitFor(() => expect(screen.getByRole('heading', { name: 'PO-2026-0007' })).toBeInTheDocument());
    expect(screen.queryByText(/📥 Receive/)).not.toBeInTheDocument();
  });

  it('adding a line item posts it and recomputes/persists the PO subtotal and total', async () => {
    renderDetail();
    await waitFor(() => expect(screen.getByText('MikroTik hAP')).toBeInTheDocument());

    // After the add, the items GET should reflect both lines so the recompute
    // step sums 1000 (existing) + 500 (new) = 1500.
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/purchase-orders/{id}') return Promise.resolve({ data: { data: makePo(currentStatus) }, error: undefined });
      if (path === '/purchase-orders/{id}/items') {
        return Promise.resolve({
          data: { data: [item1, { id: 2, po_id: 7, inventory_item_id: 2, description: 'MikroTik hAP', quantity_ordered: 5, quantity_received: 0, unit_cost: '100.0000', total_cost: '500.0000', notes: null }] },
          error: undefined,
        });
      }
      if (path === '/vendors/{id}') return Promise.resolve({ data: { data: vendor1 }, error: undefined });
      if (path === '/warehouses/{id}') return Promise.resolve({ data: { data: warehouse1 }, error: undefined });
      if (path === '/inventory/items') return Promise.resolve({ data: { data: [inventoryItem1] }, error: undefined });
      return Promise.resolve({ data: { data: [] }, error: undefined });
    });

    fireEvent.change(screen.getByLabelText(/Description/), { target: { value: 'MikroTik hAP' } });
    fireEvent.change(screen.getByLabelText(/Quantity/), { target: { value: '5' } });
    fireEvent.change(screen.getByLabelText(/Unit Cost/), { target: { value: '100' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add Item' }));

    await waitFor(() => expect(mockApiPost).toHaveBeenCalledWith(
      '/purchase-orders/{id}/items',
      expect.objectContaining({
        params: { path: { id: 7 } },
        body: expect.objectContaining({ description: 'MikroTik hAP', quantity_ordered: 5, unit_cost: 100 }),
      }),
    ));

    await waitFor(() => expect(mockApiPut).toHaveBeenCalledWith(
      '/purchase-orders/{id}',
      expect.objectContaining({
        params: { path: { id: 7 } },
        body: expect.objectContaining({ subtotal: 1500, total: 1500 }),
      }),
    ));

    expect(await screen.findByText('Line item added.')).toBeInTheDocument();
  });

  it('Receive defaults each line to its full remaining quantity and posts items[]', async () => {
    renderDetail();
    const receiveBtn = await screen.findByRole('button', { name: /Receive/ });
    fireEvent.click(receiveBtn);

    const dialog = await screen.findByRole('dialog', { name: 'Receive Purchase Order' });
    const qtyInput = within(dialog).getByRole('spinbutton');
    expect(qtyInput).toHaveValue(10); // full remaining (10 ordered, 0 received)

    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm Receive' }));

    await waitFor(() => expect(mockApiPost).toHaveBeenCalledWith(
      '/purchase-orders/{id}/receive',
      expect.objectContaining({
        params: { path: { id: 7 } },
        body: { items: [{ id: 1, quantity_received: 10 }] },
      }),
    ));
    expect(await screen.findByText('Purchase order received — stock updated.')).toBeInTheDocument();
  });

  it('Receive can be adjusted to a partial quantity', async () => {
    renderDetail();
    const receiveBtn = await screen.findByRole('button', { name: /Receive/ });
    fireEvent.click(receiveBtn);

    const dialog = await screen.findByRole('dialog', { name: 'Receive Purchase Order' });
    const qtyInput = within(dialog).getByRole('spinbutton');
    fireEvent.change(qtyInput, { target: { value: '4' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm Receive' }));

    await waitFor(() => expect(mockApiPost).toHaveBeenCalledWith(
      '/purchase-orders/{id}/receive',
      expect.objectContaining({
        body: { items: [{ id: 1, quantity_received: 4 }] },
      }),
    ));
  });
});
