// =============================================================================
// FireISP 5.0 — SiteDetail page tests
// =============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { SiteDetail } from '../SiteDetail';

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
      return Promise.resolve({ data: { data: [] }, error: undefined });
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
