// =============================================================================
// FireISP 5.0 — Dashboard page tests
// =============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { Dashboard } from '../Dashboard';
import * as AuthContextModule from '@/auth/AuthContext';
import type { AuthUser } from '@/auth/AuthContext';

// ---------------------------------------------------------------------------
// Mock API client
// ---------------------------------------------------------------------------

const mockApiGet = vi.fn();
vi.mock('@/api/client', () => ({
  api: { GET: (...args: unknown[]) => mockApiGet(...args) },
  tokenStore: {
    getAccess: () => 'test-token',
    setAccess: vi.fn(),
    getRefresh: () => null,
    setRefresh: vi.fn(),
    clear: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Fixtures / helpers
// ---------------------------------------------------------------------------

const adminUser: AuthUser = {
  id: 1,
  email: 'admin@test.com',
  name: 'Admin',
  role: 'admin',
  organization_id: 1,
  is_active: true,
  email_verified: true,
  twofa_enabled: false,
};

function mockUseAuth() {
  vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue({
    user: adminUser,
    loading: false,
    initialized: true,
    login: vi.fn(),
    logout: vi.fn(),
    refresh: vi.fn(),
    switchOrganization: vi.fn(),
  } as ReturnType<typeof AuthContextModule.useAuth>);
}

const summary = {
  clients: { total: 10, active: 8 },
  contracts: { total: 9, active: 7, suspended: 2 },
  revenue_30d: { outstanding: '0', collected: '5000', total_invoiced: '5000' },
  tickets: { total: 3, open_count: 1 },
  devices: { total: 5, monitored: 4 },
};

function setupApiMock() {
  mockApiGet.mockImplementation((path: string) => {
    if (path.includes('summary')) return Promise.resolve({ data: { data: summary }, error: undefined });
    if (path.includes('mrr')) return Promise.resolve({ data: { data: [] }, error: undefined });
    if (path.includes('device-health')) return Promise.resolve({ data: { data: { devices_by_type: [], health_snapshots: [] } }, error: undefined });
    if (path.includes('overdue')) return Promise.resolve({ data: { data: [] }, error: undefined });
    return Promise.resolve({ data: { data: {} }, error: undefined });
  });
}

function renderDashboard() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Dashboard page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAuth();
    setupApiMock();
  });

  it('renders the page title', async () => {
    renderDashboard();
    await waitFor(() => expect(screen.getByText('Dashboard')).toBeInTheDocument());
  });

  it('renders KPI card labels', async () => {
    renderDashboard();
    await waitFor(() => expect(screen.getByText('Active Clients')).toBeInTheDocument());
  });

  it('renders Overdue Invoices section heading', async () => {
    renderDashboard();
    await waitFor(() => expect(screen.getByRole('heading', { name: /Overdue Invoices/i })).toBeInTheDocument());
  });

  it('shows active client count after data loads', async () => {
    renderDashboard();
    // "8" comes from summary.clients.active
    await waitFor(() => expect(screen.getByText('8')).toBeInTheDocument());
  });
});
