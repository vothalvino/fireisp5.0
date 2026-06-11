// =============================================================================
// FireISP 5.0 — PppoeServiceProfileList page tests
// =============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { PppoeServiceProfileList } from '../PppoeServiceProfileList';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }),
}));

const mockApiGet = vi.fn();
const mockApiPost = vi.fn();
const mockApiPut = vi.fn();
const mockApiDelete = vi.fn();

vi.mock('@/api/client', () => ({
  api: {
    GET: (...args: unknown[]) => mockApiGet(...args),
    POST: (...args: unknown[]) => mockApiPost(...args),
    PUT: (...args: unknown[]) => mockApiPut(...args),
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

const profile1 = {
  id: 1,
  name: 'Residential-PPPoE',
  service_name: 'ISP-PPPoE',
  mtu: 1492,
  mru: 1492,
  auth_methods: 'pap,chap,mschapv2',
  dns_primary: '8.8.8.8',
  dns_secondary: '8.8.4.4',
  session_timeout_seconds: null,
  idle_timeout_seconds: null,
  rate_limit_override: null,
  address_list: null,
  filter_id: null,
  status: 'active',
  notes: null,
};

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <PppoeServiceProfileList />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('PppoeServiceProfileList page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/pppoe-service-profiles')
        return Promise.resolve({
          data: { data: [profile1], meta: { total: 1, page: 1, limit: 25 } },
          error: undefined,
        });
      return Promise.resolve({ data: { data: [] }, error: undefined });
    });
  });

  it('renders page heading', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('PPPoE Service Profiles')).toBeInTheDocument());
  });

  it('renders a profile row with name and service name', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('Residential-PPPoE')).toBeInTheDocument());
    expect(screen.getByText('ISP-PPPoE')).toBeInTheDocument();
  });

  it('shows MTU/MRU values', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('1492/1492')).toBeInTheDocument());
  });

  it('shows empty message when no profiles returned', async () => {
    mockApiGet.mockImplementation(() =>
      Promise.resolve({ data: { data: [], meta: { total: 0, page: 1, limit: 25 } }, error: undefined }),
    );
    renderPage();
    await waitFor(() => expect(screen.getByText('No PPPoE service profiles found.')).toBeInTheDocument());
  });

  it('shows error state on fetch failure', async () => {
    mockApiGet.mockImplementation(() =>
      Promise.resolve({ data: undefined, error: { message: 'server error' } }),
    );
    renderPage();
    await waitFor(() => expect(screen.getByText('Failed to load profiles.')).toBeInTheDocument());
  });

  it('shows loading state while fetching', () => {
    mockApiGet.mockImplementation(() => new Promise(() => undefined));
    renderPage();
    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });
});
