// =============================================================================
// FireISP 5.0 — MessageTemplateList page tests
// =============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { MessageTemplateList } from '../MessageTemplateList';

const mockApiGet = vi.fn();
vi.mock('@/api/client', () => ({
  api: { GET: (...args: unknown[]) => mockApiGet(...args) },
  tokenStore: { getAccess: () => 'tok', setAccess: vi.fn(), getRefresh: () => null, setRefresh: vi.fn(), clear: vi.fn() },
}));

const tpl1 = {
  id: 1, name: 'invoice_reminder', channel: 'email',
  subject: 'Your invoice is due', body: 'Hi {{client_name}}', variables: 'client_name',
};

function renderList() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <MessageTemplateList />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('MessageTemplateList page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/message-templates')
        return Promise.resolve({ data: { data: [tpl1], meta: { total: 1, page: 1, limit: 25, totalPages: 1 } }, error: undefined });
      return Promise.resolve({ data: { data: [] }, error: undefined });
    });
  });

  it('renders the page heading', async () => {
    renderList();
    await waitFor(() => expect(screen.getByText('✉️ Message Templates')).toBeInTheDocument());
  });

  it('renders a template row with its name', async () => {
    renderList();
    await waitFor(() => expect(screen.getByText('invoice_reminder')).toBeInTheDocument());
  });

  it('shows empty message when no templates', async () => {
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/message-templates')
        return Promise.resolve({ data: { data: [], meta: { total: 0, page: 1, limit: 25, totalPages: 0 } }, error: undefined });
      return Promise.resolve({ data: { data: [] }, error: undefined });
    });
    renderList();
    await waitFor(() => expect(screen.getByText(/No templates found/)).toBeInTheDocument());
  });
});
