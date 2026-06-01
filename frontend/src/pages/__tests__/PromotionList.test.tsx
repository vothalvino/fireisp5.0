// =============================================================================
// FireISP 5.0 — PromotionList page tests
// =============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { PromotionList } from '../PromotionList';

const mockApiGet = vi.fn();
vi.mock('@/api/client', () => ({
  api: { GET: (...args: unknown[]) => mockApiGet(...args) },
  tokenStore: { getAccess: () => 'tok', setAccess: vi.fn(), getRefresh: () => null, setRefresh: vi.fn(), clear: vi.fn() },
}));

const promo1 = {
  id: 1, name: 'Summer 2026', code: 'SUMMER20', description: null, discount_type: 'percentage',
  discount_value: 20, promotion_type: 'coupon', applies_to: 'invoice', max_uses: null,
  max_uses_per_client: null, min_order_value: null, duration_months: null, starts_at: null,
  ends_at: null, is_active: 1,
};

function renderList() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <PromotionList />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('PromotionList page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/promotions')
        return Promise.resolve({ data: { data: [promo1], meta: { total: 1, page: 1, limit: 25, totalPages: 1 } }, error: undefined });
      return Promise.resolve({ data: { data: [] }, error: undefined });
    });
  });

  it('renders the page heading', async () => {
    renderList();
    await waitFor(() => expect(screen.getByText('🏷️ Promotions')).toBeInTheDocument());
  });

  it('renders a promotion row with its code and discount', async () => {
    renderList();
    await waitFor(() => expect(screen.getByText('Summer 2026')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText('SUMMER20')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText('20%')).toBeInTheDocument());
  });

  it('shows empty message when no promotions', async () => {
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/promotions')
        return Promise.resolve({ data: { data: [], meta: { total: 0, page: 1, limit: 25, totalPages: 0 } }, error: undefined });
      return Promise.resolve({ data: { data: [] }, error: undefined });
    });
    renderList();
    await waitFor(() => expect(screen.getByText(/No promotions found/)).toBeInTheDocument());
  });
});
