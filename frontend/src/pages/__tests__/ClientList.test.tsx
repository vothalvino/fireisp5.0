// =============================================================================
// FireISP 5.0 — ClientList page tests
// =============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { ClientList } from '../ClientList';

// ---------------------------------------------------------------------------
// Mock API client
// ---------------------------------------------------------------------------

const mockApiGet = vi.fn();
const mockApiPut = vi.fn();
vi.mock('@/api/client', () => ({
  api: {
    GET: (...args: unknown[]) => mockApiGet(...args),
    PUT: (...args: unknown[]) => mockApiPut(...args),
  },
  tokenStore: { getAccess: () => 'tok', setAccess: vi.fn(), getRefresh: () => null, setRefresh: vi.fn(), clear: vi.fn() },
}));

vi.mock('@/auth/AuthContext', () => ({
  useAuth: () => ({ user: { id: 1, role: 'admin' } }),
}));

const client1 = {
  id: 1, name: 'Alice Smith', email: 'alice@test.com', phone: null,
  client_type: 'residential', status: 'active', address: '1 Main St',
  city: 'CDMX', state: 'CMX', country: 'MX', created_at: '2024-01-01',
};

function renderClientList() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <ClientList />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('ClientList page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Path-aware: the page also fetches /client-groups for the group filter — keep
    // that empty so client names don't also appear as <option>s (getByText needs
    // a single match).
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/client-groups') {
        return Promise.resolve({ data: { data: [] }, error: undefined });
      }
      return Promise.resolve({
        data: { data: [client1], meta: { total: 1, page: 1, limit: 20, totalPages: 1 } },
        error: undefined,
      });
    });
  });

  it('renders the page heading', async () => {
    renderClientList();
    await waitFor(() => expect(screen.getByText('👥 Clients')).toBeInTheDocument());
  });

  it('renders a client row after data loads', async () => {
    renderClientList();
    await waitFor(() => expect(screen.getByText('Alice Smith')).toBeInTheDocument());
  });

  it('sends address as an explicit null when a previously-set field is cleared on edit', async () => {
    mockApiPut.mockResolvedValue({ error: undefined });
    renderClientList();
    await waitFor(() => expect(screen.getByText('Alice Smith')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Edit'));
    const addressInput = await screen.findByDisplayValue('1 Main St');
    fireEvent.change(addressInput, { target: { value: '' } });
    fireEvent.click(screen.getByText('Save'));

    await waitFor(() => expect(mockApiPut).toHaveBeenCalledWith(
      '/clients/{id}',
      // The cleared field is nulled; a field that was set and left untouched
      // (city) still goes through as its real value, not null.
      expect.objectContaining({ body: expect.objectContaining({ address: null, city: 'CDMX' }) }),
    ));
  });

  it('shows No clients found when list is empty', async () => {
    mockApiGet.mockResolvedValue({
      data: { data: [], meta: { total: 0, page: 1, limit: 20, totalPages: 0 } },
      error: undefined,
    });
    renderClientList();
    await waitFor(() => expect(screen.getByText('No clients found.')).toBeInTheDocument());
  });
});
