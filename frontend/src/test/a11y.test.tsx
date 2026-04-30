// =============================================================================
// FireISP 5.0 — WCAG 2.1 AA accessibility audit
// Runs axe-core on every major page/component; color-contrast is disabled
// because jsdom cannot compute computed CSS styles.
// =============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { configureAxe } from 'jest-axe';

// ---------------------------------------------------------------------------
// Configure axe: target WCAG 2.1 AA; skip color-contrast (jsdom has no CSS)
// ---------------------------------------------------------------------------

const axe = configureAxe({
  rules: {
    'color-contrast': { enabled: false },
  },
  runOnly: {
    type: 'tag',
    values: ['wcag2a', 'wcag2aa'],
  },
});

// ---------------------------------------------------------------------------
// Shared mocks — api client, navigation, auth contexts
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

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => vi.fn() };
});

import * as AuthContextModule from '@/auth/AuthContext';
import type { AuthUser } from '@/auth/AuthContext';
import * as PortalAuthContextModule from '@/auth/PortalAuthContext';

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

function mockUsePortalAuth() {
  vi.spyOn(PortalAuthContextModule, 'usePortalAuth').mockReturnValue({
    client: null,
    loading: false,
    initialized: true,
    login: vi.fn(),
    logout: vi.fn(),
  } as ReturnType<typeof PortalAuthContextModule.usePortalAuth>);
}

function makeQc() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

// ---------------------------------------------------------------------------
// Page imports
// ---------------------------------------------------------------------------

import { Login } from '@/pages/Login';
import { Dashboard } from '@/pages/Dashboard';
import { ClientList } from '@/pages/ClientList';
import { InvoiceList } from '@/pages/InvoiceList';
import { TicketList } from '@/pages/TicketList';
import { UserList } from '@/pages/UserList';
import { PortalLogin } from '@/pages/portal/PortalLogin';
import { AIAssistantSettings } from '@/pages/AIAssistantSettings';
import { TicketDetail } from '@/pages/TicketDetail';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const summaryData = {
  clients: { total: 10, active: 8 },
  contracts: { total: 9, active: 7, suspended: 2 },
  revenue_30d: { outstanding: '0', collected: '5000', total_invoiced: '5000' },
  tickets: { total: 3, open_count: 1 },
  devices: { total: 5, monitored: 4 },
};

const client1 = {
  id: 1, name: 'Alice Smith', email: 'alice@test.com', phone: null,
  client_type: 'residential', status: 'active', city: 'CDMX', state: 'CMX',
  country: 'MX', created_at: '2024-01-01',
};

const invoice1 = {
  id: 1, client_id: 10, contract_id: 5,
  invoice_number: 'INV-2024-001', subtotal: '500', tax_amount: '80', total: '580',
  currency: 'MXN', due_date: '2024-02-01', paid_at: null, status: 'pending',
  created_at: '2024-01-01',
};

const ticket1 = {
  id: 1, client_id: 10, contract_id: null, assigned_to: null,
  subject: 'No internet connection', description: 'Client reports offline',
  priority: 'high', category: 'technical', status: 'open',
  created_at: '2024-01-10', updated_at: '2024-01-10',
};

const user1 = {
  id: 2, first_name: 'Bob', last_name: 'Tech', email: 'bob@test.com',
  role: 'technician', phone: null, status: 'active', totp_enabled: false,
  last_login_at: null, created_at: '2024-01-01',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Accessibility audit — WCAG 2.1 AA', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('Login page has no violations', async () => {
    mockUseAuth();
    const { container } = render(
      <MemoryRouter>
        <Login />
      </MemoryRouter>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it('Dashboard page has no violations after data loads', async () => {
    mockUseAuth();
    mockApiGet.mockImplementation((path: string) => {
      if (path.includes('summary'))
        return Promise.resolve({ data: { data: summaryData }, error: undefined });
      if (path.includes('mrr'))
        return Promise.resolve({ data: { data: [] }, error: undefined });
      if (path.includes('device-health'))
        return Promise.resolve({
          data: { data: { devices_by_type: [], health_snapshots: [] } },
          error: undefined,
        });
      if (path.includes('overdue'))
        return Promise.resolve({ data: { data: [] }, error: undefined });
      return Promise.resolve({ data: { data: {} }, error: undefined });
    });

    const { container } = render(
      <QueryClientProvider client={makeQc()}>
        <MemoryRouter>
          <Dashboard />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    // Wait for async data to render
    await waitFor(() => container.querySelector('[data-testid="dashboard-summary"], h1, h2'));
    expect(await axe(container)).toHaveNoViolations();
  });

  it('ClientList page has no violations after data loads', async () => {
    mockApiGet.mockResolvedValue({
      data: { data: [client1], meta: { total: 1, page: 1, limit: 20, totalPages: 1 } },
      error: undefined,
    });

    const { container } = render(
      <QueryClientProvider client={makeQc()}>
        <MemoryRouter>
          <ClientList />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await waitFor(() => container.querySelector('table, [role="table"], h1'));
    expect(await axe(container)).toHaveNoViolations();
  });

  it('ClientList page (empty state) has no violations', async () => {
    mockApiGet.mockResolvedValue({
      data: { data: [], meta: { total: 0, page: 1, limit: 20, totalPages: 0 } },
      error: undefined,
    });

    const { container } = render(
      <QueryClientProvider client={makeQc()}>
        <MemoryRouter>
          <ClientList />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await waitFor(() => container.querySelector('h1, p'));
    expect(await axe(container)).toHaveNoViolations();
  });

  it('InvoiceList page has no violations after data loads', async () => {
    mockApiGet.mockImplementation((path: string) => {
      if (path.includes('plans'))
        return Promise.resolve({ data: { data: [] }, error: undefined });
      return Promise.resolve({
        data: { data: [invoice1], meta: { total: 1, page: 1, limit: 20, totalPages: 1 } },
        error: undefined,
      });
    });

    const { container } = render(
      <QueryClientProvider client={makeQc()}>
        <MemoryRouter>
          <InvoiceList />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await waitFor(() => container.querySelector('table, [role="table"], h1'));
    expect(await axe(container)).toHaveNoViolations();
  });

  it('TicketList page has no violations after data loads', async () => {
    mockApiGet.mockResolvedValue({
      data: { data: [ticket1], meta: { total: 1, page: 1, limit: 20, totalPages: 1 } },
      error: undefined,
    });

    const { container } = render(
      <QueryClientProvider client={makeQc()}>
        <MemoryRouter>
          <TicketList />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await waitFor(() => container.querySelector('table, [role="table"], h1'));
    expect(await axe(container)).toHaveNoViolations();
  });

  it('UserList page has no violations after data loads', async () => {
    mockUseAuth();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          data: [user1],
          meta: { total: 1, page: 1, limit: 25, totalPages: 1 },
        }),
    } as Response);

    const { container } = render(
      <QueryClientProvider client={makeQc()}>
        <MemoryRouter>
          <UserList />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await waitFor(() => container.querySelector('table, [role="table"], h1'));
    expect(await axe(container)).toHaveNoViolations();
  });

  it('PortalLogin page has no violations', async () => {
    mockUsePortalAuth();
    const { container } = render(
      <MemoryRouter initialEntries={['/portal/login']}>
        <PortalLogin />
      </MemoryRouter>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it('TicketDetail page with AI Suggested Reply panel has no violations', async () => {
    mockUseAuth();

    const td99 = {
      id: 99, client_id: 5, contract_id: 3, assigned_to: null,
      subject: 'Slow internet', description: 'Speed is very low',
      priority: 'high', category: 'connectivity', status: 'open',
      created_at: '2026-04-01T08:00:00Z', updated_at: '2026-04-01T09:00:00Z',
    };

    mockApiGet.mockImplementation((path: string) => {
      if (String(path).includes('/tickets/'))
        return Promise.resolve({ data: { data: td99 }, error: null });
      if (String(path).includes('/clients/'))
        return Promise.resolve({ data: { data: { id: 5, name: 'Jane', email: 'jane@x.com' } }, error: null });
      if (String(path).includes('/users'))
        return Promise.resolve({ data: { data: [] }, error: null });
      return Promise.resolve({ data: { data: null }, error: null });
    });

    vi.spyOn(globalThis, 'fetch').mockImplementation((url: string, init?: RequestInit) => {
      const method = (init?.method ?? 'GET').toUpperCase();
      const path = String(url).split('?')[0];
      if (path.includes('/tickets/') && path.includes('/comments'))
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ data: [] }) } as Response);
      if (path.endsWith('/ai/policy'))
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ data: { id: 1, enabled: 1, mode: 'draft_only', active_provider_id: 2 } }) } as Response);
      if (path.endsWith('/ai/logs'))
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ data: [], meta: { total: 0 } }) } as Response);
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ data: null }) } as Response);
    });

    vi.mock('@/api/useWebSocket',          () => ({ useWebSocket:          vi.fn(() => ({ lastMessage: null })) }));
    vi.mock('@/api/useGraphQLSubscription', () => ({ useGraphQLSubscription: vi.fn(() => ({ data: null })) }));

    const { Route: RRoute, Routes: RRoutes } = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');

    const { container } = render(
      <QueryClientProvider client={makeQc()}>
        <MemoryRouter initialEntries={['/tickets/99']}>
          <RRoutes>
            <RRoute path="/tickets/:id" element={<TicketDetail />} />
          </RRoutes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await waitFor(() => container.querySelector('h1'));
    expect(await axe(container)).toHaveNoViolations();
  });

  it('AIAssistantSettings page has no violations (General tab)', async () => {
    mockUseAuth();
    vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
      const method = (init?.method ?? 'GET').toUpperCase();
      if (String(url).includes('/ai/policy') && method === 'GET')
        return Promise.resolve({
          ok: true, status: 200,
          json: () => Promise.resolve({
            data: {
              id: 1, enabled: true, mode: 'draft_only',
              active_provider_id: null,
              enabled_channels: { portal: true, email: true, whatsapp: false, sms: false },
              auto_send_confidence: 90, default_locale: 'en',
              tone: 'professional', redact_pii_before_llm: true,
              updated_at: '2025-01-01T00:00:00Z',
            },
          }),
        } as Response);
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ data: [] }) } as Response);
    });

    const { container } = render(
      <QueryClientProvider client={makeQc()}>
        <MemoryRouter>
          <AIAssistantSettings />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await waitFor(() => container.querySelector('form, h2'));
    expect(await axe(container)).toHaveNoViolations();
  });
});
