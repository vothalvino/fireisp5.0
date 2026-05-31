// =============================================================================
// FireISP 5.0 — IpAssignmentList page tests
// =============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { IpAssignmentList } from '../IpAssignmentList';

const mockApiGet = vi.fn();
vi.mock('@/api/client', () => ({
  api: { GET: (...args: unknown[]) => mockApiGet(...args) },
  tokenStore: { getAccess: () => 'tok', setAccess: vi.fn(), getRefresh: () => null, setRefresh: vi.fn(), clear: vi.fn() },
}));

const assignment1 = {
  id: 1, pool_id: 3, contract_id: null, device_id: null, ip_address: '10.0.0.5',
  prefix_len: null, type: 'static', notes: null, status: 'active',
};

const pool3 = { id: 3, name: 'Residential-Pool' };

function renderList() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <IpAssignmentList />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('IpAssignmentList page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/ip-assignments')
        return Promise.resolve({ data: { data: [assignment1], meta: { total: 1, page: 1, limit: 25, totalPages: 1 } }, error: undefined });
      if (path === '/ip-pools')
        return Promise.resolve({ data: { data: [pool3] }, error: undefined });
      return Promise.resolve({ data: { data: [] }, error: undefined });
    });
  });

  it('renders the page heading', async () => {
    renderList();
    await waitFor(() => expect(screen.getByText('🔢 IP Assignments')).toBeInTheDocument());
  });

  it('renders an assignment row and resolves its pool name', async () => {
    renderList();
    await waitFor(() => expect(screen.getByText('10.0.0.5')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText('Residential-Pool')).toBeInTheDocument());
  });

  it('shows empty message when no assignments', async () => {
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/ip-assignments')
        return Promise.resolve({ data: { data: [], meta: { total: 0, page: 1, limit: 25, totalPages: 0 } }, error: undefined });
      return Promise.resolve({ data: { data: [] }, error: undefined });
    });
    renderList();
    await waitFor(() => expect(screen.getByText(/No IP assignments found/)).toBeInTheDocument());
  });
});
