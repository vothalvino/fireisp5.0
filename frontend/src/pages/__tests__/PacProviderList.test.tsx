// =============================================================================
// FireISP 5.0 — PacProviderList page tests
// =============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { PacProviderList } from '../PacProviderList';

const mockApiGet = vi.fn();
vi.mock('@/api/client', () => ({
  api: { GET: (...args: unknown[]) => mockApiGet(...args) },
  tokenStore: { getAccess: () => 'tok', setAccess: vi.fn(), getRefresh: () => null, setRefresh: vi.fn(), clear: vi.fn() },
}));

const pac1 = {
  id: 1, provider_name: 'finkok', label: 'Finkok Producción', environment: 'production',
  api_url: 'https://facturacion.finkok.com', is_default: 1, status: 'active', last_stamp_at: null,
};

function renderList() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <PacProviderList />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('PacProviderList page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/pac-providers')
        return Promise.resolve({ data: { data: [pac1], meta: { total: 1, page: 1, limit: 50, totalPages: 1 } }, error: undefined });
      return Promise.resolve({ data: { data: [] }, error: undefined });
    });
  });

  it('renders the page heading', async () => {
    renderList();
    await waitFor(() => expect(screen.getByText('🧾 PAC Providers')).toBeInTheDocument());
  });

  it('renders a provider row with its label', async () => {
    renderList();
    await waitFor(() => expect(screen.getByText('Finkok Producción')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText('production')).toBeInTheDocument());
  });

  it('shows empty message when no providers', async () => {
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/pac-providers')
        return Promise.resolve({ data: { data: [], meta: { total: 0, page: 1, limit: 50, totalPages: 0 } }, error: undefined });
      return Promise.resolve({ data: { data: [] }, error: undefined });
    });
    renderList();
    await waitFor(() => expect(screen.getByText(/No PAC providers configured/)).toBeInTheDocument());
  });
});
