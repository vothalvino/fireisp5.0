// =============================================================================
// FireISP 5.0 — SlaDefinitionList page tests
// =============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { SlaDefinitionList } from '../SlaDefinitionList';

const mockApiGet = vi.fn();
vi.mock('@/api/client', () => ({
  api: { GET: (...args: unknown[]) => mockApiGet(...args) },
  tokenStore: { getAccess: () => 'tok', setAccess: vi.fn(), getRefresh: () => null, setRefresh: vi.fn(), clear: vi.fn() },
}));

const sla1 = {
  id: 1, plan_id: 7, name: 'Gold SLA', uptime_pct: '99.90', max_response_minutes: 30,
  max_resolution_minutes: 240, measurement_period: 'monthly', compensation_type: 'none',
  compensation_value: null, exclude_maintenance: 1, priority: 'high', status: 'active',
};
const plan7 = { id: 7, name: 'Fibra 100' };

function renderList() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <SlaDefinitionList />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('SlaDefinitionList page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/sla-definitions')
        return Promise.resolve({ data: { data: [sla1], meta: { total: 1, page: 1, limit: 25, totalPages: 1 } }, error: undefined });
      if (path === '/plans')
        return Promise.resolve({ data: { data: [plan7] }, error: undefined });
      return Promise.resolve({ data: { data: [] }, error: undefined });
    });
  });

  it('renders the page heading', async () => {
    renderList();
    await waitFor(() => expect(screen.getByText('📐 SLA Definitions')).toBeInTheDocument());
  });

  it('renders an SLA row and resolves its plan name', async () => {
    renderList();
    await waitFor(() => expect(screen.getByText('Gold SLA')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText('Fibra 100')).toBeInTheDocument());
  });

  it('shows empty message when no SLAs', async () => {
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/sla-definitions')
        return Promise.resolve({ data: { data: [], meta: { total: 0, page: 1, limit: 25, totalPages: 0 } }, error: undefined });
      return Promise.resolve({ data: { data: [] }, error: undefined });
    });
    renderList();
    await waitFor(() => expect(screen.getByText(/No SLA definitions found/)).toBeInTheDocument());
  });
});
