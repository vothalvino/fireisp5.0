// =============================================================================
// FireISP 5.0 — VlanList page tests
// =============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { VlanList } from '../VlanList';

const mockApiGet = vi.fn();
vi.mock('@/api/client', () => ({
  api: { GET: (...args: unknown[]) => mockApiGet(...args) },
  tokenStore: { getAccess: () => 'tok', setAccess: vi.fn(), getRefresh: () => null, setRefresh: vi.fn(), clear: vi.fn() },
}));

const vlan1 = {
  id: 1, vlan_id: 100, name: 'Client-Data', description: null, site_id: 5, status: 'active',
};

const site5 = { id: 5, name: 'Central POP' };

function renderList() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <VlanList />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('VlanList page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/vlans')
        return Promise.resolve({ data: { data: [vlan1], meta: { total: 1, page: 1, limit: 25, totalPages: 1 } }, error: undefined });
      if (path === '/sites')
        return Promise.resolve({ data: { data: [site5] }, error: undefined });
      return Promise.resolve({ data: { data: [] }, error: undefined });
    });
  });

  it('renders the page heading', async () => {
    renderList();
    await waitFor(() => expect(screen.getByText('🔌 VLANs')).toBeInTheDocument());
  });

  it('renders a VLAN row and resolves its site name', async () => {
    renderList();
    await waitFor(() => expect(screen.getByText('Client-Data')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText('Central POP')).toBeInTheDocument());
  });

  it('shows empty message when no VLANs', async () => {
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/vlans')
        return Promise.resolve({ data: { data: [], meta: { total: 0, page: 1, limit: 25, totalPages: 0 } }, error: undefined });
      return Promise.resolve({ data: { data: [] }, error: undefined });
    });
    renderList();
    await waitFor(() => expect(screen.getByText(/No VLANs found/)).toBeInTheDocument());
  });
});
