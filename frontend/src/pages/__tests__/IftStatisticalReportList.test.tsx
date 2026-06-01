// =============================================================================
// FireISP 5.0 — IftStatisticalReportList page tests
// =============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { IftStatisticalReportList } from '../IftStatisticalReportList';

const mockApiGet = vi.fn();
vi.mock('@/api/client', () => ({
  api: { GET: (...args: unknown[]) => mockApiGet(...args) },
  tokenStore: { getAccess: () => 'tok', setAccess: vi.fn(), getRefresh: () => null, setRefresh: vi.fn(), clear: vi.fn() },
}));

const report1 = {
  id: 1, report_period: '2026-Q1', period_start: '2026-01-01', period_end: '2026-03-31',
  total_subscribers: 1200, coverage_municipalities: 8, status: 'filed',
};

function renderList() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <IftStatisticalReportList />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('IftStatisticalReportList page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/ift-statistical-reports')
        return Promise.resolve({ data: { data: [report1], meta: { total: 1, page: 1, limit: 50, totalPages: 1 } }, error: undefined });
      return Promise.resolve({ data: { data: [] }, error: undefined });
    });
  });

  it('renders the page heading', async () => {
    renderList();
    await waitFor(() => expect(screen.getByText('📊 IFT Statistical Reports')).toBeInTheDocument());
  });

  it('renders a report row with its period', async () => {
    renderList();
    await waitFor(() => expect(screen.getByText('2026-Q1')).toBeInTheDocument());
  });

  it('shows empty message when no reports', async () => {
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/ift-statistical-reports')
        return Promise.resolve({ data: { data: [], meta: { total: 0, page: 1, limit: 50, totalPages: 0 } }, error: undefined });
      return Promise.resolve({ data: { data: [] }, error: undefined });
    });
    renderList();
    await waitFor(() => expect(screen.getByText(/No statistical reports recorded/)).toBeInTheDocument());
  });
});
