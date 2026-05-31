// =============================================================================
// FireISP 5.0 — PaymentGatewayList page tests
// =============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { PaymentGatewayList } from '../PaymentGatewayList';

const mockApiGet = vi.fn();
vi.mock('@/api/client', () => ({
  api: { GET: (...args: unknown[]) => mockApiGet(...args) },
  tokenStore: { getAccess: () => 'tok', setAccess: vi.fn(), getRefresh: () => null, setRefresh: vi.fn(), clear: vi.fn() },
}));

const gw1 = {
  id: 1, name: 'Conekta Producción', provider: 'conekta', environment: 'production',
  public_key: 'key_abc', is_default: 1, status: 'active',
};

function renderList() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <PaymentGatewayList />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('PaymentGatewayList page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/payment-gateways')
        return Promise.resolve({ data: { data: [gw1], meta: { total: 1, page: 1, limit: 50, totalPages: 1 } }, error: undefined });
      return Promise.resolve({ data: { data: [] }, error: undefined });
    });
  });

  it('renders the page heading', async () => {
    renderList();
    await waitFor(() => expect(screen.getByText('💳 Payment Gateways')).toBeInTheDocument());
  });

  it('renders a gateway row with its name', async () => {
    renderList();
    await waitFor(() => expect(screen.getByText('Conekta Producción')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText('production')).toBeInTheDocument());
  });

  it('shows empty message when no gateways', async () => {
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/payment-gateways')
        return Promise.resolve({ data: { data: [], meta: { total: 0, page: 1, limit: 50, totalPages: 0 } }, error: undefined });
      return Promise.resolve({ data: { data: [] }, error: undefined });
    });
    renderList();
    await waitFor(() => expect(screen.getByText(/No payment gateways configured/)).toBeInTheDocument());
  });
});
