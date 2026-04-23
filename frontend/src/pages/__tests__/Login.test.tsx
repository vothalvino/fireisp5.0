// =============================================================================
// FireISP 5.0 — Login page tests
// =============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Login } from '../Login';
import * as AuthContextModule from '@/auth/AuthContext';

// ---------------------------------------------------------------------------
// Mock navigation
// ---------------------------------------------------------------------------

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

// ---------------------------------------------------------------------------
// Mock useAuth
// ---------------------------------------------------------------------------

function mockLogin(impl: (email: string, password: string) => Promise<void>) {
  vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue({
    user: null,
    loading: false,
    initialized: true,
    login: impl,
    logout: vi.fn(),
    refresh: vi.fn(),
    switchOrganization: vi.fn(),
  } as ReturnType<typeof AuthContextModule.useAuth>);
}

function renderLogin(path = '/login') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Login />
    </MemoryRouter>
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Login page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the login form', () => {
    mockLogin(vi.fn());
    renderLogin();
    expect(screen.getByText('🔥 FireISP 5.0')).toBeInTheDocument();
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
  });

  it('calls login() and navigates on success', async () => {
    const loginFn = vi.fn().mockResolvedValue(undefined);
    mockLogin(loginFn);
    renderLogin();

    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'admin@test.com' } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'secret' } });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => expect(loginFn).toHaveBeenCalledWith('admin@test.com', 'secret', undefined));
    expect(mockNavigate).toHaveBeenCalled();
  });

  it('shows error message on login failure', async () => {
    const loginFn = vi.fn().mockRejectedValue(new Error('Invalid credentials'));
    mockLogin(loginFn);
    renderLogin();

    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'bad@test.com' } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => expect(screen.getByText('Invalid credentials')).toBeInTheDocument());
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('shows TOTP field when server requires two-factor', async () => {
    const loginFn = vi.fn().mockRejectedValue(new Error('TOTP code required'));
    mockLogin(loginFn);
    renderLogin();

    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'totp@test.com' } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'pass' } });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() =>
      expect(screen.getByText(/two-factor authentication code/i)).toBeInTheDocument()
    );
    expect(screen.getByLabelText(/two-factor/i)).toBeInTheDocument();
  });
});
