// =============================================================================
// FireISP 5.0 — SiteDetail page tests
// =============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { SiteDetail } from '../SiteDetail';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockApiGet = vi.fn();
const mockAuthedFetch = vi.fn();
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
  authedFetch: (...args: unknown[]) => mockAuthedFetch(...args),
}));

vi.mock('@/auth/AuthContext', () => ({
  useAuth: () => ({ user: { id: 1, role: 'admin' } }),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const site = {
  id: 7,
  name: 'Main POP',
  site_type: 'datacenter',
  address: 'Av. Insurgentes 123',
  city: 'CDMX',
  state: 'CDMX',
  zip_code: '06600',
  country: 'MX',
  latitude: 19.4326,
  longitude: -99.1332,
  status: 'active',
  notes: 'Primary data center',
};

// Distinct from any generic /users fixture — proves the assignee select is
// populated from GET /work-orders/assignable-users, not the generic list.
const assignableUsers = [
  { id: 42, first_name: 'Ana', last_name: 'Technician' },
];

// ---------------------------------------------------------------------------
// Render helper
// ---------------------------------------------------------------------------

function renderDetail(id = '7') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/sites/${id}`]}>
        <Routes>
          <Route path="/sites/:id" element={<SiteDetail />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SiteDetail page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/sites/{id}') {
        return Promise.resolve({
          data: { data: site },
          error: undefined,
        });
      }
      if (path === '/work-orders/assignable-users') {
        return Promise.resolve({ data: { data: assignableUsers }, error: undefined });
      }
      return Promise.resolve({ data: { data: [] }, error: undefined });
    });
    mockAuthedFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: { id: 501 } }),
    });
  });

  it('renders the site name as a heading', async () => {
    renderDetail();
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Main POP' })).toBeInTheDocument(),
    );
  });

  it('shows the site status badge', async () => {
    renderDetail();
    await waitFor(() => expect(screen.getByText('active')).toBeInTheDocument());
  });

  it('shows site ID in the header meta', async () => {
    renderDetail();
    await waitFor(() => expect(screen.getByText('ID #7')).toBeInTheDocument());
  });

  it('shows location info', async () => {
    renderDetail();
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Main POP' })).toBeInTheDocument(),
    );
    // location is assembled from address, city, state, zip_code, country
    expect(screen.getByText('Av. Insurgentes 123, CDMX, CDMX, 06600, MX')).toBeInTheDocument();
  });

  it('shows notes section', async () => {
    renderDetail();
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Main POP' })).toBeInTheDocument());
    expect(screen.getByText('Primary data center')).toBeInTheDocument();
  });

  it('renders breadcrumb back link to /sites', async () => {
    renderDetail();
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Main POP' })).toBeInTheDocument());
    const link = screen.getByRole('link', { name: 'Sites' });
    expect(link).toHaveAttribute('href', '/sites');
  });

  it('shows all tabs', async () => {
    renderDetail();
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Main POP' })).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Overview' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Devices' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'NAS' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'IP Pools' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Work Orders' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Outages' })).toBeInTheDocument();
  });

  it('shows not found message on API error', async () => {
    mockApiGet.mockImplementation(() =>
      Promise.resolve({ data: null, error: { message: 'Not found' } }),
    );
    renderDetail();
    await waitFor(() => expect(screen.getByText('Site not found.')).toBeInTheDocument());
  });

  it('shows loading text initially', () => {
    mockApiGet.mockImplementation(() => new Promise(() => {}));
    renderDetail();
    expect(screen.getByText('Loading site…')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Create Work Order (inline form on the Work Orders tab)
// ---------------------------------------------------------------------------

describe('SiteDetail — create work order', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/sites/{id}') {
        return Promise.resolve({ data: { data: site }, error: undefined });
      }
      if (path === '/work-orders/assignable-users') {
        return Promise.resolve({ data: { data: assignableUsers }, error: undefined });
      }
      return Promise.resolve({ data: { data: [] }, error: undefined });
    });
    mockAuthedFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: { id: 501 } }),
    });
  });

  async function openCreateForm() {
    renderDetail();
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Main POP' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Work Orders' }));
    fireEvent.click(screen.getByRole('button', { name: 'New Work Order' }));
  }

  it('populates the assignee select from /work-orders/assignable-users, not a generic /users list', async () => {
    await openCreateForm();
    await waitFor(() => expect(screen.getByText('Ana Technician')).toBeInTheDocument());
    expect(mockApiGet).toHaveBeenCalledWith('/work-orders/assignable-users', expect.anything());
  });

  it('POSTs the create body with site_id pinned to this site, and never asks for a target picker', async () => {
    await openCreateForm();

    fireEvent.change(screen.getByPlaceholderText('Describe the work needed'), { target: { value: 'Replace antenna' } });
    await waitFor(() => expect(screen.getByText('Ana Technician')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(mockAuthedFetch).toHaveBeenCalled());
    const [url, opts] = mockAuthedFetch.mock.calls[0] as [string, { method: string; body: string }];
    expect(url).toBe('/api/v1/work-orders');
    expect(opts.method).toBe('POST');
    const body = JSON.parse(opts.body);
    expect(body.site_id).toBe(7);
    expect(body.title).toBe('Replace antenna');
    // Site-scoped creation fixes the target — no client/site/device picker.
    expect(screen.queryByText('Target')).not.toBeInTheDocument();
  });

  it('collapses the form and refetches the site work-order list on success', async () => {
    await openCreateForm();
    fireEvent.change(screen.getByPlaceholderText('Describe the work needed'), { target: { value: 'Replace antenna' } });
    const callsBeforeSubmit = mockApiGet.mock.calls.filter(([p]) => p === '/work-orders').length;

    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(mockAuthedFetch).toHaveBeenCalled());
    // Form collapses back to the "New Work Order" toggle button.
    await waitFor(() => expect(screen.getByRole('button', { name: 'New Work Order' })).toBeInTheDocument());
    // The site-scoped work-orders list query was invalidated and refetched.
    await waitFor(() => {
      const callsAfter = mockApiGet.mock.calls.filter(([p]) => p === '/work-orders').length;
      expect(callsAfter).toBeGreaterThan(callsBeforeSubmit);
    });
  });
});
