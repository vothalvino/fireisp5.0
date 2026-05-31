// =============================================================================
// FireISP 5.0 — RecurringPaymentProfileList page tests
// =============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { RecurringPaymentProfileList } from '../RecurringPaymentProfileList';

const mockApiGet = vi.fn();
vi.mock('@/api/client', () => ({
  api: { GET: (...args: unknown[]) => mockApiGet(...args) },
  tokenStore: { getAccess: () => 'tok', setAccess: vi.fn(), getRefresh: () => null, setRefresh: vi.fn(), clear: vi.fn() },
}));

const profile1 = {
  id: 1, client_id: 7, payment_gateway_id: 2, card_brand: 'visa', card_last_four: '4242',
  card_exp_month: 8, card_exp_year: 2028, is_default: 1, status: 'active',
};

function renderList() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <RecurringPaymentProfileList />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('RecurringPaymentProfileList page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/recurring-payment-profiles')
        return Promise.resolve({ data: { data: [profile1], meta: { total: 1, page: 1, limit: 50, totalPages: 1 } }, error: undefined });
      return Promise.resolve({ data: { data: [] }, error: undefined });
    });
  });

  it('renders the page heading', async () => {
    renderList();
    await waitFor(() => expect(screen.getByText('🔁 Recurring Payment Profiles')).toBeInTheDocument());
  });

  it('renders a profile row with masked card and expiry', async () => {
    renderList();
    await waitFor(() => expect(screen.getByText('VISA •••• 4242')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText('08/2028')).toBeInTheDocument());
  });

  it('shows empty message when no profiles', async () => {
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/recurring-payment-profiles')
        return Promise.resolve({ data: { data: [], meta: { total: 0, page: 1, limit: 50, totalPages: 0 } }, error: undefined });
      return Promise.resolve({ data: { data: [] }, error: undefined });
    });
    renderList();
    await waitFor(() => expect(screen.getByText(/No recurring payment profiles found/)).toBeInTheDocument());
  });
});
