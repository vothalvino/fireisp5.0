// =============================================================================
// FireISP 5.0 — PaymentPlanList page tests
// =============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { PaymentPlanList } from '../PaymentPlanList';

const mockApiGet = vi.fn();
vi.mock('@/api/client', () => ({
  api: {
    GET: (...args: unknown[]) => mockApiGet(...args),
    POST: vi.fn(),
    PUT: vi.fn(),
    DELETE: vi.fn(),
  },
  tokenStore: { getAccess: () => 'tok', setAccess: vi.fn(), getRefresh: () => null, setRefresh: vi.fn(), clear: vi.fn() },
}));

vi.mock('@/auth/AuthContext', () => ({
  useAuth: () => ({ user: { id: 1, role: 'admin' } }),
}));

const plan1 = {
  id: 1,
  client_id: 5,
  total_amount: '100.00',
  installment_count: 3,
  frequency: 'monthly',
  status: 'active',
  created_at: '2024-01-01',
};

function renderList() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <PaymentPlanList />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('PaymentPlanList page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/payment-plans')
        return Promise.resolve({ data: { data: [plan1], meta: { total: 1, page: 1, limit: 50, totalPages: 1 } }, error: undefined });
      return Promise.resolve({ data: { data: [] }, error: undefined });
    });
  });

  it('renders the page title', async () => {
    renderList();
    await waitFor(() => expect(screen.getByText('Payment Plans')).toBeInTheDocument());
  });

  it('shows "New Plan" button when user has admin role', async () => {
    renderList();
    await waitFor(() => expect(screen.getByText('+ New Plan')).toBeInTheDocument());
  });

  it('renders a table row when plans data is returned', async () => {
    renderList();
    await waitFor(() => expect(screen.getByText('#1')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText('5')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText('3')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText('monthly')).toBeInTheDocument());
  });
});
