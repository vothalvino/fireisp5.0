// =============================================================================
// FireISP 5.0 — ContractList page tests
// =============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { ContractList } from '../ContractList';

// ---------------------------------------------------------------------------
// Mock API client
// ---------------------------------------------------------------------------

const mockApiGet = vi.fn();
vi.mock('@/api/client', () => ({
  api: { GET: (...args: unknown[]) => mockApiGet(...args) },
  tokenStore: { getAccess: () => 'tok', setAccess: vi.fn(), getRefresh: () => null, setRefresh: vi.fn(), clear: vi.fn() },
}));

const contract1 = {
  id: 1, client_id: 10, plan_id: 2, connection_type: 'fiber',
  start_date: '2024-01-01', end_date: null, billing_day: 1,
  ip_address: '10.0.0.1', price_override: null, status: 'active',
  facturar: true, notes: null,
};

function renderContractList() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <ContractList />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('ContractList page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/contracts')
        return Promise.resolve({ data: { data: [contract1], meta: { total: 1, page: 1, limit: 20, totalPages: 1 } }, error: undefined });
      if (path === '/plans')
        return Promise.resolve({ data: { data: [] }, error: undefined });
      if (path === '/clients')
        return Promise.resolve({ data: { data: [] }, error: undefined });
      return Promise.resolve({ data: { data: [] }, error: undefined });
    });
  });

  it('renders the page heading', async () => {
    renderContractList();
    await waitFor(() => expect(screen.getByText('📄 Contracts')).toBeInTheDocument());
  });

  it('renders a contract row after data loads', async () => {
    renderContractList();
    // IP address is shown in the table
    await waitFor(() => expect(screen.getByText('10.0.0.1')).toBeInTheDocument());
  });

  it('shows empty message when no contracts', async () => {
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/contracts')
        return Promise.resolve({ data: { data: [], meta: { total: 0, page: 1, limit: 20, totalPages: 0 } }, error: undefined });
      return Promise.resolve({ data: { data: [] }, error: undefined });
    });
    renderContractList();
    await waitFor(() => expect(screen.getByText(/No contracts found/)).toBeInTheDocument());
  });
});
