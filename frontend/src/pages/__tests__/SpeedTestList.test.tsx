// =============================================================================
// FireISP 5.0 — SpeedTestList page tests
// =============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { SpeedTestList } from '../SpeedTestList';

const mockApiGet = vi.fn();
vi.mock('@/api/client', () => ({
  api: { GET: (...args: unknown[]) => mockApiGet(...args) },
  tokenStore: { getAccess: () => 'tok', setAccess: vi.fn(), getRefresh: () => null, setRefresh: vi.fn(), clear: vi.fn() },
}));

const test1 = {
  id: 1, client_id: 7, contract_id: 9, device_id: null, test_source: 'client_portal',
  server_location: 'MX-Central', download_mbps: 95.5, upload_mbps: 20.1, latency_ms: 12.3,
  jitter_ms: 1.2, packet_loss_pct: 0.0, tested_at: '2026-01-15T10:00:00Z',
};

function renderList() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <SpeedTestList />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('SpeedTestList page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/speed-tests')
        return Promise.resolve({ data: { data: [test1], meta: { total: 1, page: 1, limit: 50, totalPages: 1 } }, error: undefined });
      return Promise.resolve({ data: { data: [] }, error: undefined });
    });
  });

  it('renders the page heading', async () => {
    renderList();
    await waitFor(() => expect(screen.getByText('⚡ Speed Tests')).toBeInTheDocument());
  });

  it('renders a speed test row with download and upload figures', async () => {
    renderList();
    await waitFor(() => expect(screen.getByText('95.5 Mbps')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText('20.1 Mbps')).toBeInTheDocument());
  });

  it('shows empty message when no speed tests', async () => {
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/speed-tests')
        return Promise.resolve({ data: { data: [], meta: { total: 0, page: 1, limit: 50, totalPages: 0 } }, error: undefined });
      return Promise.resolve({ data: { data: [] }, error: undefined });
    });
    renderList();
    await waitFor(() => expect(screen.getByText(/No speed tests found/)).toBeInTheDocument());
  });
});
