// =============================================================================
// FireISP 5.0 — WinbackCampaignList page tests (§1.2)
// =============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { WinbackCampaignList } from '../WinbackCampaignList';

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

vi.mock('@/auth/AuthContext', () => ({
  useAuth: () => ({ user: { id: 1, role: 'admin' } }),
}));

const campaign1 = {
  id: 1, name: 'Spring Comeback', status: 'active', target_segment: 'cancelled_90d',
  offer_description: '20% off for 3 months', discount_percent: 20, message_template_id: null,
  start_date: '2026-03-01', end_date: '2026-06-01', notes: null,
};

function mockResponses() {
  mockApiGet.mockImplementation((path: string) => {
    if (path === '/winback-campaigns/{id}/targets') {
      return Promise.resolve({ data: { data: [], meta: { count: 0, segment: 'cancelled_90d' } }, error: undefined });
    }
    return Promise.resolve({
      data: { data: [campaign1], meta: { total: 1, page: 1, limit: 50, totalPages: 1 } },
      error: undefined,
    });
  });
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <WinbackCampaignList />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('WinbackCampaignList page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResponses();
  });

  it('renders the page heading', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('🎁 Win-back Campaigns')).toBeInTheDocument());
  });

  it('renders a campaign row after data loads', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('Spring Comeback')).toBeInTheDocument());
  });

  it('shows a Targets action for each campaign', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('Targets')).toBeInTheDocument());
  });

  it('shows the empty state when there are no campaigns', async () => {
    mockApiGet.mockImplementation(() => Promise.resolve({
      data: { data: [], meta: { total: 0, page: 1, limit: 50, totalPages: 0 } },
      error: undefined,
    }));
    renderPage();
    await waitFor(() => expect(screen.getByText('No win-back campaigns yet.')).toBeInTheDocument());
  });
});
