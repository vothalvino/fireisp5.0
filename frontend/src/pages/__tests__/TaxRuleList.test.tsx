// =============================================================================
// FireISP 5.0 — TaxRuleList page tests
// =============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { TaxRuleList } from '../TaxRuleList';

const mockApiGet = vi.fn();
vi.mock('@/api/client', () => ({
  api: { GET: (...args: unknown[]) => mockApiGet(...args) },
  tokenStore: { getAccess: () => 'tok', setAccess: vi.fn(), getRefresh: () => null, setRefresh: vi.fn(), clear: vi.fn() },
}));

const rule1 = {
  id: 1, name: 'IVA General', region: 'Nacional', tax_type: 'vat', rate: 0.16,
  is_default: 1, status: 'active',
};

function renderList() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <TaxRuleList />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('TaxRuleList page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/tax-rules')
        return Promise.resolve({ data: { data: [rule1], meta: { total: 1, page: 1, limit: 25, totalPages: 1 } }, error: undefined });
      return Promise.resolve({ data: { data: [] }, error: undefined });
    });
  });

  it('renders the page heading', async () => {
    renderList();
    await waitFor(() => expect(screen.getByText('🧾 Tax Rules')).toBeInTheDocument());
  });

  it('renders a tax rule row with its formatted rate', async () => {
    renderList();
    await waitFor(() => expect(screen.getByText('IVA General')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText('16.00%')).toBeInTheDocument());
  });

  it('shows empty message when no tax rules', async () => {
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/tax-rules')
        return Promise.resolve({ data: { data: [], meta: { total: 0, page: 1, limit: 25, totalPages: 0 } }, error: undefined });
      return Promise.resolve({ data: { data: [] }, error: undefined });
    });
    renderList();
    await waitFor(() => expect(screen.getByText(/No tax rules found/)).toBeInTheDocument());
  });
});
