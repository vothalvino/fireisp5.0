// =============================================================================
// FireISP 5.0 — DeviceDetail page tests
// =============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { DeviceDetail } from '../DeviceDetail';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockApiGet = vi.fn();
vi.mock('@/api/client', () => ({
  api: {
    GET: (...args: unknown[]) => mockApiGet(...args),
    POST: vi.fn(),
    PUT: vi.fn(),
    DELETE: vi.fn(),
  },
  tokenStore: {
    getAccess: () => 'tok',
    setAccess: vi.fn(),
    getRefresh: () => null,
    setRefresh: vi.fn(),
    clear: vi.fn(),
  },
}));

vi.mock('@/auth/AuthContext', () => ({
  useAuth: () => ({ user: { id: 1, role: 'admin' } }),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const device = {
  id: 42,
  site_id: 3,
  client_id: null,
  contract_id: null,
  category: 'router',
  name: 'Core-Router-01',
  type: 'router',
  manufacturer: 'MikroTik',
  model: 'CCR2004',
  serial_number: 'SN-ABC123',
  mac_address: 'AA:BB:CC:DD:EE:FF',
  ip_address: '10.0.0.1',
  ipv6_address: null,
  firmware_version: '7.14',
  snmp_enabled: true,
  snmp_version: 'v2c',
  status: 'online',
  notes: 'Main distribution router',
  last_polled_at: '2026-06-01T10:00:00.000Z',
  last_poll_error: null,
};

// ---------------------------------------------------------------------------
// Render helper
// ---------------------------------------------------------------------------

function renderDetail(id = '42') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/devices/${id}`]}>
        <Routes>
          <Route path="/devices/:id" element={<DeviceDetail />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DeviceDetail page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/devices/{id}') {
        return Promise.resolve({
          data: { data: device },
          error: undefined,
        });
      }
      return Promise.resolve({ data: { data: [] }, error: undefined });
    });
  });

  it('renders the device name as a heading', async () => {
    renderDetail();
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Core-Router-01' })).toBeInTheDocument(),
    );
  });

  it('shows the device status badge', async () => {
    renderDetail();
    await waitFor(() => expect(screen.getByText('online')).toBeInTheDocument());
  });

  it('shows key device fields', async () => {
    renderDetail();
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Core-Router-01' })).toBeInTheDocument(),
    );
    expect(screen.getByText('MikroTik')).toBeInTheDocument();
    expect(screen.getByText('CCR2004')).toBeInTheDocument();
    expect(screen.getByText('10.0.0.1')).toBeInTheDocument();
    expect(screen.getByText('SN-ABC123')).toBeInTheDocument();
  });

  it('shows notes section', async () => {
    renderDetail();
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Core-Router-01' })).toBeInTheDocument(),
    );
    expect(screen.getByText('Main distribution router')).toBeInTheDocument();
  });

  it('renders the breadcrumb back link to /devices', async () => {
    renderDetail();
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Core-Router-01' })).toBeInTheDocument(),
    );
    const link = screen.getByRole('link', { name: 'Devices' });
    expect(link).toHaveAttribute('href', '/devices');
  });

  it('shows all tabs', async () => {
    renderDetail();
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Core-Router-01' })).toBeInTheDocument(),
    );
    expect(screen.getByRole('button', { name: 'Overview' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'SNMP Metrics' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Config Backups' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Work Orders' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Outages' })).toBeInTheDocument();
  });

  it('shows not found message on API error', async () => {
    mockApiGet.mockImplementation(() =>
      Promise.resolve({ data: null, error: { message: 'Not found' } }),
    );
    renderDetail();
    await waitFor(() => expect(screen.getByText('Device not found.')).toBeInTheDocument());
  });

  it('shows loading text initially', () => {
    // Delay the mock so we can catch the loading state
    mockApiGet.mockImplementation(() => new Promise(() => {}));
    renderDetail();
    expect(screen.getByText('Loading device…')).toBeInTheDocument();
  });
});
