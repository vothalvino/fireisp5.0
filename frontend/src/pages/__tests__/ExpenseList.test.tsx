// =============================================================================
// FireISP 5.0 — ExpenseList page tests
// =============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { ExpenseList } from '../ExpenseList';

const mockApiGet = vi.fn();
vi.mock('@/api/client', () => ({
  api: { GET: (...args: unknown[]) => mockApiGet(...args) },
  tokenStore: { getAccess: () => 'tok', setAccess: vi.fn(), getRefresh: () => null, setRefresh: vi.fn(), clear: vi.fn() },
}));

const expense1 = {
  id: 1, category: 'fuel', description: null, amount: '350.00',
  currency: 'MXN', vendor: 'Pemex', receipt_url: null,
  expense_date: '2024-06-01', notes: null, status: 'pending',
};

function renderExpenseList() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <ExpenseList />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('ExpenseList page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/expenses')
        return Promise.resolve({ data: { data: [expense1], meta: { total: 1, page: 1, limit: 25, totalPages: 1 } }, error: undefined });
      return Promise.resolve({ data: { data: [] }, error: undefined });
    });
  });

  it('renders the page heading', async () => {
    renderExpenseList();
    await waitFor(() => expect(screen.getByText('💸 Expenses')).toBeInTheDocument());
  });

  it('renders an expense row after data loads', async () => {
    renderExpenseList();
    await waitFor(() => expect(screen.getByText('Pemex')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText('fuel')).toBeInTheDocument());
  });

  it('shows empty message when no expenses', async () => {
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/expenses')
        return Promise.resolve({ data: { data: [], meta: { total: 0, page: 1, limit: 25, totalPages: 0 } }, error: undefined });
      return Promise.resolve({ data: { data: [] }, error: undefined });
    });
    renderExpenseList();
    await waitFor(() => expect(screen.getByText(/No expenses found/)).toBeInTheDocument());
  });
});
