// =============================================================================
// FireISP 5.0 — ApiTokenList page tests
// =============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { ApiTokenList } from '../ApiTokenList';

const mockApiGet = vi.fn();
vi.mock('@/api/client', () => ({
  api: { GET: (...args: unknown[]) => mockApiGet(...args) },
  tokenStore: { getAccess: () => 'tok', setAccess: vi.fn(), getRefresh: () => null, setRefresh: vi.fn(), clear: vi.fn() },
}));

const token1 = {
  id: 1, name: 'Grafana read-only', scopes: ['clients.read'],
  last_used_at: null, expires_at: null, revoked_at: null,
};

function renderList() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <ApiTokenList />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('ApiTokenList page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/api-tokens')
        return Promise.resolve({ data: { data: [token1], meta: { total: 1, page: 1, limit: 25, totalPages: 1 } }, error: undefined });
      return Promise.resolve({ data: { data: [] }, error: undefined });
    });
  });

  it('renders the page heading', async () => {
    renderList();
    await waitFor(() => expect(screen.getByText('🔑 API Tokens')).toBeInTheDocument());
  });

  it('renders a token row with its name and scopes', async () => {
    renderList();
    await waitFor(() => expect(screen.getByText('Grafana read-only')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText('clients.read')).toBeInTheDocument());
  });

  it('shows empty message when no tokens', async () => {
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/api-tokens')
        return Promise.resolve({ data: { data: [], meta: { total: 0, page: 1, limit: 25, totalPages: 0 } }, error: undefined });
      return Promise.resolve({ data: { data: [] }, error: undefined });
    });
    renderList();
    await waitFor(() => expect(screen.getByText(/No API tokens found/)).toBeInTheDocument());
  });
});
