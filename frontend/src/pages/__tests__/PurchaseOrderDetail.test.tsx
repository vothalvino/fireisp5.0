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

  // Regression: the modal input is a per-shipment "receive now" DELTA, but the
  // backend's quantity_received is the CUMULATIVE total. On a second receive of
  // an already-partially-received line the two must not be confused, or the
  // just-arrived stock is silently under-counted and the PO can stall.
  it('second receive of a partial line sends the cumulative total, not the delta', async () => {
    const partialItem = { ...item1, quantity_received: 4 }; // 4 of 10 already received
    setupMocks('partial', [partialItem]);
    renderDetail();
    const receiveBtn = await screen.findByRole('button', { name: /Receive/ });
    fireEvent.click(receiveBtn);

    const dialog = await screen.findByRole('dialog', { name: 'Receive Purchase Order' });
    const qtyInput = within(dialog).getByRole('spinbutton');
    expect(qtyInput).toHaveValue(6); // "receive now" defaults to remaining (10 - 4)

    // Accept the default (receive the remaining 6). Cumulative must be 4 + 6 = 10.
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm Receive' }));
    await waitFor(() => expect(mockApiPost).toHaveBeenCalledWith(
      '/purchase-orders/{id}/receive',
      expect.objectContaining({
        body: { items: [{ id: 1, quantity_received: 10 }] },
      }),
    ));
  });

  it('a smaller second receive adds the delta onto what was already received', async () => {
    const partialItem = { ...item1, quantity_received: 4 }; // 4 of 10 already received
    setupMocks('partial', [partialItem]);
    renderDetail();
    fireEvent.click(await screen.findByRole('button', { name: /Receive/ }));

    const dialog = await screen.findByRole('dialog', { name: 'Receive Purchase Order' });
    const qtyInput = within(dialog).getByRole('spinbutton');
    fireEvent.change(qtyInput, { target: { value: '3' } }); // receive 3 more now

    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm Receive' }));
    await waitFor(() => expect(mockApiPost).toHaveBeenCalledWith(
      '/purchase-orders/{id}/receive',
      expect.objectContaining({
        body: { items: [{ id: 1, quantity_received: 7 }] }, // 4 + 3
      }),
    ));
  });

  // -------------------------------------------------------------------------
  // Inventory Phase 3 (migration 391) — serial-tracked receive
  // -------------------------------------------------------------------------
  describe('serial_required line', () => {
    const serialItem = { ...item1, quantity_ordered: 2, quantity_received: 0, serial_required: 1 };

    it('shows serial number inputs and blocks submit until the count matches the receive quantity', async () => {
      setupMocks('sent', [serialItem]);
      renderDetail();
      fireEvent.click(await screen.findByRole('button', { name: /Receive/ }));

      const dialog = await screen.findByRole('dialog', { name: 'Receive Purchase Order' });
      // Serial textarea appears because this line is serial_required and receiving > 0.
      const serialBox = within(dialog).getByPlaceholderText('One serial per line');
      expect(serialBox).toBeInTheDocument();

      const confirmBtn = within(dialog).getByRole('button', { name: 'Confirm Receive' });
      // 2 needed, 0 entered yet — mismatch, submit is blocked.
      expect(confirmBtn).toBeDisabled();
      expect(within(dialog).getByText(/Enter exactly the right number/)).toBeInTheDocument();

      // Only one serial entered for a quantity of 2 — still blocked.
      fireEvent.change(serialBox, { target: { value: 'SN-100' } });
      expect(confirmBtn).toBeDisabled();

      fireEvent.click(confirmBtn); // no-op while disabled/blocked
      expect(mockApiPost).not.toHaveBeenCalledWith('/purchase-orders/{id}/receive', expect.anything());
    });

    it('submits serials keyed by line id once the count matches', async () => {
      setupMocks('sent', [serialItem]);
      renderDetail();
      fireEvent.click(await screen.findByRole('button', { name: /Receive/ }));

      const dialog = await screen.findByRole('dialog', { name: 'Receive Purchase Order' });
      const serialBox = within(dialog).getByPlaceholderText('One serial per line');
      fireEvent.change(serialBox, { target: { value: 'SN-100\nSN-101' } });

      const confirmBtn = within(dialog).getByRole('button', { name: 'Confirm Receive' });
      expect(confirmBtn).not.toBeDisabled();
      fireEvent.click(confirmBtn);

      await waitFor(() => expect(mockApiPost).toHaveBeenCalledWith(
        '/purchase-orders/{id}/receive',
        expect.objectContaining({
          body: { items: [{ id: 1, quantity_received: 2 }], serials: { 1: ['SN-100', 'SN-101'] } },
        }),
      ));
    });

    it('does not render serial inputs for a non-serial-tracked line', async () => {
      renderDetail(); // default setupMocks uses item1, no serial_required
      fireEvent.click(await screen.findByRole('button', { name: /Receive/ }));
      const dialog = await screen.findByRole('dialog', { name: 'Receive Purchase Order' });
      expect(within(dialog).queryByPlaceholderText('One serial per line')).not.toBeInTheDocument();
      expect(within(dialog).getByRole('button', { name: 'Confirm Receive' })).not.toBeDisabled();
    });
  });
});
