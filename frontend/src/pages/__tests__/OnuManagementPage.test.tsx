// =============================================================================
// FireISP 5.0 — OnuManagementPage tests (§7.2)
// =============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { OnuManagementPage } from '../OnuManagementPage';

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

const onu1 = {
  id: 1, device_id: 20, device_name: 'ONU-001', olt_device_id: 10,
  olt_name: 'OLT-Central', olt_port_id: 5, port_name: 'GPON 0/1/0',
  onu_profile_id: 2, onu_profile_name: 'Residencial-GPON',
  serial_number: 'ALCL12345678', loid: null, onu_state: 'online',
  onu_id: 1, ranging_distance_m: 3200, wan_mode: 'IPoE',
  line_profile_name: 'line-res-100', service_profile_name: 'svc-res-100',
  last_status_at: '2026-06-11T10:00:00Z', last_provision_job_id: null,
};

const profile1 = {
  id: 2, name: 'Residencial-GPON', technology: 'gpon', tcont_id: 4,
  dba_profile_name: null, assured_bw_kbps: 2000, max_bw_kbps: 100000,
  gem_port_id: 10, service_vlan: 100, client_vlan: null, vlan_mode: 'tagged', plan_id: null,
};

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <OnuManagementPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('OnuManagementPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/onu-management/details')
        return Promise.resolve({ data: { data: [onu1], meta: { total: 1, page: 1, limit: 25 } }, error: undefined });
      if (path === '/onu-management/profiles')
        return Promise.resolve({ data: { data: [profile1], meta: { total: 1, page: 1, limit: 25 } }, error: undefined });
      if (path === '/onu-management/whitelist')
        return Promise.resolve({ data: { data: [], meta: { total: 0, page: 1, limit: 25 } }, error: undefined });
      if (path === '/onu-management/omci-configs')
        return Promise.resolve({ data: { data: [], meta: { total: 0, page: 1, limit: 25 } }, error: undefined });
      if (path === '/onu-management/firmware-jobs')
        return Promise.resolve({ data: { data: [], meta: { total: 0, page: 1, limit: 25 } }, error: undefined });
      return Promise.resolve({ data: { data: [] }, error: undefined });
    });
  });

  it('renders the page heading', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('ONU Management')).toBeInTheDocument());
  });

  it('renders ONU detail row on the ONUs tab', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('ONU-001')).toBeInTheDocument());
    expect(screen.getByText('ALCL12345678')).toBeInTheDocument();
    // 'online' appears in both the filter dropdown option and the state badge
    expect(screen.getAllByText('online').length).toBeGreaterThanOrEqual(1);
  });

  it('shows empty state when no ONUs', async () => {
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/onu-management/details')
        return Promise.resolve({ data: { data: [], meta: { total: 0, page: 1, limit: 25 } }, error: undefined });
      return Promise.resolve({ data: { data: [] }, error: undefined });
    });
    renderPage();
    await waitFor(() => expect(screen.getByText('No results found.')).toBeInTheDocument());
  });
});
