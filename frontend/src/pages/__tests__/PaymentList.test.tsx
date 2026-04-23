// =============================================================================
// FireISP 5.0 — PaymentList page tests
// =============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { PaymentList } from '../PaymentList';

// ---------------------------------------------------------------------------
// Mock API client + fetch
// ---------------------------------------------------------------------------

const mockApiGet = vi.fn();
vi.mock('@/api/client', () => ({
  api: { GET: (...args: unknown[]) => mockApiGet(...args) },
  tokenStore: { getAccess: () => 'tok', setAccess: vi.fn(), getRefresh: () => null, setRefresh: vi.fn(), clear: vi.fn() },
}));

const payment1 = {
  id: 1, client_id: 10, amount: '580', currency: 'MXN',
  payment_method: 'cash', reference: 'REF-001', status: 'completed',
  payment_date: '2024-01-15', created_at: '2024-01-15',
};

function renderPaymentList() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <PaymentList />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('PaymentList page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // PaymentList uses api.GET for /payments and /clients
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/payments')
        return Promise.resolve({ data: { data: [payment1], meta: { total: 1, page: 1, limit: 20, totalPages: 1 } }, error: undefined });
      if (path === '/clients')
        return Promise.resolve({ data: { data: [] }, error: undefined });
      return Promise.resolve({ data: { data: [] }, error: undefined });
    });
    // fetchInvoices for open invoices in RecordPaymentForm uses raw fetch
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: [] }),
    } as Response);
  });

  it('renders the page heading', async () => {
    renderPaymentList();
    await waitFor(() => expect(screen.getByText('💳 Payments')).toBeInTheDocument());
  });

  it('renders a payment row after data loads', async () => {
    renderPaymentList();
    await waitFor(() => expect(screen.getByText('REF-001')).toBeInTheDocument());
  });
});
