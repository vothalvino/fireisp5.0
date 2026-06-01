// =============================================================================
// FireISP 5.0 — DeviceConfigBackupList page tests
// =============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { DeviceConfigBackupList } from '../DeviceConfigBackupList';

const mockApiGet = vi.fn();
vi.mock('@/api/client', () => ({
  api: { GET: (...args: unknown[]) => mockApiGet(...args) },
  tokenStore: { getAccess: () => 'tok', setAccess: vi.fn(), getRefresh: () => null, setRefresh: vi.fn(), clear: vi.fn() },
}));

const backup1 = {
  id: 1, device_id: 4, version: 3, config_type: 'mikrotik_export', file_size: 2048,
  checksum: 'abcdef0123456789abcdef', capture_method: 'scheduled', created_at: '2026-01-15T10:00:00Z',
};

function renderList() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <DeviceConfigBackupList />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('DeviceConfigBackupList page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/device-config-backups')
        return Promise.resolve({ data: { data: [backup1], meta: { total: 1, page: 1, limit: 50, totalPages: 1 } }, error: undefined });
      return Promise.resolve({ data: { data: [] }, error: undefined });
    });
  });

  it('renders the page heading', async () => {
    renderList();
    await waitFor(() => expect(screen.getByText('💾 Device Config Backups')).toBeInTheDocument());
  });

  it('renders a backup row with its version and config type', async () => {
    renderList();
    await waitFor(() => expect(screen.getByText('v3')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText('mikrotik_export')).toBeInTheDocument());
  });

  it('shows empty message when no backups', async () => {
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/device-config-backups')
        return Promise.resolve({ data: { data: [], meta: { total: 0, page: 1, limit: 50, totalPages: 0 } }, error: undefined });
      return Promise.resolve({ data: { data: [] }, error: undefined });
    });
    renderList();
    await waitFor(() => expect(screen.getByText(/No device config backups found/)).toBeInTheDocument());
  });
});
