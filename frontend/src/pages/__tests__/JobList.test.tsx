// =============================================================================
// FireISP 5.0 — JobList page tests
// =============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { JobList } from '../JobList';

const mockApiGet = vi.fn();
vi.mock('@/api/client', () => ({
  api: { GET: (...args: unknown[]) => mockApiGet(...args) },
  tokenStore: { getAccess: () => 'tok', setAccess: vi.fn(), getRefresh: () => null, setRefresh: vi.fn(), clear: vi.fn() },
}));

const job1 = {
  id: 7, client_id: 3, contract_id: null, ticket_id: null, assigned_to: 12,
  title: 'Fiber install - Calle 5', type: 'installation', priority: 'high',
  status: 'scheduled', scheduled_date: '2026-06-02T09:00:00Z', completed_date: null,
};

function renderList() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <JobList />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('JobList page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/jobs')
        return Promise.resolve({ data: { data: [job1], meta: { total: 1, page: 1, limit: 50, totalPages: 1 } }, error: undefined });
      return Promise.resolve({ data: { data: [] }, error: undefined });
    });
  });

  it('renders the page heading', async () => {
    renderList();
    await waitFor(() => expect(screen.getByText('🛠️ Field Jobs')).toBeInTheDocument());
  });

  it('renders a job row with its title and status', async () => {
    renderList();
    await waitFor(() => expect(screen.getByText('Fiber install - Calle 5')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText('scheduled')).toBeInTheDocument());
  });

  it('shows empty message when no jobs', async () => {
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/jobs')
        return Promise.resolve({ data: { data: [], meta: { total: 0, page: 1, limit: 50, totalPages: 0 } }, error: undefined });
      return Promise.resolve({ data: { data: [] }, error: undefined });
    });
    renderList();
    await waitFor(() => expect(screen.getByText(/No jobs found/)).toBeInTheDocument());
  });
});
