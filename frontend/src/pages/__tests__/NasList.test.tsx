// =============================================================================
// FireISP 5.0 — NasList page tests
// =============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { NasList, NasModal } from '../NasList';

const mockApiGet = vi.fn();
const mockApiPost = vi.fn();
const mockApiPut = vi.fn();
vi.mock('@/api/client', () => ({
  api: {
    GET: (...args: unknown[]) => mockApiGet(...args),
    POST: (...args: unknown[]) => mockApiPost(...args),
    PUT: (...args: unknown[]) => mockApiPut(...args),
  },
  tokenStore: {
    getAccess: () => 'tok',
    setAccess: vi.fn(),
    getRefresh: () => null,
    setRefresh: vi.fn(),
    clear: vi.fn(),
  },
}));

const nas1 = {
  id: 1,
  name: 'Core-Router',
  ip_address: '10.0.0.1',
  ipv6_address: null,
  type: 'mikrotik',
  ports: 16,
  coa_port: 3799,
  location: 'Datacenter A',
  secondary_nas_id: null,
  health_status: 'up',
  last_health_check_at: '2026-06-01T08:00:00.000Z',
  description: null,
  status: 'active',
  maintenance_mode: false,
};

const nasDown = {
  id: 2,
  name: 'Edge-Router',
  ip_address: '10.0.0.2',
  ipv6_address: null,
  type: 'cisco',
  ports: 8,
  coa_port: 3799,
  location: null,
  secondary_nas_id: null,
  health_status: 'down',
  last_health_check_at: null,
  description: null,
  status: 'active',
};

function renderNasList() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <NasList />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('NasList page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiPost.mockResolvedValue({ data: { data: { ...nas1, id: 3 } }, error: undefined });
    mockApiPut.mockResolvedValue({ data: { data: nas1 }, error: undefined });
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/nas')
        return Promise.resolve({
          data: { data: [nas1], meta: { total: 1, page: 1, limit: 25, totalPages: 1 } },
          error: undefined,
        });
      return Promise.resolve({ data: { data: [] }, error: undefined });
    });
  });

  // -------------------------------------------------------------------------
  // Existing coverage
  // -------------------------------------------------------------------------

  it('renders the page heading', async () => {
    renderNasList();
    await waitFor(() => expect(screen.getByText('NAS Devices')).toBeInTheDocument());
  });

  it('renders a NAS row after data loads', async () => {
    renderNasList();
    await waitFor(() => expect(screen.getByText('Core-Router')).toBeInTheDocument());
    expect(screen.getByText('10.0.0.1')).toBeInTheDocument();
  });

  it('shows empty message when no NAS devices', async () => {
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/nas')
        return Promise.resolve({
          data: { data: [], meta: { total: 0, page: 1, limit: 25, totalPages: 0 } },
          error: undefined,
        });
      return Promise.resolve({ data: { data: [] }, error: undefined });
    });
    renderNasList();
    await waitFor(() => expect(screen.getByText(/No NAS devices found/)).toBeInTheDocument());
  });

  // -------------------------------------------------------------------------
  // CoA Port column
  // -------------------------------------------------------------------------

  it('shows coa_port value in the table', async () => {
    renderNasList();
    await waitFor(() => expect(screen.getByText('Core-Router')).toBeInTheDocument());
    // The column header
    expect(screen.getByText('CoA Port')).toBeInTheDocument();
    // The cell value
    expect(screen.getByText('3799')).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // Health badge — "up" (green)
  // -------------------------------------------------------------------------

  it('renders health badge for "up" status with green colours', async () => {
    renderNasList();
    await waitFor(() => expect(screen.getByText('Core-Router')).toBeInTheDocument());

    const badge = screen.getByText('up');
    expect(badge).toBeInTheDocument();
    // Green background used for "up"
    expect(badge).toHaveStyle({ background: '#d1fae5' });
    expect(badge).toHaveStyle({ color: '#065f46' });
  });

  // -------------------------------------------------------------------------
  // Health badge — "down" (red)
  // -------------------------------------------------------------------------

  it('renders health badge for "down" status with red colours', async () => {
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/nas')
        return Promise.resolve({
          data: {
            data: [nasDown],
            meta: { total: 1, page: 1, limit: 25, totalPages: 1 },
          },
          error: undefined,
        });
      return Promise.resolve({ data: { data: [] }, error: undefined });
    });

    renderNasList();
    await waitFor(() => expect(screen.getByText('Edge-Router')).toBeInTheDocument());

    const badge = screen.getByText('down');
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveStyle({ background: '#fee2e2' });
    expect(badge).toHaveStyle({ color: '#991b1b' });
  });

  // -------------------------------------------------------------------------
  // New NAS modal contains CoA Port input
  // -------------------------------------------------------------------------

  it('New NAS modal contains CoA Port input', async () => {
    const user = userEvent.setup();
    renderNasList();

    // Wait for the page to load
    await waitFor(() => expect(screen.getByText('NAS Devices')).toBeInTheDocument());

    // Open the New NAS modal
    await user.click(screen.getByText('+ New NAS'));

    // CoA Port input should be present (label appears in both table header and modal form)
    const coaInput = screen.getByRole('spinbutton', { name: /CoA Port/i });
    expect(coaInput).toBeInTheDocument();
    // Default value is 3799
    expect(coaInput).toHaveValue(3799);
  });

  it('creates an active NAS in maintenance mode and sends the boolean field', async () => {
    const user = userEvent.setup();
    renderNasList();
    await waitFor(() => expect(screen.getByText('NAS Devices')).toBeInTheDocument());
    await user.click(screen.getByText('+ New NAS'));

    await user.type(screen.getByLabelText(/Name/), 'Lab-Router');
    await user.type(screen.getByLabelText(/IP Address \(IPv4\)/), '10.0.0.9');
    await user.type(screen.getByLabelText(/RADIUS Shared Secret/), 'test-secret');
    const maintenance = screen.getByRole('checkbox', { name: /Maintenance mode/ });
    expect(maintenance).not.toBeChecked();
    await user.click(maintenance);
    await user.click(screen.getByRole('button', { name: 'Create NAS' }));

    await waitFor(() => expect(mockApiPost).toHaveBeenCalledWith(
      '/nas',
      expect.objectContaining({
        body: expect.objectContaining({
          name: 'Lab-Router',
          status: 'active',
          maintenance_mode: true,
        }),
      }),
    ));
  });

  it('round-trips maintenance mode when editing an existing NAS', async () => {
    const user = userEvent.setup();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <NasModal
            nas={{ ...nas1, maintenance_mode: 1 }}
            onClose={vi.fn()}
            onSaved={vi.fn()}
          />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    const maintenance = screen.getByRole('checkbox', { name: /Maintenance mode/ });
    expect(maintenance).toBeChecked();
    await user.click(maintenance);
    await user.click(screen.getByRole('button', { name: 'Save Changes' }));

    await waitFor(() => expect(mockApiPut).toHaveBeenCalledWith(
      '/nas/{id}',
      expect.objectContaining({
        params: { path: { id: 1 } },
        body: expect.objectContaining({ maintenance_mode: false }),
      }),
    ));
  });

  it('marks maintained NAS devices in the list while keeping their active status', async () => {
    mockApiGet.mockImplementation((path: string) => Promise.resolve(path === '/nas'
      ? { data: { data: [{ ...nas1, maintenance_mode: true }], meta: { total: 1, page: 1, limit: 25, totalPages: 1 } }, error: undefined }
      : { data: { data: [] }, error: undefined }));
    renderNasList();

    await waitFor(() => expect(screen.getByText('Core-Router')).toBeInTheDocument());
    expect(screen.getByText('active')).toBeInTheDocument();
    expect(screen.getByTitle('Excluded from automated RouterOS PPPoE diagnostics polling and readiness coverage')).toHaveTextContent('Maintenance');
  });

  // -------------------------------------------------------------------------
  // Row action — every per-device action now lives on the detail page
  // -------------------------------------------------------------------------

  it('links each row to the NAS detail page and no longer shows per-row actions', async () => {
    renderNasList();
    await waitFor(() => expect(screen.getByText('Core-Router')).toBeInTheDocument());

    const manage = screen.getByRole('link', { name: /Manage/i });
    expect(manage).toHaveAttribute('href', '/nas/1');
    // Seed/Test/VoIP/WG/Edit/Delete moved to the detail page — gone from the list.
    expect(screen.queryByRole('button', { name: 'Seed' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Test' })).not.toBeInTheDocument();
  });
});
