// =============================================================================
// FireISP 5.0 — CashReconciliationList page tests
// =============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { CashReconciliationList } from '../CashReconciliationList';

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

const session1 = {
  id: 1,
  user_id: 3,
  agent_user_id: 3,
  status: 'open',
  opened_at: '2024-01-01T10:00:00Z',
  closed_at: null,
  expected_total: null,
  counted_total: null,
  variance: null,
  notes: null,
};

function renderList() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <CashReconciliationList />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('CashReconciliationList page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/cash-reconciliation/sessions')
        return Promise.resolve({ data: { data: [session1], meta: { total: 1, page: 1, limit: 50, totalPages: 1 } }, error: undefined });
      return Promise.resolve({ data: { data: [] }, error: undefined });
    });
  });

  it('renders the page title', async () => {
    renderList();
    await waitFor(() => expect(screen.getByText('Cash Reconciliation')).toBeInTheDocument());
  });

  it('shows "Open Session" button when user has admin role', async () => {
    renderList();
    await waitFor(() => expect(screen.getByText('+ Open Session')).toBeInTheDocument());
  });

  it('renders a table row when session data is returned', async () => {
    renderList();
    await waitFor(() => expect(screen.getByText('#1')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText('3')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText('open')).toBeInTheDocument());
  });
});
