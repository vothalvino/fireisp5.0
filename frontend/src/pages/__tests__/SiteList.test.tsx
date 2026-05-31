// =============================================================================
// FireISP 5.0 — SiteList page tests
// =============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { SiteList } from '../SiteList';

const mockApiGet = vi.fn();
vi.mock('@/api/client', () => ({
  api: { GET: (...args: unknown[]) => mockApiGet(...args) },
  tokenStore: { getAccess: () => 'tok', setAccess: vi.fn(), getRefresh: () => null, setRefresh: vi.fn(), clear: vi.fn() },
}));

const site1 = {
  id: 1, name: 'Central POP', site_type: 'pop', address: null, city: 'Monterrey',
  state: null, zip_code: null, country: 'MX', latitude: null, longitude: null,
  status: 'active', notes: null,
};

function renderSiteList() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <SiteList />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('SiteList page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/sites')
        return Promise.resolve({ data: { data: [site1], meta: { total: 1, page: 1, limit: 25, totalPages: 1 } }, error: undefined });
      return Promise.resolve({ data: { data: [] }, error: undefined });
    });
  });

  it('renders the page heading', async () => {
    renderSiteList();
    await waitFor(() => expect(screen.getByText('🏢 Sites')).toBeInTheDocument());
  });

  it('renders a site row after data loads', async () => {
    renderSiteList();
    await waitFor(() => expect(screen.getByText('Central POP')).toBeInTheDocument());
  });

  it('shows empty message when no sites', async () => {
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/sites')
        return Promise.resolve({ data: { data: [], meta: { total: 0, page: 1, limit: 25, totalPages: 0 } }, error: undefined });
      return Promise.resolve({ data: { data: [] }, error: undefined });
    });
    renderSiteList();
    await waitFor(() => expect(screen.getByText(/No sites found/)).toBeInTheDocument());
  });
});
