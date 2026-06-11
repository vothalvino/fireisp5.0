// =============================================================================
// FireISP 5.0 — NasList page tests
// =============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { NasList } from '../NasList';

const mockApiGet = vi.fn();
vi.mock('@/api/client', () => ({
  api: { GET: (...args: unknown[]) => mockApiGet(...args) },
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
});
