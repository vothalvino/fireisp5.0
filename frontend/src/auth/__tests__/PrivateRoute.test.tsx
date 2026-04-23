// =============================================================================
// FireISP 5.0 — PrivateRoute + hasRole tests
// =============================================================================
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { PrivateRoute, hasRole } from '../PrivateRoute';
import * as AuthContextModule from '../AuthContext';
import type { AuthUser } from '../AuthContext';

// ---------------------------------------------------------------------------
// Mock AuthContext
// ---------------------------------------------------------------------------

function mockAuth(overrides: Partial<ReturnType<typeof AuthContextModule.useAuth>>) {
  vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue({
    user: null,
    loading: false,
    initialized: true,
    login: vi.fn(),
    logout: vi.fn(),
    refresh: vi.fn(),
    switchOrganization: vi.fn(),
    ...overrides,
  } as ReturnType<typeof AuthContextModule.useAuth>);
}

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

const billingUser: AuthUser = {
  ...adminUser,
  id: 2,
  email: 'billing@test.com',
  role: 'billing',
};

// ---------------------------------------------------------------------------
// hasRole unit tests
// ---------------------------------------------------------------------------

describe('hasRole', () => {
  it('admin always returns true for any role', () => {
    expect(hasRole('admin', 'billing')).toBe(true);
    expect(hasRole('admin', 'technician')).toBe(true);
    expect(hasRole('admin', 'read-only')).toBe(true);
  });

  it('exact match returns true', () => {
    expect(hasRole('billing', 'billing')).toBe(true);
    expect(hasRole('support', 'support')).toBe(true);
  });

  it('lower-rank role returns false for higher required role', () => {
    expect(hasRole('support', 'admin')).toBe(false);
    expect(hasRole('read-only', 'billing')).toBe(false);
  });

  it('equal-rank roles return true', () => {
    // billing and technician have same rank (3)
    expect(hasRole('billing', 'technician')).toBe(true);
    expect(hasRole('technician', 'billing')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// PrivateRoute component tests
// ---------------------------------------------------------------------------

function renderRoute(element: React.ReactNode, initialPath = '/protected') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/login" element={<div>Login page</div>} />
        <Route element={element}>
          <Route path="/protected" element={<div>Protected content</div>} />
        </Route>
      </Routes>
    </MemoryRouter>
  );
}

describe('PrivateRoute', () => {
  it('shows loading spinner while auth is initialising', () => {
    mockAuth({ loading: true, initialized: false, user: null });
    renderRoute(<PrivateRoute />);
    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });

  it('redirects unauthenticated user to /login', () => {
    mockAuth({ user: null, loading: false, initialized: true });
    renderRoute(<PrivateRoute />);
    expect(screen.getByText('Login page')).toBeInTheDocument();
    expect(screen.queryByText('Protected content')).not.toBeInTheDocument();
  });

  it('renders outlet for authenticated user with no role requirement', () => {
    mockAuth({ user: adminUser, loading: false, initialized: true });
    renderRoute(<PrivateRoute />);
    expect(screen.getByText('Protected content')).toBeInTheDocument();
  });

  it('renders outlet for authenticated user with sufficient role', () => {
    mockAuth({ user: adminUser, loading: false, initialized: true });
    renderRoute(<PrivateRoute requiredRole="billing" />);
    expect(screen.getByText('Protected content')).toBeInTheDocument();
  });

  it('renders 403 when user lacks required role', () => {
    mockAuth({ user: billingUser, loading: false, initialized: true });
    renderRoute(<PrivateRoute requiredRole="admin" />);
    expect(screen.getByText('403 — Not Allowed')).toBeInTheDocument();
    expect(screen.queryByText('Protected content')).not.toBeInTheDocument();
  });
});
