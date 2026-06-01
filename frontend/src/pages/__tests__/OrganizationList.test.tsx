// =============================================================================
// FireISP 5.0 — OrganizationList page tests
// =============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { OrganizationList } from '../OrganizationList';

const mockApiGet = vi.fn();
vi.mock('@/api/client', () => ({
  api: { GET: (...args: unknown[]) => mockApiGet(...args) },
  tokenStore: { getAccess: () => 'tok', setAccess: vi.fn(), getRefresh: () => null, setRefresh: vi.fn(), clear: vi.fn() },
}));

const org1 = {
  id: 1, name: 'Acme ISP', legal_name: 'Acme S.A.', email: 'ops@acme.mx',
  phone: null, website: null, address: null, city: null, state: null,
  zip_code: null, country: null, locale: 'MX', tax_id: null, logo_url: null, status: 'active',
};

function renderList() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <OrganizationList />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('OrganizationList page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/organizations')
        return Promise.resolve({ data: { data: [org1], meta: { total: 1, page: 1, limit: 25, totalPages: 1 } }, error: undefined });
      return Promise.resolve({ data: { data: {} }, error: undefined });
    });
  });

  it('renders the page heading', async () => {
    renderList();
    await waitFor(() => expect(screen.getByText('🏢 Organizations')).toBeInTheDocument());
  });

  it('renders an organization row with its name', async () => {
    renderList();
    await waitFor(() => expect(screen.getByText('Acme ISP')).toBeInTheDocument());
  });

  it('shows empty message when no organizations', async () => {
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/organizations')
        return Promise.resolve({ data: { data: [], meta: { total: 0, page: 1, limit: 25, totalPages: 0 } }, error: undefined });
      return Promise.resolve({ data: { data: {} }, error: undefined });
    });
    renderList();
    await waitFor(() => expect(screen.getByText(/No organizations found/)).toBeInTheDocument());
  });
});
