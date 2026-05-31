// =============================================================================
// FireISP 5.0 — QueueStats page tests
// =============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { QueueStats } from '../QueueStats';

const mockApiGet = vi.fn();
vi.mock('@/api/client', () => ({
  api: { GET: (...args: unknown[]) => mockApiGet(...args) },
  tokenStore: { getAccess: () => 'tok', setAccess: vi.fn(), getRefresh: () => null, setRefresh: vi.fn(), clear: vi.fn() },
}));

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <QueueStats />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('QueueStats page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders queue rows with counts in bullmq mode', async () => {
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/queue-stats')
        return Promise.resolve({
          data: { mode: 'bullmq', queues: [{ name: 'webhooks', waiting: 2, active: 1, completed: 9, failed: 0, delayed: 0 }] },
          error: undefined,
        });
      return Promise.resolve({ data: {}, error: undefined });
    });
    renderPage();
    await waitFor(() => expect(screen.getByText('📥 Queue Status')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText('webhooks')).toBeInTheDocument());
  });

  it('shows guidance when in-process mode has no queues', async () => {
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/queue-stats')
        return Promise.resolve({ data: { mode: 'in-process', queues: [] }, error: undefined });
      return Promise.resolve({ data: {}, error: undefined });
    });
    renderPage();
    await waitFor(() => expect(screen.getByText(/No active queues/)).toBeInTheDocument());
  });
});
