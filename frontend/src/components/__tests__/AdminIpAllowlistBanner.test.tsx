import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { AdminIpAllowlistBanner } from '../AdminIpAllowlistBanner';
import * as AuthContextModule from '@/auth/AuthContext';
import type { AuthUser } from '@/auth/AuthContext';

const mockApiGet = vi.fn();
vi.mock('@/api/client', () => ({
  api: { GET: (...args: unknown[]) => mockApiGet(...args) },
}));

const baseUser: AuthUser = {
  id: 1,
  email: 'operator@test.com',
  name: 'Operator',
  role: 'admin',
  organization_id: 1,
  is_install_operator: true,
  is_active: true,
  email_verified_at: '2026-01-01T00:00:00.000Z',
  twofa_enabled: false,
};

function mockUser(user: AuthUser) {
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
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <AdminIpAllowlistBanner />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('AdminIpAllowlistBanner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUser(baseUser);
  });

  it('persists for the install operator while protection is inactive', async () => {
    mockApiGet.mockResolvedValue({ data: { data: { enabled: false, source: 'none' } } });
    renderBanner();
    expect(await screen.findByRole('status')).toHaveTextContent(/not been activated/i);
    expect(screen.getByRole('link')).toHaveAttribute('href', '/security-access-control#admin-ip-allowlist');
  });

  it('disappears after protection is activated', async () => {
    mockApiGet.mockResolvedValue({ data: { data: { enabled: true, source: 'database' } } });
    renderBanner();
    await waitFor(() => expect(mockApiGet).toHaveBeenCalled());
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('does not request or display install guidance for a tenant admin', async () => {
    mockUser({ ...baseUser, id: 2, is_install_operator: false });
    renderBanner();
    await waitFor(() => expect(mockApiGet).not.toHaveBeenCalled());
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
