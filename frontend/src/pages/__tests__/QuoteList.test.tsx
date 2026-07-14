// =============================================================================
// FireISP 5.0 — QuoteList page tests
// =============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
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
vi.mock('@/api/client', () => ({
  api: {
    GET: (...args: unknown[]) => mockApiGet(...args),
    POST: (...args: unknown[]) => mockApiPost(...args),
  },
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
  // subtotal/tax/total by hand. It now creates a minimal draft (client +
  // quote number + optional valid-until/tax-rate/notes) and navigates
  // straight to QuoteDetail to build line items — mirroring how invoices are
  // built (header first, then items), the same "create header, then
  // navigate" flow the PR brief asked for.
  it('New Quote creates a draft and navigates to its detail page', async () => {
    mockApiPost.mockResolvedValue({
      data: { data: { id: 42, client_id: 10, quote_number: 'QUO-000042', status: 'draft' } },
      error: undefined,
    });

    renderQuoteList();
    await waitFor(() => expect(screen.getByText('🧮 Quotes')).toBeInTheDocument());

    fireEvent.click(screen.getByText('+ New Quote'));
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'New quote' })).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText(/Client/), { target: { value: '10' } });
    fireEvent.change(screen.getByPlaceholderText('e.g. QUO-000001'), { target: { value: 'QUO-000042' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Quote' }));

    await waitFor(() => expect(mockApiPost).toHaveBeenCalledWith(
      '/quotes',
      expect.objectContaining({ body: expect.objectContaining({ client_id: 10, quote_number: 'QUO-000042' }) }),
    ));
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/quotes/42'));
  });

  it('New Quote modal requires a quote number before submitting', async () => {
    renderQuoteList();
    await waitFor(() => expect(screen.getByText('🧮 Quotes')).toBeInTheDocument());

    fireEvent.click(screen.getByText('+ New Quote'));
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'New quote' })).toBeInTheDocument());

    // quote_number is HTML-required (there is no server-side auto-generated
    // sequence for quotes, unlike invoices) — the browser blocks submission
    // before our own onSubmit guard even runs.
    fireEvent.change(screen.getByLabelText(/Client/), { target: { value: '10' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Quote' }));

    expect(mockApiPost).not.toHaveBeenCalled();
  });
});
