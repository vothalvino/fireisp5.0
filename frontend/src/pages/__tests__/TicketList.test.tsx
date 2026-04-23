// =============================================================================
// FireISP 5.0 — TicketList page tests
// =============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { TicketList } from '../TicketList';

// ---------------------------------------------------------------------------
// Mock API client
// ---------------------------------------------------------------------------

const mockApiGet = vi.fn();
vi.mock('@/api/client', () => ({
  api: { GET: (...args: unknown[]) => mockApiGet(...args) },
  tokenStore: { getAccess: () => 'tok', setAccess: vi.fn(), getRefresh: () => null, setRefresh: vi.fn(), clear: vi.fn() },
}));

const ticket1 = {
  id: 1, client_id: 10, contract_id: null, assigned_to: null,
  subject: 'No internet connection', description: 'Client reports offline',
  priority: 'high', category: 'technical', status: 'open',
  created_at: '2024-01-10', updated_at: '2024-01-10',
};

function renderTicketList() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <TicketList />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('TicketList page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/tickets' || String(path).includes('/tickets'))
        return Promise.resolve({ data: { data: [ticket1], meta: { total: 1, page: 1, limit: 20, totalPages: 1 } }, error: undefined });
      if (path === '/clients')
        return Promise.resolve({ data: { data: [] }, error: undefined });
      if (path === '/users' || String(path).includes('/users'))
        return Promise.resolve({ data: { data: [] }, error: undefined });
      return Promise.resolve({ data: { data: [] }, error: undefined });
    });
  });

  it('renders the page heading', async () => {
    renderTicketList();
    await waitFor(() => expect(screen.getByText('🎫 Tickets')).toBeInTheDocument());
  });

  it('renders a ticket subject after data loads', async () => {
    renderTicketList();
    await waitFor(() => expect(screen.getByText('No internet connection')).toBeInTheDocument());
  });

  it('shows empty row when no tickets', async () => {
    mockApiGet.mockResolvedValue({ data: { data: [], meta: { total: 0, page: 1, limit: 20, totalPages: 0 } }, error: undefined });
    renderTicketList();
    await waitFor(() => expect(screen.getByText('No tickets found')).toBeInTheDocument());
  });
});
