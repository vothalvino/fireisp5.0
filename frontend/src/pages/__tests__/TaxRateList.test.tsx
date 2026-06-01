// =============================================================================
// FireISP 5.0 — TaxRateList page tests
// =============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { TaxRateList } from '../TaxRateList';

const mockApiGet = vi.fn();
vi.mock('@/api/client', () => ({
  api: { GET: (...args: unknown[]) => mockApiGet(...args) },
  tokenStore: { getAccess: () => 'tok', setAccess: vi.fn(), getRefresh: () => null, setRefresh: vi.fn(), clear: vi.fn() },
}));

const rate1 = {
  id: 1, name: 'IVA 16%', rate: 0.16, description: 'Impuesto al valor agregado',
  is_default: 1, status: 'active',
};

function renderList() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <TaxRateList />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('TaxRateList page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/tax-rates')
        return Promise.resolve({ data: { data: [rate1], meta: { total: 1, page: 1, limit: 25, totalPages: 1 } }, error: undefined });
      return Promise.resolve({ data: { data: [] }, error: undefined });
    });
  });

  it('renders the page heading', async () => {
    renderList();
    await waitFor(() => expect(screen.getByText('🧮 Tax Rates')).toBeInTheDocument());
  });

  it('renders a tax rate row with its formatted rate', async () => {
    renderList();
    await waitFor(() => expect(screen.getByText('IVA 16%')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText('16.00%')).toBeInTheDocument());
  });

  it('shows empty message when no tax rates', async () => {
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/tax-rates')
        return Promise.resolve({ data: { data: [], meta: { total: 0, page: 1, limit: 25, totalPages: 0 } }, error: undefined });
      return Promise.resolve({ data: { data: [] }, error: undefined });
    });
    renderList();
    await waitFor(() => expect(screen.getByText(/No tax rates found/)).toBeInTheDocument());
  });
});
