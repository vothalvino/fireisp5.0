// =============================================================================
// FireISP 5.0 — RegulatoryFilingList page tests
// =============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { RegulatoryFilingList } from '../RegulatoryFilingList';

const mockApiGet = vi.fn();
vi.mock('@/api/client', () => ({
  api: { GET: (...args: unknown[]) => mockApiGet(...args) },
  tokenStore: { getAccess: () => 'tok', setAccess: vi.fn(), getRefresh: () => null, setRefresh: vi.fn(), clear: vi.fn() },
}));

const filing1 = {
  id: 1, filing_type: 'annual_report', period_start: '2025-01-01', period_end: '2025-12-31',
  filed_at: '2026-01-15T00:00:00Z', acknowledgement_number: 'IFT-2026-0001', status: 'filed', notes: 'LFTR annual',
};

function renderList() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <RegulatoryFilingList />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('RegulatoryFilingList page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/regulatory-filings')
        return Promise.resolve({ data: { data: [filing1], meta: { total: 1, page: 1, limit: 50, totalPages: 1 } }, error: undefined });
      return Promise.resolve({ data: { data: [] }, error: undefined });
    });
  });

  it('renders the page heading', async () => {
    renderList();
    await waitFor(() => expect(screen.getByText('🏛️ Regulatory Filings')).toBeInTheDocument());
  });

  it('renders a filing row with its acknowledgement number', async () => {
    renderList();
    await waitFor(() => expect(screen.getByText('IFT-2026-0001')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText('annual report')).toBeInTheDocument());
  });

  it('shows empty message when no filings', async () => {
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/regulatory-filings')
        return Promise.resolve({ data: { data: [], meta: { total: 0, page: 1, limit: 50, totalPages: 0 } }, error: undefined });
      return Promise.resolve({ data: { data: [] }, error: undefined });
    });
    renderList();
    await waitFor(() => expect(screen.getByText(/No regulatory filings found/)).toBeInTheDocument());
  });
});
