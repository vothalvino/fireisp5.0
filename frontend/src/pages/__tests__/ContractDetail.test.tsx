// =============================================================================
// FireISP 5.0 — ContractDetail PPPoE tab tests
// =============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
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

    // Username shown; password masked until revealed.
    await waitFor(() => expect(screen.getByText('sub_ada')).toBeInTheDocument());
    expect(screen.queryByText('topsecret')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Show' }));
    expect(screen.getByText('topsecret')).toBeInTheDocument();
  });

  it('regenerates the password and displays the new value', async () => {
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ data: { username: 'sub_ada', password: 'rotated-xyz' }, pushed: false }),
    });

    renderDetail();
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Contract #5' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'PPPoE' }));
    await waitFor(() => expect(screen.getByText('sub_ada')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Regenerate password' }));

    await waitFor(() => expect(screen.getByText('rotated-xyz')).toBeInTheDocument());
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/v1/contracts/5/regenerate-pppoe',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('does not show a PPPoE tab for a non-PPPoE contract', async () => {
    mockGql.mockResolvedValue({ contract: makeContract('ipoe') });
    renderDetail();
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Contract #5' })).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'PPPoE' })).not.toBeInTheDocument();
  });
});
