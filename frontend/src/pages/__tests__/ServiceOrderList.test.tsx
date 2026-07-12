// =============================================================================
// FireISP 5.0 — ServiceOrderList page tests (§1.2, simplified flow — migration 380)
// =============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { ServiceOrderList } from '../ServiceOrderList';

const mockApiGet = vi.fn();
const mockApiPost = vi.fn();
vi.mock('@/api/client', () => ({
  api: {
    GET: (...args: unknown[]) => mockApiGet(...args),
    POST: (...args: unknown[]) => mockApiPost(...args),
    PUT: vi.fn(),
    DELETE: vi.fn(),
  },
  tokenStore: { getAccess: () => 'tok', setAccess: vi.fn(), getRefresh: () => null, setRefresh: vi.fn(), clear: vi.fn() },
}));

vi.mock('@/auth/AuthContext', () => ({
  useAuth: () => ({ user: { id: 1, role: 'admin' } }),
}));

// Row shape now comes straight from the GET /service-orders LEFT JOIN handler
// (client_name/lead_name) — no separate clients lookup backs the table anymore.
const newOrder = {
  id: 10, order_number: 'SO-000010', client_id: 50, lead_id: null, plan_id: 2,
  contract_id: null, order_type: 'new_install', status: 'new', address: null, created_at: '2026-01-01',
  client_name: 'Acme Corp', lead_name: null,
};
const inProcessOrder = {
  id: 11, order_number: 'SO-000011', client_id: 51, lead_id: null, plan_id: 2,
  contract_id: 900, order_type: 'new_install', status: 'in_process', address: null, created_at: '2026-01-02',
  client_name: 'Beta LLC', lead_name: null,
};

function mockResponses(orders: unknown[] = [newOrder, inProcessOrder]) {
  mockApiGet.mockImplementation((path: string) => {
    if (path === '/clients') {
      return Promise.resolve({ data: { data: [] }, error: undefined });
    }
    if (path === '/leads') {
      return Promise.resolve({ data: { data: [] }, error: undefined });
    }
    if (path === '/plans') {
      return Promise.resolve({ data: { data: [{ id: 2, name: 'Basic 50Mbps', price: '399.00' }] }, error: undefined });
    }
    return Promise.resolve({
      data: { data: orders, meta: { total: orders.length, page: 1, limit: 25, totalPages: 1 } },
      error: undefined,
    });
  });
  mockApiPost.mockImplementation(() => Promise.resolve({ data: { data: {} }, error: undefined }));
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <ServiceOrderList />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('ServiceOrderList page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResponses();
  });

  it('renders the page heading', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('Service Orders')).toBeInTheDocument());
  });

  it('renders client_name from the JOINed response and translates the status for each order', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('Acme Corp')).toBeInTheDocument());
    expect(screen.getByText('Beta LLC')).toBeInTheDocument();
    expect(screen.getByText('New')).toBeInTheDocument();
    expect(screen.getByText('In process')).toBeInTheDocument();
  });

  it('falls back to #id and tags a lead-sourced order when client_id is null', async () => {
    mockResponses([{
      id: 12, order_number: 'SO-000012', client_id: null, lead_id: 7, plan_id: 2,
      contract_id: null, order_type: 'new_install', status: 'new', address: null, created_at: '2026-01-03',
      client_name: null, lead_name: 'Prospect Co',
    }]);
    renderPage();
    await waitFor(() => expect(screen.getByText('Prospect Co')).toBeInTheDocument());
    expect(screen.getByText('(lead)')).toBeInTheDocument();
  });

  it('shows a Start action for a new order and a Complete action for an in_process order', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('Start')).toBeInTheDocument());
    expect(screen.getByText('Complete')).toBeInTheDocument();
  });

  it('does not show a manual Link Contract action for new_install orders (auto-provisioned on Start)', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('Start')).toBeInTheDocument());
    expect(screen.queryByText('+ Link Contract')).not.toBeInTheDocument();
  });

  it('shows the empty state when there are no orders', async () => {
    mockResponses([]);
    renderPage();
    await waitFor(() => expect(screen.getByText('No service orders yet.')).toBeInTheDocument());
  });

  it('clicking Start posts to the start endpoint and shows PPPoE credentials from the response', async () => {
    mockApiPost.mockImplementation((path: string) => {
      if (path === '/service-orders/{id}/start') {
        return Promise.resolve({
          data: {
            data: {
              id: 10, status: 'in_process', contract_id: 900,
              provisioning: { pppoe: { username: 'acme01', password: 'sekret123' } },
            },
          },
          error: undefined,
        });
      }
      return Promise.resolve({ data: { data: {} }, error: undefined });
    });

    renderPage();
    await waitFor(() => expect(screen.getByText('Start')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Start'));

    await waitFor(() => expect(mockApiPost).toHaveBeenCalledWith(
      '/service-orders/{id}/start',
      expect.objectContaining({ params: { path: { id: 10 } } }),
    ));
    await waitFor(() => expect(screen.getByText('acme01')).toBeInTheDocument());
    expect(screen.getByText('sekret123')).toBeInTheDocument();
  });

  it('surfaces a Start failure instead of failing silently', async () => {
    mockApiPost.mockImplementation((path: string) => {
      if (path === '/service-orders/{id}/start') {
        return Promise.resolve({ data: undefined, error: { error: { message: 'Service order has no plan — set a plan before starting' } } });
      }
      return Promise.resolve({ data: { data: {} }, error: undefined });
    });

    renderPage();
    await waitFor(() => expect(screen.getByText('Start')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Start'));

    await waitFor(() => expect(screen.getByText(/no plan/i)).toBeInTheDocument());
  });

  it('opens the Complete dialog, gates submit on a fee for create_invoice, and shows the invoice confirmation', async () => {
    mockApiPost.mockImplementation((path: string) => {
      if (path === '/service-orders/{id}/complete') {
        return Promise.resolve({
          data: { data: { id: 11, status: 'done', invoice: { id: 5, invoice_number: 'INV-000005', total: '500.00' } } },
          error: undefined,
        });
      }
      return Promise.resolve({ data: { data: {} }, error: undefined });
    });

    renderPage();
    await waitFor(() => expect(screen.getByText('Complete')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Complete'));

    const dialog = within(await screen.findByRole('dialog', { name: /Complete Service Order/i }));
    fireEvent.click(dialog.getByText('Create installation invoice'));

    const confirmBtn = dialog.getByText('Complete').closest('button') as HTMLButtonElement;
    expect(confirmBtn).toBeDisabled();

    fireEvent.change(dialog.getByPlaceholderText('0.00'), { target: { value: '500' } });
    expect(confirmBtn).not.toBeDisabled();

    fireEvent.click(confirmBtn);

    await waitFor(() => expect(mockApiPost).toHaveBeenCalledWith(
      '/service-orders/{id}/complete',
      expect.objectContaining({
        params: { path: { id: 11 } },
        body: { billing: 'create_invoice', installation_fee: 500, description: 'Installation fee' },
      }),
    ));
    await waitFor(() => expect(screen.getByText('INV-000005')).toBeInTheDocument());
  });

  it('asks for confirmation before cancelling and does not call the API when declined', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderPage();
    await waitFor(() => expect(screen.getAllByText('Cancel').length).toBeGreaterThan(0));
    fireEvent.click(screen.getAllByText('Cancel')[0]);

    expect(confirmSpy).toHaveBeenCalled();
    expect(mockApiPost).not.toHaveBeenCalledWith('/service-orders/{id}/cancel', expect.anything());
    confirmSpy.mockRestore();
  });

  it('cancels the order when the confirmation is accepted', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    mockApiPost.mockImplementation((path: string) => {
      if (path === '/service-orders/{id}/cancel') {
        return Promise.resolve({ data: { data: { id: 10, status: 'cancelled' } }, error: undefined });
      }
      return Promise.resolve({ data: { data: {} }, error: undefined });
    });

    renderPage();
    await waitFor(() => expect(screen.getAllByText('Cancel').length).toBeGreaterThan(0));
    fireEvent.click(screen.getAllByText('Cancel')[0]);

    await waitFor(() => expect(mockApiPost).toHaveBeenCalledWith(
      '/service-orders/{id}/cancel',
      expect.objectContaining({ params: { path: { id: 10 } } }),
    ));
    confirmSpy.mockRestore();
  });
});
