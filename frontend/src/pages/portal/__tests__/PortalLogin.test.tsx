// =============================================================================
// FireISP 5.0 — PortalLogin page tests
// =============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { PortalLogin } from '../PortalLogin';
import * as PortalAuthContextModule from '@/auth/PortalAuthContext';

// ---------------------------------------------------------------------------
// Mock navigation
// ---------------------------------------------------------------------------

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

// ---------------------------------------------------------------------------
// Mock usePortalAuth
// ---------------------------------------------------------------------------

function mockPortalLogin(impl: (email: string, password: string) => Promise<void>) {
  vi.spyOn(PortalAuthContextModule, 'usePortalAuth').mockReturnValue({
    client: null,
    loading: false,
    initialized: true,
    login: impl,
    logout: vi.fn(),
  } as ReturnType<typeof PortalAuthContextModule.usePortalAuth>);
}

function renderPortalLogin() {
  return render(
    <MemoryRouter initialEntries={['/portal/login']}>
      <PortalLogin />
    </MemoryRouter>
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PortalLogin page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the portal login form', () => {
    mockPortalLogin(vi.fn());
    renderPortalLogin();
    expect(screen.getByText('Client Account Portal')).toBeInTheDocument();
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
  });

  it('renders a forgot-password link pointing to /portal/forgot-password', () => {
    mockPortalLogin(vi.fn());
    renderPortalLogin();
    expect(screen.getByRole('link', { name: /forgot password/i })).toHaveAttribute('href', '/portal/forgot-password');
  });

  it('calls login() and navigates on success', async () => {
    const loginFn = vi.fn().mockResolvedValue(undefined);
    mockPortalLogin(loginFn);
    renderPortalLogin();

    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'client@test.com' } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'pass' } });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => expect(loginFn).toHaveBeenCalledWith('client@test.com', 'pass'));
    expect(mockNavigate).toHaveBeenCalled();
  });

  it('shows error message on login failure', async () => {
    const loginFn = vi.fn().mockRejectedValue(new Error('Invalid credentials'));
    mockPortalLogin(loginFn);
    renderPortalLogin();

    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'bad@test.com' } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => expect(screen.getByText('Invalid credentials')).toBeInTheDocument());
  });
});
