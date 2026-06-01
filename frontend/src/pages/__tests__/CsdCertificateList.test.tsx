// =============================================================================
// FireISP 5.0 — CsdCertificateList page tests
// =============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { CsdCertificateList } from '../CsdCertificateList';

const mockApiGet = vi.fn();
vi.mock('@/api/client', () => ({
  api: { GET: (...args: unknown[]) => mockApiGet(...args) },
  tokenStore: { getAccess: () => 'tok', setAccess: vi.fn(), getRefresh: () => null, setRefresh: vi.fn(), clear: vi.fn() },
}));

const cert1 = {
  id: 1, rfc: 'AAA010101AAA', certificate_number: '30001000000400002434',
  valid_from: '2024-01-01T00:00:00Z', valid_to: '2028-01-01T00:00:00Z', is_active: 1, status: 'active',
};

function renderList() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <CsdCertificateList />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('CsdCertificateList page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/csd-certificates')
        return Promise.resolve({ data: { data: [cert1], meta: { total: 1, page: 1, limit: 50, totalPages: 1 } }, error: undefined });
      return Promise.resolve({ data: { data: [] }, error: undefined });
    });
  });

  it('renders the page heading', async () => {
    renderList();
    await waitFor(() => expect(screen.getByText('📜 CSD Certificates')).toBeInTheDocument());
  });

  it('renders a certificate row with its RFC', async () => {
    renderList();
    await waitFor(() => expect(screen.getByText('AAA010101AAA')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText('30001000000400002434')).toBeInTheDocument());
  });

  it('shows empty message when no certificates', async () => {
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/csd-certificates')
        return Promise.resolve({ data: { data: [], meta: { total: 0, page: 1, limit: 50, totalPages: 0 } }, error: undefined });
      return Promise.resolve({ data: { data: [] }, error: undefined });
    });
    renderList();
    await waitFor(() => expect(screen.getByText(/No CSD certificates registered/)).toBeInTheDocument());
  });
});
