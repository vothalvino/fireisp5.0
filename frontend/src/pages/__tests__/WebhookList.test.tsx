// =============================================================================
// FireISP 5.0 — WebhookList page tests
// =============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { WebhookList } from '../WebhookList';

const mockApiGet = vi.fn();
vi.mock('@/api/client', () => ({
  api: { GET: (...args: unknown[]) => mockApiGet(...args) },
  tokenStore: { getAccess: () => 'tok', setAccess: vi.fn(), getRefresh: () => null, setRefresh: vi.fn(), clear: vi.fn() },
}));

const webhook1 = {
  id: 1, url: 'https://example.com/hook', events: ['invoice.created'],
  is_enabled: 1, max_retries: 5, timeout_seconds: 30,
};

function renderList() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <WebhookList />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('WebhookList page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/webhooks')
        return Promise.resolve({ data: { data: [webhook1], meta: { total: 1, page: 1, limit: 25, totalPages: 1 } }, error: undefined });
      return Promise.resolve({ data: { data: [] }, error: undefined });
    });
  });

  it('renders the page heading', async () => {
    renderList();
    await waitFor(() => expect(screen.getByText('🔗 Webhooks')).toBeInTheDocument());
  });

  it('renders a webhook row with its events', async () => {
    renderList();
    await waitFor(() => expect(screen.getByText('https://example.com/hook')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText('invoice.created')).toBeInTheDocument());
  });

  it('shows empty message when no webhooks', async () => {
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/webhooks')
        return Promise.resolve({ data: { data: [], meta: { total: 0, page: 1, limit: 25, totalPages: 0 } }, error: undefined });
      return Promise.resolve({ data: { data: [] }, error: undefined });
    });
    renderList();
    await waitFor(() => expect(screen.getByText(/No webhooks found/)).toBeInTheDocument());
  });
});
