// =============================================================================
// FireISP 5.0 — PaymentDetail page tests
// =============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { PaymentDetail } from '../PaymentDetail';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockGql = vi.fn();
vi.mock('@/api/graphql', () => ({ gql: (...a: unknown[]) => mockGql(...a) }));

const mockApiGet = vi.fn();
vi.mock('@/api/client', () => ({
  api: {
    GET: (...a: unknown[]) => mockApiGet(...a),
    PUT: vi.fn().mockResolvedValue({ data: {}, error: undefined }),
    POST: vi.fn().mockResolvedValue({ data: {}, error: undefined }),
    DELETE: vi.fn().mockResolvedValue({ data: {}, error: undefined }),
  },
  tokenStore: { getAccess: () => 'tok', setAccess: vi.fn(), getRefresh: () => null, setRefresh: vi.fn(), clear: vi.fn() },
}));

vi.mock('@/auth/AuthContext', () => ({
  useAuth: () => ({ user: { id: 1, role: 'admin' } }),
}));

const gqlPayment = {
  id: '42',
  clientId: '10',
  amount: '580.00',
  currency: 'MXN',
  paymentMethod: 'cash',
  reference: 'REF-TEST',
  status: 'completed',
  paymentDate: '2024-01-15',
  createdAt: '2024-01-15',
  client: { id: '10', name: 'Acme Corp', status: 'active' },
  allocations: [],
};

function renderPaymentDetail(id = '42') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/payments/${id}`]}>
        <Routes>
          <Route path="/payments/:id" element={<PaymentDetail />} />
          <Route path="/payments" element={<div>Payment List</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('PaymentDetail page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGql.mockResolvedValue({ payment: gqlPayment });
    mockApiGet.mockResolvedValue({ data: { data: [] }, error: undefined });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: [] }),
    } as Response);
  });

  it('renders the payment heading and status badge', async () => {
    renderPaymentDetail();
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Payment #42' })).toBeInTheDocument());
    expect(screen.getByText('completed')).toBeInTheDocument();
  });

  it('renders the client name in the info card and breadcrumb', async () => {
    renderPaymentDetail();
    // Wait until the payment is fully rendered (heading confirms it)
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Payment #42' })).toBeInTheDocument());
    // client.name renders in both the info card Link and the breadcrumb Link
    const clientLinks = screen.getAllByText('Acme Corp');
    expect(clientLinks.length).toBeGreaterThanOrEqual(1);
  });

  it('renders the Download receipt PDF button', async () => {
    renderPaymentDetail();
    await waitFor(() => expect(screen.getByTitle('Download receipt PDF')).toBeInTheDocument());
  });

  it('renders the Send receipt email button', async () => {
    renderPaymentDetail();
    await waitFor(() => expect(screen.getByTitle('Send receipt email to client')).toBeInTheDocument());
  });

  it('renders the Allocate action button', async () => {
    renderPaymentDetail();
    await waitFor(() => expect(screen.getByTitle('Allocate payment to an invoice')).toBeInTheDocument());
  });

  it('renders the Reallocate action button', async () => {
    renderPaymentDetail();
    await waitFor(() => expect(screen.getByTitle('Move allocation from one invoice to another (same client)')).toBeInTheDocument());
  });

  it('renders the Un-apply action button', async () => {
    renderPaymentDetail();
    await waitFor(() => expect(screen.getByTitle('Remove this payment from an invoice (keeps credit on account)')).toBeInTheDocument());
  });

  it('renders the Reassign action button', async () => {
    renderPaymentDetail();
    await waitFor(() => expect(screen.getByTitle('Reassign payment to a different client (unallocated only)')).toBeInTheDocument());
  });

  it('renders the Edit action button', async () => {
    renderPaymentDetail();
    await waitFor(() => expect(screen.getByTitle('Edit payment')).toBeInTheDocument());
  });

  it('renders the Delete action button', async () => {
    renderPaymentDetail();
    await waitFor(() => expect(screen.getByTitle('Delete payment')).toBeInTheDocument());
  });

  it('shows not-found state when GraphQL returns null', async () => {
    mockGql.mockResolvedValue({ payment: null });
    renderPaymentDetail();
    await waitFor(() => expect(screen.getByText('Payment not found.')).toBeInTheDocument());
  });
});
