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
    email_verified_at: '2026-01-01T00:00:00.000Z',
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
    localStorage.clear(); // accordion expanded-state persists here between renders
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

  it('renders every section header for an admin, with Clients open by default', () => {
    mockUseAuth(makeUser('admin'));
    renderLayout();

    // Section headers are always visible; collapsed sections hide their rows.
    for (const heading of ['Dashboard', 'Billing', 'Support', 'Field Work', 'Network', 'Inventory', 'Compliance', 'Administration']) {
      expect(screen.getByText(heading)).toBeInTheDocument();
    }
    // 'Clients' appears twice: the (default-open) section header and its first row.
    expect(screen.getAllByText('Clients').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('Leads')).toBeInTheDocument();
    // Rows of collapsed sections are not rendered.
    expect(screen.queryByText('Invoices')).not.toBeInTheDocument();
  });

  it('gives support only its sections, with the support kit open', () => {
    mockUseAuth(makeUser('support'));
    renderLayout();

    expect(screen.getByText('Clients')).toBeInTheDocument();
    expect(screen.getByText('Support')).toBeInTheDocument();
    expect(screen.getByText('Network')).toBeInTheDocument();
    // Support's primary section opens by default.
    expect(screen.getByText('Tickets')).toBeInTheDocument();
    // Billing (all rows billing-only), Compliance, Field Work and Admin are gone —
    // support lacks the permissions/route guards for every row in them.
    expect(screen.queryByText('Billing')).not.toBeInTheDocument();
    expect(screen.queryByText('Compliance')).not.toBeInTheDocument();
    expect(screen.queryByText('Field Work')).not.toBeInTheDocument();
    expect(screen.queryByText('Administration')).not.toBeInTheDocument();
  });

  it('gives technicians their field kit from the shared registry (no hardcoded fork)', async () => {
    mockUseAuth(makeUser('technician'));
    renderLayout();

    expect(screen.getByText('Field Work')).toBeInTheDocument();
    expect(screen.getByText('Network')).toBeInTheDocument();
    expect(screen.getByText('Inventory')).toBeInTheDocument();
    // Field Work opens by default for technicians.
    expect(screen.getByText('Work Orders')).toBeInTheDocument();
    // Pages the technician role 403s on (audit: leads/surveys) and the
    // billing/admin sections are gone.
    expect(screen.queryByText('Leads')).not.toBeInTheDocument();
    expect(screen.queryByText('Billing')).not.toBeInTheDocument();
    expect(screen.queryByText('Administration')).not.toBeInTheDocument();
    const { fireEvent } = await import('@testing-library/react');
    // Tickets lives in the (collapsed) Support section since migration 394
    // granted technicians tickets.view.
    fireEvent.click(screen.getByText('Support'));
    expect(screen.getByText('Tickets')).toBeInTheDocument();
    // Expanding Network reveals the shortlist and the View-all row to the hub.
    fireEvent.click(screen.getByText('Network'));
    expect(screen.getByText('NAS Devices')).toBeInTheDocument();
    expect(screen.getByText(/View all \d+/)).toBeInTheDocument();
    // The long tail is hub-only, not rail rows.
    expect(screen.queryByText('VLANs')).not.toBeInTheDocument();
  });

  it('hub sections collapse again via the chevron after being opened (regression)', async () => {
    mockUseAuth(makeUser('technician'));
    renderLayout();
    const { fireEvent } = await import('@testing-library/react');

    // Label click on a hub header expands the section (and navigates to the hub).
    fireEvent.click(screen.getByText('Network'));
    expect(screen.getByText('NAS Devices')).toBeInTheDocument();

    // The chevron is a separate toggle — an opened hub must collapse again.
    const chevron = screen.getByRole('button', { name: 'Expand or collapse Network' });
    fireEvent.click(chevron);
    expect(screen.queryByText('NAS Devices')).not.toBeInTheDocument();
    fireEvent.click(chevron);
    expect(screen.getByText('NAS Devices')).toBeInTheDocument();
  });

  it('opens the command palette from the sidebar button and filters by role', async () => {
    mockUseAuth(makeUser('technician'));
    renderLayout();
    const { fireEvent } = await import('@testing-library/react');

    fireEvent.click(screen.getByText('Search…'));
    const input = screen.getByRole('combobox', { name: 'Go to page' });
    expect(input).toBeInTheDocument();

    // Technician can jump to work orders…
    fireEvent.change(input, { target: { value: 'Work Or' } });
    expect(screen.getByRole('option', { name: /Work Orders/ })).toBeInTheDocument();

    // …but pages their role can't load never appear (leads — no leads.view).
    fireEvent.change(input, { target: { value: 'Leads' } });
    expect(screen.queryByRole('option', { name: /Leads/ })).not.toBeInTheDocument();

    // Esc closes.
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByRole('combobox', { name: 'Go to page' })).not.toBeInTheDocument();
  });

  it('opens the command palette with Ctrl+K', async () => {
    mockUseAuth(makeUser('admin'));
    renderLayout();
    const { fireEvent } = await import('@testing-library/react');
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    expect(screen.getByRole('combobox', { name: 'Go to page' })).toBeInTheDocument();
  });

  it('offers workspace presets to admins only, and they prune the sidebar', async () => {
    mockUseAuth(makeUser('technician'));
    const first = renderLayout();
    expect(screen.queryByLabelText('Workspace')).not.toBeInTheDocument();
    first.unmount();

    mockUseAuth(makeUser('admin'));
    renderLayout();
    const { fireEvent } = await import('@testing-library/react');
    const select = screen.getByLabelText('Workspace');
    fireEvent.change(select, { target: { value: 'billing' } });
    // Billing preset keeps Dashboard + billing-side sections, hides the rest.
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
    expect(screen.getByText('Billing')).toBeInTheDocument();
    expect(screen.getByText('Compliance')).toBeInTheDocument();
    expect(screen.queryByText('Network')).not.toBeInTheDocument();
    expect(screen.queryByText('Field Work')).not.toBeInTheDocument();
    // Back to full restores everything.
    fireEvent.change(select, { target: { value: 'full' } });
    expect(screen.getByText('Network')).toBeInTheDocument();
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
