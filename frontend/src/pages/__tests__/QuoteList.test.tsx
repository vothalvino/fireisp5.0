// =============================================================================
// FireISP 5.0 — QuoteList page tests
// =============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { QuoteList } from '../QuoteList';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

const mockApiGet = vi.fn();
const mockApiPost = vi.fn();
// GenerateQuoteModal (opened by "New Quote") also fetches the product/add-on
// catalog via the raw authedFetch, not the typed `api` client — mock it too.
const mockAuthedFetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ data: [] }) });
vi.mock('@/api/client', () => ({
  api: {
    GET: (...args: unknown[]) => mockApiGet(...args),
    POST: (...args: unknown[]) => mockApiPost(...args),
  },
  authedFetch: (...args: unknown[]) => mockAuthedFetch(...args),
  tokenStore: { getAccess: () => 'tok', setAccess: vi.fn(), getRefresh: () => null, setRefresh: vi.fn(), clear: vi.fn() },
}));

const quote1 = {
  id: 1, client_id: 10, quote_number: 'QUO-000001', valid_until: '2025-01-01',
  subtotal: '100.00', tax_rate: '0.16', tax_amount: '16.00', total: '116.00',
  currency: 'MXN', notes: null, status: 'draft',
};
const client1 = { id: 10, name: 'María García' };

function renderQuoteList() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <QuoteList />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('QuoteList page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/quotes')
        return Promise.resolve({ data: { data: [quote1], meta: { total: 1, page: 1, limit: 25, totalPages: 1 } }, error: undefined });
      if (path === '/clients')
        return Promise.resolve({ data: { data: [client1] }, error: undefined });
      return Promise.resolve({ data: { data: [] }, error: undefined });
    });
  });

  it('renders the page heading', async () => {
    renderQuoteList();
    await waitFor(() => expect(screen.getByText('🧮 Quotes')).toBeInTheDocument());
  });

  it('renders a quote row with resolved client name', async () => {
    renderQuoteList();
    await waitFor(() => expect(screen.getByText('QUO-000001')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText('María García')).toBeInTheDocument());
  });

  it('shows empty message when no quotes', async () => {
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/quotes')
        return Promise.resolve({ data: { data: [], meta: { total: 0, page: 1, limit: 25, totalPages: 0 } }, error: undefined });
      return Promise.resolve({ data: { data: [] }, error: undefined });
    });
    renderQuoteList();
    await waitFor(() => expect(screen.getByText(/No quotes found/)).toBeInTheDocument());
  });

  it('the quote number links to the quote detail page', async () => {
    renderQuoteList();
    await waitFor(() => expect(screen.getByText('QUO-000001')).toBeInTheDocument());
    const link = screen.getByText('QUO-000001').closest('a');
    expect(link).toHaveAttribute('href', '/quotes/1');
  });

  // Regression: "New Quote" used to open a modal where the user typed
  // subtotal/tax/total by hand (then, briefly, a minimal draft-only modal
  // requiring a hand-typed quote number). It now opens GenerateQuoteModal —
  // the same all-at-once client + line-items builder invoices use — and
  // quote_number is auto-assigned server-side (migration 389), so the
  // create flow genuinely mirrors "make an invoice."
  it('New Quote opens GenerateQuoteModal, submits to /quotes/generate, and navigates to the new quote', async () => {
    const user = userEvent.setup();
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/quotes')
        return Promise.resolve({ data: { data: [quote1], meta: { total: 1, page: 1, limit: 25, totalPages: 1 } }, error: undefined });
      if (path === '/clients')
        return Promise.resolve({ data: { data: [client1] }, error: undefined });
      if (path === '/contracts')
        return Promise.resolve({ data: { data: [] }, error: undefined });
      return Promise.resolve({ data: { data: [] }, error: undefined });
    });
    mockApiPost.mockResolvedValue({
      data: { data: { id: 42, client_id: 10, quote_number: 'QUO-000042', status: 'draft' } },
      error: undefined,
    });

    renderQuoteList();
    await waitFor(() => expect(screen.getByText('🧮 Quotes')).toBeInTheDocument());

    fireEvent.click(screen.getByText('+ New Quote'));
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Generate Quote' })).toBeInTheDocument());

    // Pick the client, add a custom item (no product catalog needed here),
    // fill it in, and submit — mirroring GenerateInvoiceModal's flow exactly.
    // (The Client <label> isn't associated with its <select> — same
    // pre-existing gap as GenerateInvoiceModal, which this modal clones — so
    // find the select by its placeholder option rather than getByLabelText.
    // Must wait for the clients query to resolve before changing the select,
    // or the option doesn't exist yet and the change is silently dropped.)
    await screen.findByRole('option', { name: 'María García' });
    const clientSelect = screen.getByText('— select client —').closest('select')!;
    fireEvent.change(clientSelect, { target: { value: '10' } });
    await user.click(screen.getByTitle('Add Custom item'));
    fireEvent.change(screen.getByPlaceholderText('e.g. Site survey'), { target: { value: 'Site survey' } });
    fireEvent.change(screen.getByDisplayValue('1'), { target: { value: '2' } });
    fireEvent.change(screen.getByPlaceholderText('0.00'), { target: { value: '75' } });
    await user.click(screen.getByRole('button', { name: 'Generate' }));

    await waitFor(() => expect(mockApiPost).toHaveBeenCalledWith(
      '/quotes/generate',
      expect.objectContaining({
        body: expect.objectContaining({
          client_id: 10,
          items: [expect.objectContaining({ type: 'custom', description: 'Site survey', quantity: 2, unit_price: 75 })],
        }),
      }),
    ));
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/quotes/42'));
  });
});
