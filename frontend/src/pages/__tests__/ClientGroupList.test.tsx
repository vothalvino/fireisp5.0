// =============================================================================
// FireISP 5.0 — ClientGroupList page tests (§1.1)
// =============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { ClientGroupList } from '../ClientGroupList';

const mockApiGet = vi.fn();
vi.mock('@/api/client', () => ({
  api: {
    GET: (...args: unknown[]) => mockApiGet(...args),
    POST: vi.fn(),
    PUT: vi.fn(),
    DELETE: vi.fn(),
  },
  tokenStore: { getAccess: () => 'tok', setAccess: vi.fn(), getRefresh: () => null, setRefresh: vi.fn(), clear: vi.fn() },
}));

vi.mock('@/auth/AuthContext', () => ({
  useAuth: () => ({ user: { id: 1, role: 'admin' } }),
}));

const group1 = {
  id: 1, name: 'Familia García', billing_mode: 'shared',
  primary_client_id: 7, notes: 'Shared home plan', created_at: '2024-01-01',
};

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <ClientGroupList />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('ClientGroupList page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiGet.mockResolvedValue({
      data: { data: [group1], meta: { total: 1, page: 1, limit: 200, totalPages: 1 } },
      error: undefined,
    });
  });

  it('renders the page heading', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('Account Groups')).toBeInTheDocument());
  });

  it('renders a group row after data loads', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('Familia García')).toBeInTheDocument());
  });

  it('shows the empty state when there are no groups', async () => {
    mockApiGet.mockResolvedValue({
      data: { data: [], meta: { total: 0, page: 1, limit: 200, totalPages: 0 } },
      error: undefined,
    });
    renderPage();
    await waitFor(() => expect(screen.getByText('No account groups yet.')).toBeInTheDocument());
  });
});
