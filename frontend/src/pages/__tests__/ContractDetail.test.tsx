// =============================================================================
// FireISP 5.0 — ContractDetail PPPoE tab tests
// =============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { ContractDetail } from '../ContractDetail';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockGql = vi.fn();
vi.mock('@/api/graphql', () => ({ gql: (...a: unknown[]) => mockGql(...a) }));

const mockApiGet = vi.fn();
vi.mock('@/api/client', () => ({
  api: { GET: (...a: unknown[]) => mockApiGet(...a), POST: vi.fn(), PUT: vi.fn(), DELETE: vi.fn() },
  tokenStore: { getAccess: () => 'tok', setAccess: vi.fn(), getRefresh: () => null, setRefresh: vi.fn(), clear: vi.fn() },
  authedFetch: vi.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(input, init)),
}));

let mockRole = 'admin';
vi.mock('@/auth/AuthContext', () => ({ useAuth: () => ({ user: { id: 1, role: mockRole } }) }));

function makeContract(connectionType: string) {
  return {
    id: '5', clientId: '3', planId: '2', connectionType,
    startDate: '2024-01-01', endDate: null, billingDay: 1, status: 'active',
    ipAddress: null, priceOverride: null, notes: null, createdAt: '2024-01-01',
    client: { id: '3', name: 'Acme Corp', status: 'active' },
    invoices: [], devices: [], addons: [],
  };
}

const radiusAccount = { id: 99, username: 'sub_ada', password: 'topsecret', status: 'active' };

beforeEach(() => {
  vi.clearAllMocks();
  mockRole = 'admin';
  mockGql.mockResolvedValue({ contract: makeContract('pppoe') });
  mockApiGet.mockResolvedValue({ data: { data: [radiusAccount] }, error: undefined });
  global.fetch = vi.fn();
});

function renderDetail() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/contracts/5']}>
        <Routes>
          <Route path="/contracts/:id" element={<ContractDetail />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ContractDetail — PPPoE credentials', () => {
  it('shows a PPPoE tab for a PPPoE contract and reveals the credentials', async () => {
    renderDetail();
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Contract #5' })).toBeInTheDocument());

    const pppoeTab = screen.getByRole('button', { name: 'PPPoE' });
    fireEvent.click(pppoeTab);

    // Username shown immediately (base, password-free fetch); the password
    // comes from a second, separately-gated /credentials fetch and is masked
    // until revealed — wait for it (findByRole) rather than assuming it has
    // already resolved by the time the base account renders.
    await waitFor(() => expect(screen.getByText('sub_ada')).toBeInTheDocument());
    expect(screen.queryByText('topsecret')).not.toBeInTheDocument();

    const showBtn = await screen.findByRole('button', { name: 'Show' });
    fireEvent.click(showBtn);
    expect(screen.getByText('topsecret')).toBeInTheDocument();
  });

  it('shows an insufficient-permission note in place of the password when the credentials fetch 403s', async () => {
    mockApiGet.mockImplementation((path: unknown) => {
      if (typeof path === 'string' && path.includes('/credentials')) {
        return Promise.resolve({
          data: undefined,
          error: { error: { code: 'FORBIDDEN' } },
          response: { status: 403 },
        });
      }
      return Promise.resolve({ data: { data: [radiusAccount] }, error: undefined });
    });

    renderDetail();
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Contract #5' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'PPPoE' }));

    // Username still visible (base fetch only needs devices.view).
    await waitFor(() => expect(screen.getByText('sub_ada')).toBeInTheDocument());
    // Password never rendered, replaced by the permission note instead.
    expect(screen.queryByText('topsecret')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Show' })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/Insufficient permission to view the password/)).toBeInTheDocument());
  });

  it('asks for confirmation before regenerating, then displays the new value', async () => {
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ data: { username: 'sub_ada', password: 'rotated-xyz' }, pushed: false }),
    });

    renderDetail();
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Contract #5' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'PPPoE' }));
    await waitFor(() => expect(screen.getByText('sub_ada')).toBeInTheDocument());

    // Clicking the trigger opens a confirm dialog and does NOT call the API yet.
    fireEvent.click(screen.getByRole('button', { name: 'Regenerate password' }));
    const dialog = await screen.findByRole('dialog');
    expect(global.fetch).not.toHaveBeenCalled();

    // Confirm inside the dialog → API called, new password shown.
    fireEvent.click(within(dialog).getByRole('button', { name: 'Regenerate password' }));
    await waitFor(() => expect(screen.getByText('rotated-xyz')).toBeInTheDocument());
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/v1/contracts/5/regenerate-pppoe',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('cancelling the confirm dialog does not regenerate', async () => {
    renderDetail();
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Contract #5' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'PPPoE' }));
    await waitFor(() => expect(screen.getByText('sub_ada')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Regenerate password' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('does not show a PPPoE tab for a non-PPPoE contract', async () => {
    mockGql.mockResolvedValue({ contract: makeContract('ipoe') });
    renderDetail();
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Contract #5' })).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'PPPoE' })).not.toBeInTheDocument();
  });
});
