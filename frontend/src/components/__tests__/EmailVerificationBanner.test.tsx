// =============================================================================
// FireISP 5.0 — EmailVerificationBanner component tests
// =============================================================================
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { EmailVerificationBanner } from '../EmailVerificationBanner';
import * as AuthContextModule from '@/auth/AuthContext';
import type { AuthUser } from '@/auth/AuthContext';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockAuthedFetch = vi.fn();
vi.mock('@/api/client', () => ({
  authedFetch: (...args: unknown[]) => mockAuthedFetch(...args),
}));

const mockRefresh = vi.fn();

function jsonResponse(status: number, body: unknown) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: () => Promise.resolve(body),
  };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const verifiedUser: AuthUser = {
  id: 1,
  email: 'tech@test.com',
  name: 'Tech',
  role: 'technician',
  organization_id: 1,
  is_active: true,
  email_verified_at: '2026-01-01T00:00:00.000Z',
  twofa_enabled: false,
};

const unverifiedUser: AuthUser = { ...verifiedUser, email_verified_at: null };

function mockUseAuth(user: AuthUser | null) {
  vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue({
    user,
    loading: false,
    initialized: true,
    login: vi.fn(),
    logout: vi.fn(),
    refresh: mockRefresh,
    switchOrganization: vi.fn(),
  } as ReturnType<typeof AuthContextModule.useAuth>);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('EmailVerificationBanner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.removeItem('emailVerifyBannerDismissed');
    mockRefresh.mockResolvedValue(true);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders nothing when the user has verified their email', () => {
    mockUseAuth(verifiedUser);
    const { container } = render(<EmailVerificationBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when there is no authenticated user', () => {
    mockUseAuth(null);
    const { container } = render(<EmailVerificationBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the banner and resend button when email_verified_at is null', () => {
    mockUseAuth(unverifiedUser);
    render(<EmailVerificationBanner />);
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByText('Please verify your email address.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Resend verification email' })).toBeInTheDocument();
  });

  it('resend success shows the persistent sent-confirmation state and disables the button until the cooldown elapses', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockUseAuth(unverifiedUser);
    mockAuthedFetch.mockResolvedValueOnce(jsonResponse(200, { message: 'Verification email sent' }));

    render(<EmailVerificationBanner />);
    fireEvent.click(screen.getByRole('button', { name: 'Resend verification email' }));

    await waitFor(() =>
      expect(screen.getByText('Verification email sent — check your inbox.')).toBeInTheDocument(),
    );
    expect(screen.getByRole('button', { name: 'Resend verification email' })).toBeDisabled();

    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });

    // Confirmation message persists; the button re-enables for another attempt.
    expect(screen.getByText('Verification email sent — check your inbox.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Resend verification email' })).not.toBeDisabled();
  });

  it('a 429 response shows the server rate-limit message and disables the button for the backoff window', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockUseAuth(unverifiedUser);
    mockAuthedFetch.mockResolvedValueOnce(
      jsonResponse(429, {
        error: { code: 'RATE_LIMITED', message: 'Too many verification email requests, please try again later' },
      }),
    );

    render(<EmailVerificationBanner />);
    fireEvent.click(screen.getByRole('button', { name: 'Resend verification email' }));

    await waitFor(() =>
      expect(
        screen.getByText('Too many verification email requests, please try again later'),
      ).toBeInTheDocument(),
    );
    expect(screen.getByRole('button', { name: 'Resend verification email' })).toBeDisabled();

    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(screen.getByRole('button', { name: 'Resend verification email' })).not.toBeDisabled();
  });

  it('an alreadyVerified:true response calls refresh() so the banner can unmount', async () => {
    mockUseAuth(unverifiedUser);
    mockAuthedFetch.mockResolvedValueOnce(
      jsonResponse(200, { message: 'Email already verified', alreadyVerified: true }),
    );

    render(<EmailVerificationBanner />);
    fireEvent.click(screen.getByRole('button', { name: 'Resend verification email' }));

    await waitFor(() => expect(mockRefresh).toHaveBeenCalledTimes(1));
  });

  it('the "I already verified" action calls refresh directly without sending a resend request', async () => {
    mockUseAuth(unverifiedUser);
    render(<EmailVerificationBanner />);
    fireEvent.click(screen.getByRole('button', { name: 'I already verified — refresh' }));

    await waitFor(() => expect(mockRefresh).toHaveBeenCalledTimes(1));
    expect(mockAuthedFetch).not.toHaveBeenCalled();
  });

  it('dismissing the banner hides it and persists the choice in sessionStorage for the session', () => {
    mockUseAuth(unverifiedUser);
    const { rerender } = render(<EmailVerificationBanner />);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));

    expect(sessionStorage.getItem('emailVerifyBannerDismissed')).toBe('1');

    rerender(<EmailVerificationBanner />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('does not reappear on remount within the same session after being dismissed', () => {
    sessionStorage.setItem('emailVerifyBannerDismissed', '1');
    mockUseAuth(unverifiedUser);
    const { container } = render(<EmailVerificationBanner />);
    expect(container).toBeEmptyDOMElement();
  });
});
