// =============================================================================
// FireISP 5.0 — LeadList page tests (§1.2)
// =============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { LeadList } from '../LeadList';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

const mockApiGet = vi.fn();
const mockApiPost = vi.fn();
const mockApiPut = vi.fn();
vi.mock('@/api/client', () => ({
  api: {
    GET: (...args: unknown[]) => mockApiGet(...args),
    POST: (...args: unknown[]) => mockApiPost(...args),
    PUT: (...args: unknown[]) => mockApiPut(...args),
    DELETE: vi.fn(),
  },
  tokenStore: { getAccess: () => 'tok', setAccess: vi.fn(), getRefresh: () => null, setRefresh: vi.fn(), clear: vi.fn() },
}));

let mockUser: { id: number; role: string; permissions?: string[] } = { id: 1, role: 'admin' };
vi.mock('@/auth/AuthContext', () => ({
  useAuth: () => ({ user: mockUser }),
}));

const lead1 = {
  id: 1, name: 'Jane Prospect', email: 'jane@x.com', phone: '555', company: 'Acme',
  source: 'referral', status: 'new', estimated_value: 350, assigned_to: null,
  converted_client_id: null, created_at: '2026-01-01',
  address: '1 Main St', city: 'CDMX', state: 'CDMX', zip_code: '01000',
  desired_plan_id: 7,
};

function mockResponses() {
  mockApiGet.mockImplementation((path: string) => {
    if (path === '/leads/pipeline') {
      return Promise.resolve({ data: { data: { new: 1, won: 0 } }, error: undefined });
    }
    if (path === '/plans') {
      return Promise.resolve({
        data: { data: [{ id: 7, name: 'Fiber 100' }, { id: 8, name: 'Fiber 300' }] },
        error: undefined,
      });
    }
    if (path === '/service-orders/{id}') {
      return Promise.resolve({
        data: { data: { id: 44, status: 'new', contract_id: null } },
        error: undefined,
      });
    }
    return Promise.resolve({
      data: { data: [lead1], meta: { total: 1, page: 1, limit: 200, totalPages: 1 } },
      error: undefined,
    });
  });
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <LeadList />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('LeadList page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUser = { id: 1, role: 'admin' };
    mockResponses();
  });

  it('renders the page heading', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('Leads')).toBeInTheDocument());
  });

  it('renders a lead row after data loads', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('Jane Prospect')).toBeInTheDocument());
  });

  it('shows a Convert action for an unconverted lead', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('Convert only')).toBeInTheDocument());
  });

  it('starts an installation from a prefilled lead and opens its pending contract', async () => {
    mockApiPost.mockImplementation((path: string) => {
      if (path === '/service-orders') {
        return Promise.resolve({ data: { data: { id: 44, status: 'new' } }, error: undefined });
      }
      if (path === '/service-orders/{id}/start') {
        return Promise.resolve({
          data: { data: { id: 44, status: 'in_process', contract: { id: 91, status: 'pending' } } },
          error: undefined,
        });
      }
      return Promise.resolve({ data: undefined, error: undefined });
    });

    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Start installation' }));

    const plan = await screen.findByLabelText('Service plan *');
    await waitFor(() => expect(plan).toHaveValue('7'));
    expect(screen.getByLabelText('Installation address')).toHaveValue('1 Main St, CDMX, CDMX, 01000');

    fireEvent.change(plan, { target: { value: '8' } });
    fireEvent.change(screen.getByLabelText('Installation address'), { target: { value: '2 Install Ave' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create order and continue' }));

    await waitFor(() => expect(mockApiPost).toHaveBeenCalledWith(
      '/service-orders',
      {
        body: {
          lead_id: 1,
          plan_id: 8,
          order_type: 'new_install',
          address: '2 Install Ave',
        },
      },
    ));
    await waitFor(() => expect(mockApiPost).toHaveBeenCalledWith(
      '/service-orders/{id}/start',
      { params: { path: { id: 44 } }, body: {} },
    ));
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/contracts/91'));
  });

  it('retries Start on the saved order without creating a duplicate order', async () => {
    let startAttempts = 0;
    mockApiPost.mockImplementation((path: string) => {
      if (path === '/service-orders') {
        return Promise.resolve({ data: { data: { id: 44, status: 'new' } }, error: undefined });
      }
      if (path === '/service-orders/{id}/start') {
        startAttempts += 1;
        if (startAttempts === 1) {
          return Promise.resolve({
            data: undefined,
            error: { error: { message: 'Signing setup is incomplete' } },
          });
        }
        return Promise.resolve({
          data: { data: { id: 44, contract: { id: 91 } } },
          error: undefined,
        });
      }
      return Promise.resolve({ data: undefined, error: undefined });
    });

    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Start installation' }));
    await screen.findByText('Fiber 100', { selector: 'option' });
    fireEvent.click(screen.getByRole('button', { name: 'Create order and continue' }));

    expect(await screen.findByText(/Signing setup is incomplete/)).toBeInTheDocument();
    expect(screen.getByText(/Service order #44 was saved/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry installation' }));

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/contracts/91'));
    expect(mockApiPost.mock.calls.filter(([path]) => path === '/service-orders')).toHaveLength(1);
    expect(mockApiPost.mock.calls.filter(([path]) => path === '/service-orders/{id}/start')).toHaveLength(2);
  });

  it('recovers a committed Start after its response was lost', async () => {
    let orderStarted = false;
    mockApiPost.mockImplementation((path: string) => {
      if (path === '/service-orders') {
        return Promise.resolve({ data: { data: { id: 44, status: 'new' } }, error: undefined });
      }
      if (path === '/service-orders/{id}/start') {
        orderStarted = true;
        return Promise.resolve({ data: undefined, error: { error: { message: 'Network timeout' } } });
      }
      return Promise.resolve({ data: undefined, error: undefined });
    });
    const originalGet = mockApiGet.getMockImplementation();
    mockApiGet.mockImplementation((path: string, options: unknown) => {
      if (path === '/service-orders/{id}' && orderStarted) {
        return Promise.resolve({
          data: { data: { id: 44, status: 'in_process', contract_id: 91 } },
          error: undefined,
        });
      }
      return originalGet?.(path, options);
    });

    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Start installation' }));
    await screen.findByText('Fiber 100', { selector: 'option' });
    fireEvent.click(screen.getByRole('button', { name: 'Create order and continue' }));
    expect(await screen.findByText('Network timeout')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Retry installation' }));
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/contracts/91'));
    expect(mockApiPost.mock.calls.filter(([path]) => path === '/service-orders/{id}/start')).toHaveLength(1);
  });

  it('can bridge a previously converted lead without clients.create permission', async () => {
    mockUser = {
      id: 2,
      role: 'support',
      permissions: ['service_orders.create', 'service_orders.update', 'installations.start'],
    };
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/leads/pipeline') return Promise.resolve({ data: { data: { won: 1 } }, error: undefined });
      if (path === '/plans') return Promise.resolve({ data: { data: [{ id: 7, name: 'Fiber 100' }] }, error: undefined });
      return Promise.resolve({
        data: { data: [{ ...lead1, status: 'won', converted_client_id: 55 }], meta: { total: 1, page: 1, limit: 200, totalPages: 1 } },
        error: undefined,
      });
    });

    renderPage();
    expect(await screen.findByRole('button', { name: 'Start installation' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Client #55' })).toHaveAttribute('href', '/clients/55');
    expect(screen.queryByRole('button', { name: 'Convert only' })).not.toBeInTheDocument();
  });

  it('can start from an unconverted lead with the composite installation permission but without clients.create', async () => {
    mockUser = {
      id: 2,
      role: 'support',
      permissions: ['service_orders.create', 'service_orders.update', 'installations.start'],
    };

    renderPage();
    await screen.findByText('Jane Prospect');
    expect(screen.getByRole('button', { name: 'Start installation' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Convert only' })).not.toBeInTheDocument();
  });

  it('requires all three service-order and composite permissions for Start installation', async () => {
    mockUser = {
      id: 2,
      role: 'support',
      permissions: ['clients.create', 'service_orders.create'],
    };
    renderPage();
    await screen.findByText('Jane Prospect');
    expect(screen.queryByRole('button', { name: 'Start installation' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Convert only' })).toBeInTheDocument();
  });

  it('sends address as an explicit null when a previously-set field is cleared on edit', async () => {
    mockApiPut.mockResolvedValue({ error: undefined });
    renderPage();
    await waitFor(() => expect(screen.getByText('Jane Prospect')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Edit'));
    const addressInput = await screen.findByDisplayValue('1 Main St');
    fireEvent.change(addressInput, { target: { value: '' } });
    fireEvent.click(screen.getByText('Save'));

    await waitFor(() => expect(mockApiPut).toHaveBeenCalledWith(
      '/leads/{id}',
      // The cleared field is nulled; a field that was set and left untouched
      // (city) still goes through as its real value, not null.
      expect.objectContaining({ body: expect.objectContaining({ address: null, city: 'CDMX' }) }),
    ));
  });

  it('shows the empty state when there are no leads', async () => {
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/leads/pipeline') {
        return Promise.resolve({ data: { data: {} }, error: undefined });
      }
      return Promise.resolve({
        data: { data: [], meta: { total: 0, page: 1, limit: 200, totalPages: 0 } },
        error: undefined,
      });
    });
    renderPage();
    await waitFor(() => expect(screen.getByText('No leads yet.')).toBeInTheDocument());
  });
});

// =============================================================================
// Feasibility desk check + desired plan (migration 445)
// =============================================================================
describe('LeadList — feasibility and desired plan', () => {
  beforeEach(() => mockResponses());

  it('every lead row offers the Feasibility desk check', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('Jane Prospect')).toBeInTheDocument());
    expect(screen.getByText('Feasibility')).toBeInTheDocument();
  });

  it('opens the feasibility modal and renders the desk-check sections', async () => {
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/leads/pipeline') return Promise.resolve({ data: { data: { new: 1 } }, error: undefined });
      if (path === '/leads/{id}/feasibility') {
        return Promise.resolve({
          data: {
            data: {
              has_coordinates: true,
              coverage_zones: [{ id: 3, name: 'CDMX Sur', zone_type: 'fixed_wireless', status: 'active', max_download_mbps: 50, max_upload_mbps: 10 }],
              wireless: [{ device_id: 9, ap_name: 'North AP', distance_km: 2.41, frequency_mhz: 5800, sector_azimuth_deg: 120, signal_min_dbm: -65, link_capacity_min_mbps: 20 }],
              ftth: [{ id: 2, name: 'ODF-CO1-R01', site_name: 'CO1', distance_km: 1.1, port_count: 12, ports_tracked: 12, free_ports: 4 }],
            },
          },
          error: undefined,
        });
      }
      return Promise.resolve({ data: { data: [lead1], meta: { total: 1, page: 1, limit: 25, totalPages: 1 } }, error: undefined });
    });
    renderPage();
    await waitFor(() => expect(screen.getByText('Jane Prospect')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Feasibility'));
    expect(await screen.findByText(/CDMX Sur/)).toBeInTheDocument();
    expect(screen.getByText(/North AP — 2.41 km/)).toBeInTheDocument();
    expect(screen.getByText(/4 of 12 ports free/)).toBeInTheDocument();
  });

  it('explains when the lead has no coordinates instead of showing empty sections', async () => {
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/leads/pipeline') return Promise.resolve({ data: { data: { new: 1 } }, error: undefined });
      if (path === '/leads/{id}/feasibility') {
        return Promise.resolve({ data: { data: { has_coordinates: false, coverage_zones: [], wireless: [], ftth: [] } }, error: undefined });
      }
      return Promise.resolve({ data: { data: [lead1], meta: { total: 1, page: 1, limit: 25, totalPages: 1 } }, error: undefined });
    });
    renderPage();
    await waitFor(() => expect(screen.getByText('Jane Prospect')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Feasibility'));
    expect(await screen.findByText(/no coordinates yet/i)).toBeInTheDocument();
  });
});
