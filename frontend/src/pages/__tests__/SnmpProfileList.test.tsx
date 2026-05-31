// =============================================================================
// FireISP 5.0 — SnmpProfileList page tests
// =============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { SnmpProfileList } from '../SnmpProfileList';

const mockApiGet = vi.fn();
vi.mock('@/api/client', () => ({
  api: { GET: (...args: unknown[]) => mockApiGet(...args) },
  tokenStore: { getAccess: () => 'tok', setAccess: vi.fn(), getRefresh: () => null, setRefresh: vi.fn(), clear: vi.fn() },
}));

const profile1 = {
  id: 1, name: 'MikroTik RouterOS', manufacturer: 'MikroTik', model_pattern: 'RB%',
  device_type: 'router', snmp_version: 'v2c', poll_interval_sec: 300, is_default: 1, status: 'active',
};

function renderList() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <SnmpProfileList />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('SnmpProfileList page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/snmp-profiles')
        return Promise.resolve({ data: { data: [profile1], meta: { total: 1, page: 1, limit: 50, totalPages: 1 } }, error: undefined });
      return Promise.resolve({ data: { data: [] }, error: undefined });
    });
  });

  it('renders the page heading', async () => {
    renderList();
    await waitFor(() => expect(screen.getByText('📶 SNMP Profiles')).toBeInTheDocument());
  });

  it('renders a profile row with its name and manufacturer', async () => {
    renderList();
    await waitFor(() => expect(screen.getByText('MikroTik RouterOS')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText('MikroTik')).toBeInTheDocument());
  });

  it('shows empty message when no profiles', async () => {
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/snmp-profiles')
        return Promise.resolve({ data: { data: [], meta: { total: 0, page: 1, limit: 50, totalPages: 0 } }, error: undefined });
      return Promise.resolve({ data: { data: [] }, error: undefined });
    });
    renderList();
    await waitFor(() => expect(screen.getByText(/No SNMP profiles found/)).toBeInTheDocument());
  });
});
