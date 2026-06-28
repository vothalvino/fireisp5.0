// =============================================================================
// FireISP 5.0 — GenerateInvoiceModal tests
// =============================================================================
// Covers the shared invoice builder's key behaviors:
//   - Product line items pick from the add-on catalog and auto-fill the price
//   - The contract picker appears ONLY for contract-charge items
//   - lockedClientId pre-fills + locks the client
//   - Submit posts { client_id, items } to /invoices/generate
// =============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
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
import { GenerateInvoiceModal } from '../GenerateInvoiceModal';

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
  (api.POST as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { data: { id: 99 } }, error: undefined });
  (authedFetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
    ok: true, json: () => Promise.resolve({ data: ADDONS }),
  });
}

function renderModal(lockedClientId: number | undefined = 5) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onClose = vi.fn();
  const onGenerated = vi.fn();
  render(
    <QueryClientProvider client={qc}>
      <GenerateInvoiceModal lockedClientId={lockedClientId} lockedClientName="Acme Corp" onClose={onClose} onGenerated={onGenerated} />
    </QueryClientProvider>,
  );
  return { onClose, onGenerated };
}

beforeEach(() => {
  vi.clearAllMocks();
  setupApi();
});

describe('GenerateInvoiceModal', () => {
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

  it('posts { client_id, items } to /invoices/generate on submit', async () => {
    const user = userEvent.setup();
    const { onGenerated } = renderModal();
    await user.click(screen.getByTitle('Add Product'));
    const opt = await screen.findByRole('option', { name: /Static IP/ }) as HTMLOptionElement;
    await user.selectOptions(opt.closest('select')!, '1');
    await user.click(screen.getByRole('button', { name: 'Generate' }));

    await waitFor(() => expect(api.POST).toHaveBeenCalled());
    const [path, opts] = (api.POST as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(path).toBe('/invoices/generate');
    expect(opts.body.client_id).toBe(5);
    expect(opts.body.items[0]).toMatchObject({ type: 'product', description: 'Static IP', unit_price: 50 });
    await waitFor(() => expect(onGenerated).toHaveBeenCalled());
  });
});
