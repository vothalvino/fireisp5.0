// =============================================================================
// FireISP 5.0 — PaymentList page tests
// =============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { PaymentList } from '../PaymentList';

// ---------------------------------------------------------------------------
// Mock API client + fetch
// ---------------------------------------------------------------------------

const mockApiGet = vi.fn();
vi.mock('@/api/client', () => ({
  api: { GET: (...args: unknown[]) => mockApiGet(...args) },
  tokenStore: { getAccess: () => 'tok', setAccess: vi.fn(), getRefresh: () => null, setRefresh: vi.fn(), clear: vi.fn() },
}));

const payment1 = {
  id: 1, client_id: 10, amount: '580', currency: 'MXN',
  payment_method: 'cash', reference: 'REF-001', status: 'completed',
  payment_date: '2024-01-15', created_at: '2024-01-15',
};

const client10 = { id: 10, name: 'Acme Corp', email: 'acme@example.com' };

function renderPaymentList() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <PaymentList />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('PaymentList page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // PaymentList uses api.GET for /payments and /clients
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/payments')
        return Promise.resolve({ data: { data: [payment1], meta: { total: 1, page: 1, limit: 20, totalPages: 1 } }, error: undefined });
      if (path === '/clients')
        return Promise.resolve({ data: { data: [client10] }, error: undefined });
      return Promise.resolve({ data: { data: [] }, error: undefined });
    });
    // fetchInvoices for open invoices in RecordPaymentForm uses raw fetch
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: [] }),
    } as Response);
  });

  it('renders the page heading', async () => {
    renderPaymentList();
    await waitFor(() => expect(screen.getByText('💳 Payments')).toBeInTheDocument());
  });

  it('renders a payment row after data loads', async () => {
    renderPaymentList();
    await waitFor(() => expect(screen.getByText('REF-001')).toBeInTheDocument());
  });

  it('renders consolidated Allocate button (with balance) in the payment row', async () => {
    renderPaymentList();
    await waitFor(() => expect(screen.getByTitle('Allocate payment to an invoice')).toBeInTheDocument());
  });

  it('renders the client name in the Client column', async () => {
    renderPaymentList();
    await waitFor(() => expect(screen.getByText('Acme Corp')).toBeInTheDocument());
  });

  it('renders the narrow numeric client ID column', async () => {
    renderPaymentList();
    await waitFor(() => expect(screen.getByText('REF-001')).toBeInTheDocument());
    // The narrow ID column should contain the raw client_id number "10".
    // It appears as a standalone cell separate from the name link.
    const cells = screen.getAllByText('10');
    expect(cells.length).toBeGreaterThanOrEqual(1);
  });

  it('downloads the receipt PDF from /pdf/payments/:id when the PDF button is clicked', async () => {
    // Serve a PDF blob for the receipt endpoint; JSON for everything else.
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation((url: string) => {
      if (String(url).includes('/pdf/payments/')) {
        return Promise.resolve({ ok: true, blob: () => Promise.resolve(new Blob(['%PDF'], { type: 'application/pdf' })) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: [] }) });
    });
    URL.createObjectURL = vi.fn(() => 'blob:fake');
    URL.revokeObjectURL = vi.fn();
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    renderPaymentList();
    await waitFor(() => expect(screen.getByText('REF-001')).toBeInTheDocument());
    fireEvent.click(screen.getByTitle('Download receipt PDF'));

    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/v1/pdf/payments/1',
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer tok' }) }),
    ));
    await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalled());
    expect(clickSpy).toHaveBeenCalled();
    clickSpy.mockRestore();
  });
});
