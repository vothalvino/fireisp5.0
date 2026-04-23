// =============================================================================
// FireISP 5.0 — InvoiceList page tests
// =============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { InvoiceList } from '../InvoiceList';

// ---------------------------------------------------------------------------
// Mock API client + fetch
// ---------------------------------------------------------------------------

const mockApiGet = vi.fn();
vi.mock('@/api/client', () => ({
  api: { GET: (...args: unknown[]) => mockApiGet(...args) },
  tokenStore: { getAccess: () => 'tok', setAccess: vi.fn(), getRefresh: () => null, setRefresh: vi.fn(), clear: vi.fn() },
}));

const invoice1 = {
  id: 1, client_id: 10, contract_id: 5,
  invoice_number: 'INV-2024-001', subtotal: '500', tax_amount: '80', total: '580',
  currency: 'MXN', due_date: '2024-02-01', paid_at: null, status: 'pending', created_at: '2024-01-01',
};

function renderInvoiceList() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <InvoiceList />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('InvoiceList page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/invoices')
        return Promise.resolve({ data: { data: [invoice1], meta: { total: 1, page: 1, limit: 20, totalPages: 1 } }, error: undefined });
      if (path === '/clients')
        return Promise.resolve({ data: { data: [] }, error: undefined });
      if (path === '/contracts')
        return Promise.resolve({ data: { data: [] }, error: undefined });
      return Promise.resolve({ data: { data: [] }, error: undefined });
    });
  });

  it('renders the page heading', async () => {
    renderInvoiceList();
    await waitFor(() => expect(screen.getByText('🧾 Invoices')).toBeInTheDocument());
  });

  it('renders an invoice row after data loads', async () => {
    renderInvoiceList();
    await waitFor(() => expect(screen.getByText('INV-2024-001')).toBeInTheDocument());
  });

  it('shows empty state when no invoices', async () => {
    mockApiGet.mockResolvedValue({ data: { data: [], meta: { total: 0, page: 1, limit: 20, totalPages: 0 } }, error: undefined });
    renderInvoiceList();
    await waitFor(() => expect(screen.getByText('No invoices found.')).toBeInTheDocument());
  });
});
