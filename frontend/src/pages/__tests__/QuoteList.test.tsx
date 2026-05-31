// =============================================================================
// FireISP 5.0 — QuoteList page tests
// =============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { QuoteList } from '../QuoteList';

const mockApiGet = vi.fn();
vi.mock('@/api/client', () => ({
  api: { GET: (...args: unknown[]) => mockApiGet(...args) },
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
});
