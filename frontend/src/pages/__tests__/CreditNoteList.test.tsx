// =============================================================================
// FireISP 5.0 — CreditNoteList page tests
// =============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { CreditNoteList, CreditNoteModal, splitCreditAmount } from '../CreditNoteList';

const mockApiGet = vi.fn();
const mockApiPost = vi.fn();
const mockAuthedFetch = vi.fn();
vi.mock('@/auth/useOrgCurrency', () => ({ useOrgCurrency: () => 'MXN' }));
vi.mock('@/auth/AuthContext', () => ({
  useAuth: () => ({ user: { id: 1, email: 'a@b.c', organization_locale: 'MX' } }),
}));

vi.mock('@/api/client', () => ({
  api: {
    GET: (...args: unknown[]) => mockApiGet(...args),
    POST: (...args: unknown[]) => mockApiPost(...args),
  },
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

  it('replaces Stamp with a link to the CFDI once one exists (j6)', async () => {
    // The list now carries the note's live-CFDI state. Before it did, the
    // button kept rendering on a stamped note and the click came back 409.
    const stamped = {
      ...note1, id: 4, credit_note_number: 'CN-000004', status: 'issued',
      cfdi_document_id: 31, cfdi_uuid: 'AAAA-BBBB', cfdi_sat_status: 'vigente',
    };
    const unstamped = {
      ...note1, id: 5, credit_note_number: 'CN-000005', status: 'issued',
      cfdi_document_id: null, cfdi_uuid: null, cfdi_sat_status: null,
    };
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/credit-notes')
        return Promise.resolve({ data: { data: [stamped, unstamped], meta: { total: 2, page: 1, limit: 25, totalPages: 1 } }, error: undefined });
      if (path === '/clients')
        return Promise.resolve({ data: { data: [client1] }, error: undefined });
      return Promise.resolve({ data: { data: [] }, error: undefined });
    });
    renderCreditNoteList();
    await waitFor(() => expect(screen.getByText('CN-000004')).toBeInTheDocument());
    // Only the UNSTAMPED row still offers a stamp.
    expect(screen.getAllByText('🧾 Stamp CFDI')).toHaveLength(1);
    expect(screen.getByText('🧾 View CFDI')).toBeInTheDocument();
  });

  it('labels a draft CFDI as a draft — it is live, so no re-stamp (j6)', async () => {
    const draft = {
      ...note1, id: 6, credit_note_number: 'CN-000006', status: 'issued',
      cfdi_document_id: 32, cfdi_uuid: null, cfdi_sat_status: 'draft',
    };
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/credit-notes')
        return Promise.resolve({ data: { data: [draft], meta: { total: 1, page: 1, limit: 25, totalPages: 1 } }, error: undefined });
      if (path === '/clients')
        return Promise.resolve({ data: { data: [client1] }, error: undefined });
      return Promise.resolve({ data: { data: [] }, error: undefined });
    });
    renderCreditNoteList();
    await waitFor(() => expect(screen.getByText('CN-000006')).toBeInTheDocument());
    expect(screen.getByText('🧾 CFDI draft')).toBeInTheDocument();
    expect(screen.queryByText('🧾 Stamp CFDI')).not.toBeInTheDocument();
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

  it('surfaces the backend totals-consistency 422 message in the create modal', async () => {
    mockApiPost.mockResolvedValue({
      data: undefined,
      error: { error: { code: 'CREDIT_NOTE_TOTALS_INCONSISTENT', message: 'Credit note amounts are inconsistent: subtotal (100.00) + tax (16.00) must equal total (300.00).' } },
    });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <CreditNoteModal creditNote={null} clients={[client1]} onClose={() => {}} onSaved={() => {}} />
        </MemoryRouter>
      </QueryClientProvider>
    );
    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: '10' } }); // Client select
    fireEvent.click(screen.getByText('Create Credit Note'));
    await waitFor(() => expect(screen.getByText(/must equal total \(300\.00\)/)).toBeInTheDocument());
  });

  it('prefills the amounts from the credited invoice (j44)', async () => {
    // The amounts used to start EMPTY and be hand-typed — which is exactly how
    // a zero-tax credit note got made against a 16%-IVA invoice. Since #558 the
    // backend rejects that, so an unprefilled form invites the mistake and then
    // 422s with no indication of what was expected.
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/invoices/{id}')
        return Promise.resolve({
          data: { data: { id: 5, invoice_number: 'INV-000005', subtotal: '1000.00', tax_rate: '0.16', tax_amount: '160.00', total: '1160.00', currency: 'MXN', client_id: 10 } },
          error: undefined,
        });
      return Promise.resolve({ data: { data: [] }, error: undefined });
    });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <CreditNoteModal creditNote={null} clients={[client1]} onClose={() => {}} onSaved={() => {}} />
        </MemoryRouter>
      </QueryClientProvider>
    );
    fireEvent.change(screen.getByPlaceholderText('link to an invoice'), { target: { value: '5' } });
    await waitFor(() => expect(screen.getByText(/Crediting INV-000005/)).toBeInTheDocument());

    fireEvent.click(screen.getByText('Credit the full amount'));
    // The invoice's OWN figures, not a recomputation at today's rate.
    expect((screen.getByLabelText(/Subtotal/i) as HTMLInputElement).value).toBe('1000.00');
    expect((screen.getByLabelText(/Tax Amount/i) as HTMLInputElement).value).toBe('160.00');
    expect((screen.getByLabelText(/^Total/i) as HTMLInputElement).value).toBe('1160.00');
  });

  it('splits a PARTIAL credit at the invoice rate (j44)', async () => {
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/invoices/{id}')
        return Promise.resolve({
          data: { data: { id: 5, invoice_number: 'INV-000005', subtotal: '1000.00', tax_rate: '0.16', tax_amount: '160.00', total: '1160.00', currency: 'MXN', client_id: 10 } },
          error: undefined,
        });
      return Promise.resolve({ data: { data: [] }, error: undefined });
    });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <CreditNoteModal creditNote={null} clients={[client1]} onClose={() => {}} onSaved={() => {}} />
        </MemoryRouter>
      </QueryClientProvider>
    );
    fireEvent.change(screen.getByPlaceholderText('link to an invoice'), { target: { value: '5' } });
    await waitFor(() => expect(screen.getByText(/Crediting INV-000005/)).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText('Partial credit amount'), { target: { value: '580' } });
    fireEvent.click(screen.getByText('Credit part of it'));
    expect((screen.getByLabelText(/Subtotal/i) as HTMLInputElement).value).toBe('500.00');
    expect((screen.getByLabelText(/Tax Amount/i) as HTMLInputElement).value).toBe('80.00');
    expect((screen.getByLabelText(/^Total/i) as HTMLInputElement).value).toBe('580.00');
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

// ---------------------------------------------------------------------------
// splitCreditAmount — the arithmetic the operator no longer does by hand.
// ---------------------------------------------------------------------------

describe('splitCreditAmount', () => {
  it('treats the amount as tax-INCLUSIVE', () => {
    // Crediting a 1160 invoice in full is 1160, not 1000 — the tax comes OUT
    // of the amount the client gets back.
    expect(splitCreditAmount(1160, 0.16)).toEqual({ subtotal: 1000, tax: 160, total: 1160, rate: 0.16 });
  });

  it('always sums exactly, even when the split does not divide cleanly', () => {
    // 100 at 16% is 86.2068…; the backend rejects subtotal + tax !== total
    // (#530), so the pair must be derived from each other, not independently.
    const s = splitCreditAmount(100, 0.16);
    expect(Number((s.subtotal + s.tax).toFixed(2))).toBe(100);
    expect(s).toEqual({ subtotal: 86.21, tax: 13.79, total: 100, rate: 0.16 });
  });

  it('handles the 8% frontera rate', () => {
    expect(splitCreditAmount(1080, 0.08)).toEqual({ subtotal: 1000, tax: 80, total: 1080, rate: 0.08 });
  });

  it('leaves an untaxed credit entirely as subtotal', () => {
    expect(splitCreditAmount(500, 0)).toEqual({ subtotal: 500, tax: 0, total: 500, rate: 0 });
  });

  it('tolerates a rate typed as a percent', () => {
    // invoices.tax_rate is a fraction, but a hand-edited 16 must not produce a
    // 1600% split.
    expect(splitCreditAmount(1160, 16)).toEqual({ subtotal: 1000, tax: 160, total: 1160, rate: 0.16 });
  });

  it('sums exactly for EVERY amount and rate, not just the round ones', () => {
    // A single hand-picked example cannot distinguish "derived from the tax"
    // from "each rounded independently" — at 16% and 8% those agree for every
    // amount up to 20,000. They diverge at other rates (12% on 0.14), so the
    // invariant is swept rather than sampled: this is what actually holds the
    // construction in place, since the backend 422s an inconsistent triple.
    const rates = [0, 0.08, 0.12, 0.16, 0.19, 0.21];
    for (const rate of rates) {
      for (let cents = 1; cents <= 5000; cents++) {
        const gross = cents / 100;
        const s = splitCreditAmount(gross, rate);
        expect(Number((s.subtotal + s.tax).toFixed(2))).toBe(s.total);
      }
    }
  });
});
