// =============================================================================
// FireISP 5.0 — EscalationList page tests (§1.3)
// =============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { EscalationList } from '../EscalationList';

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

const escalation1 = {
  id: 1, ticket_id: 12, level: 2, escalated_by: 1, escalated_to: 8,
  reason: 'Client called twice with no resolution', status: 'open',
  acknowledged_at: null, resolved_at: null, created_at: '2026-06-01T10:00:00Z',
};

const candidate1 = {
  id: 30, subject: 'Intermittent drops', priority: 'high', status: 'open',
  client_id: 5, client_name: 'Jane Doe', hours_open: 50,
};

function mockResponses() {
  mockApiGet.mockImplementation((path: string) => {
    if (path === '/escalations/candidates') {
      return Promise.resolve({ data: { data: [candidate1] }, error: undefined });
    }
    return Promise.resolve({
      data: { data: [escalation1], meta: { total: 1, page: 1, limit: 200, totalPages: 1 } },
      error: undefined,
    });
  });
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <EscalationList />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('EscalationList page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResponses();
  });

  it('renders the page heading', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('Escalations')).toBeInTheDocument());
  });

  it('renders an escalation row with its level badge', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('Client called twice with no resolution')).toBeInTheDocument());
    expect(screen.getByText('L2')).toBeInTheDocument();
  });

  it('shows the candidates queue with an Escalate action', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('Jane Doe')).toBeInTheDocument());
    expect(screen.getByText('Escalate')).toBeInTheDocument();
  });

  it('shows acknowledge and resolve actions for an open escalation', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('Acknowledge')).toBeInTheDocument());
    expect(screen.getByText('Resolve')).toBeInTheDocument();
  });

  it('shows the empty state when there are no escalations', async () => {
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/escalations/candidates') {
        return Promise.resolve({ data: { data: [] }, error: undefined });
      }
      return Promise.resolve({
        data: { data: [], meta: { total: 0, page: 1, limit: 200, totalPages: 0 } },
        error: undefined,
      });
    });
    renderPage();
    await waitFor(() => expect(screen.getByText('No escalations yet.')).toBeInTheDocument());
  });
});
