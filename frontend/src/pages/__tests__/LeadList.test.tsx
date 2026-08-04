// =============================================================================
// FireISP 5.0 — LeadList page tests (§1.2)
// =============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { LeadList } from '../LeadList';

const mockApiGet = vi.fn();
const mockApiPut = vi.fn();
vi.mock('@/api/client', () => ({
  api: {
    GET: (...args: unknown[]) => mockApiGet(...args),
    POST: vi.fn(),
    PUT: (...args: unknown[]) => mockApiPut(...args),
    DELETE: vi.fn(),
  },
  tokenStore: { getAccess: () => 'tok', setAccess: vi.fn(), getRefresh: () => null, setRefresh: vi.fn(), clear: vi.fn() },
}));

vi.mock('@/auth/AuthContext', () => ({
  useAuth: () => ({ user: { id: 1, role: 'admin' } }),
}));

const lead1 = {
  id: 1, name: 'Jane Prospect', email: 'jane@x.com', phone: '555', company: 'Acme',
  source: 'referral', status: 'new', estimated_value: 350, assigned_to: null,
  converted_client_id: null, created_at: '2026-01-01',
  address: '1 Main St', city: 'CDMX', state: 'CDMX', zip_code: '01000',
};

function mockResponses() {
  mockApiGet.mockImplementation((path: string) => {
    if (path === '/leads/pipeline') {
      return Promise.resolve({ data: { data: { new: 1, won: 0 } }, error: undefined });
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
    await waitFor(() => expect(screen.getByText('Convert')).toBeInTheDocument());
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
