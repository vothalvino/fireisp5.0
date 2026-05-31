// =============================================================================
// FireISP 5.0 — SuspensionRuleList page tests
// =============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { SuspensionRuleList } from '../SuspensionRuleList';

const mockApiGet = vi.fn();
vi.mock('@/api/client', () => ({
  api: { GET: (...args: unknown[]) => mockApiGet(...args) },
  tokenStore: { getAccess: () => 'tok', setAccess: vi.fn(), getRefresh: () => null, setRefresh: vi.fn(), clear: vi.fn() },
}));

const rule1 = {
  id: 1, name: 'Suspensión 30 días', days_past_due: 30, grace_period_days: 3,
  action: 'auto_suspend', notify_before_days: 5, is_active: 1,
};

function renderList() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <SuspensionRuleList />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('SuspensionRuleList page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/suspension-rules')
        return Promise.resolve({ data: { data: [rule1], meta: { total: 1, page: 1, limit: 50, totalPages: 1 } }, error: undefined });
      return Promise.resolve({ data: { data: [] }, error: undefined });
    });
  });

  it('renders the page heading', async () => {
    renderList();
    await waitFor(() => expect(screen.getByText('⛔ Suspension Rules')).toBeInTheDocument());
  });

  it('renders a rule row with its name', async () => {
    renderList();
    await waitFor(() => expect(screen.getByText('Suspensión 30 días')).toBeInTheDocument());
  });

  it('shows empty message when no rules', async () => {
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/suspension-rules')
        return Promise.resolve({ data: { data: [], meta: { total: 0, page: 1, limit: 50, totalPages: 0 } }, error: undefined });
      return Promise.resolve({ data: { data: [] }, error: undefined });
    });
    renderList();
    await waitFor(() => expect(screen.getByText(/No suspension rules configured/)).toBeInTheDocument());
  });
});
