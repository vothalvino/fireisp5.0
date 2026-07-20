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

// Mutable org locale: default 'global' (no SAT affordances); stamp tests flip
// it to 'MX'.
const authState: { locale: 'global' | 'MX' } = { locale: 'global' };
vi.mock('@/auth/AuthContext', () => ({
  useAuth: () => ({ user: { id: 1, email: 'a@b.c', organization_locale: authState.locale } }),
}));

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
  authState.locale = 'global';
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

  it('hides the Add Item form once the invoice is cancelled (SAT-cancelled)', async () => {
    setupMocks('cancelled');
    wireItemsGet([item1]);
    renderDetail();
    await waitFor(() => expect(screen.getByText('Setup Fee')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Add Item' })).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Void vs. Cancel-at-SAT gating
// ---------------------------------------------------------------------------
// Mexican compliance: a stamped CFDI is registered at SAT at timbrado, so an
// internal void would leave it fiscally valid. While a live CFDI exists
// (vigente / cancel_pending) the Void button is replaced by Cancel CFDI (SAT).

// Re-wires authedFetch with CFDI docs for this invoice on top of the default
// catalog/items handling (mockImplementation fully replaces the previous one).
function wireAuthedFetch(cfdiDocs: object[]) {
  mockAuthedFetch.mockImplementation((url: string) => {
    if (url.includes('/cfdi-documents')) {
      return Promise.resolve({ ok: true, json: async () => ({ data: cfdiDocs }) });
    }
    if (url.includes('/cfdi/cancel')) {
      return Promise.resolve({ ok: true, json: async () => ({ data: { status: 'cancelado' } }) });
    }
    if (url.includes('/plans/addons/catalog')) {
      return Promise.resolve({ ok: true, json: async () => ({ data: productCatalog }) });
    }
    return Promise.resolve({ ok: true, json: async () => ({ data: [] }) });
  });
}

const vigenteDoc = { id: 7, uuid: 'AAAA1111-BBBB-2222-CCCC-333344445555', sat_status: 'vigente' };

describe('InvoiceDetail void vs. SAT cancel', () => {
  it('shows Void (and no SAT-cancel button) when the invoice has no stamped CFDI', async () => {
    renderDetail();
    await waitFor(() => expect(screen.getByText('Setup Fee')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: '🚫 Void' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '✕ Cancel CFDI (SAT)' })).not.toBeInTheDocument();
  });

  it('clicking Void with applied payments explains deallocate-first instead of voiding', async () => {
    // Deallocation is a deliberate separate step (payment → Unapply → client
    // credit); Void must never strip payments as a side effect.
    currentStatus = 'paid';
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/invoices/{id}') return Promise.resolve({ data: { data: makeInvoice('paid') }, error: undefined });
      if (path === '/invoices/{id}/items') return Promise.resolve({ data: { data: [item1] }, error: undefined });
      if (path === '/invoices/{id}/payments') {
        return Promise.resolve({ data: { data: [{ id: 1, payment_id: 9, invoice_id: 42, amount: '116.00', payment_amount: '116.00', payment_method: 'cash', payment_date: '2026-07-01' }] }, error: undefined });
      }
      if (path === '/clients/{id}') return Promise.resolve({ data: { data: client1 }, error: undefined });
      return Promise.resolve({ data: { data: [] }, error: undefined });
    });
    renderDetail();
    const voidBtn = await screen.findByRole('button', { name: '🚫 Void' });
    await waitFor(() => expect(screen.getByText('#9')).toBeInTheDocument()); // applied payment rendered
    fireEvent.click(voidBtn);

    expect(await screen.findByText(/Unapply them first/)).toBeInTheDocument();
    expect(mockApiPut).not.toHaveBeenCalled(); // no void request went out
  });

  it('replaces Void with Cancel CFDI (SAT) and shows the Vigente badge when a vigente CFDI exists', async () => {
    wireAuthedFetch([vigenteDoc]);
    renderDetail();
    await waitFor(() => expect(screen.getByRole('button', { name: '✕ Cancel CFDI (SAT)' })).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: '🚫 Void' })).not.toBeInTheDocument();
    // Metadata card surfaces the CFDI's SAT status.
    expect(screen.getByText('Vigente')).toBeInTheDocument();
  });

  it('submits POST /cfdi/cancel with the chosen motivo from the modal', async () => {
    wireAuthedFetch([vigenteDoc]);
    renderDetail();
    fireEvent.click(await screen.findByRole('button', { name: '✕ Cancel CFDI (SAT)' }));

    // Modal opens with the SAT reason picker; default motivo 02.
    expect(await screen.findByRole('dialog', { name: 'Cancel CFDI at SAT' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel CFDI' }));

    await waitFor(() => {
      const call = mockAuthedFetch.mock.calls.find(([url]) => (url as string).includes('/cfdi/cancel'));
      expect(call).toBeDefined();
      expect(JSON.parse((call![1] as { body: string }).body)).toEqual({ cfdi_document_id: 7, reason: '02' });
    });
    // The mock PAC accepted immediately (status 'cancelado') → the toast says so.
    expect(await screen.findByText('CFDI cancelled at SAT — invoice marked cancelled')).toBeInTheDocument();
  });

  it('surfaces a SAT-REJECTED cancellation as an error, not success', async () => {
    // /cfdi/cancel answers HTTP 200 with status 'rejected' when SAT refuses —
    // the modal must show an error and never toast success.
    mockAuthedFetch.mockImplementation((url: string) => {
      if (url.includes('/cfdi-documents')) {
        return Promise.resolve({ ok: true, json: async () => ({ data: [vigenteDoc] }) });
      }
      if (url.includes('/cfdi/cancel')) {
        return Promise.resolve({ ok: true, json: async () => ({ data: { status: 'rejected' } }) });
      }
      return Promise.resolve({ ok: true, json: async () => ({ data: [] }) });
    });
    renderDetail();
    fireEvent.click(await screen.findByRole('button', { name: '✕ Cancel CFDI (SAT)' }));
    await screen.findByRole('dialog', { name: 'Cancel CFDI at SAT' });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel CFDI' }));

    expect(await screen.findByText('SAT rejected the cancellation — the CFDI remains vigente.')).toBeInTheDocument();
    // Modal stays open; no success toast.
    expect(screen.getByRole('dialog', { name: 'Cancel CFDI at SAT' })).toBeInTheDocument();
    expect(screen.queryByText(/invoice marked cancelled|submitted to SAT/)).not.toBeInTheDocument();
  });

  it('blocks a motivo-01 submit with a whitespace-only replacement UUID', async () => {
    wireAuthedFetch([vigenteDoc]);
    renderDetail();
    fireEvent.click(await screen.findByRole('button', { name: '✕ Cancel CFDI (SAT)' }));
    await screen.findByRole('dialog', { name: 'Cancel CFDI at SAT' });

    fireEvent.change(screen.getByLabelText('Cancellation reason (SAT)'), { target: { value: '01' } });
    fireEvent.change(screen.getByLabelText('Replacement UUID (required for reason 01)'), { target: { value: '   ' } });
    // fireEvent.submit bypasses native `required` — this targets our JS check.
    fireEvent.submit(screen.getByRole('button', { name: 'Cancel CFDI' }).closest('form')!);

    expect(await screen.findByText('Motivo 01 requires a replacement UUID (folio de sustitución).')).toBeInTheDocument();
    expect(mockAuthedFetch.mock.calls.find(([url]) => (url as string).includes('/cfdi/cancel'))).toBeUndefined();
  });

  it('motivo 01 requires a replacement UUID and sends it', async () => {
    wireAuthedFetch([vigenteDoc]);
    renderDetail();
    fireEvent.click(await screen.findByRole('button', { name: '✕ Cancel CFDI (SAT)' }));
    await screen.findByRole('dialog', { name: 'Cancel CFDI at SAT' });

    fireEvent.change(screen.getByLabelText('Cancellation reason (SAT)'), { target: { value: '01' } });
    const uuidInput = screen.getByLabelText('Replacement UUID (required for reason 01)');
    fireEvent.change(uuidInput, { target: { value: 'DDDD1111-EEEE-2222-FFFF-333344445555' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel CFDI' }));

    await waitFor(() => {
      const call = mockAuthedFetch.mock.calls.find(([url]) => (url as string).includes('/cfdi/cancel'));
      expect(call).toBeDefined();
      expect(JSON.parse((call![1] as { body: string }).body)).toEqual({
        cfdi_document_id: 7, reason: '01', replacement_uuid: 'DDDD1111-EEEE-2222-FFFF-333344445555',
      });
    });
  });

  it('shows a disabled "SAT cancel pending" button while the cancellation awaits SAT', async () => {
    wireAuthedFetch([{ ...vigenteDoc, sat_status: 'cancel_pending' }]);
    renderDetail();
    const btn = await screen.findByRole('button', { name: '⏳ SAT cancel pending' });
    expect(btn).toBeDisabled();
    expect(screen.queryByRole('button', { name: '🚫 Void' })).not.toBeInTheDocument();
  });

  it('a SAT-cancelled invoice shows the Cancelado badge and a plain (disabled) Void button', async () => {
    setupMocks('cancelled');
    wireItemsGet([item1]);
    wireAuthedFetch([{ ...vigenteDoc, sat_status: 'cancelado' }]);
    renderDetail();
    await waitFor(() => expect(screen.getByText('Cancelado')).toBeInTheDocument());
    // No live CFDI anymore → the Void button returns, but the invoice is
    // already terminal so it stays disabled.
    expect(screen.getByRole('button', { name: '🚫 Void' })).toBeDisabled();
    // Editing a SAT-cancelled invoice is blocked too (backend 422s it).
    expect(screen.getByRole('button', { name: '✏️ Edit' })).toBeDisabled();
  });
});

// ---------------------------------------------------------------------------
// Stamp-later (MX org): Stamp (SAT) button + modal
// ---------------------------------------------------------------------------

describe('InvoiceDetail stamp-later', () => {
  function wireStamp({ profile = { rfc: 'XAXX010101000', razon_social: 'Juana', uso_cfdi_default: 'G03' }, stampResult = { cfdi_document_id: 900, serie: 'A', uuid: 'SIM-1234', sat_status: 'vigente', stamped: true } } = {}) {
    mockAuthedFetch.mockImplementation((url: string, init?: { method?: string }) => {
      if (url.includes('/cfdi-documents')) return Promise.resolve({ ok: true, json: async () => ({ data: [] }) });
      if (url.includes('/mx-profile')) return Promise.resolve({ ok: true, json: async () => ({ data: profile }) });
      if (url.includes('/stamp') && init?.method === 'POST') {
        return Promise.resolve({ ok: true, json: async () => ({ data: stampResult }) });
      }
      if (url.includes('/plans/addons/catalog')) return Promise.resolve({ ok: true, json: async () => ({ data: productCatalog }) });
      return Promise.resolve({ ok: true, json: async () => ({ data: [] }) });
    });
  }

  it('never shows the Stamp button in a global-locale org', async () => {
    renderDetail();
    await waitFor(() => expect(screen.getByText('Setup Fee')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: '📜 Stamp (SAT)' })).not.toBeInTheDocument();
  });

  it('MX org: stamps via the modal and reports the UUID', async () => {
    authState.locale = 'MX';
    wireStamp();
    renderDetail();
    fireEvent.click(await screen.findByRole('button', { name: '📜 Stamp (SAT)' }));

    // Receptor preview from the client MX profile; PPD derived (issued invoice)
    expect(await screen.findByText(/XAXX010101000/)).toBeInTheDocument();
    expect(screen.getByText(/PPD \(payment pending/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Stamp now' }));

    await waitFor(() => {
      const call = mockAuthedFetch.mock.calls.find(([url, init]) =>
        (url as string).includes('/invoices/42/stamp') && (init as { method?: string })?.method === 'POST');
      expect(call).toBeDefined();
      expect(JSON.parse((call![1] as { body: string }).body)).toEqual({ uso_cfdi: 'G03' });
    });
    expect(await screen.findByText(/CFDI stamped — UUID SIM-1234/)).toBeInTheDocument();
  });

  it('blocks Stamp now when the client has no MX fiscal profile', async () => {
    authState.locale = 'MX';
    wireStamp({ profile: null as never });
    renderDetail();
    fireEvent.click(await screen.findByRole('button', { name: '📜 Stamp (SAT)' }));

    expect(await screen.findByText(/no MX fiscal profile/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Stamp now' })).toBeDisabled();
  });

  it('a retryable PAC failure surfaces as created-but-not-stamped', async () => {
    authState.locale = 'MX';
    wireStamp({ stampResult: { cfdi_document_id: 901, serie: 'A', uuid: null, sat_status: 'draft', stamped: false, stamp_error: 'PAC down' } as never });
    renderDetail();
    fireEvent.click(await screen.findByRole('button', { name: '📜 Stamp (SAT)' }));
    await screen.findByText(/XAXX010101000/);
    fireEvent.click(screen.getByRole('button', { name: 'Stamp now' }));

    expect(await screen.findByText(/CFDI created but stamping failed/)).toBeInTheDocument();
  });

  it('hides the Stamp button once a CFDI exists for the invoice', async () => {
    authState.locale = 'MX';
    wireAuthedFetch([vigenteDoc]); // existing helper: /cfdi-documents returns a vigente doc
    renderDetail();
    await waitFor(() => expect(screen.getByRole('button', { name: '✕ Cancel CFDI (SAT)' })).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: '📜 Stamp (SAT)' })).not.toBeInTheDocument();
  });

  it('a leftover draft CFDI shows Retry stamp (SAT) and resubmits the existing doc', async () => {
    authState.locale = 'MX';
    mockAuthedFetch.mockImplementation((url: string, init?: { method?: string }) => {
      if (url.includes('/cfdi-documents')) {
        return Promise.resolve({ ok: true, json: async () => ({ data: [{ id: 77, uuid: null, sat_status: 'draft' }] }) });
      }
      if (url.includes('/cfdi/stamp') && init?.method === 'POST') {
        return Promise.resolve({ ok: true, json: async () => ({ data: { uuid: 'SIM-RETRY-1', status: 'vigente' } }) });
      }
      return Promise.resolve({ ok: true, json: async () => ({ data: [] }) });
    });
    renderDetail();
    const retryBtn = await screen.findByRole('button', { name: '🔁 Retry stamp (SAT)' });
    // The convert button must NOT coexist with the draft (no duplicates).
    expect(screen.queryByRole('button', { name: '📜 Stamp (SAT)' })).not.toBeInTheDocument();
    fireEvent.click(retryBtn);

    await waitFor(() => {
      const call = mockAuthedFetch.mock.calls.find(([url, init]) =>
        (url as string).includes('/cfdi/stamp') && (init as { method?: string })?.method === 'POST');
      expect(call).toBeDefined();
      expect(JSON.parse((call![1] as { body: string }).body)).toEqual({ cfdi_document_id: 77 });
    });
    expect(await screen.findByText(/CFDI stamped — UUID SIM-RETRY-1/)).toBeInTheDocument();
  });

});
