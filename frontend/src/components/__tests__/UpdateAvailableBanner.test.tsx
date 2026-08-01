// =============================================================================
// FireISP 5.0 — UpdateAvailableBanner component tests
// =============================================================================
// Two properties matter here and neither is "does a div render":
//
//   1. ONCE A DAY. Dismissal must survive a reload (localStorage, not
//      sessionStorage) and must expire at the local date boundary. A
//      session-scoped dismissal would reappear on every browser restart, which
//      is not what was asked for.
//
//   2. INSTALL OPERATOR ONLY. A tenant admin must not even trigger the request.
//      The backend 404s them regardless, but a component that asks anyway
//      leaks the endpoint's existence through the network tab.
// =============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { UpdateAvailableBanner } from '../UpdateAvailableBanner';
import * as AuthContextModule from '@/auth/AuthContext';
import type { AuthUser } from '@/auth/AuthContext';

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

const base = {
  organization_id: 1,
  is_active: true,
  email_verified_at: '2026-01-01T00:00:00.000Z',
  twofa_enabled: false,
};
const operator: AuthUser = { id: 1, email: 'op@test.com', name: 'Op', role: 'admin', ...base };
const tenantAdmin: AuthUser = { id: 2, email: 'ta@test.com', name: 'TA', role: 'manager', ...base };

const DISMISS_KEY = 'fireispUpdateBannerDismissedOn';

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

function respond(over: Record<string, unknown> = {}) {
  mockApiGet.mockResolvedValue({
    data: {
      data: {
        running_sha: 'aaaaaaaaaaaaaaaa',
        latest_sha: 'bbbbbbbbbbbbbbbb',
        update_available: true,
        check_enabled: true,
        checked_at: '2026-08-01T00:00:00.000Z',
        ...over,
      },
    },
  });
}

function renderBanner() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <UpdateAvailableBanner />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${`${d.getMonth() + 1}`.padStart(2, '0')}-${`${d.getDate()}`.padStart(2, '0')}`;
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.removeItem(DISMISS_KEY);
  respond();
});
afterEach(() => vi.useRealTimers());

describe('who sees it', () => {
  it('shows for the install operator when an update exists', async () => {
    mockUseAuth(operator);
    renderBanner();
    expect(await screen.findByRole('status')).toBeInTheDocument();
  });

  it('renders nothing for a tenant admin', async () => {
    mockUseAuth(tenantAdmin);
    renderBanner();
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
  });

  it('does not even REQUEST for a tenant admin', async () => {
    // The endpoint 404s them anyway; asking would still advertise it exists.
    mockUseAuth(tenantAdmin);
    renderBanner();
    await waitFor(() => expect(mockApiGet).not.toHaveBeenCalled());
  });

  it('renders nothing when logged out', async () => {
    mockUseAuth(null);
    renderBanner();
    await waitFor(() => expect(mockApiGet).not.toHaveBeenCalled());
  });
});

describe('when it stays quiet', () => {
  it('hides when no update is available', async () => {
    mockUseAuth(operator);
    respond({ update_available: false });
    renderBanner();
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
  });

  it('hides when the operator never enabled the check', async () => {
    mockUseAuth(operator);
    respond({ check_enabled: false, update_available: false, latest_sha: null });
    renderBanner();
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
  });

  it('stays silent if the endpoint errors', async () => {
    mockUseAuth(operator);
    mockApiGet.mockResolvedValue({ error: { message: 'nope' } });
    renderBanner();
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
  });
});

describe('dismissal is once a DAY, not once a session', () => {
  it('hides after dismiss and records today', async () => {
    mockUseAuth(operator);
    renderBanner();
    fireEvent.click(await screen.findByRole('button'));
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    expect(localStorage.getItem(DISMISS_KEY)).toBe(todayKey());
  });

  it('stays hidden across a full remount — survives a reload', async () => {
    // localStorage, not sessionStorage: a session-scoped flag would bring the
    // banner back on every browser restart.
    mockUseAuth(operator);
    const { unmount } = renderBanner();
    fireEvent.click(await screen.findByRole('button'));
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    unmount();

    renderBanner();
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
  });

  it('returns the NEXT day', async () => {
    mockUseAuth(operator);
    localStorage.setItem(DISMISS_KEY, '2000-01-01');  // dismissed long ago
    renderBanner();
    expect(await screen.findByRole('status')).toBeInTheDocument();
  });

  it('a stale flag from yesterday does not suppress it', async () => {
    mockUseAuth(operator);
    const y = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const key = `${y.getFullYear()}-${`${y.getMonth() + 1}`.padStart(2, '0')}-${`${y.getDate()}`.padStart(2, '0')}`;
    localStorage.setItem(DISMISS_KEY, key);
    renderBanner();
    expect(await screen.findByRole('status')).toBeInTheDocument();
  });
});
