// =============================================================================
// FireISP 5.0 — UserList page tests
// =============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { UserList, apiErrorMessage } from '../UserList';
import * as AuthContextModule from '@/auth/AuthContext';
import type { AuthUser } from '@/auth/AuthContext';

// ---------------------------------------------------------------------------
// UserList uses raw fetch(), not api.GET — mock global fetch
// ---------------------------------------------------------------------------

vi.mock('@/api/client', () => ({
  tokenStore: { getAccess: () => 'tok', setAccess: vi.fn(), getRefresh: () => null, setRefresh: vi.fn(), clear: vi.fn() },
}));

const adminUser: AuthUser = {
  id: 1, email: 'admin@test.com', name: 'Admin', role: 'admin',
  organization_id: 1, is_active: true, email_verified: true, twofa_enabled: false,
};

const user1 = {
  id: 2, first_name: 'Bob', last_name: 'Tech', email: 'bob@test.com',
  role: 'technician', phone: null, status: 'active', totp_enabled: false,
  last_login_at: null, created_at: '2024-01-01',
};

function renderUserList() {
  vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue({
    user: adminUser,
    loading: false,
    initialized: true,
    login: vi.fn(),
    logout: vi.fn(),
    refresh: vi.fn(),
    switchOrganization: vi.fn(),
  } as ReturnType<typeof AuthContextModule.useAuth>);

  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <UserList />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('UserList page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        data: [user1],
        meta: { total: 1, page: 1, limit: 25, totalPages: 1 },
      }),
    } as Response);
  });

  it('renders the page heading', async () => {
    renderUserList();
    await waitFor(() => expect(screen.getByText('🔑 Users')).toBeInTheDocument());
  });

  it('renders a user row after data loads', async () => {
    renderUserList();
    await waitFor(() => expect(screen.getByText('bob@test.com')).toBeInTheDocument());
  });

  it('shows empty message when no users', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: [], meta: { total: 0, page: 1, limit: 25, totalPages: 0 } }),
    } as Response);
    renderUserList();
    await waitFor(() => expect(screen.getByText(/No users found/)).toBeInTheDocument());
  });

  // Regression: the API returns errors as { error: { message, details } }; the old
  // code read err.error as a string, so create/update failures rendered "[object Object]".
  describe('apiErrorMessage', () => {
    it('returns the error message, not the stringified object', () => {
      expect(apiErrorMessage({ error: { message: 'Email already exists' } }, 'fallback'))
        .toBe('Email already exists');
    });

    it('joins validation details when present', () => {
      const json = { error: { message: 'Validation failed', details: [{ message: 'first_name is required' }, { message: 'email is invalid' }] } };
      expect(apiErrorMessage(json, 'fallback')).toBe('first_name is required, email is invalid');
    });

    it('falls back when there is no usable message (never returns [object Object])', () => {
      expect(apiErrorMessage({}, 'Failed to create user')).toBe('Failed to create user');
      expect(apiErrorMessage({ error: {} }, 'Failed to create user')).toBe('Failed to create user');
      expect(apiErrorMessage(null, 'Failed to create user')).toBe('Failed to create user');
    });
  });
});
