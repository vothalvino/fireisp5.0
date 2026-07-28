// =============================================================================
// FireISP 5.0 — ProfileExtrasTab permission gate (j13, bug half)
// =============================================================================
// The tax-exemption and VIP-suspension controls were gated on
// `user?.role === 'admin'` — the LEGACY users.role, not the resolved permission
// set. So an ORG-MEMBERSHIP admin could not see them at all, even though the
// backend would have accepted their write: PUT/PATCH /clients/:id requires only
// `clients.update`.
//
// This file pins the gate to what the API actually enforces. It deliberately
// does NOT assert anything about whether billing SHOULD hold clients.update —
// that is the open product decision on j13.
// =============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { ProfileExtrasTab } from '../ClientProfileTabs';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string, f?: string) => f ?? k, i18n: { changeLanguage: vi.fn() } }),
}));

const mockGet = vi.fn();
vi.mock('@/api/client', () => ({
  api: { GET: (...a: unknown[]) => mockGet(...a), PUT: vi.fn(), PATCH: vi.fn(), POST: vi.fn() },
  tokenStore: { getAccess: () => 'tok' },
  authedFetch: vi.fn(),
}));

type MockUser = { role?: string; permissions?: string[]; organization_locale?: string };
const mockUser = vi.hoisted(() => ({ current: {} as MockUser }));
vi.mock('@/auth/AuthContext', () => ({ useAuth: () => ({ user: mockUser.current }) }));

const CLIENT = {
  id: 7, name: 'Juana Pérez', tax_exempt: 0, suspension_exempt: 1, client_group_id: null,
};

function renderTab(user: MockUser) {
  mockUser.current = { organization_locale: 'MX', ...user };
  mockGet.mockImplementation((path: string) => {
    if (String(path).includes('client-groups')) return Promise.resolve({ data: { data: [] }, error: undefined });
    return Promise.resolve({ data: { data: CLIENT }, error: undefined });
  });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><ProfileExtrasTab clientId={7} canEdit /></MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => vi.clearAllMocks());

describe('the gate follows the backend permission, not the legacy role', () => {
  it('an ORG-MEMBERSHIP admin sees the controls — the bug this fixes', async () => {
    // users.role is NOT 'admin' here; the org membership grants the permission.
    // Under the old `user.role === 'admin'` check this rendered nothing.
    renderTab({ role: 'manager', permissions: ['clients.view', 'clients.update'] });
    await waitFor(() => expect(screen.getByText(/Exempt from automatic suspension/i)).toBeInTheDocument());
  });

  it('a legacy users.role=admin still sees them', async () => {
    // can() short-circuits true for the legacy admin bypass tier, mirroring rbac.
    renderTab({ role: 'admin' });
    await waitFor(() => expect(screen.getByText(/Exempt from automatic suspension/i)).toBeInTheDocument());
  });

  it('a role WITHOUT clients.update does not see them', async () => {
    // Unchanged behaviour, and correct: the backend would 403 the write, so a
    // visible toggle would be the visible-but-forbidden shape.
    renderTab({ role: 'billing', permissions: ['clients.view'] });
    await waitFor(() => expect(screen.getByText('Credit score')).toBeInTheDocument());
    expect(screen.queryByText(/Exempt from automatic suspension/i)).toBeNull();
  });

  it('readonly does not see them either', async () => {
    renderTab({ role: 'readonly', permissions: ['clients.view'] });
    await waitFor(() => expect(screen.getByText('Credit score')).toBeInTheDocument());
    expect(screen.queryByText(/Exempt from automatic suspension/i)).toBeNull();
  });
});
