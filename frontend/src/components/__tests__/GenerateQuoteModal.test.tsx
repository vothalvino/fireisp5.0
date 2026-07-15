// =============================================================================
// FireISP 5.0 — GenerateQuoteModal tests
// =============================================================================
// A clone of GenerateInvoiceModal.test.tsx — same coverage, since
// GenerateQuoteModal is itself a clone of GenerateInvoiceModal:
//   - Product line items pick from the add-on catalog and auto-fill the price
//   - The contract picker appears ONLY for contract-charge items
//   - lockedClientId pre-fills + locks the client
//   - Submit posts { client_id, items } to /quotes/generate
// =============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Mock the API client (openapi-fetch `api` + raw `authedFetch`).
vi.mock('@/api/client', () => ({
  api: { GET: vi.fn(), POST: vi.fn() },
  authedFetch: vi.fn(),
  tokenStore: {
    getAccess: () => 'test-token', setAccess: vi.fn(),
    getRefresh: () => null, setRefresh: vi.fn(), clear: vi.fn(),
  },
}));

import { api, authedFetch } from '@/api/client';
import { GenerateQuoteModal } from '../GenerateQuoteModal';

const CLIENTS = [{ id: 5, name: 'Acme Corp' }, { id: 6, name: 'Globex' }];
const CONTRACTS = [{ id: 11, client_id: 5 }, { id: 12, client_id: 6 }];
const ADDONS = [
  { id: 1, name: 'Static IP', price: '50.00' },
  { id: 2, name: 'Router rental', price: 150 },
];

function setupApi() {
  (api.GET as unknown as ReturnType<typeof vi.fn>).mockImplementation((path: string) => {
    if (path === '/clients') return Promise.resolve({ data: { data: CLIENTS }, error: undefined });
    if (path === '/contracts') return Promise.resolve({ data: { data: CONTRACTS }, error: undefined });
    return Promise.resolve({ data: { data: [] }, error: undefined });
  });
  (api.POST as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { data: { id: 99, quote_number: 'QUO-000099' } }, error: undefined });
  // Branch by URL — the addon catalog and the (Inventory follow-up) sellable
  // inventory items fetch both go through authedFetch; a blanket
  // mockResolvedValue would leak the ADDONS fixture into the items fetch too
  // (same id space, producing bogus duplicate-looking options).
  (authedFetch as unknown as ReturnType<typeof vi.fn>).mockImplementation((url: string) => {
    if (url.includes('/plans/addons/catalog')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: ADDONS }) });
    }
    if (url.includes('/inventory/items')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: [] }) });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: [] }) });
  });
}

function renderModal(lockedClientId: number | undefined = 5) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onClose = vi.fn();
  const onGenerated = vi.fn();
  render(
    <QueryClientProvider client={qc}>
      <GenerateQuoteModal lockedClientId={lockedClientId} lockedClientName="Acme Corp" onClose={onClose} onGenerated={onGenerated} />
    </QueryClientProvider>,
  );
  return { onClose, onGenerated };
}

beforeEach(() => {
  vi.clearAllMocks();
  setupApi();
});

describe('GenerateQuoteModal', () => {
  it('locks the client to its name and starts with no line items', async () => {
    renderModal();
    expect(await screen.findByRole('option', { name: 'Acme Corp' })).toBeInTheDocument();
    expect(screen.getByText(/Use the buttons above to add items/i)).toBeInTheDocument();
  });

  it('adds a Product line backed by the add-on catalog (no contract picker)', async () => {
    const user = userEvent.setup();
    renderModal();
    await user.click(screen.getByTitle('Add Product'));
    expect(await screen.findByRole('option', { name: /Static IP \(50\.00\)/ })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Router rental \(150\.00\)/ })).toBeInTheDocument();
    expect(screen.getByText('1. Product')).toBeInTheDocument();
    // A product line must NOT ask for a contract
    expect(screen.queryByRole('option', { name: '— select contract —' })).not.toBeInTheDocument();
  });

  it('auto-fills the unit price when a catalog product is chosen', async () => {
    const user = userEvent.setup();
    renderModal();
    await user.click(screen.getByTitle('Add Product'));
    const opt = await screen.findByRole('option', { name: /Static IP \(50\.00\)/ }) as HTMLOptionElement;
    await user.selectOptions(opt.closest('select')!, '1');
    expect(screen.getByDisplayValue('50.00')).toBeInTheDocument();
  });

  it('shows the contract picker ONLY for a contract-charge item', async () => {
    const user = userEvent.setup();
    renderModal();
    // a product line shows no contract picker
    await user.click(screen.getByTitle('Add Product'));
    await screen.findByRole('option', { name: /Static IP/ });
    expect(screen.queryByRole('option', { name: '— select contract —' })).not.toBeInTheDocument();
    // a contract-charge line shows the locked client's contract only
    await user.click(screen.getByTitle('Add Contract charge'));
    expect(await screen.findByRole('option', { name: 'Contract #11' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Contract #12' })).not.toBeInTheDocument();
  });

  it('posts { client_id, items } to /quotes/generate on submit and returns the created quote', async () => {
    const user = userEvent.setup();
    const { onGenerated } = renderModal();
    await user.click(screen.getByTitle('Add Product'));
    const opt = await screen.findByRole('option', { name: /Static IP/ }) as HTMLOptionElement;
    await user.selectOptions(opt.closest('select')!, '1');
    await user.click(screen.getByRole('button', { name: 'Generate' }));

    await waitFor(() => expect(api.POST).toHaveBeenCalled());
    const [path, opts] = (api.POST as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(path).toBe('/quotes/generate');
    expect(opts.body.client_id).toBe(5);
    expect(opts.body.items[0]).toMatchObject({ type: 'product', description: 'Static IP', unit_price: 50 });
    await waitFor(() => expect(onGenerated).toHaveBeenCalledWith({ id: 99, quote_number: 'QUO-000099' }));
  });

  // Inventory follow-up: the product picker also offers raw inventory items
  // not already linked by a curated addon, de-duping against linked ones.
  it('unions in a raw inventory item and hides one already linked by an addon', async () => {
    (authedFetch as unknown as ReturnType<typeof vi.fn>).mockImplementation((url: string) => {
      if (url.includes('/plans/addons/catalog')) {
        // ADDONS[1] ("Router rental") is linked to inventory_item_id 55.
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ data: [ADDONS[0], { ...ADDONS[1], inventory_item_id: 55 }] }),
        });
      }
      if (url.includes('/inventory/items')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            data: [
              { id: 55, name: 'Router rental', sku: 'RT-55', sale_price: null, unit_cost: '30.00', status: 'active' },
              { id: 56, name: 'Loose Cable', sku: 'CBL-1', sale_price: '9.99', unit_cost: null, status: 'active' },
            ],
          }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: [] }) });
    });

    const user = userEvent.setup();
    renderModal();
    await user.click(screen.getByTitle('Add Product'));

    // The raw item NOT linked by any addon appears in the union.
    expect(await screen.findByRole('option', { name: /Loose Cable \(CBL-1\) \(9\.99\)/ })).toBeInTheDocument();
    // The raw item that IS already linked by addon id 2 does NOT get a
    // second, duplicate entry — only the curated addon's option exists.
    expect(screen.queryByRole('option', { name: /Router rental \(RT-55\)/ })).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: /^Router rental \(150\.00\)$/ })).toBeInTheDocument();
  });

  // Gap this brief closes: /quotes/generate now accepts inventory_item_id
  // on product lines, so the modal must send it when a stock-backed catalog
  // entry is picked.
  it('carries inventory_item_id when a stock-backed addon is picked', async () => {
    (authedFetch as unknown as ReturnType<typeof vi.fn>).mockImplementation((url: string) => {
      if (url.includes('/plans/addons/catalog')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ data: [{ ...ADDONS[1], inventory_item_id: 55 }] }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: [] }) });
    });

    const user = userEvent.setup();
    const { onGenerated } = renderModal();
    await user.click(screen.getByTitle('Add Product'));
    const opt = await screen.findByRole('option', { name: /Router rental/ }) as HTMLOptionElement;
    await user.selectOptions(opt.closest('select')!, '2');
    await user.click(screen.getByRole('button', { name: 'Generate' }));

    await waitFor(() => expect(api.POST).toHaveBeenCalled());
    const [, opts] = (api.POST as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(opts.body.items[0]).toMatchObject({ type: 'product', inventory_item_id: 55 });
    await waitFor(() => expect(onGenerated).toHaveBeenCalled());
  });

  it('omits inventory_item_id for a plain (non-linked) catalog product', async () => {
    // Default setupApi() fixture: ADDONS have no inventory_item_id at all.
    const user = userEvent.setup();
    const { onGenerated } = renderModal();
    await user.click(screen.getByTitle('Add Product'));
    const opt = await screen.findByRole('option', { name: /Static IP/ }) as HTMLOptionElement;
    await user.selectOptions(opt.closest('select')!, '1');
    await user.click(screen.getByRole('button', { name: 'Generate' }));

    await waitFor(() => expect(api.POST).toHaveBeenCalled());
    const [, opts] = (api.POST as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(opts.body.items[0]).not.toHaveProperty('inventory_item_id');
    await waitFor(() => expect(onGenerated).toHaveBeenCalled());
  });

  it('omits inventory_item_id for a Custom (free-text) item', async () => {
    const user = userEvent.setup();
    const { onGenerated } = renderModal();
    await user.click(screen.getByTitle('Add Custom item'));
    await user.type(screen.getByPlaceholderText('e.g. Site survey'), 'Setup fee');
    await user.type(screen.getByPlaceholderText('0.00'), '25');
    await user.click(screen.getByRole('button', { name: 'Generate' }));

    await waitFor(() => expect(api.POST).toHaveBeenCalled());
    const [, opts] = (api.POST as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(opts.body.items[0]).not.toHaveProperty('inventory_item_id');
    await waitFor(() => expect(onGenerated).toHaveBeenCalled());
  });

  it('rejects a fractional quantity for a stock-backed selection and never submits', async () => {
    (authedFetch as unknown as ReturnType<typeof vi.fn>).mockImplementation((url: string) => {
      if (url.includes('/plans/addons/catalog')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ data: [{ ...ADDONS[1], inventory_item_id: 55 }] }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: [] }) });
    });

    const user = userEvent.setup();
    renderModal();
    await user.click(screen.getByTitle('Add Product'));
    const opt = await screen.findByRole('option', { name: /Router rental/ }) as HTMLOptionElement;
    await user.selectOptions(opt.closest('select')!, '2');
    // Quantity defaults to '1' and is the only field showing that value at
    // this point (unit price is auto-filled to '150.00' by the selection).
    const qtyInput = screen.getByDisplayValue('1');
    fireEvent.change(qtyInput, { target: { value: '1.5' } });
    // fireEvent.submit bypasses the native HTML5 step-mismatch block a real
    // click would also trigger (step="1" once a stock-backed product is
    // selected) — this targets OUR OWN JS-level integer check in
    // handleSubmit, mirroring InvoiceDetail.test.tsx's identical pattern.
    fireEvent.submit(qtyInput.closest('form')!);

    expect(await screen.findByText(/whole number/i)).toBeInTheDocument();
    expect(api.POST).not.toHaveBeenCalled();
  });
});
