// =============================================================================
// FireISP 5.0 — ServiceAreaList page tests
// =============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { ServiceAreaList } from '../ServiceAreaList';

const mockApiGet = vi.fn();
vi.mock('@/api/client', () => ({
  api: { GET: (...args: unknown[]) => mockApiGet(...args) },
  tokenStore: { getAccess: () => 'tok', setAccess: vi.fn(), getRefresh: () => null, setRefresh: vi.fn(), clear: vi.fn() },
}));

const area1 = {
  id: 1, site_id: 3, name: 'Downtown Metro', description: 'Core city footprint',
  color: '#3B82F6', status: 'active',
};

function renderList() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <ServiceAreaList />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('ServiceAreaList page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/service-areas')
        return Promise.resolve({ data: { data: [area1], meta: { total: 1, page: 1, limit: 50, totalPages: 1 } }, error: undefined });
      return Promise.resolve({ data: { data: [] }, error: undefined });
    });
  });

  it('renders the page heading', async () => {
    renderList();
    await waitFor(() => expect(screen.getByText('🗺️ Service Areas')).toBeInTheDocument());
  });

  it('renders a service area row with its name and colour', async () => {
    renderList();
    await waitFor(() => expect(screen.getByText('Downtown Metro')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText('#3B82F6')).toBeInTheDocument());
  });

  it('shows empty message when no service areas', async () => {
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/service-areas')
        return Promise.resolve({ data: { data: [], meta: { total: 0, page: 1, limit: 50, totalPages: 0 } }, error: undefined });
      return Promise.resolve({ data: { data: [] }, error: undefined });
    });
    renderList();
    await waitFor(() => expect(screen.getByText(/No service areas found/)).toBeInTheDocument());
  });
});
