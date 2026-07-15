// =============================================================================
// FireISP 5.0 — PurchaseOrderList page tests (§14.2 — Inventory Phase 1)
// =============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { PurchaseOrderList } from '../PurchaseOrderList';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

const mockApiGet = vi.fn();
const mockApiPost = vi.fn();
const mockApiDelete = vi.fn();
vi.mock('@/api/client', () => ({
  api: {
    GET: (...a: unknown[]) => mockApiGet(...a),
    POST: (...a: unknown[]) => mockApiPost(...a),
    DELETE: (...a: unknown[]) => mockApiDelete(...a),
  },
  tokenStore: { getAccess: () => 'tok', setAccess: vi.fn(), getRefresh: () => null, setRefresh: vi.fn(), clear: vi.fn() },
}));

const vendor1 = { id: 1, name: 'Ubiquiti Networks', status: 'active' };
const warehouse1 = { id: 5, name: 'Main Warehouse', status: 'active' };
const po1 = {
  id: 1, vendor_id: 1, warehouse_id: 5, po_number: 'PO-2026-0001', status: 'draft',
  order_date: '2026-01-01', expected_date: null, received_date: null,
  subtotal: '0.00', tax_amount: '0.00', total: '0.00', currency: 'MXN',
};

function renderList() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <PurchaseOrderList />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockApiGet.mockImplementation((path: string) => {
    if (path === '/purchase-orders')
      return Promise.resolve({ data: { data: [po1], meta: { total: 1, page: 1, limit: 25, totalPages: 1 } }, error: undefined });
    if (path === '/vendors')
      return Promise.resolve({ data: { data: [vendor1] }, error: undefined });
    if (path === '/warehouses')
      return Promise.resolve({ data: { data: [warehouse1] }, error: undefined });
    return Promise.resolve({ data: { data: [] }, error: undefined });
  });
});

describe('PurchaseOrderList page', () => {
  it('renders the page heading and a PO row with resolved vendor/warehouse names', async () => {
    renderList();
    await waitFor(() => expect(screen.getByText('📑 Purchase Orders')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText('PO-2026-0001')).toBeInTheDocument());
    expect(screen.getByText('Ubiquiti Networks')).toBeInTheDocument();
    expect(screen.getByText('Main Warehouse')).toBeInTheDocument();
  });

  it('the PO number links to the PO detail page', async () => {
    renderList();
    await waitFor(() => expect(screen.getByText('PO-2026-0001')).toBeInTheDocument());
    const link = screen.getByText('PO-2026-0001').closest('a');
    expect(link).toHaveAttribute('href', '/purchase-orders/1');
  });

  it('shows empty message when no purchase orders', async () => {
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/purchase-orders')
        return Promise.resolve({ data: { data: [], meta: { total: 0, page: 1, limit: 25, totalPages: 0 } }, error: undefined });
      return Promise.resolve({ data: { data: [] }, error: undefined });
    });
    renderList();
    await waitFor(() => expect(screen.getByText(/No purchase orders found/)).toBeInTheDocument());
  });

  it('New Purchase Order opens the create modal, submits, and navigates to the detail page', async () => {
    mockApiPost.mockResolvedValue({ data: { data: { ...po1, id: 9, po_number: 'PO-NEW' } }, error: undefined });
    renderList();
    await waitFor(() => expect(screen.getByText('📑 Purchase Orders')).toBeInTheDocument());

    fireEvent.click(screen.getByText('+ New Purchase Order'));
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'New Purchase Order' })).toBeInTheDocument());

    await screen.findByText('Ubiquiti Networks', { selector: 'option' });
    fireEvent.change(screen.getByText('— select vendor —').closest('select')!, { target: { value: '1' } });
    fireEvent.change(screen.getByText('— select warehouse —').closest('select')!, { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Purchase Order' }));

    await waitFor(() => expect(mockApiPost).toHaveBeenCalledWith(
      '/purchase-orders',
      expect.objectContaining({
        body: expect.objectContaining({ vendor_id: 1, warehouse_id: 5 }),
      }),
    ));
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/purchase-orders/9'));
  });

  it('a draft PO can be deleted', async () => {
    mockApiDelete.mockResolvedValue({ data: undefined, error: undefined });
    renderList();
    await waitFor(() => expect(screen.getByText('PO-2026-0001')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Delete'));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(dialog.querySelector('button:last-child')!);

    await waitFor(() => expect(mockApiDelete).toHaveBeenCalledWith(
      '/purchase-orders/{id}',
      expect.objectContaining({ params: { path: { id: 1 } } }),
    ));
  });

  it('does not show a Delete action for a non-draft PO', async () => {
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/purchase-orders')
        return Promise.resolve({ data: { data: [{ ...po1, status: 'received' }], meta: { total: 1, page: 1, limit: 25, totalPages: 1 } }, error: undefined });
      if (path === '/vendors') return Promise.resolve({ data: { data: [vendor1] }, error: undefined });
      if (path === '/warehouses') return Promise.resolve({ data: { data: [warehouse1] }, error: undefined });
      return Promise.resolve({ data: { data: [] }, error: undefined });
    });
    renderList();
    await waitFor(() => expect(screen.getByText('PO-2026-0001')).toBeInTheDocument());
    expect(screen.queryByText('Delete')).not.toBeInTheDocument();
  });
});
