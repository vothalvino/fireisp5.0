// =============================================================================
// FireISP 5.0 — ConcessionTitleList page tests
// =============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { ConcessionTitleList } from '../ConcessionTitleList';

const mockApiGet = vi.fn();
vi.mock('@/api/client', () => ({
  api: { GET: (...args: unknown[]) => mockApiGet(...args) },
  tokenStore: { getAccess: () => 'tok', setAccess: vi.fn(), getRefresh: () => null, setRefresh: vi.fn(), clear: vi.fn() },
}));

const title1 = {
  id: 1, title_number: 'CT-2024-001', concession_type: 'commercial',
  regulatory_body: 'IFT', granted_date: '2024-01-15', expiration_date: '2044-01-15', status: 'active',
};

function renderList() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <ConcessionTitleList />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('ConcessionTitleList page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/concession-titles')
        return Promise.resolve({ data: { data: [title1], meta: { total: 1, page: 1, limit: 50, totalPages: 1 } }, error: undefined });
      return Promise.resolve({ data: { data: [] }, error: undefined });
    });
  });

  it('renders the page heading', async () => {
    renderList();
    await waitFor(() => expect(screen.getByText('📑 Concession Titles')).toBeInTheDocument());
  });

  it('renders a title row with its number', async () => {
    renderList();
    await waitFor(() => expect(screen.getByText('CT-2024-001')).toBeInTheDocument());
  });

  it('shows empty message when no titles', async () => {
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/concession-titles')
        return Promise.resolve({ data: { data: [], meta: { total: 0, page: 1, limit: 50, totalPages: 0 } }, error: undefined });
      return Promise.resolve({ data: { data: [] }, error: undefined });
    });
    renderList();
    await waitFor(() => expect(screen.getByText(/No concession titles registered/)).toBeInTheDocument());
  });
});
