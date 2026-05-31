// =============================================================================
// FireISP 5.0 — IpPoolList page tests
// =============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { IpPoolList } from '../IpPoolList';

const mockApiGet = vi.fn();
vi.mock('@/api/client', () => ({
  api: { GET: (...args: unknown[]) => mockApiGet(...args) },
  tokenStore: { getAccess: () => 'tok', setAccess: vi.fn(), getRefresh: () => null, setRefresh: vi.fn(), clear: vi.fn() },
}));

const pool1 = {
  id: 1, name: 'Residential-Pool', network: '10.0.0.0', subnet_mask: '255.255.255.0',
  gateway: '10.0.0.1', ip_version: '4', dns_primary: null, dns_secondary: null,
  pool_type: 'dynamic', site_id: 5, notes: null, status: 'active',
};

const site5 = { id: 5, name: 'Central POP' };

function renderIpPoolList() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <IpPoolList />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('IpPoolList page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/ip-pools')
        return Promise.resolve({ data: { data: [pool1], meta: { total: 1, page: 1, limit: 25, totalPages: 1 } }, error: undefined });
      if (path === '/sites')
        return Promise.resolve({ data: { data: [site5] }, error: undefined });
      return Promise.resolve({ data: { data: [] }, error: undefined });
    });
  });

  it('renders the page heading', async () => {
    renderIpPoolList();
    await waitFor(() => expect(screen.getByText('🌐 IP Pools')).toBeInTheDocument());
  });

  it('renders a pool row and resolves its site name', async () => {
    renderIpPoolList();
    await waitFor(() => expect(screen.getByText('Residential-Pool')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText('Central POP')).toBeInTheDocument());
  });

  it('shows empty message when no pools', async () => {
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/ip-pools')
        return Promise.resolve({ data: { data: [], meta: { total: 0, page: 1, limit: 25, totalPages: 0 } }, error: undefined });
      return Promise.resolve({ data: { data: [] }, error: undefined });
    });
    renderIpPoolList();
    await waitFor(() => expect(screen.getByText(/No IP pools found/)).toBeInTheDocument());
  });
});
