// =============================================================================
// FireISP 5.0 — NasDetail page tests
// =============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { NasDetail } from '../NasDetail';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockApiGet = vi.fn();
const mockApiPost = vi.fn();
const mockApiDelete = vi.fn();
vi.mock('@/api/client', () => ({
  api: {
    GET: (...args: unknown[]) => mockApiGet(...args),
    POST: (...args: unknown[]) => mockApiPost(...args),
    PUT: vi.fn(),
    DELETE: (...args: unknown[]) => mockApiDelete(...args),
  },
  tokenStore: {
    getAccess: () => 'tok',
    setAccess: vi.fn(),
    getRefresh: () => null,
    setRefresh: vi.fn(),
    clear: vi.fn(),
  },
}));

let mockRole = 'admin';
vi.mock('@/auth/AuthContext', () => ({
  useAuth: () => ({ user: { id: 1, role: mockRole } }),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const nas = {
  id: 1,
  name: 'Core-Router',
  ip_address: '10.0.0.1',
  ipv6_address: null,
  type: 'mikrotik',
  ports: 16,
  coa_port: 3799,
  location: 'Datacenter A',
  site_id: 7,
  health_status: 'up',
  last_health_check_at: '2026-06-01T08:00:00.000Z',
  status: 'active',
  api_port: 8728,
  api_username: 'admin',
  api_use_tls: false,
};

// ---------------------------------------------------------------------------
// Render helper
// ---------------------------------------------------------------------------

function renderDetail(id = '1') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/nas/${id}`]}>
        <Routes>
          <Route path="/nas/:id" element={<NasDetail />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('NasDetail page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRole = 'admin';
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/nas/{id}') {
        return Promise.resolve({
          data: { data: nas },
          error: undefined,
        });
      }
      return Promise.resolve({ data: { data: [] }, error: undefined });
    });
  });

  it('renders the NAS name as a heading', async () => {
    renderDetail();
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Core-Router' })).toBeInTheDocument(),
    );
  });

  it('shows the NAS status badge', async () => {
    renderDetail();
    await waitFor(() => expect(screen.getByText('active')).toBeInTheDocument());
  });

  it('shows the NAS ID in header meta', async () => {
    renderDetail();
    await waitFor(() => expect(screen.getByText('ID #1')).toBeInTheDocument());
  });

  it('shows key NAS fields', async () => {
    renderDetail();
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Core-Router' })).toBeInTheDocument(),
    );
    expect(screen.getByText('10.0.0.1')).toBeInTheDocument();
    expect(screen.getByText('Datacenter A')).toBeInTheDocument();
  });

  it('shows a link to the associated site', async () => {
    renderDetail();
    await waitFor(() => expect(screen.getByText('View site →')).toBeInTheDocument());
    const siteLink = screen.getByRole('link', { name: 'View site →' });
    expect(siteLink).toHaveAttribute('href', '/sites/7');
  });

  it('renders breadcrumb back link to /nas', async () => {
    renderDetail();
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Core-Router' })).toBeInTheDocument(),
    );
    const link = screen.getByRole('link', { name: 'NAS Devices' });
    expect(link).toHaveAttribute('href', '/nas');
  });

  it('shows all tabs', async () => {
    renderDetail();
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Core-Router' })).toBeInTheDocument(),
    );
    expect(screen.getByRole('button', { name: 'Overview' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Health' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Live Sessions' })).toBeInTheDocument();
  });

  it('shows health check buttons for admin role', async () => {
    renderDetail();
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Core-Router' })).toBeInTheDocument(),
    );
    // Click the Health tab
    screen.getByRole('button', { name: 'Health' }).click();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Run health check' })).toBeInTheDocument(),
    );
    expect(screen.getByRole('button', { name: 'Test connection' })).toBeInTheDocument();
  });

  it('shows the health-check button for a technician (has nas.health)', async () => {
    mockRole = 'technician';
    renderDetail();
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Core-Router' })).toBeInTheDocument(),
    );
    screen.getByRole('button', { name: 'Health' }).click();
    // technician has nas.health (health-check) and devices.update (test-connection)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Run health check' })).toBeInTheDocument(),
    );
    expect(screen.getByRole('button', { name: 'Test connection' })).toBeInTheDocument();
  });

  it('hides action buttons for a role without nas.health / devices.update (billing)', async () => {
    mockRole = 'billing';
    renderDetail();
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Core-Router' })).toBeInTheDocument(),
    );
    screen.getByRole('button', { name: 'Health' }).click();
    await waitFor(() => expect(screen.getByText('up')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Run health check' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Test connection' })).not.toBeInTheDocument();
  });

  it('does not display api_password_encrypted field', async () => {
    renderDetail();
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Core-Router' })).toBeInTheDocument(),
    );
    expect(screen.queryByText(/password.*encrypted/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/api_password/i)).not.toBeInTheDocument();
  });

  it('shows not found message on API error', async () => {
    mockApiGet.mockImplementation(() =>
      Promise.resolve({ data: null, error: { message: 'Not found' } }),
    );
    renderDetail();
    await waitFor(() => expect(screen.getByText('NAS not found.')).toBeInTheDocument());
  });

  it('shows loading text initially', () => {
    mockApiGet.mockImplementation(() => new Promise(() => {}));
    renderDetail();
    expect(screen.getByText('Loading NAS…')).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // Per-device actions (moved here from the NAS list)
  // -------------------------------------------------------------------------

  it('shows Seed / VoIP / Edit / Delete header actions for admin', async () => {
    renderDetail();
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Core-Router' })).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Seed' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'VoIP' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
  });

  it('refreshes VoIP ranges from the header and shows the reconcile result', async () => {
    mockApiPost.mockResolvedValue({ data: { data: { added: 3, removed: 1, kept: 2, ranges: 6 } }, error: undefined });
    renderDetail();
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Core-Router' })).toBeInTheDocument());

    screen.getByRole('button', { name: 'VoIP' }).click();

    await waitFor(() => expect(screen.getByText(/VoIP ranges reconciled/i)).toBeInTheDocument());
    expect(mockApiPost).toHaveBeenCalledWith('/nas/{id}/voip/refresh', expect.objectContaining({ params: { path: { id: 1 } } }));
  });

  it('opens the Seed modal with the RADIUS address defaulted to the hub tunnel IP', async () => {
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/nas/{id}') return Promise.resolve({ data: { data: nas }, error: undefined });
      if (path === '/nas/{id}/wg') return Promise.resolve({ data: { data: { tunnel: null, serverTunnelIp: '10.255.0.1' } }, error: undefined });
      return Promise.resolve({ data: { data: [] }, error: undefined });
    });
    renderDetail();
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Core-Router' })).toBeInTheDocument());

    screen.getByRole('button', { name: 'Seed' }).click();

    await waitFor(() => expect(screen.getByRole('dialog', { name: /Seed NAS Core-Router/i })).toBeInTheDocument());
    expect(screen.getByRole('textbox', { name: /FireISP RADIUS Address/i })).toHaveValue('10.255.0.1');
  });

  it('deletes the NAS after confirmation and returns to the list', async () => {
    mockApiDelete.mockResolvedValue({ error: undefined });
    renderDetail();
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Core-Router' })).toBeInTheDocument());

    screen.getByRole('button', { name: 'Delete' }).click();
    await waitFor(() => expect(screen.getByRole('button', { name: /Yes, confirm/i })).toBeInTheDocument());
    screen.getByRole('button', { name: /Yes, confirm/i }).click();

    await waitFor(() => expect(mockApiDelete).toHaveBeenCalledWith('/nas/{id}', expect.objectContaining({ params: { path: { id: 1 } } })));
  });

  it('hides Seed / Edit / Delete for a role without devices permissions (billing)', async () => {
    mockRole = 'billing';
    renderDetail();
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Core-Router' })).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Seed' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
  });
});
