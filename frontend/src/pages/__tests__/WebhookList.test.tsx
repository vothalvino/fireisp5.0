// =============================================================================
// FireISP 5.0 — WebhookList page tests
// =============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { WebhookList } from '../WebhookList';

const mockApiGet = vi.fn();
vi.mock('@/api/client', () => ({
  api: { GET: (...args: unknown[]) => mockApiGet(...args) },
  tokenStore: { getAccess: () => 'tok', setAccess: vi.fn(), getRefresh: () => null, setRefresh: vi.fn(), clear: vi.fn() },
}));

const webhook1 = {
  id: 1, events: ['invoice.created'], is_active: true, has_secret: true,
  url_configured: true, target_display_code: 'configured_https_endpoint',
  max_retries: 5, timeout_seconds: 30,
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
      if (path === '/webhooks/{id}/configuration')
        return Promise.resolve({ data: { data: { id: 1, url: 'https://example.com/private-capability' } }, error: undefined });
      return Promise.resolve({ data: { data: [] }, error: undefined });
    });
  });

  it('renders the page heading', async () => {
    renderList();
    await waitFor(() => expect(screen.getByText('🔗 Webhooks')).toBeInTheDocument());
  });

  it('renders a webhook row with its events', async () => {
    renderList();
    await waitFor(() => expect(screen.getByText('Configured HTTPS endpoint')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText('invoice.created')).toBeInTheDocument());
    expect(screen.queryByText(/example\.com/)).not.toBeInTheDocument();
  });

  it('loads the private URL only after the operator chooses Edit', async () => {
    const user = userEvent.setup();
    renderList();
    await user.click(await screen.findByRole('button', { name: /Edit/ }));

    expect(await screen.findByRole('dialog', { name: 'Edit webhook #1' })).toBeInTheDocument();
    expect(screen.getByLabelText(/Target URL/)).toHaveValue('https://example.com/private-capability');
    expect(mockApiGet).toHaveBeenCalledWith('/webhooks/{id}/configuration', {
      params: { path: { id: 1 } },
    });
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
