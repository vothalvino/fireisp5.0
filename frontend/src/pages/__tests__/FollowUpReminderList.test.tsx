// =============================================================================
// FireISP 5.0 — FollowUpReminderList page tests (§1.3)
// =============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { FollowUpReminderList } from '../FollowUpReminderList';

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

const reminder1 = {
  id: 1, client_id: 5, ticket_id: null, assigned_to: 1,
  title: 'Call Jane about upgrade', notes: null, priority: 'high', status: 'pending',
  due_at: '2099-01-01 10:00:00', notified_at: null, completed_at: null, created_at: '2026-06-01',
};

function mockResponses() {
  mockApiGet.mockImplementation(() => Promise.resolve({
    data: { data: [reminder1], meta: { total: 1, page: 1, limit: 200, totalPages: 1 } },
    error: undefined,
  }));
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <FollowUpReminderList />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('FollowUpReminderList page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResponses();
  });

  it('renders the page heading', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('Follow-up Reminders')).toBeInTheDocument());
  });

  it('renders a reminder row after data loads', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('Call Jane about upgrade')).toBeInTheDocument());
  });

  it('shows a Complete action for a pending reminder', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('Complete')).toBeInTheDocument());
  });

  it('shows the empty state when there are no reminders', async () => {
    mockApiGet.mockImplementation(() => Promise.resolve({
      data: { data: [], meta: { total: 0, page: 1, limit: 200, totalPages: 0 } },
      error: undefined,
    }));
    renderPage();
    await waitFor(() => expect(screen.getByText('No follow-ups yet.')).toBeInTheDocument());
  });
});
