// =============================================================================
// FireISP 5.0 — InvoiceDetail page tests
// =============================================================================
// Covers the invoice's first-ever "Add Item" form (Inventory Phase 2,
// §14.2) — InvoiceDetail previously had no add-item UI at all — and its
// product-catalog picker (autofill + inventory_item_id, negative on-hand in
// red, free-text lines unaffected).
// =============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { InvoiceDetail } from '../InvoiceDetail';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockApiGet = vi.fn();
const mockApiPost = vi.fn();
const mockApiPut = vi.fn();
const mockAuthedFetch = vi.fn();
vi.mock('@/api/client', () => ({
  api: {
    GET: (...a: unknown[]) => mockApiGet(...a),
    POST: (...a: unknown[]) => mockApiPost(...a),
    PUT: (...a: unknown[]) => mockApiPut(...a),
  },
  authedFetch: (...a: unknown[]) => mockAuthedFetch(...a),
  tokenStore: { getAccess: () => 'tok', setAccess: vi.fn(), getRefresh: () => null, setRefresh: vi.fn(), clear: vi.fn() },
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeInvoice(status: string) {
  return {
    id: 42, client_id: 10, contract_id: null, invoice_number: 'INV-000042',
    subtotal: '100.00', tax_amount: '16.00', tax_rate: '0.16', discount_amount: null,
    total: '116.00', currency: 'MXN', period_start: null, period_end: null,
    due_date: '2026-08-01', paid_at: null, status, notes: null, created_at: '2026-07-01',
  };
}
const item1 = { id: 1, description: 'Setup Fee', quantity: '1.00', unit_price: '100.00', amount: '100.00', tax_rate: null };
const client1 = { id: 10, name: 'María García', email: 'maria@example.com' };
const productCatalog = [
  { id: 3, name: 'MikroTik hAP ac3', price: '899.00', inventory_item_id: 7, quantity_on_hand: 5 },
  { id: 4, name: 'Out of Stock Router', price: '500.00', inventory_item_id: 8, quantity_on_hand: -2 },
];

let currentStatus: string;

function setupMocks(initialStatus = 'issued', items: object[] = [item1]) {
  currentStatus = initialStatus;
  mockApiGet.mockImplementation((path: string) => {
    if (path === '/invoices/{id}') return Promise.resolve({ data: { data: makeInvoice(currentStatus) }, error: undefined });
    if (path === '/clients/{id}') return Promise.resolve({ data: { data: client1 }, error: undefined });
    return Promise.resolve({ data: { data: [] }, error: undefined });
  });
  mockApiPost.mockImplementation((path: string) => {
    if (path === '/invoices/{id}/items') {
      return Promise.resolve({ data: { data: { id: 2, description: 'Install', quantity: '1.00', unit_price: '50.00', amount: '50.00' } }, error: undefined });
    }
    return Promise.resolve({ data: {}, error: undefined });
  });
  mockApiPut.mockResolvedValue({ data: { data: makeInvoice(currentStatus) }, error: undefined });
  mockAuthedFetch.mockImplementation((url: string) => {
    if (url.includes('/plans/addons/catalog')) {
      return Promise.resolve({ ok: true, json: async () => ({ data: productCatalog }) });
    }
    if (url.includes('/invoices/42/items') || url.includes('/invoices/{id}/items')) {
      return Promise.resolve({ ok: true, json: async () => ({ data: items }) });
    }
    return Promise.resolve({ ok: true, json: async () => ({ data: [] }) });
  });
}

// InvoiceDetail.tsx fetches items via the typed api client, not authedFetch
// (see fetchItems -> api.GET('/invoices/{id}/items')) — wire that path too.
function wireItemsGet(items: object[]) {
  mockApiGet.mockImplementation((path: string) => {
    if (path === '/invoices/{id}') return Promise.resolve({ data: { data: makeInvoice(currentStatus) }, error: undefined });
    if (path === '/invoices/{id}/items') return Promise.resolve({ data: { data: items }, error: undefined });
    if (path === '/invoices/{id}/payments') return Promise.resolve({ data: { data: [] }, error: undefined });
    if (path === '/clients/{id}') return Promise.resolve({ data: { data: client1 }, error: undefined });
    return Promise.resolve({ data: { data: [] }, error: undefined });
  });
}

function renderDetail() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/invoices/42']}>
        <Routes>
          <Route path="/invoices/:id" element={<InvoiceDetail />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  setupMocks();
  wireItemsGet([item1]);
});

describe('InvoiceDetail page', () => {
  it('renders the invoice header, client link, and line items', async () => {
    renderDetail();
    await waitFor(() => expect(screen.getByRole('heading', { name: 'INV-000042' })).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText('María García')).toBeInTheDocument());
    expect(screen.getByText('Setup Fee')).toBeInTheDocument();
  });

  it('renders the Add Item form (previously absent entirely)', async () => {
    renderDetail();
    await waitFor(() => expect(screen.getByText('Setup Fee')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Add Item' })).toBeInTheDocument();
  });

  it('a free-text custom line posts without inventory_item_id', async () => {
    renderDetail();
    await waitFor(() => expect(screen.getByText('Setup Fee')).toBeInTheDocument());

    wireItemsGet([item1, { id: 2, description: 'Install', quantity: '1.00', unit_price: '50.00', amount: '50.00' }]);

    fireEvent.change(screen.getByLabelText(/Description/), { target: { value: 'Install' } });
    fireEvent.change(screen.getByLabelText(/Quantity/), { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText(/Unit Price/), { target: { value: '50' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add Item' }));

    await waitFor(() => expect(mockApiPost).toHaveBeenCalledWith(
      '/invoices/{id}/items',
      expect.objectContaining({
        params: { path: { id: 42 } },
        body: expect.objectContaining({ description: 'Install', quantity: 1, unit_price: 50, amount: 50 }),
      }),
    ));
    const body = mockApiPost.mock.calls.find(c => c[0] === '/invoices/{id}/items')?.[1].body;
    expect(body.inventory_item_id).toBeUndefined();

    // Recomputes and persists subtotal/tax/total from all items — fraction
    // tax_rate (0.16), never *100.
    await waitFor(() => expect(mockApiPut).toHaveBeenCalledWith(
      '/invoices/{id}',
      expect.objectContaining({
        params: { path: { id: 42 } },
        body: expect.objectContaining({ subtotal: 150, tax_amount: 24, total: 174 }),
      }),
    ));
    expect(await screen.findByText('Line item added.')).toBeInTheDocument();
  });

  it('picking a product autofills the line and sends inventory_item_id', async () => {
    renderDetail();
    await waitFor(() => expect(screen.getByText('Setup Fee')).toBeInTheDocument());

    const picker = await screen.findByLabelText('Product');
    fireEvent.change(picker, { target: { value: '3' } });

    expect(screen.getByLabelText(/Description/)).toHaveValue('MikroTik hAP ac3');
    expect(screen.getByLabelText(/Unit Price/)).toHaveValue(899);

    fireEvent.change(screen.getByLabelText(/Quantity/), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add Item' }));

    await waitFor(() => expect(mockApiPost).toHaveBeenCalledWith(
      '/invoices/{id}/items',
      expect.objectContaining({
        params: { path: { id: 42 } },
        body: expect.objectContaining({ description: 'MikroTik hAP ac3', inventory_item_id: 7 }),
      }),
    ));
  });

  // Migration 390: inventory-linked lines must carry a whole-number quantity
  // (the backend 422s otherwise). The frontend blocks the submit locally with
  // a translated error instead of round-tripping to the server.
  it('blocks submit with a fractional quantity on a product-picker (inventory-linked) line', async () => {
    renderDetail();
    await waitFor(() => expect(screen.getByText('Setup Fee')).toBeInTheDocument());

    const picker = await screen.findByLabelText('Product');
    fireEvent.change(picker, { target: { value: '3' } });

    const quantityInput = screen.getByLabelText(/Quantity/);
    fireEvent.change(quantityInput, { target: { value: '1.5' } });
    // fireEvent.submit bypasses the native HTML5 step-mismatch block a real
    // click would also trigger (step="1" once a product is selected) —
    // this targets OUR OWN JS-level integer check in handleSubmit.
    fireEvent.submit(quantityInput.closest('form')!);

    expect(await screen.findByText('Quantity must be a whole number for inventory-linked products.')).toBeInTheDocument();
    expect(mockApiPost).not.toHaveBeenCalledWith('/invoices/{id}/items', expect.anything());
  });

  it('renders negative on-hand in red in the product picker', async () => {
    renderDetail();
    await waitFor(() => expect(screen.getByText('Setup Fee')).toBeInTheDocument());

    const picker = await screen.findByLabelText('Product');
    const negativeOption = Array.from(picker.querySelectorAll('option'))
      .find(o => o.textContent?.includes('Out of Stock Router'));
    expect(negativeOption).toBeDefined();
    expect(negativeOption?.style.color).toBe('rgb(220, 38, 38)');
  });

  // Inventory follow-up: raw inventory items sell directly in the picker
  // (union with the addon catalog), de-duping against anything already
  // linked by a curated addon.
  it('unions in a raw inventory item w/ sale_price autofill + sends inventory_item_id, de-duping addon-linked items', async () => {
    mockAuthedFetch.mockImplementation((url: string) => {
      if (url.includes('/plans/addons/catalog')) {
        return Promise.resolve({ ok: true, json: async () => ({ data: productCatalog }) });
      }
      if (url.includes('/inventory/items')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            data: [
              // Already linked by productCatalog[0] (inventory_item_id: 7) —
              // must NOT get a second, duplicate option.
              { id: 7, name: 'MikroTik hAP ac3', sku: 'MT-7', sale_price: '899.00', unit_cost: null, quantity_on_hand: 5, status: 'active' },
              // Not linked by any addon — sellable directly.
              { id: 9, name: 'Ubiquiti NanoStation', sku: 'UB-9', sale_price: '75.50', unit_cost: '60.00', quantity_on_hand: 3, status: 'active' },
            ],
          }),
        });
      }
      if (url.includes('/invoices/42/items') || url.includes('/invoices/{id}/items')) {
        return Promise.resolve({ ok: true, json: async () => ({ data: [item1] }) });
      }
      return Promise.resolve({ ok: true, json: async () => ({ data: [] }) });
    });

    renderDetail();
    await waitFor(() => expect(screen.getByText('Setup Fee')).toBeInTheDocument());

    const picker = await screen.findByLabelText('Product');
    const options = Array.from(picker.querySelectorAll('option'));
    // The raw item NOT linked by any addon appears (name + sku + sale_price).
    expect(options.some(o => o.textContent?.includes('Ubiquiti NanoStation (UB-9)') && o.textContent?.includes('75.50'))).toBe(true);
    // The raw item that IS already linked (id 7) doesn't get its own option —
    // only ONE option exists for MikroTik hAP ac3 (the curated addon's).
    expect(options.filter(o => o.textContent?.includes('MikroTik hAP ac3'))).toHaveLength(1);

    // Selecting the raw item autofills from sale_price and sends inventory_item_id.
    const itemOption = options.find(o => o.textContent?.includes('Ubiquiti NanoStation')) as HTMLOptionElement;
    fireEvent.change(picker, { target: { value: itemOption.value } });
    expect(screen.getByLabelText(/Description/)).toHaveValue('Ubiquiti NanoStation (UB-9)');
    expect(screen.getByLabelText(/Unit Price/)).toHaveValue(75.5);

    fireEvent.change(screen.getByLabelText(/Quantity/), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add Item' }));

    await waitFor(() => expect(mockApiPost).toHaveBeenCalledWith(
      '/invoices/{id}/items',
      expect.objectContaining({
        params: { path: { id: 42 } },
        body: expect.objectContaining({ description: 'Ubiquiti NanoStation (UB-9)', inventory_item_id: 9 }),
      }),
    ));
  });

  it('hides the Add Item form once the invoice is void', async () => {
    setupMocks('void');
    wireItemsGet([item1]);
    renderDetail();
    await waitFor(() => expect(screen.getByText('Setup Fee')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Add Item' })).not.toBeInTheDocument();
  });
});
