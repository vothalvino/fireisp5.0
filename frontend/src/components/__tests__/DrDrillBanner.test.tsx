// =============================================================================
// FireISP 5.0 — DrDrillBanner component tests
// =============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { DrDrillBanner } from '../DrDrillBanner';
import * as AuthContextModule from '@/auth/AuthContext';
import type { AuthUser } from '@/auth/AuthContext';

// ---------------------------------------------------------------------------
// Mocks
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

const techUser: AuthUser = {
  id: 2,
  email: 'tech@test.com',
  name: 'Tech',
  role: 'technician',
  organization_id: 1,
  is_active: true,
  email_verified: true,
  twofa_enabled: false,
};

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

function renderBanner() {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <DrDrillBanner />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DrDrillBanner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Clear sessionStorage dismiss flag before each test
    sessionStorage.removeItem('drDrillBannerDismissed');
  });

  it('shows the modal when drill is overdue (> 90 days)', async () => {
    mockUseAuth(adminUser);
    mockApiGet.mockResolvedValueOnce({
      data: {
        data: {
          last_run_at: new Date(Date.now() - 95 * 24 * 60 * 60 * 1000).toISOString(),
          status: 'pass',
          days_since_drill: 95,
          overdue: true,
          last_error: null,
        },
      },
      error: undefined,
    });

    renderBanner();

    await waitFor(() =>
      expect(screen.getByRole('alertdialog')).toBeInTheDocument(),
    );
    expect(screen.getByText('DR Drill Warning')).toBeInTheDocument();
  });

  it('shows the modal when last drill failed', async () => {
    mockUseAuth(adminUser);
    mockApiGet.mockResolvedValueOnce({
      data: {
        data: {
          last_run_at: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
          status: 'fail',
          days_since_drill: 5,
          overdue: true,
          last_error: 'FK orphans detected: orphaned_contracts=3',
        },
      },
      error: undefined,
    });

    renderBanner();

    await waitFor(() =>
      expect(screen.getByRole('alertdialog')).toBeInTheDocument(),
    );
    expect(screen.getByText(/Last DR Drill FAILED/i)).toBeInTheDocument();
    expect(screen.getByText(/FK orphans detected/i)).toBeInTheDocument();
  });

  it('shows the modal when the drill has never been run', async () => {
    mockUseAuth(adminUser);
    mockApiGet.mockResolvedValueOnce({
      data: {
        data: {
          last_run_at: null,
          status: null,
          days_since_drill: null,
          overdue: true,
          last_error: null,
        },
      },
      error: undefined,
    });

    renderBanner();

    await waitFor(() =>
      expect(screen.getByRole('alertdialog')).toBeInTheDocument(),
    );
    expect(screen.getByText(/Never Been Run/i)).toBeInTheDocument();
  });

  it('does not show the modal when drill is current and passing', async () => {
    mockUseAuth(adminUser);
    mockApiGet.mockResolvedValueOnce({
      data: {
        data: {
          last_run_at: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
          status: 'pass',
          days_since_drill: 10,
          overdue: false,
          last_error: null,
        },
      },
      error: undefined,
    });

    renderBanner();

    // Wait a tick for the query to resolve
    await new Promise(r => setTimeout(r, 50));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('does not show for non-admin users', async () => {
    mockUseAuth(techUser);

    renderBanner();

    await new Promise(r => setTimeout(r, 50));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    // API should not be called for non-admins
    expect(mockApiGet).not.toHaveBeenCalled();
  });

  it('dismisses the modal when the dismiss button is clicked', async () => {
    mockUseAuth(adminUser);
    mockApiGet.mockResolvedValueOnce({
      data: {
        data: {
          last_run_at: null,
          status: null,
          days_since_drill: null,
          overdue: true,
          last_error: null,
        },
      },
      error: undefined,
    });

    renderBanner();

    await waitFor(() =>
      expect(screen.getByRole('alertdialog')).toBeInTheDocument(),
    );

    const dismissBtn = screen.getByRole('button', { name: /Acknowledge/i });
    fireEvent.click(dismissBtn);

    await waitFor(() =>
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument(),
    );

    // sessionStorage flag should be set
    expect(sessionStorage.getItem('drDrillBannerDismissed')).toBe('1');
  });

  it('does not show when already dismissed in this session', async () => {
    sessionStorage.setItem('drDrillBannerDismissed', '1');
    mockUseAuth(adminUser);

    renderBanner();

    await new Promise(r => setTimeout(r, 50));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    // API should not be called since already dismissed
    expect(mockApiGet).not.toHaveBeenCalled();
  });

  it('does not crash when the API returns an error', async () => {
    mockUseAuth(adminUser);
    mockApiGet.mockRejectedValueOnce(new Error('network error'));

    // Should render without throwing
    expect(() => renderBanner()).not.toThrow();
    await new Promise(r => setTimeout(r, 50));
    // No modal shown on API error
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });
});
