// =============================================================================
// FireISP 5.0 — CreditNoteList page tests
// =============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { CreditNoteList } from '../CreditNoteList';

const mockApiGet = vi.fn();
vi.mock('@/auth/useOrgCurrency', () => ({ useOrgCurrency: () => 'MXN' }));

vi.mock('@/api/client', () => ({
  api: { GET: (...args: unknown[]) => mockApiGet(...args) },
  tokenStore: { getAccess: () => 'tok', setAccess: vi.fn(), getRefresh: () => null, setRefresh: vi.fn(), clear: vi.fn() },
}));

const note1 = {
  id: 1, client_id: 10, invoice_id: 5, credit_note_number: 'CN-000001',
  reason: 'billing_error', subtotal: '50.00', tax_rate: '0.16',
  tax_amount: '8.00', total: '58.00', currency: 'MXN', notes: null, status: 'draft',
};
const client1 = { id: 10, name: 'María García' };

function renderCreditNoteList() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <CreditNoteList />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('CreditNoteList page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/credit-notes')
        return Promise.resolve({ data: { data: [note1], meta: { total: 1, page: 1, limit: 25, totalPages: 1 } }, error: undefined });
      if (path === '/clients')
        return Promise.resolve({ data: { data: [client1] }, error: undefined });
      return Promise.resolve({ data: { data: [] }, error: undefined });
    });
  });

  it('renders the page heading', async () => {
    renderCreditNoteList();
    await waitFor(() => expect(screen.getByText('🧾 Credit Notes')).toBeInTheDocument());
  });

  it('renders a credit note row with humanized reason', async () => {
    renderCreditNoteList();
    await waitFor(() => expect(screen.getByText('CN-000001')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText('Billing Error')).toBeInTheDocument());
  });

  it('shows empty message when no credit notes', async () => {
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/credit-notes')
        return Promise.resolve({ data: { data: [], meta: { total: 0, page: 1, limit: 25, totalPages: 0 } }, error: undefined });
      return Promise.resolve({ data: { data: [] }, error: undefined });
    });
    renderCreditNoteList();
    await waitFor(() => expect(screen.getByText(/No credit notes found/)).toBeInTheDocument());
  });
});
