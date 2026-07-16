// =============================================================================
// FireISP 5.0 — TicketDetail work-order-assignee source test
// =============================================================================
// The "Create Work Order" panel's assignee <select> used to be populated from
// the page's generic GET /users list (fetched for ticket reassignment /
// escalation targets). That list is NOT scoped to work_orders.update, so
// picking an arbitrary user there and creating a work order with them
// silently 422s server-side (routes/workOrders.js's assigneeAuthError).
// This test proves the assignee options now come from the dedicated
// GET /work-orders/assignable-users endpoint instead — asserting the
// assignable user's name appears, and the generic-list-only user's name does
// not, so a regression back to /users would fail loudly.
// =============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { TicketDetail } from '../TicketDetail';
import * as AuthContextModule from '@/auth/AuthContext';
import type { AuthUser } from '@/auth/AuthContext';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const assignableUsers = [{ id: 42, first_name: 'Ana', last_name: 'Technician' }];
const genericUsers = [{ id: 7, first_name: 'Bob', last_name: 'GenericStaff' }];

vi.mock('@/api/client', () => ({
  api: {
    GET: vi.fn(async (path: string) => {
      // Exact-match first: '/work-orders/assignable-users' would also match
      // a naive `.includes('/users')` check below.
      if (path === '/work-orders/assignable-users') return { data: { data: assignableUsers }, error: null };
      if (path.includes('/tickets/')) return { data: { data: ticket1 }, error: null };
      if (path.includes('/clients/')) return { data: { data: client1 }, error: null };
      if (path === '/users') return { data: { data: genericUsers }, error: null };
      return { data: { data: null }, error: null };
    }),
  },
  tokenStore: {
    getAccess: () => 'test-token',
    setAccess: vi.fn(),
    getRefresh: () => null,
    setRefresh: vi.fn(),
    clear: vi.fn(),
  },
  authedFetch: vi.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(input, init)),
}));

vi.mock('@/api/useWebSocket',           () => ({ useWebSocket:           vi.fn(() => ({ lastMessage: null })) }));
vi.mock('@/api/useGraphQLSubscription', () => ({ useGraphQLSubscription: vi.fn(() => ({ data: null })) }));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const adminUser: AuthUser = {
  id: 1, email: 'admin@test.com', name: 'Admin', role: 'admin',
  organization_id: 1, is_active: true, email_verified_at: '2026-01-01T00:00:00.000Z', twofa_enabled: false,
};

const ticket1 = {
  id: 99,
  client_id: 5,
  contract_id: null,
  assigned_to: null,
  subject: 'Internet very slow',
  description: 'Speed drops after 9 PM',
  priority: 'high',
  category: 'connectivity',
  status: 'open',
  notes: null,
  created_at: '2026-04-01T08:00:00Z',
  updated_at: '2026-04-01T09:00:00Z',
};

const client1 = { id: 5, name: 'Jane Doe', email: 'jane@example.com' };

function makeJsonOk(body: unknown) {
  return { ok: true, status: 200, json: () => Promise.resolve(body) } as Response;
}

function mockFetchImpl() {
  // Every raw-fetch sub-resource on the page (comments, ticket-scoped work
  // orders, escalations, follow-ups, time logs, AI endpoints) — an empty
  // list is a safe default for all of them.
  mockFetch.mockImplementation(() => Promise.resolve(makeJsonOk({ data: [] })));
}

function renderTicketDetail() {
  vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue({
    user: adminUser,
    loading: false,
    initialized: true,
    login: vi.fn(),
    logout: vi.fn(),
    refresh: vi.fn(),
    switchOrganization: vi.fn(),
  } as ReturnType<typeof AuthContextModule.useAuth>);

  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/tickets/99']}>
        <Routes>
          <Route path="/tickets/:id" element={<TicketDetail />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TicketDetail — Work Order assignee source', () => {
  beforeEach(() => vi.clearAllMocks());

  it('populates the assignee select from /work-orders/assignable-users, not the generic /users list', async () => {
    mockFetchImpl();
    renderTicketDetail();

    await waitFor(() => {
      expect(screen.queryByText(/Internet very slow/i)).toBeTruthy();
    }, { timeout: 3000 });

    fireEvent.click(screen.getByRole('button', { name: 'Create Work Order' }));

    await waitFor(() => {
      expect(screen.getByText('Ana Technician')).toBeInTheDocument();
    }, { timeout: 3000 });

    // The page's sidebar "Actions" panel (ticket status/reassignment) also
    // renders the generic /users list elsewhere on the page — that's a
    // legitimate, unrelated consumer (see TicketDetail.tsx's top-level
    // "Assigned To" select), so scope the "not from /users" assertion to
    // the work-order form's own <select> rather than the whole document.
    const assigneeSelect = screen.getByText('Ana Technician').closest('select');
    expect(assigneeSelect).not.toBeNull();
    expect(within(assigneeSelect as HTMLSelectElement).queryByText('Bob GenericStaff')).not.toBeInTheDocument();
  });
});
