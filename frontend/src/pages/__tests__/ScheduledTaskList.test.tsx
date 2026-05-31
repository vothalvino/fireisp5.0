// =============================================================================
// FireISP 5.0 — ScheduledTaskList page tests
// =============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { ScheduledTaskList } from '../ScheduledTaskList';

const mockApiGet = vi.fn();
vi.mock('@/api/client', () => ({
  api: { GET: (...args: unknown[]) => mockApiGet(...args) },
  tokenStore: { getAccess: () => 'tok', setAccess: vi.fn(), getRefresh: () => null, setRefresh: vi.fn(), clear: vi.fn() },
}));

const task1 = {
  id: 1, task_name: 'nightly-suspend', task_type: 'auto_suspend', cron_expression: '0 2 * * *',
  description: null, priority: 'normal', is_enabled: 1, last_run_at: null, last_status: null,
};

function renderList() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <ScheduledTaskList />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('ScheduledTaskList page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/scheduled-tasks')
        return Promise.resolve({ data: { data: [task1], meta: { total: 1, page: 1, limit: 25, totalPages: 1 } }, error: undefined });
      return Promise.resolve({ data: { data: [] }, error: undefined });
    });
  });

  it('renders the page heading', async () => {
    renderList();
    await waitFor(() => expect(screen.getByText('⏰ Scheduled Tasks')).toBeInTheDocument());
  });

  it('renders a task row with its cron expression', async () => {
    renderList();
    await waitFor(() => expect(screen.getByText('nightly-suspend')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText('0 2 * * *')).toBeInTheDocument());
  });

  it('shows empty message when no tasks', async () => {
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/scheduled-tasks')
        return Promise.resolve({ data: { data: [], meta: { total: 0, page: 1, limit: 25, totalPages: 0 } }, error: undefined });
      return Promise.resolve({ data: { data: [] }, error: undefined });
    });
    renderList();
    await waitFor(() => expect(screen.getByText(/No scheduled tasks found/)).toBeInTheDocument());
  });
});
