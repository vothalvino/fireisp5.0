// =============================================================================
// FireISP 5.0 — OltManagementPage tests (§7.1)
// =============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { OltManagementPage } from '../OltManagementPage';

const mockApiGet = vi.fn();
vi.mock('@/api/client', () => ({
  api: {
    GET: (...args: unknown[]) => mockApiGet(...args),
    POST: vi.fn().mockResolvedValue({ data: {}, error: undefined }),
    PUT: vi.fn().mockResolvedValue({ data: {}, error: undefined }),
    DELETE: vi.fn().mockResolvedValue({ data: {}, error: undefined }),
  },
  tokenStore: {
    getAccess: () => 'tok', setAccess: vi.fn(),
    getRefresh: () => null, setRefresh: vi.fn(), clear: vi.fn(),
  },
}));

const port1 = {
  id: 1, olt_device_id: 10, olt_name: 'OLT-Central', port_index: 0,
  port_name: 'GPON 0/1/0', port_type: 'gpon', slot_no: 0, port_no: 0,
  admin_status: 'up', oper_status: 'up', onu_count: 32, max_onus: 128,
  tx_power_dbm: 2.5, rx_power_dbm: -18.3,
};

const splitter1 = {
  id: 1, name: 'SP-A01', ratio: '1:32', splitter_type: 'planar',
  status: 'active', location_detail: 'Cabinet A', installed_at: null,
};

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <OltManagementPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('OltManagementPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/olt-management/ports')
        return Promise.resolve({ data: { data: [port1], meta: { total: 1, page: 1, limit: 25 } }, error: undefined });
      if (path === '/olt-management/splitters')
        return Promise.resolve({ data: { data: [splitter1], meta: { total: 1, page: 1, limit: 25 } }, error: undefined });
      return Promise.resolve({ data: { data: [] }, error: undefined });
    });
  });

  it('renders the page heading', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('OLT Management')).toBeInTheDocument());
  });

  it('renders OLT port row on the Ports tab', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('GPON 0/1/0')).toBeInTheDocument());
    expect(screen.getByText('OLT-Central')).toBeInTheDocument();
    expect(screen.getByText('32 / 128')).toBeInTheDocument();
  });

  it('shows empty state when no ports', async () => {
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/olt-management/ports')
        return Promise.resolve({ data: { data: [], meta: { total: 0, page: 1, limit: 25 } }, error: undefined });
      return Promise.resolve({ data: { data: [] }, error: undefined });
    });
    renderPage();
    await waitFor(() => expect(screen.getByText('No results found.')).toBeInTheDocument());
  });
});
