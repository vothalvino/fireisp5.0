// =============================================================================
// FireISP 5.0 — SatisfactionSurveyList page tests (§1.3)
// =============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { SatisfactionSurveyList } from '../SatisfactionSurveyList';

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

const survey1 = {
  id: 3, client_id: 5, ticket_id: 12, survey_type: 'nps', channel: 'email',
  status: 'sent', score: null, comment: null, sent_at: '2026-06-01', responded_at: null, created_at: '2026-06-01',
};

const metrics = {
  nps: { sent: 10, responses: 6, promoters: 4, passives: 1, detractors: 1, score: 50 },
  csat: { sent: 12, responses: 10, satisfied: 8, average: 4.3, satisfaction_pct: 80 },
};

function mockResponses() {
  mockApiGet.mockImplementation((path: string) => {
    if (path === '/satisfaction-surveys/metrics') {
      return Promise.resolve({ data: { data: metrics }, error: undefined });
    }
    return Promise.resolve({
      data: { data: [survey1], meta: { total: 1, page: 1, limit: 200, totalPages: 1 } },
      error: undefined,
    });
  });
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <SatisfactionSurveyList />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('SatisfactionSurveyList page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResponses();
  });

  it('renders the page heading', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('Satisfaction Surveys')).toBeInTheDocument());
  });

  it('shows the NPS score metric card', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('NPS score')).toBeInTheDocument());
    expect(screen.getByText('50')).toBeInTheDocument();
  });

  it('shows the CSAT average metric card', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('4.3/5')).toBeInTheDocument());
  });

  it('renders a survey row with a Respond action', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('Respond')).toBeInTheDocument());
    expect(screen.getByText('nps')).toBeInTheDocument();
  });

  it('shows the empty state when there are no surveys', async () => {
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/satisfaction-surveys/metrics') {
        return Promise.resolve({ data: { data: metrics }, error: undefined });
      }
      return Promise.resolve({
        data: { data: [], meta: { total: 0, page: 1, limit: 200, totalPages: 0 } },
        error: undefined,
      });
    });
    renderPage();
    await waitFor(() => expect(screen.getByText('No surveys yet.')).toBeInTheDocument());
  });
});
