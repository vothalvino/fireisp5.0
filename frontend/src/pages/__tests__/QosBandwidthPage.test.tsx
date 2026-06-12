// =============================================================================
// FireISP 5.0 — QosBandwidthPage tests
// =============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { QosBandwidthPage } from '../QosBandwidthPage';

const mockApiGet = vi.fn();
vi.mock('@/api/client', () => ({
  api: { GET: (...args: unknown[]) => mockApiGet(...args), POST: vi.fn(), PATCH: vi.fn(), DELETE: vi.fn() },
  tokenStore: { getAccess: () => 'tok', setAccess: vi.fn(), getRefresh: () => null, setRefresh: vi.fn(), clear: vi.fn() },
}));

const qcItem = {
  id: 1, name: 'VoIP', description: 'Voice traffic', traffic_type: 'voip',
  priority: 1, dscp_mark: 'EF', mikrotik_queue_kind: 'pcq', max_limit_pct: null, status: 'active',
};

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <QosBandwidthPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('QosBandwidthPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/quality-classes')
        return Promise.resolve({ data: { data: [qcItem], meta: { total: 1, page: 1, limit: 25 } }, error: undefined });
      return Promise.resolve({ data: { data: [], meta: { total: 0, page: 1, limit: 25 } }, error: undefined });
    });
  });

  it('renders the page heading', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('QoS & Bandwidth Management')).toBeInTheDocument());
  });

  it('renders quality class tab by default and shows a row', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('VoIP')).toBeInTheDocument());
  });

  it('shows empty message when no quality classes', async () => {
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/quality-classes')
        return Promise.resolve({ data: { data: [], meta: { total: 0, page: 1, limit: 25 } }, error: undefined });
      return Promise.resolve({ data: { data: [], meta: { total: 0, page: 1, limit: 25 } }, error: undefined });
    });
    renderPage();
    await waitFor(() => expect(screen.getByText(/No quality classes found/)).toBeInTheDocument());
  });
});
