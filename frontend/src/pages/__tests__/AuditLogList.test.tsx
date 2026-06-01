// =============================================================================
// FireISP 5.0 — AuditLogList page tests
// =============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { AuditLogList } from '../AuditLogList';

const mockApiGet = vi.fn();
vi.mock('@/api/client', () => ({
  api: { GET: (...args: unknown[]) => mockApiGet(...args) },
  tokenStore: { getAccess: () => 'tok', setAccess: vi.fn(), getRefresh: () => null, setRefresh: vi.fn(), clear: vi.fn() },
}));

const log1 = {
  id: 1, user_id: 4, action: 'update', entity_type: 'clients', entity_id: 12,
  summary: 'Updated client email', ip_address: '10.0.0.1', created_at: '2026-05-31T10:00:00Z',
};

function renderList() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <AuditLogList />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('AuditLogList page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/audit-logs')
        return Promise.resolve({ data: { data: [log1], meta: { total: 1, page: 1, limit: 50 } }, error: undefined });
      return Promise.resolve({ data: { data: [] }, error: undefined });
    });
  });

  it('renders the page heading', async () => {
    renderList();
    await waitFor(() => expect(screen.getByText('📜 Audit Logs')).toBeInTheDocument());
  });

  it('renders an audit log row with its summary', async () => {
    renderList();
    await waitFor(() => expect(screen.getByText('Updated client email')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText('clients')).toBeInTheDocument());
  });

  it('shows empty message when no logs', async () => {
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/audit-logs')
        return Promise.resolve({ data: { data: [], meta: { total: 0, page: 1, limit: 50 } }, error: undefined });
      return Promise.resolve({ data: { data: [] }, error: undefined });
    });
    renderList();
    await waitFor(() => expect(screen.getByText(/No audit log entries found/)).toBeInTheDocument());
  });
});
