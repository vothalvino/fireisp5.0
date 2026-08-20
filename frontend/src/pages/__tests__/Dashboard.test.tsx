// =============================================================================
// FireISP 5.0 — Dashboard / Operations Console tests
// =============================================================================
// The admin/staff dashboard route now renders the Operations Console. It shows
// polished DEMO data while the system is empty (no real clients) and switches
// to live data once the first client exists. These tests cover both modes via
// the Dashboard role-router (admin → OperationsConsole).
// =============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
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
  email_verified_at: '2026-01-01T00:00:00.000Z',
  twofa_enabled: false,
};

function mockUseAuth(user: AuthUser = adminUser) {
  vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue({
    user,
    loading: false,
    initialized: true,
    login: vi.fn(),
    logout: vi.fn(),
    refresh: vi.fn(),
    switchOrganization: vi.fn(),
  } as ReturnType<typeof AuthContextModule.useAuth>);
}

// clients.total drives the demo↔real gate: 0 → demo, >0 → real.
function summaryWith(total: number, active: number) {
  return {
    clients: { total, active },
    contracts: { total: 9, active: 7, suspended: 2 },
    revenue_30d: { outstanding: '0', collected: '5000', total_invoiced: '5000' },
    tickets: { total: 3, open_count: 1 },
    devices: { total: 5, monitored: 4 },
  };
}

function setupApiMock(summary: ReturnType<typeof summaryWith>) {
  mockApiGet.mockImplementation((path: string) => {
    if (path.includes('summary')) return Promise.resolve({ data: { data: summary }, error: undefined });
    if (path.includes('mrr')) return Promise.resolve({ data: { data: [{ currency: 'MXN', active_contracts: 7, mrr: '5000', arpu: '714' }] }, error: undefined });
    if (path.includes('device-health')) return Promise.resolve({ data: { data: { devices_by_type: [], health_snapshots: [] } }, error: undefined });
    if (path.includes('overdue')) return Promise.resolve({ data: { data: [] }, error: undefined });
    if (path.includes('alerts/events')) return Promise.resolve({ data: { data: [] }, error: undefined });
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
    </QueryClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Operations Console (dashboard route)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAuth();
  });

  it('renders the console title', async () => {
    setupApiMock(summaryWith(0, 0));
    renderDashboard();
    await waitFor(() => expect(screen.getByText('Operations Overview')).toBeInTheDocument());
  });

  it('renders KPI labels', async () => {
    setupApiMock(summaryWith(0, 0));
    renderDashboard();
    await waitFor(() => expect(screen.getByText('Active Clients')).toBeInTheDocument());
    expect(screen.getByText('MRR')).toBeInTheDocument();
    expect(screen.getByText('Open Tickets')).toBeInTheDocument();
  });

  it('shows DEMO data and a "Demo data" marker while the system is empty', async () => {
    setupApiMock(summaryWith(0, 0));
    renderDashboard();
    // 12,847 is the design's demo active-client figure.
    await waitFor(() => expect(screen.getByText('12,847')).toBeInTheDocument());
    expect(screen.getByText('Demo data')).toBeInTheDocument();
  });

  it('switches to REAL data once the first client exists', async () => {
    setupApiMock(summaryWith(10, 8));
    renderDashboard();
    // Real active-client count from summary, no demo marker.
    await waitFor(() => expect(screen.getByText('8')).toBeInTheDocument());
    expect(screen.queryByText('Demo data')).not.toBeInTheDocument();
    expect(screen.queryByText('12,847')).not.toBeInTheDocument();
  });

  it('does not show the ticket action to billing, whose registry excludes /tickets', async () => {
    setupApiMock(summaryWith(0, 0));
    mockUseAuth({ ...adminUser, role: 'billing' });
    renderDashboard();
    await waitFor(() => expect(screen.getByText('Operations Overview')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'New ticket' })).not.toBeInTheDocument();
  });

  it('shows the ticket action to support when it may view and create tickets', async () => {
    setupApiMock(summaryWith(0, 0));
    mockUseAuth({ ...adminUser, role: 'support' });
    renderDashboard();
    await waitFor(() => expect(screen.getByRole('button', { name: 'New ticket' })).toBeInTheDocument());
  });

  it('hides the ticket action when authoritative permissions omit tickets.create', async () => {
    setupApiMock(summaryWith(0, 0));
    mockUseAuth({ ...adminUser, role: 'support', permissions: ['tickets.view'] });
    renderDashboard();
    await waitFor(() => expect(screen.getByText('Operations Overview')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'New ticket' })).not.toBeInTheDocument();
  });

  it('leaves Ctrl+K to the global command palette', async () => {
    setupApiMock(summaryWith(0, 0));
    renderDashboard();
    const ticketButton = await screen.findByRole('button', { name: 'New ticket' });
    const deviceSearch = screen.getByLabelText('Search devices');
    ticketButton.focus();

    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });

    expect(ticketButton).toHaveFocus();
    expect(deviceSearch).not.toHaveFocus();
    expect(deviceSearch).toHaveAttribute('placeholder', 'Filter by name, IP, or type…');
  });
});
