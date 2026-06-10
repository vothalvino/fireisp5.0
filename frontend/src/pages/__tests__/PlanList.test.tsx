// =============================================================================
// FireISP 5.0 — PlanList page tests
// =============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { PlanList } from '../PlanList';

const mockApiGet = vi.fn();
vi.mock('@/api/client', () => ({
  api: { GET: (...args: unknown[]) => mockApiGet(...args) },
  tokenStore: { getAccess: () => 'tok', setAccess: vi.fn(), getRefresh: () => null, setRefresh: vi.fn(), clear: vi.fn() },
}));

const plan1 = {
  id: 1, name: 'Fibra 100', description: null,
  download_speed_mbps: 100, upload_speed_mbps: 50,
  price: '599.00', currency: 'MXN', billing_cycle: 'monthly',
  data_cap_gb: null, status: 'active',
};

function renderPlanList() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <PlanList />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('PlanList page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/plans')
        return Promise.resolve({ data: { data: [plan1], meta: { total: 1, page: 1, limit: 25, totalPages: 1 } }, error: undefined });
      return Promise.resolve({ data: { data: [] }, error: undefined });
    });
  });

  it('renders the page heading', async () => {
    renderPlanList();
    await waitFor(() => expect(screen.getByText('📶 Plans')).toBeInTheDocument());
  });

  it('renders a plan row after data loads', async () => {
    renderPlanList();
    await waitFor(() => expect(screen.getByText('Fibra 100')).toBeInTheDocument());
  });

  it('shows empty message when no plans', async () => {
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/plans')
        return Promise.resolve({ data: { data: [], meta: { total: 0, page: 1, limit: 25, totalPages: 0 } }, error: undefined });
      return Promise.resolve({ data: { data: [] }, error: undefined });
    });
    renderPlanList();
    await waitFor(() => expect(screen.getByText(/No plans found/)).toBeInTheDocument());
  });

  it('renders RADIUS Vendor label in plan modal', async () => {
    renderPlanList();
    await waitFor(() => expect(screen.getByText('Fibra 100')).toBeInTheDocument());
    // Open New Plan modal
    const newPlanBtn = screen.getByText('+ New Plan');
    newPlanBtn.click();
    await waitFor(() => expect(screen.getByLabelText('RADIUS vendor')).toBeInTheDocument());
  });

  it('renders Overage Mode select in plan modal', async () => {
    renderPlanList();
    await waitFor(() => expect(screen.getByText('Fibra 100')).toBeInTheDocument());
    const newPlanBtn = screen.getByText('+ New Plan');
    newPlanBtn.click();
    await waitFor(() => expect(screen.getByLabelText('Overage mode')).toBeInTheDocument());
  });

  it('renders Free Trial Days input in plan modal', async () => {
    renderPlanList();
    await waitFor(() => expect(screen.getByText('Fibra 100')).toBeInTheDocument());
    const newPlanBtn = screen.getByText('+ New Plan');
    newPlanBtn.click();
    await waitFor(() => expect(screen.getByLabelText('Free trial days')).toBeInTheDocument());
  });
});
