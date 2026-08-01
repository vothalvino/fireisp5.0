// =============================================================================
// FireISP 5.0 — Settings / Version tab
// =============================================================================
// The tab answers "what am I running?", which had no home in the product: the
// update banner only appears when an update IS available AND the check is
// switched on, so an operator with neither condition true saw nothing at all
// and could not tell working-and-quiet from broken.
//
// The property under test is the ROLE GATE. GET /system/version 404s anyone who
// is not the legacy users.role='admin', so showing a tenant admin the tab would
// guarantee an error page — the exact "visible button that 403s" failure this
// codebase keeps producing. A test that only checked "the tab renders for an
// admin" would not catch that.
// =============================================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { Settings } from '../Settings';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

let currentRole = 'admin';
vi.mock('@/auth/AuthContext', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/auth/AuthContext')>()),
  useAuth: () => ({
    user: {
      id: 1, email: 'u@test.com', name: 'U', role: currentRole,
      organization_id: 1, is_active: true, email_verified_at: null, twofa_enabled: false,
    },
    loading: false, initialized: true,
    login: vi.fn(), logout: vi.fn(), refresh: vi.fn(), switchOrganization: vi.fn(),
  }),
}));

vi.mock('@/api/client', () => ({
  api: { GET: vi.fn() },
  tokenStore: {
    getAccess: () => 'test-token', setAccess: vi.fn(),
    getRefresh: () => null, setRefresh: vi.fn(), clear: vi.fn(),
  },
  authedFetch: vi.fn().mockImplementation(
    (input: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(input, init),
  ),
}));

const VERSION = {
  running_sha: 'abcdef1234567890',
  latest_sha: '99999992222222',
  update_available: true,
  check_enabled: true,
  checked_at: '2026-08-01T00:00:00.000Z',
};

function respondWith(over: Record<string, unknown> = {}) {
  mockFetch.mockImplementation(async (url: string) => {
    if (String(url).includes('/system/version')) {
      return { ok: true, status: 200, json: async () => ({ data: { ...VERSION, ...over } }) };
    }
    return { ok: true, status: 200, json: async () => ({ data: [] }) };
  });
}

function renderSettings() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><Settings /></MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  currentRole = 'admin';
  respondWith();
});

describe('the tab is install-operator only', () => {
  it('is offered to the legacy admin', () => {
    renderSettings();
    expect(screen.getByRole('button', { name: /Version/i })).toBeInTheDocument();
  });

  it.each([['manager'], ['technician'], ['billing'], ['support'], ['readonly']])(
    'is hidden from a %s', (role) => {
      currentRole = role;
      renderSettings();
      expect(screen.queryByRole('button', { name: /Version/i })).not.toBeInTheDocument();
    },
  );

  it('does not request /system/version for a non-operator', async () => {
    // The endpoint 404s them. Asking anyway would put an error in their console
    // and advertise that the route exists.
    currentRole = 'manager';
    renderSettings();
    await waitFor(() => {
      expect(mockFetch.mock.calls.some(([u]) => String(u).includes('/system/version'))).toBe(false);
    });
  });
});

describe('what it shows', () => {
  it('reports the running commit, shortened', async () => {
    renderSettings();
    fireEvent.click(screen.getByRole('button', { name: /Version/i }));
    expect(await screen.findByText('abcdef1')).toBeInTheDocument();
  });

  it('says up to date when the commits match', async () => {
    respondWith({ latest_sha: 'abcdef1234567890', update_available: false });
    renderSettings();
    fireEvent.click(screen.getByRole('button', { name: /Version/i }));
    expect(await screen.findByText(/Up to date/i)).toBeInTheDocument();
  });

  it('flags an available update and names the command', async () => {
    renderSettings();
    fireEvent.click(screen.getByRole('button', { name: /Version/i }));
    expect(await screen.findByText(/newer release is available/i)).toBeInTheDocument();
    expect(screen.getByText('sudo redeploy')).toBeInTheDocument();
  });

  it('explains how to switch the check on when it is off', async () => {
    // The disabled state is the DEFAULT, so this is the first thing most
    // operators will see. It has to say what to do, not just "Disabled".
    respondWith({ check_enabled: false, latest_sha: null, update_available: false, checked_at: null });
    renderSettings();
    fireEvent.click(screen.getByRole('button', { name: /Version/i }));
    expect(await screen.findByText(/Disabled/i)).toBeInTheDocument();
    expect(screen.getByText('FIREISP_UPDATE_CHECK=1')).toBeInTheDocument();
  });

  it('hides the upstream rows entirely when the check is off', async () => {
    // Showing "Latest available: —" would imply a failed check rather than one
    // that was never made.
    respondWith({ check_enabled: false, latest_sha: null, update_available: false, checked_at: null });
    renderSettings();
    fireEvent.click(screen.getByRole('button', { name: /Version/i }));
    await screen.findByText(/Disabled/i);
    expect(screen.queryByText(/Latest available/i)).not.toBeInTheDocument();
  });

  it('says so plainly when the image carries no commit stamp', async () => {
    // A locally-built image. Showing "—" alone would read as a bug.
    respondWith({ running_sha: null });
    renderSettings();
    fireEvent.click(screen.getByRole('button', { name: /Version/i }));
    expect(await screen.findByText(/not built by CI/i)).toBeInTheDocument();
  });
});
