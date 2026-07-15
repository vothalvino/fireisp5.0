// =============================================================================
// FireISP 5.0 — QuoteDetail page tests
// =============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QuoteDetail } from '../QuoteDetail';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

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

// GET /plans/addons/catalog — the product picker's catalog source (fetched
// via authedFetch, not the typed api client; see api/addonCatalog.ts).
const productCatalog = [
  { id: 3, name: 'MikroTik hAP ac3', price: '899.00', inventory_item_id: 7, quantity_on_hand: 5 },
  { id: 4, name: 'Out of Stock Router', price: '500.00', inventory_item_id: 8, quantity_on_hand: -2 },
];

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeQuote(status: string, convertedInvoiceId: number | null = null) {
  return {
    id: 7, client_id: 10, contract_id: null, quote_number: 'QUO-000007',
    issue_date: '2025-01-01', valid_until: '2025-02-01',
    subtotal: '100.00', tax_rate: '0.16', tax_amount: '16.00', total: '116.00',
    currency: 'MXN', notes: null, status, created_at: '2025-01-01',
    converted_invoice_id: convertedInvoiceId,
  };
}
const item1 = { id: 1, quote_id: 7, description: 'Setup Fee', quantity: '1.00', unit_price: '100.00', tax_rate_id: null, total: '100.00' };
const client1 = { id: 10, name: 'María García', email: 'maria@example.com' };

let currentStatus: string;

function setupMocks(initialStatus = 'draft', items: object[] = [item1]) {
  currentStatus = initialStatus;
  mockApiGet.mockImplementation((path: string) => {
    if (path === '/quotes/{id}') return Promise.resolve({ data: { data: makeQuote(currentStatus) }, error: undefined });
    if (path === '/quotes/{id}/items') return Promise.resolve({ data: { data: items }, error: undefined });
    if (path === '/clients/{id}') return Promise.resolve({ data: { data: client1 }, error: undefined });
    return Promise.resolve({ data: { data: [] }, error: undefined });
  });
  mockApiPost.mockImplementation((path: string) => {
    if (path === '/quotes/{id}/approve') {
      currentStatus = 'accepted';
      return Promise.resolve({ data: { data: makeQuote('accepted') }, error: undefined });
    }
    if (path === '/quotes/{id}/reject') {
      currentStatus = 'rejected';
      return Promise.resolve({ data: { data: makeQuote('rejected') }, error: undefined });
    }
    if (path === '/quotes/{id}/convert-to-invoice') {
      return Promise.resolve({ data: { data: { id: 99 } }, error: undefined });
    }
    if (path === '/quotes/{id}/items') {
      return Promise.resolve({ data: { data: { id: 2, quote_id: 7, description: 'Install', quantity: '1.00', unit_price: '50.00', total: '50.00' } }, error: undefined });
    }
    return Promise.resolve({ data: {}, error: undefined });
  });
  mockApiPut.mockResolvedValue({ data: { data: makeQuote(currentStatus) }, error: undefined });
  mockAuthedFetch.mockResolvedValue({ ok: true, json: async () => ({ data: productCatalog }) });
}

function renderDetail() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/quotes/7']}>
        <Routes>
          <Route path="/quotes/:id" element={<QuoteDetail />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  setupMocks();
});

describe('QuoteDetail page', () => {
  it('renders the quote header, client link, and status badge', async () => {
    renderDetail();
    await waitFor(() => expect(screen.getByRole('heading', { name: 'QUO-000007' })).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText('María García')).toBeInTheDocument());
    expect(screen.getByText('draft')).toBeInTheDocument();
  });

  it('renders the line items table', async () => {
    renderDetail();
    await waitFor(() => expect(screen.getByText('Setup Fee')).toBeInTheDocument());
  });

  it('does not show Convert to Invoice for a draft quote', async () => {
    renderDetail();
    await waitFor(() => expect(screen.getByRole('heading', { name: 'QUO-000007' })).toBeInTheDocument());
    expect(screen.queryByText(/Convert to Invoice/)).not.toBeInTheDocument();
  });

  it('shows Convert to Invoice only once the quote is accepted, and converting navigates to the new invoice', async () => {
    setupMocks('accepted');
    renderDetail();
    await waitFor(() => expect(screen.getByRole('heading', { name: 'QUO-000007' })).toBeInTheDocument());

    const convertBtn = await screen.findByText(/Convert to Invoice/);
    fireEvent.click(convertBtn);

    await waitFor(() => expect(mockApiPost).toHaveBeenCalledWith(
      '/quotes/{id}/convert-to-invoice',
      expect.objectContaining({ params: { path: { id: 7 } } }),
    ));
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/invoices/99'));
  });

  it('Approve sets the badge to accepted', async () => {
    renderDetail();
    await waitFor(() => expect(screen.getByRole('heading', { name: 'QUO-000007' })).toBeInTheDocument());

    fireEvent.click(screen.getByText('✔ Approve'));

    await waitFor(() => expect(mockApiPost).toHaveBeenCalledWith(
      '/quotes/{id}/approve',
      expect.objectContaining({ params: { path: { id: 7 } } }),
    ));
    await waitFor(() => expect(screen.getByText('accepted')).toBeInTheDocument());
  });

  it('Reject sets the badge to rejected', async () => {
    renderDetail();
    await waitFor(() => expect(screen.getByRole('heading', { name: 'QUO-000007' })).toBeInTheDocument());

    fireEvent.click(screen.getByText('✖ Reject'));

    await waitFor(() => expect(mockApiPost).toHaveBeenCalledWith(
      '/quotes/{id}/reject',
      expect.objectContaining({ params: { path: { id: 7 } } }),
    ));
    await waitFor(() => expect(screen.getByText('rejected')).toBeInTheDocument());
  });

  // Regression coverage for the recompute-from-items behavior: adding a line
  // item posts it, then re-sums ALL items (existing + new) and PUTs the
  // quote's subtotal/tax/total — tax_rate is a 0-1 fraction (0.16), not a
  // whole percent, so 150 * 0.16 = 24.00 tax, never 150 * 16 = 2400.
  it('adding a line item recomputes and persists subtotal/tax/total from all items', async () => {
    renderDetail();
    await waitFor(() => expect(screen.getByText('Setup Fee')).toBeInTheDocument());

    // Once the item is added, the items GET should reflect both items so the
    // recompute step sums correctly.
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/quotes/{id}') return Promise.resolve({ data: { data: makeQuote(currentStatus) }, error: undefined });
      if (path === '/quotes/{id}/items') {
        return Promise.resolve({
          data: { data: [item1, { id: 2, quote_id: 7, description: 'Install', quantity: '1.00', unit_price: '50.00', total: '50.00' }] },
          error: undefined,
        });
      }
      if (path === '/clients/{id}') return Promise.resolve({ data: { data: client1 }, error: undefined });
      return Promise.resolve({ data: { data: [] }, error: undefined });
    });

    fireEvent.change(screen.getByLabelText(/Description/), { target: { value: 'Install' } });
    fireEvent.change(screen.getByLabelText(/Quantity/), { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText(/Unit Price/), { target: { value: '50' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add Item' }));

    await waitFor(() => expect(mockApiPost).toHaveBeenCalledWith(
      '/quotes/{id}/items',
      expect.objectContaining({
        params: { path: { id: 7 } },
        body: expect.objectContaining({ description: 'Install', quantity: 1, unit_price: 50, amount: 50 }),
      }),
    ));

    await waitFor(() => expect(mockApiPut).toHaveBeenCalledWith(
      '/quotes/{id}',
      expect.objectContaining({
        params: { path: { id: 7 } },
        body: expect.objectContaining({ subtotal: 150, tax_amount: 24, total: 174 }),
      }),
    ));

    expect(await screen.findByText('Line item added.')).toBeInTheDocument();
  });

  // Inventory Phase 2: the product picker autofills description/unit_price
  // from the catalog and tags the line with inventory_item_id — a plain
  // free-text line (no product selected, covered by the test above) posts
  // without that field at all.
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
      '/quotes/{id}/items',
      expect.objectContaining({
        params: { path: { id: 7 } },
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
    // fireEvent.submit dispatches the 'submit' event directly, bypassing the
    // native HTML5 step-mismatch block a real click would also trigger (the
    // input's step="1" for an inventory-linked line) — this test targets
    // OUR OWN JS-level integer check (see AddItemForm's handleSubmit), not
    // the browser's native constraint validation, which is a separate,
    // untranslated line of defense already covered by the min/step attrs.
    fireEvent.submit(quantityInput.closest('form')!);

    expect(await screen.findByText('Quantity must be a whole number for inventory-linked products.')).toBeInTheDocument();
    expect(mockApiPost).not.toHaveBeenCalledWith('/quotes/{id}/items', expect.anything());
  });

  // "on hand: N" renders in red for an inventory-linked product with
  // quantity_on_hand <= 0 (negative stock is an allowed, visible state —
  // Inventory Phase 2 policy).
  it('renders negative on-hand in red in the product picker', async () => {
    renderDetail();
    await waitFor(() => expect(screen.getByText('Setup Fee')).toBeInTheDocument());

    const picker = await screen.findByLabelText('Product');
    const negativeOption = Array.from(picker.querySelectorAll('option'))
      .find(o => o.textContent?.includes('Out of Stock Router'));
    expect(negativeOption).toBeDefined();
    expect(negativeOption?.style.color).toBe('rgb(220, 38, 38)');
  });

  // Migration 390's converted_invoice_id back-reference / idempotency fix:
  // once a quote has converted, the Convert button must never reappear (that
  // would let a user retrigger the now-409'd endpoint), and a link to the
  // resulting invoice takes its place.
  it('hides Convert to Invoice and shows a link to the converted invoice once converted_invoice_id is set', async () => {
    setupMocks('accepted');
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/quotes/{id}') return Promise.resolve({ data: { data: makeQuote('accepted', 99) }, error: undefined });
      if (path === '/quotes/{id}/items') return Promise.resolve({ data: { data: [item1] }, error: undefined });
      if (path === '/clients/{id}') return Promise.resolve({ data: { data: client1 }, error: undefined });
      if (path === '/invoices/{id}') return Promise.resolve({ data: { data: { id: 99, invoice_number: 'INV-000099' } }, error: undefined });
      return Promise.resolve({ data: { data: [] }, error: undefined });
    });
    renderDetail();
    await waitFor(() => expect(screen.getByRole('heading', { name: 'QUO-000007' })).toBeInTheDocument());

    expect(screen.queryByText(/Convert to Invoice/)).not.toBeInTheDocument();

    const link = await screen.findByRole('link', { name: 'INV-000099' });
    expect(link).toHaveAttribute('href', '/invoices/99');
  });
});
