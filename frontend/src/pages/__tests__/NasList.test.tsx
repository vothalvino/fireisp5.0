// =============================================================================
// FireISP 5.0 — NasList page tests
// =============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { NasList } from '../NasList';

const mockApiGet = vi.fn();
vi.mock('@/api/client', () => ({
  api: { GET: (...args: unknown[]) => mockApiGet(...args) },
  tokenStore: { getAccess: () => 'tok', setAccess: vi.fn(), getRefresh: () => null, setRefresh: vi.fn(), clear: vi.fn() },
}));

const nas1 = {
  id: 1, name: 'Core-Router', ip_address: '10.0.0.1', ipv6_address: null,
  type: 'mikrotik', ports: 16, description: null, status: 'active',
};

function renderNasList() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <NasList />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('NasList page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/nas')
        return Promise.resolve({ data: { data: [nas1], meta: { total: 1, page: 1, limit: 25, totalPages: 1 } }, error: undefined });
      return Promise.resolve({ data: { data: [] }, error: undefined });
    });
  });

  it('renders the page heading', async () => {
    renderNasList();
    await waitFor(() => expect(screen.getByText('🖧 NAS Devices')).toBeInTheDocument());
  });

  it('renders a NAS row after data loads', async () => {
    renderNasList();
    await waitFor(() => expect(screen.getByText('Core-Router')).toBeInTheDocument());
    expect(screen.getByText('10.0.0.1')).toBeInTheDocument();
  });

  it('shows empty message when no NAS devices', async () => {
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/nas')
        return Promise.resolve({ data: { data: [], meta: { total: 0, page: 1, limit: 25, totalPages: 0 } }, error: undefined });
      return Promise.resolve({ data: { data: [] }, error: undefined });
    });
    renderNasList();
    await waitFor(() => expect(screen.getByText(/No NAS devices found/)).toBeInTheDocument());
  });
});
