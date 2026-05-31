// =============================================================================
// FireISP 5.0 — ConnectionLogList page tests
// =============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { ConnectionLogList } from '../ConnectionLogList';

const mockApiGet = vi.fn();
vi.mock('@/api/client', () => ({
  api: { GET: (...args: unknown[]) => mockApiGet(...args) },
  tokenStore: { getAccess: () => 'tok', setAccess: vi.fn(), getRefresh: () => null, setRefresh: vi.fn(), clear: vi.fn() },
}));

const log1 = {
  id: 1, contract_id: 9, client_id: 7, username: 'user@isp', ip_address: '10.0.0.5',
  event_type: 'start', bytes_in: 1048576, bytes_out: 524288, session_duration: 3600,
  event_at: '2026-01-15T10:00:00Z',
};

function renderList() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <ConnectionLogList />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('ConnectionLogList page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/connection-logs')
        return Promise.resolve({ data: { data: [log1], meta: { total: 1, page: 1, limit: 50 } }, error: undefined });
      return Promise.resolve({ data: { data: [] }, error: undefined });
    });
  });

  it('renders the page heading', async () => {
    renderList();
    await waitFor(() => expect(screen.getByText('📡 Connection Logs')).toBeInTheDocument());
  });

  it('renders a connection log row with username and IP', async () => {
    renderList();
    await waitFor(() => expect(screen.getByText('user@isp')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText('10.0.0.5')).toBeInTheDocument());
  });

  it('shows empty message when no connection logs', async () => {
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/connection-logs')
        return Promise.resolve({ data: { data: [], meta: { total: 0, page: 1, limit: 50 } }, error: undefined });
      return Promise.resolve({ data: { data: [] }, error: undefined });
    });
    renderList();
    await waitFor(() => expect(screen.getByText(/No connection logs found/)).toBeInTheDocument());
  });
});
