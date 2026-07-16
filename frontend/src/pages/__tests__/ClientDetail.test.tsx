// =============================================================================
// FireISP 5.0 — ClientDetail page tests
// =============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { ClientDetail } from '../ClientDetail';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockGql = vi.fn();
vi.mock('@/api/graphql', () => ({
  gql: (...a: unknown[]) => mockGql(...a),
}));

const mockApiGet = vi.fn();
vi.mock('@/api/client', () => ({
  api: { GET: (...a: unknown[]) => mockApiGet(...a), POST: vi.fn(), PUT: vi.fn(), DELETE: vi.fn() },
  authedFetch: vi.fn(),
  tokenStore: { getAccess: () => 'tok', setAccess: vi.fn(), getRefresh: () => null, setRefresh: vi.fn(), clear: vi.fn() },
}));

let mockRole = 'admin';
vi.mock('@/auth/AuthContext', () => ({
  useAuth: () => ({ user: { id: 1, role: mockRole } }),
}));

const client = {
  id: '5', name: 'Acme Corp', email: 'ops@acme.com', phone: null,
  clientType: 'business', status: 'active', address: null, city: 'CDMX',
  state: null, zipCode: null, country: 'MX', taxId: null, locale: 'MX',
  notes: null, createdAt: '2024-01-01',
  contracts: [], invoices: [], payments: [], devices: [], ledger: [],
  contacts: [{ id: '1', name: 'Jane Doe', email: null, phone: null, role: 'Billing' }],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockRole = 'admin';
  mockGql.mockResolvedValue({ client });
  mockApiGet.mockResolvedValue({ data: { data: [] }, error: undefined });
});

function renderDetail() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/clients/5']}>
        <Routes>
          <Route path="/clients/:id" element={<ClientDetail />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('ClientDetail page', () => {
  it('renders the client name', async () => {
    renderDetail();
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Acme Corp' })).toBeInTheDocument());
  });

  it('shows Edit/MX/Portal actions for admin', async () => {
    renderDetail();
    await waitFor(() => expect(screen.getByText('✏️ Edit')).toBeInTheDocument());
    expect(screen.getByText('🧾 MX Profile')).toBeInTheDocument();
    expect(screen.getByText('🔑 Portal Password')).toBeInTheDocument();
  });

  it('hides write actions for readonly role', async () => {
    mockRole = 'readonly';
    renderDetail();
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Acme Corp' })).toBeInTheDocument());
    expect(screen.queryByText('✏️ Edit')).not.toBeInTheDocument();
  });

  it('Tickets tab lists the client tickets and links to each ticket', async () => {
    mockApiGet.mockImplementation((path: string) =>
      path === '/tickets'
        ? Promise.resolve({ data: { data: [{ id: 42, subject: 'No internet', priority: 'high', status: 'open', created_at: '2024-05-01' }] }, error: undefined })
        : Promise.resolve({ data: { data: [] }, error: undefined }),
    );
    renderDetail();
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Acme Corp' })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Tickets' }));

    await waitFor(() => expect(screen.getByText('No internet')).toBeInTheDocument());
    const link = screen.getByRole('link', { name: 'No internet' });
    expect(link).toHaveAttribute('href', '/tickets/42');
  });

  it('tabs are icon-only but keep their accessible names', async () => {
    renderDetail();
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Acme Corp' })).toBeInTheDocument());

    // Inactive tab: icon only, name exposed via aria-label/title.
    const invoicesTab = screen.getByRole('button', { name: 'Invoices' });
    expect(invoicesTab).toHaveAttribute('title', 'Invoices');
    expect(invoicesTab).not.toHaveTextContent('Invoices');

    // Active tab (default: Contracts) shows its label next to the icon.
    expect(screen.getByRole('button', { name: 'Contracts' })).toHaveTextContent('Contracts');
  });

  it('Credit Notes tab lists the client credit notes and opens the pinned create modal', async () => {
    mockApiGet.mockImplementation((path: string) =>
      path === '/credit-notes'
        ? Promise.resolve({
            data: { data: [{ id: 7, client_id: 5, invoice_id: null, credit_note_number: 'CN-001', reason: 'billing_error', subtotal: '100.00', tax_rate: '0.16', tax_amount: '16.00', total: '116.00', currency: 'MXN', notes: null, status: 'issued', issue_date: '2026-07-01' }] },
            error: undefined,
          })
        : Promise.resolve({ data: { data: [] }, error: undefined }),
    );
    renderDetail();
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Acme Corp' })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Credit Notes' }));

    await waitFor(() => expect(screen.getByText('CN-001')).toBeInTheDocument());
    expect(screen.getByText('Billing Error')).toBeInTheDocument();
    expect(mockApiGet).toHaveBeenCalledWith(
      '/credit-notes',
      expect.objectContaining({ params: { query: expect.objectContaining({ client_id: 5 }) } }),
    );

    // Create modal opens locked to this client.
    fireEvent.click(screen.getByText('+ New Credit Note'));
    expect(await screen.findByRole('dialog', { name: 'New credit note' })).toBeInTheDocument();
    const clientSelect = screen.getByDisplayValue('Acme Corp');
    expect(clientSelect).toBeDisabled();
  });

  it('hides credit note write actions for readonly role', async () => {
    mockRole = 'readonly';
    mockApiGet.mockImplementation((path: string) =>
      path === '/credit-notes'
        ? Promise.resolve({
            data: { data: [{ id: 7, client_id: 5, invoice_id: null, credit_note_number: 'CN-001', reason: 'billing_error', subtotal: '100.00', tax_rate: '0.16', tax_amount: '16.00', total: '116.00', currency: 'MXN', notes: null, status: 'issued', issue_date: '2026-07-01' }] },
            error: undefined,
          })
        : Promise.resolve({ data: { data: [] }, error: undefined }),
    );
    renderDetail();
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Acme Corp' })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Credit Notes' }));

    await waitFor(() => expect(screen.getByText('CN-001')).toBeInTheDocument());
    expect(screen.queryByText('+ New Credit Note')).not.toBeInTheDocument();
    expect(screen.queryByText('✏️ Edit')).not.toBeInTheDocument();
  });
});
