// =============================================================================
// FireISP 5.0 — ScheduledTaskList page tests
// =============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { ScheduledTaskList } from '../ScheduledTaskList';

const mockApiGet = vi.fn();
const mockApiPost = vi.fn();
const authState = vi.hoisted(() => ({
  user: { id: 1, role: 'admin', permissions: [] as string[], is_install_operator: true },
}));

vi.mock('@/api/client', () => ({
  api: {
    GET: (...args: unknown[]) => mockApiGet(...args),
    POST: (...args: unknown[]) => mockApiPost(...args),
    PUT: vi.fn(),
    DELETE: vi.fn(),
  },
  tokenStore: { getAccess: () => 'tok', setAccess: vi.fn(), getRefresh: () => null, setRefresh: vi.fn(), clear: vi.fn() },
}));

vi.mock('@/auth/AuthContext', () => ({
  useAuth: () => ({ user: authState.user }),
}));

const task1 = {
  id: 1, task_name: 'nightly-suspend', task_type: 'auto_suspend', cron_expression: '0 2 * * *',
  description: null, priority: 'normal', is_enabled: 1, last_run_at: null, last_status: null, is_global: 0,
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
    authState.user = { id: 1, role: 'admin', permissions: [], is_install_operator: true };
    mockApiPost.mockResolvedValue({
      data: { data: { task_name: task1.task_name, result: { processed: 1 } } },
      error: undefined,
    });
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

  it('hides all executable task actions from a non-operator', async () => {
    authState.user = { id: 2, role: 'support', permissions: ['scheduled_tasks.view'], is_install_operator: false };
    renderList();
    await screen.findByText('nightly-suspend');
    expect(screen.queryByRole('button', { name: /Run now/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /New Task/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Edit/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Delete/i })).not.toBeInTheDocument();
  });

  it('confirms, shows pending state, runs the selected task, and renders its result', async () => {
    let finishRun!: (value: unknown) => void;
    mockApiPost.mockImplementation(() => new Promise(resolve => { finishRun = resolve; }));
    renderList();

    const runButton = await screen.findByRole('button', { name: /Run now/i });
    fireEvent.click(runButton);
    expect(mockApiPost).not.toHaveBeenCalled();
    expect(screen.getByRole('alertdialog', { name: 'Run scheduled task' })).toHaveTextContent(
      /Run "nightly-suspend" now/i,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Run task' }));
    await waitFor(() => {
      expect(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Running…' })).toBeDisabled();
      expect(mockApiPost).toHaveBeenCalledWith('/scheduled-tasks/{id}/run', {
        params: { path: { id: 1 } },
      });
    });

    finishRun({
      data: { data: { task_name: task1.task_name, result: { notifications_cleared: 2 } } },
      error: undefined,
    });
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(
      'Task "nightly-suspend" finished successfully.',
    ));
    expect(screen.getByText(/notifications_cleared/)).toBeInTheDocument();
  });

  it('shows install-wide Run only to the install operator', async () => {
    const globalTask = { ...task1, id: 26, task_name: 'tls_expiry_monitor', is_global: 1 };
    mockApiGet.mockResolvedValue({
      data: { data: [globalTask], meta: { total: 1, page: 1, limit: 25, totalPages: 1 } },
      error: undefined,
    });
    authState.user = { id: 3, role: 'admin', permissions: [], is_install_operator: false };
    const first = renderList();
    await screen.findByText('tls_expiry_monitor');
    expect(screen.queryByRole('button', { name: /Run now/i })).not.toBeInTheDocument();

    first.unmount();
    authState.user = { id: 1, role: 'admin', permissions: [], is_install_operator: true };
    renderList();
    fireEvent.click(await screen.findByRole('button', { name: /Run now/i }));
    expect(screen.getByRole('alertdialog')).toHaveTextContent(/install-wide task/i);
    expect(screen.getByRole('alertdialog')).toHaveTextContent(/every organization/i);
  });

  it('surfaces the backend reason when a manual run fails', async () => {
    mockApiPost.mockResolvedValue({
      data: undefined,
      error: { error: { message: 'TLS probe is unavailable' } },
    });
    renderList();

    fireEvent.click(await screen.findByRole('button', { name: /Run now/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Run task' }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(
      'Could not run "nightly-suspend": TLS probe is unavailable',
    ));
  });

  it('keeps row actions touchable and wrapped on narrow screens', async () => {
    renderList();
    const runButton = await screen.findByRole('button', { name: /Run now/i });
    expect(runButton).toHaveStyle({ minHeight: '40px' });
    expect(runButton.parentElement).toHaveStyle({ flexWrap: 'wrap' });
  });
});
