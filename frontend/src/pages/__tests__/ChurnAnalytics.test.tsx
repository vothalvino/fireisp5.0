// =============================================================================
// FireISP 5.0 — ChurnAnalytics page tests (§1.2)
// =============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { ChurnAnalytics } from '../ChurnAnalytics';

const mockApiGet = vi.fn();
vi.mock('@/api/client', () => ({
  api: {
    GET: (...args: unknown[]) => mockApiGet(...args),
    POST: vi.fn(),
    PUT: vi.fn(),
    DELETE: vi.fn(),
  },
  tokenStore: { getAccess: () => 'tok', setAccess: vi.fn(), getRefresh: () => null, setRefresh: vi.fn(), clear: vi.fn() },
}));

const churnReport = {
  generated_at: '2026-06-01T00:00:00.000Z',
  organization_id: 1,
  months: [
    { month: '2026-05', new_contracts: 10, churned: 2, churn_rate_pct: 16.67 },
    { month: '2026-04', new_contracts: 8, churned: 1, churn_rate_pct: 11.11 },
  ],
};

const atRiskReport = {
  generated_at: '2026-06-01T00:00:00.000Z',
  organization_id: 1,
  clients: [
    { client_id: 42, name: 'Risky Roberto', email: 'rob@x.com', suspended_contracts: 1, overdue_invoices: 2, max_days_overdue: 45, risk_score: 78 },
  ],
};

function mockResponses() {
  mockApiGet.mockImplementation((path: string) => {
    if (path === '/lifecycle/churn') {
      return Promise.resolve({ data: { data: churnReport }, error: undefined });
    }
    if (path === '/lifecycle/at-risk') {
      return Promise.resolve({ data: { data: atRiskReport }, error: undefined });
    }
    return Promise.resolve({ data: { data: {} }, error: undefined });
  });
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <ChurnAnalytics />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('ChurnAnalytics page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResponses();
  });

  it('renders the page heading', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('📉 Churn Analytics')).toBeInTheDocument());
  });

  it('renders a monthly churn row', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('2026-05')).toBeInTheDocument());
  });

  it('renders an at-risk client row with a risk score', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('Risky Roberto')).toBeInTheDocument());
    expect(screen.getByText(/78 · High/)).toBeInTheDocument();
  });

  it('shows the empty state when no at-risk clients', async () => {
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/lifecycle/churn') {
        return Promise.resolve({ data: { data: { ...churnReport, months: [] } }, error: undefined });
      }
      return Promise.resolve({ data: { data: { ...atRiskReport, clients: [] } }, error: undefined });
    });
    renderPage();
    await waitFor(() => expect(screen.getByText('No at-risk clients detected. 🎉')).toBeInTheDocument());
  });
});
