// =============================================================================
// FireISP 5.0 — Layout (sidebar navigation grouping) tests
// =============================================================================
// Verifies the sidebar groups nav items into translated sections and that
// section headings only appear when the user can see at least one item in them.
// =============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Layout } from '../Layout';
import { DarkModeProvider } from '@/auth/DarkModeContext';
import * as AuthContextModule from '@/auth/AuthContext';
import type { AuthUser } from '@/auth/AuthContext';

// ---------------------------------------------------------------------------
// Mocks — api client (used by DrDrillBanner/ChangelogPanel inside Layout)
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
// Fixtures
// ---------------------------------------------------------------------------

function makeUser(role: string): AuthUser {
  return {
    id: 1,
    email: `${role}@test.com`,
    name: role,
    role,
    organization_id: 1,
    is_active: true,
    email_verified: true,
    twofa_enabled: false,
  };
}

function mockUseAuth(user: AuthUser | null) {
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

function renderLayout() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <DarkModeProvider>
        <MemoryRouter>
          <Layout />
        </MemoryRouter>
      </DarkModeProvider>
    </QueryClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Layout — grouped sidebar navigation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiGet.mockResolvedValue({ data: undefined, error: undefined });
    sessionStorage.clear();
    // jsdom does not implement matchMedia, which DarkModeProvider relies on.
    if (!window.matchMedia) {
      window.matchMedia = vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })) as unknown as typeof window.matchMedia;
    }
  });

  it('renders all section headings for an admin', () => {
    mockUseAuth(makeUser('admin'));
    renderLayout();

    for (const heading of ['Clients', 'Billing', 'Network', 'Compliance', 'Administration']) {
      expect(screen.getByText(heading)).toBeInTheDocument();
    }
  });

  it('hides restricted sections for a low-privilege (support) user', () => {
    mockUseAuth(makeUser('support'));
    renderLayout();

    // Sections with at least one role-free item remain visible (e.g. Network
    // keeps the role-free Devices link, Billing keeps Invoices/Payments).
    expect(screen.getByText('Clients')).toBeInTheDocument();
    expect(screen.getByText('Network')).toBeInTheDocument();
    // Sections whose every item requires a higher role are hidden entirely.
    expect(screen.queryByText('Compliance')).not.toBeInTheDocument();
    expect(screen.queryByText('Administration')).not.toBeInTheDocument();
  });

  it('shows a curated field/NOC nav for a technician', () => {
    mockUseAuth(makeUser('technician'));
    renderLayout();

    // Technicians get a dedicated menu of pages their role can actually load,
    // grouped into Field Work / Network / Inventory.
    expect(screen.getByText('Field Work')).toBeInTheDocument();
    expect(screen.getByText('Network')).toBeInTheDocument();
    expect(screen.getByText('Inventory')).toBeInTheDocument();
    expect(screen.getByText('🔧 Work Orders')).toBeInTheDocument();
    expect(screen.getByText('🖧 NAS Devices')).toBeInTheDocument();
    // Pages that 403 for a technician, and the billing/admin sections, are gone.
    expect(screen.queryByText('🔌 VLANs')).not.toBeInTheDocument();
    expect(screen.queryByText('Billing')).not.toBeInTheDocument();
    expect(screen.queryByText('Administration')).not.toBeInTheDocument();
  });

  it('shows an org switcher listing all organizations for an admin', async () => {
    mockUseAuth(makeUser('admin'));
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/organizations') {
        return Promise.resolve({ data: { data: [{ id: 1, name: 'Org A' }, { id: 2, name: 'Org B' }] }, error: undefined });
      }
      return Promise.resolve({ data: undefined, error: undefined });
    });
    renderLayout();

    // The all-orgs query populates the switcher with every organization, even
    // ones the admin isn't an explicit member of. 'Org B' appears only as a
    // switcher option; 'Org A' (the active org) shows in both the option list
    // and the topbar label.
    expect(await screen.findByText('Org B')).toBeInTheDocument();
    expect(screen.getAllByText('Org A').length).toBeGreaterThanOrEqual(1);
  });
});
