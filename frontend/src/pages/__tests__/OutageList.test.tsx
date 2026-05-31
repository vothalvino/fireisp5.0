// =============================================================================
// FireISP 5.0 — OutageList page tests
// =============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { OutageList } from '../OutageList';

const mockApiGet = vi.fn();
vi.mock('@/api/client', () => ({
  api: { GET: (...args: unknown[]) => mockApiGet(...args) },
  tokenStore: { getAccess: () => 'tok', setAccess: vi.fn(), getRefresh: () => null, setRefresh: vi.fn(), clear: vi.fn() },
}));

const outage1 = {
  id: 1, site_id: 2, device_id: null, outage_type: 'unplanned', title: 'Fiber cut on Main St',
  description: null, severity: 'critical', started_at: '2026-01-10T08:00:00Z', resolved_at: null,
  affected_clients_count: 42, status: 'ongoing',
};

function renderList() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <OutageList />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('OutageList page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/outages')
        return Promise.resolve({ data: { data: [outage1], meta: { total: 1, page: 1, limit: 50, totalPages: 1 } }, error: undefined });
      return Promise.resolve({ data: { data: [] }, error: undefined });
    });
  });

  it('renders the page heading', async () => {
    renderList();
    await waitFor(() => expect(screen.getByText('🚧 Outages')).toBeInTheDocument());
  });

  it('renders an outage row with its title and affected count', async () => {
    renderList();
    await waitFor(() => expect(screen.getByText('Fiber cut on Main St')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText('42')).toBeInTheDocument());
  });

  it('shows empty message when no outages', async () => {
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/outages')
        return Promise.resolve({ data: { data: [], meta: { total: 0, page: 1, limit: 50, totalPages: 0 } }, error: undefined });
      return Promise.resolve({ data: { data: [] }, error: undefined });
    });
    renderList();
    await waitFor(() => expect(screen.getByText(/No outages found/)).toBeInTheDocument());
  });
});
