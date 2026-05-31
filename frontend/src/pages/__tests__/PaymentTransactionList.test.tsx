// =============================================================================
// FireISP 5.0 — PaymentTransactionList page tests
// =============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { PaymentTransactionList } from '../PaymentTransactionList';

const mockApiGet = vi.fn();
vi.mock('@/api/client', () => ({
  api: { GET: (...args: unknown[]) => mockApiGet(...args) },
  tokenStore: { getAccess: () => 'tok', setAccess: vi.fn(), getRefresh: () => null, setRefresh: vi.fn(), clear: vi.fn() },
}));

const tx1 = {
  id: 1, payment_id: 5, payment_gateway_id: 2, client_id: 7,
  gateway_reference_id: 'ch_123abc', amount: 499.0, currency: 'MXN',
  gateway_status: 'succeeded', gateway_response_code: 'approved', created_at: '2026-01-15T10:00:00Z',
};

function renderList() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <PaymentTransactionList />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('PaymentTransactionList page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/payment-transactions')
        return Promise.resolve({ data: { data: [tx1], meta: { total: 1, page: 1, limit: 50, totalPages: 1 } }, error: undefined });
      return Promise.resolve({ data: { data: [] }, error: undefined });
    });
  });

  it('renders the page heading', async () => {
    renderList();
    await waitFor(() => expect(screen.getByText('🧾 Payment Transactions')).toBeInTheDocument());
  });

  it('renders a transaction row with its reference and amount', async () => {
    renderList();
    await waitFor(() => expect(screen.getByText('ch_123abc')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText('499.00 MXN')).toBeInTheDocument());
  });

  it('shows empty message when no transactions', async () => {
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/payment-transactions')
        return Promise.resolve({ data: { data: [], meta: { total: 0, page: 1, limit: 50, totalPages: 0 } }, error: undefined });
      return Promise.resolve({ data: { data: [] }, error: undefined });
    });
    renderList();
    await waitFor(() => expect(screen.getByText(/No payment transactions found/)).toBeInTheDocument());
  });
});
