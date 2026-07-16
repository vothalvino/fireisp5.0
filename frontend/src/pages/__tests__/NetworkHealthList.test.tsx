// =============================================================================
// FireISP 5.0 — NetworkHealthList page tests
// =============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { NetworkHealthList } from '../NetworkHealthList';

const mockApiGet = vi.fn();
vi.mock('@/api/client', () => ({
  api: { GET: (...args: unknown[]) => mockApiGet(...args) },
  tokenStore: { getAccess: () => 'tok', setAccess: vi.fn(), getRefresh: () => null, setRefresh: vi.fn(), clear: vi.fn() },
}));

const snap1 = {
  id: 1, device_id: 4, network_link_id: null, snapshot_date: '2026-01-15',
  uptime_pct: 99.95, avg_latency_ms: 12.0, max_latency_ms: 45.0,
  avg_throughput_in_mbps: 120.5, avg_throughput_out_mbps: 30.2, packet_loss_pct: 0.1,
  total_downtime_minutes: 5,
};

function renderList() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <NetworkHealthList />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('NetworkHealthList page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/network-health')
        return Promise.resolve({ data: { data: [snap1], meta: { total: 1, page: 1, limit: 50 } }, error: undefined });
      return Promise.resolve({ data: { data: [] }, error: undefined });
    });
  });

  it('renders the page heading', async () => {
    renderList();
    await waitFor(() => expect(screen.getByText('💓 Network Health')).toBeInTheDocument());
  });

  it('renders a snapshot row with its uptime percentage', async () => {
    renderList();
    await waitFor(() => expect(screen.getByText('99.95%')).toBeInTheDocument());
  });

  it('links the device_id cell to the device detail page', async () => {
    renderList();
    await waitFor(() => expect(screen.getByRole('link', { name: '#4' })).toBeInTheDocument());
    expect(screen.getByRole('link', { name: '#4' })).toHaveAttribute('href', '/devices/4');
  });

  it('shows empty message when no snapshots', async () => {
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/network-health')
        return Promise.resolve({ data: { data: [], meta: { total: 0, page: 1, limit: 50 } }, error: undefined });
      return Promise.resolve({ data: { data: [] }, error: undefined });
    });
    renderList();
    await waitFor(() => expect(screen.getByText(/No network health snapshots found/)).toBeInTheDocument());
  });
});
