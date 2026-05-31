// =============================================================================
// FireISP 5.0 — DeviceMap page tests
// =============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { DeviceMap } from '../DeviceMap';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockApiGet = vi.fn();
vi.mock('@/api/client', () => ({
  api: { GET: (...a: unknown[]) => mockApiGet(...a), POST: vi.fn(), PUT: vi.fn(), DELETE: vi.fn() },
  tokenStore: { getAccess: () => 'tok', setAccess: vi.fn(), getRefresh: () => null, setRefresh: vi.fn(), clear: vi.fn() },
}));

let mockRole = 'admin';
vi.mock('@/auth/AuthContext', () => ({
  useAuth: () => ({ user: { id: 1, role: mockRole } }),
}));

// Stub fetch used by DeviceMap's fetchAll helper.
const device1 = {
  id: 10, site_id: null, name: 'Core Router', type: 'router',
  manufacturer: 'MikroTik', model: 'CCR', ip_address: '10.0.0.1',
  status: 'active', snmp_enabled: 0,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockRole = 'admin';
  global.fetch = vi.fn((url: string) => {
    let data: unknown[] = [];
    if (url.includes('/devices')) data = [device1];
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ data }),
    } as Response);
  }) as unknown as typeof fetch;
});

function renderMap() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <DeviceMap />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('DeviceMap page', () => {
  it('renders the heading and a device', async () => {
    renderMap();
    expect(screen.getByText('🖧 Device / Network Map')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/Core Router/)).toBeInTheDocument());
  });

  it('shows New Device button for admin', async () => {
    renderMap();
    expect(screen.getByText('+ New Device')).toBeInTheDocument();
  });

  it('hides New Device button for billing role', async () => {
    mockRole = 'billing';
    renderMap();
    expect(screen.queryByText('+ New Device')).not.toBeInTheDocument();
  });
});
