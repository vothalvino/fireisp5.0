// =============================================================================
// FireISP 5.0 — FacturaPublicaList page tests
// =============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { FacturaPublicaList } from '../FacturaPublicaList';

const mockApiGet = vi.fn();
vi.mock('@/api/client', () => ({
  api: { GET: (...args: unknown[]) => mockApiGet(...args) },
  tokenStore: { getAccess: () => 'tok', setAccess: vi.fn(), getRefresh: () => null, setRefresh: vi.fn(), clear: vi.fn() },
}));

const factura1 = {
  id: 1, periodicidad: '04', meses: '01', anio: 2026,
  subtotal: '1000.00', total_impuestos: '160.00', total: '1160.00', status: 'stamped',
};

function renderList() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <FacturaPublicaList />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('FacturaPublicaList page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/facturas-publicas')
        return Promise.resolve({ data: { data: [factura1], meta: { total: 1, page: 1, limit: 50, totalPages: 1 } }, error: undefined });
      return Promise.resolve({ data: { data: [] }, error: undefined });
    });
  });

  it('renders the page heading', async () => {
    renderList();
    await waitFor(() => expect(screen.getByText('🧾 Facturas Públicas')).toBeInTheDocument());
  });

  it('renders a factura row with its periodicity label', async () => {
    renderList();
    await waitFor(() => expect(screen.getByText('Monthly')).toBeInTheDocument());
  });

  it('shows empty message when no facturas', async () => {
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/facturas-publicas')
        return Promise.resolve({ data: { data: [], meta: { total: 0, page: 1, limit: 50, totalPages: 0 } }, error: undefined });
      return Promise.resolve({ data: { data: [] }, error: undefined });
    });
    renderList();
    await waitFor(() => expect(screen.getByText(/No facturas públicas recorded/)).toBeInTheDocument());
  });
});
