// =============================================================================
// FireISP 5.0 — RoleList page tests
// =============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { RoleList } from '../RoleList';

const mockApiGet = vi.fn();
vi.mock('@/api/client', () => ({
  api: { GET: (...args: unknown[]) => mockApiGet(...args) },
  tokenStore: { getAccess: () => 'tok', setAccess: vi.fn(), getRefresh: () => null, setRefresh: vi.fn(), clear: vi.fn() },
}));

const role1 = { id: 1, name: 'Support Agent', description: 'Handles tickets', is_system: 0 };

function renderList() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <RoleList />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('RoleList page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/roles')
        return Promise.resolve({ data: { data: [role1], meta: { total: 1, page: 1, limit: 50, totalPages: 1 } }, error: undefined });
      return Promise.resolve({ data: { data: [] }, error: undefined });
    });
  });

  it('renders the page heading', async () => {
    renderList();
    await waitFor(() => expect(screen.getByText('🛡️ Roles & Permissions')).toBeInTheDocument());
  });

  it('renders a role row with its description', async () => {
    renderList();
    await waitFor(() => expect(screen.getByText('Support Agent')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText('Handles tickets')).toBeInTheDocument());
  });

  it('shows empty message when no roles', async () => {
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/roles')
        return Promise.resolve({ data: { data: [], meta: { total: 0, page: 1, limit: 50, totalPages: 0 } }, error: undefined });
      return Promise.resolve({ data: { data: [] }, error: undefined });
    });
    renderList();
    await waitFor(() => expect(screen.getByText(/No roles found/)).toBeInTheDocument());
  });
});
