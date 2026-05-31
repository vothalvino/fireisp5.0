// =============================================================================
// FireISP 5.0 — ClientDetail page tests
// =============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { ClientDetail } from '../ClientDetail';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockGql = vi.fn();
vi.mock('@/api/graphql', () => ({
  gql: (...a: unknown[]) => mockGql(...a),
}));

vi.mock('@/api/client', () => ({
  api: { GET: vi.fn(), POST: vi.fn(), PUT: vi.fn(), DELETE: vi.fn() },
  tokenStore: { getAccess: () => 'tok', setAccess: vi.fn(), getRefresh: () => null, setRefresh: vi.fn(), clear: vi.fn() },
}));

let mockRole = 'admin';
vi.mock('@/auth/AuthContext', () => ({
  useAuth: () => ({ user: { id: 1, role: mockRole } }),
}));

const client = {
  id: '5', name: 'Acme Corp', email: 'ops@acme.com', phone: null,
  clientType: 'business', status: 'active', address: null, city: 'CDMX',
  state: null, zipCode: null, country: 'MX', taxId: null, locale: 'MX',
  notes: null, createdAt: '2024-01-01',
  contracts: [], invoices: [], payments: [], devices: [], ledger: [],
  contacts: [{ id: '1', name: 'Jane Doe', email: null, phone: null, role: 'Billing' }],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockRole = 'admin';
  mockGql.mockResolvedValue({ client });
});

function renderDetail() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/clients/5']}>
        <Routes>
          <Route path="/clients/:id" element={<ClientDetail />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('ClientDetail page', () => {
  it('renders the client name', async () => {
    renderDetail();
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Acme Corp' })).toBeInTheDocument());
  });

  it('shows Edit/MX/Portal actions for admin', async () => {
    renderDetail();
    await waitFor(() => expect(screen.getByText('✏️ Edit')).toBeInTheDocument());
    expect(screen.getByText('🧾 MX Profile')).toBeInTheDocument();
    expect(screen.getByText('🔑 Portal Password')).toBeInTheDocument();
  });

  it('hides write actions for read-only role', async () => {
    mockRole = 'read-only';
    renderDetail();
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Acme Corp' })).toBeInTheDocument());
    expect(screen.queryByText('✏️ Edit')).not.toBeInTheDocument();
  });
});
