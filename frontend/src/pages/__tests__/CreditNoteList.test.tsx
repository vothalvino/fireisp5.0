// =============================================================================
// FireISP 5.0 — CreditNoteList page tests
// =============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { CreditNoteList } from '../CreditNoteList';

const mockApiGet = vi.fn();
const mockAuthedFetch = vi.fn();
vi.mock('@/auth/useOrgCurrency', () => ({ useOrgCurrency: () => 'MXN' }));
vi.mock('@/auth/AuthContext', () => ({
  useAuth: () => ({ user: { id: 1, email: 'a@b.c', organization_locale: 'MX' } }),
}));

vi.mock('@/api/client', () => ({
  api: { GET: (...args: unknown[]) => mockApiGet(...args) },
  authedFetch: (...args: unknown[]) => mockAuthedFetch(...args),
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

  it('shows Stamp CFDI only for issued/applied notes linked to an invoice (MX org)', async () => {
    const issued = { ...note1, id: 2, credit_note_number: 'CN-000002', status: 'issued' };
    const unlinked = { ...note1, id: 3, credit_note_number: 'CN-000003', status: 'issued', invoice_id: null };
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/credit-notes')
        return Promise.resolve({ data: { data: [note1, issued, unlinked], meta: { total: 3, page: 1, limit: 25, totalPages: 1 } }, error: undefined });
      if (path === '/clients')
        return Promise.resolve({ data: { data: [client1] }, error: undefined });
      return Promise.resolve({ data: { data: [] }, error: undefined });
    });
    renderCreditNoteList();
    await waitFor(() => expect(screen.getByText('CN-000002')).toBeInTheDocument());
    // note1 is draft, unlinked has no invoice → exactly ONE stamp button (the issued+linked row)
    expect(screen.getAllByText('🧾 Stamp CFDI')).toHaveLength(1);
  });

  it('stamps via POST /credit-notes/:id/stamp after confirmation and reports the UUID', async () => {
    const issued = { ...note1, id: 2, credit_note_number: 'CN-000002', status: 'issued' };
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/credit-notes')
        return Promise.resolve({ data: { data: [issued], meta: { total: 1, page: 1, limit: 25, totalPages: 1 } }, error: undefined });
      if (path === '/clients')
        return Promise.resolve({ data: { data: [client1] }, error: undefined });
      return Promise.resolve({ data: { data: [] }, error: undefined });
    });
    mockAuthedFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ data: { cfdi_document_id: 950, uuid: 'AAAA-1111', sat_status: 'vigente', stamped: true } }),
    });
    renderCreditNoteList();
    await waitFor(() => expect(screen.getByText('🧾 Stamp CFDI')).toBeInTheDocument());
    screen.getByText('🧾 Stamp CFDI').click();
    await waitFor(() => expect(screen.getByText('Yes, confirm')).toBeInTheDocument());
    screen.getByText('Yes, confirm').click();
    await waitFor(() => expect(mockAuthedFetch).toHaveBeenCalledWith(
      '/api/v1/credit-notes/2/stamp',
      expect.objectContaining({ method: 'POST' }),
    ));
    await waitFor(() => expect(screen.getByText(/UUID AAAA-1111/)).toBeInTheDocument());
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
