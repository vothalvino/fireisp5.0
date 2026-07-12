// =============================================================================
// FireISP 5.0 — LeadList page tests (§1.2)
// =============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { LeadList } from '../LeadList';

const mockApiGet = vi.fn();
const mockApiPut = vi.fn();
vi.mock('@/api/client', () => ({
  api: {
    GET: (...args: unknown[]) => mockApiGet(...args),
    POST: vi.fn(),
    PUT: (...args: unknown[]) => mockApiPut(...args),
    DELETE: vi.fn(),
  },
  tokenStore: { getAccess: () => 'tok', setAccess: vi.fn(), getRefresh: () => null, setRefresh: vi.fn(), clear: vi.fn() },
}));

vi.mock('@/auth/AuthContext', () => ({
  useAuth: () => ({ user: { id: 1, role: 'admin' } }),
}));

const lead1 = {
  id: 1, name: 'Jane Prospect', email: 'jane@x.com', phone: '555', company: 'Acme',
  source: 'referral', status: 'new', estimated_value: 350, assigned_to: null,
  converted_client_id: null, created_at: '2026-01-01',
  address: '1 Main St', city: 'CDMX', state: 'CDMX', zip_code: '01000',
};

function mockResponses() {
  mockApiGet.mockImplementation((path: string) => {
    if (path === '/leads/pipeline') {
      return Promise.resolve({ data: { data: { new: 1, won: 0 } }, error: undefined });
    }
    return Promise.resolve({
      data: { data: [lead1], meta: { total: 1, page: 1, limit: 200, totalPages: 1 } },
      error: undefined,
    });
  });
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <LeadList />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('LeadList page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResponses();
  });

  it('renders the page heading', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('Leads')).toBeInTheDocument());
  });

  it('renders a lead row after data loads', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('Jane Prospect')).toBeInTheDocument());
  });

  it('shows a Convert action for an unconverted lead', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('Convert')).toBeInTheDocument());
  });

  it('sends address as an explicit null when a previously-set field is cleared on edit', async () => {
    mockApiPut.mockResolvedValue({ error: undefined });
    renderPage();
    await waitFor(() => expect(screen.getByText('Jane Prospect')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Edit'));
    const addressInput = await screen.findByDisplayValue('1 Main St');
    fireEvent.change(addressInput, { target: { value: '' } });
    fireEvent.click(screen.getByText('Save'));

    await waitFor(() => expect(mockApiPut).toHaveBeenCalledWith(
      '/leads/{id}',
      // The cleared field is nulled; a field that was set and left untouched
      // (city) still goes through as its real value, not null.
      expect.objectContaining({ body: expect.objectContaining({ address: null, city: 'CDMX' }) }),
    ));
  });

  it('shows the empty state when there are no leads', async () => {
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/leads/pipeline') {
        return Promise.resolve({ data: { data: {} }, error: undefined });
      }
      return Promise.resolve({
        data: { data: [], meta: { total: 0, page: 1, limit: 200, totalPages: 0 } },
        error: undefined,
      });
    });
    renderPage();
    await waitFor(() => expect(screen.getByText('No leads yet.')).toBeInTheDocument());
  });
});
