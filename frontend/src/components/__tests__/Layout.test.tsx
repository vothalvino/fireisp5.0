// =============================================================================
// FireISP 5.0 — Layout (sidebar navigation grouping) tests
// =============================================================================
// Verifies the sidebar groups nav items into translated sections and that
// section headings only appear when the user can see at least one item in them.
// =============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
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

function mockUseAuth(user: AuthUser | null, overrides?: Partial<ReturnType<typeof AuthContextModule.useAuth>>) {
  vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue({
    user,
    loading: false,
    initialized: true,
    login: vi.fn(),
    logout: vi.fn(),
    refresh: vi.fn(),
    switchOrganization: vi.fn(),
    ...overrides,
  } as ReturnType<typeof AuthContextModule.useAuth>);
}

// Most tests don't care about routing at all — Layout is just mounted as a
// plain child. The org-switch navigation test needs real route matching (to
// prove `navigate('/')` actually lands somewhere), so it opts into a Routes
// stub with a sentinel standing in for the Dashboard page at '/'.
function buildTree(qc: QueryClient, options?: { initialEntries?: string[]; withDashboardStub?: boolean }) {
  const routed = options?.withDashboardStub;
  const initialEntries = options?.initialEntries ?? ['/'];
  return (
    <QueryClientProvider client={qc}>
      <DarkModeProvider>
        <MemoryRouter initialEntries={initialEntries}>
          {routed ? (
            <Routes>
              <Route path="/" element={<div>DASHBOARD_SENTINEL</div>} />
              <Route path="*" element={<Layout />} />
            </Routes>
          ) : (
            <Layout />
          )}
        </MemoryRouter>
      </DarkModeProvider>
    </QueryClientProvider>
  );
}

function renderLayout(options?: { initialEntries?: string[]; withDashboardStub?: boolean }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(buildTree(qc, options));
  return { ...utils, qc };
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

  it('renders every section header for an admin, fully collapsed until a section is opened', async () => {
    mockUseAuth(makeUser('admin'));
    renderLayout();
    const { fireEvent } = await import('@testing-library/react');

    // Section headers are always visible; collapsed sections hide their rows.
    for (const heading of ['Dashboard', 'Billing', 'Support', 'Field Work', 'Network', 'Inventory', 'Compliance', 'Administration']) {
      expect(screen.getByText(heading)).toBeInTheDocument();
    }
    // Nothing auto-expands on first load — the sidebar starts fully collapsed.
    expect(screen.queryByText('Leads')).not.toBeInTheDocument();
    expect(screen.queryByText('Invoices')).not.toBeInTheDocument();

    // Clicking a section header opens it.
    fireEvent.click(screen.getByText('Clients'));
    // 'Clients' now appears twice: the (open) section header and its first row.
    expect(screen.getAllByText('Clients').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('Leads')).toBeInTheDocument();
    // Other sections remain collapsed.
    expect(screen.queryByText('Invoices')).not.toBeInTheDocument();
  });

  it('gives support only its sections, all collapsed until the support kit is opened', async () => {
    mockUseAuth(makeUser('support'));
    renderLayout();
    const { fireEvent } = await import('@testing-library/react');

    expect(screen.getByText('Clients')).toBeInTheDocument();
    expect(screen.getByText('Support')).toBeInTheDocument();
    expect(screen.getByText('Network')).toBeInTheDocument();
    // Billing (all rows billing-only), Compliance, Field Work and Admin are gone —
    // support lacks the permissions/route guards for every row in them.
    expect(screen.queryByText('Billing')).not.toBeInTheDocument();
    expect(screen.queryByText('Compliance')).not.toBeInTheDocument();
    expect(screen.queryByText('Field Work')).not.toBeInTheDocument();
    expect(screen.queryByText('Administration')).not.toBeInTheDocument();
    // Support's primary section stays collapsed until clicked.
    expect(screen.queryByText('Tickets')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('Support'));
    expect(screen.getByText('Tickets')).toBeInTheDocument();
  });

  it('gives technicians their field kit from the shared registry (no hardcoded fork)', async () => {
    mockUseAuth(makeUser('technician'));
    renderLayout();
    const { fireEvent } = await import('@testing-library/react');

    expect(screen.getByText('Field Work')).toBeInTheDocument();
    expect(screen.getByText('Network')).toBeInTheDocument();
    expect(screen.getByText('Inventory')).toBeInTheDocument();
    // Pages the technician role 403s on (audit: leads/surveys) and the
    // billing/admin sections are gone.
    expect(screen.queryByText('Leads')).not.toBeInTheDocument();
    expect(screen.queryByText('Billing')).not.toBeInTheDocument();
    expect(screen.queryByText('Administration')).not.toBeInTheDocument();
    // Nothing auto-expands, including the technician's own primary section.
    expect(screen.queryByText('Work Orders')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('Field Work'));
    expect(screen.getByText('Work Orders')).toBeInTheDocument();
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

  it('honors a stored expanded-sections array from localStorage instead of collapsing it', () => {
    // A section other than admin's persona default ('clients') so this test
    // can't pass by accident via the (now-removed) persona-seeding behavior.
    localStorage.setItem('fireisp.nav.expanded', JSON.stringify(['support']));
    mockUseAuth(makeUser('admin'));
    renderLayout();

    // 'support' was explicitly persisted open — its rows render with no click.
    expect(screen.getByText('Tickets')).toBeInTheDocument();
    // Sections that were never stored/opened stay collapsed.
    expect(screen.queryByText('Leads')).not.toBeInTheDocument();
    expect(screen.queryByText('Invoices')).not.toBeInTheDocument();
  });

  it('reseeds the persona default when a role switch stops the sidebar from stranding on an invisible section', async () => {
    mockUseAuth(makeUser('billing'));
    const { rerender, qc } = renderLayout();
    const { fireEvent } = await import('@testing-library/react');

    // Billing opens its own section by clicking the header.
    fireEvent.click(screen.getByText('Billing'));
    expect(screen.getByText('Invoices')).toBeInTheDocument();

    // Switch to a role that can't see Billing at all. The previously-open
    // section is now invisible ("stranded") — the new persona's default
    // section must open in its place rather than leaving the nav empty.
    mockUseAuth(makeUser('support'));
    rerender(buildTree(qc));
    expect(screen.queryByText('Billing')).not.toBeInTheDocument();
    expect(screen.getByText('Tickets')).toBeInTheDocument();
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

  it('readonly (multi-org member) sees its own memberships in the switcher and never fires the admin-only all-orgs query', async () => {
    // Regression for a review-caught bug: hasRole(user.role, 'admin') gives
    // readonly a bypass for PAGE-REACHABILITY (PrivateRoute/canSee), but
    // Layout's isAdmin decides a LITERAL privilege (can this user list every
    // org on the platform?) — readonly must not inherit that bypass here, or
    // the all-orgs query fires, 403s/returns something readonly has no real
    // access to, and — worse — `orgs = isAdmin ? (allOrgs ?? memberships) :
    // memberships` would stop falling back to `memberships`, so a readonly
    // user who legitimately belongs to 2 orgs would lose the switcher.
    const readonlyUser = makeUser('readonly');
    readonlyUser.organizations = [
      { id: 1, name: 'Org A' },
      { id: 2, name: 'Org B' },
    ];
    mockUseAuth(readonlyUser);
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/organizations') {
        // If this fired for readonly it would "succeed" here, which is
        // exactly why the assertion below must prove it was never called.
        return Promise.resolve({ data: { data: [{ id: 1, name: 'Org A' }, { id: 2, name: 'Org B' }, { id: 3, name: 'Org C (not a member)' }] }, error: undefined });
      }
      return Promise.resolve({ data: undefined, error: undefined });
    });
    renderLayout();

    // Own memberships render (from user.organizations, not the all-orgs query).
    expect(await screen.findByLabelText('Active organization')).toBeInTheDocument();
    expect(screen.getAllByText('Org A').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Org B')).toBeInTheDocument();
    // Never sees an org it isn't a member of.
    expect(screen.queryByText('Org C (not a member)')).not.toBeInTheDocument();
    // The admin-only all-orgs query itself must never have fired.
    expect(mockApiGet).not.toHaveBeenCalledWith('/organizations', expect.anything());
  });

  it('navigates to the dashboard after a successful org switch, even from a non-dashboard page', async () => {
    const switchOrganization = vi.fn().mockResolvedValue(undefined);
    mockUseAuth(makeUser('admin'), { switchOrganization });
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/organizations') {
        return Promise.resolve({ data: { data: [{ id: 1, name: 'Org A' }, { id: 2, name: 'Org B' }] }, error: undefined });
      }
      return Promise.resolve({ data: undefined, error: undefined });
    });
    // Mounted on a page that is not the dashboard (the sentinel below stands
    // in for it), proving the switch actually navigates rather than being a
    // no-op because the user happened to already be there.
    renderLayout({ withDashboardStub: true, initialEntries: ['/clients'] });
    const { fireEvent } = await import('@testing-library/react');

    await screen.findByText('Org B');
    const select = screen.getByLabelText('Active organization');
    fireEvent.change(select, { target: { value: '2' } });

    expect(switchOrganization).toHaveBeenCalledWith(2);
    expect(await screen.findByText('DASHBOARD_SENTINEL')).toBeInTheDocument();
  });

  it('does not navigate when the org switch fails, leaving the user on the current page', async () => {
    const switchOrganization = vi.fn().mockRejectedValue(new Error('switch failed'));
    mockUseAuth(makeUser('admin'), { switchOrganization });
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/organizations') {
        return Promise.resolve({ data: { data: [{ id: 1, name: 'Org A' }, { id: 2, name: 'Org B' }] }, error: undefined });
      }
      return Promise.resolve({ data: undefined, error: undefined });
    });
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    renderLayout({ withDashboardStub: true, initialEntries: ['/clients'] });
    const { fireEvent, waitFor } = await import('@testing-library/react');

    await screen.findByText('Org B');
    const select = screen.getByLabelText('Active organization');
    fireEvent.change(select, { target: { value: '2' } });

    // The existing alert path fires and the user stays put — no navigation.
    await waitFor(() => expect(alertSpy).toHaveBeenCalledWith('switch failed'));
    expect(screen.queryByText('DASHBOARD_SENTINEL')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Active organization')).toBeInTheDocument();
    alertSpy.mockRestore();
  });
});
