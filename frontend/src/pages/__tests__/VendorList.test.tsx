// =============================================================================
// FireISP 5.0 — VendorList page tests (§14.2 — Inventory Phase 1)
// =============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { VendorList } from '../VendorList';

const mockApiGet = vi.fn();
const mockApiPost = vi.fn();
const mockApiPut = vi.fn();
const mockApiDelete = vi.fn();
vi.mock('@/api/client', () => ({
  api: {
    GET: (...a: unknown[]) => mockApiGet(...a),
    POST: (...a: unknown[]) => mockApiPost(...a),
    PUT: (...a: unknown[]) => mockApiPut(...a),
    DELETE: (...a: unknown[]) => mockApiDelete(...a),
  },
  tokenStore: { getAccess: () => 'tok', setAccess: vi.fn(), getRefresh: () => null, setRefresh: vi.fn(), clear: vi.fn() },
}));

const vendor1 = {
  id: 1, name: 'Ubiquiti Networks', contact_name: 'Sales', email: 'sales@ubnt.com',
  phone: '555-0100', website: null, address: null, tax_id: null,
  payment_terms: 'Net 30', currency: 'MXN', notes: null, status: 'active',
};

function renderVendorList() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <VendorList />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockApiGet.mockImplementation((path: string) => {
    if (path === '/vendors')
      return Promise.resolve({ data: { data: [vendor1], meta: { total: 1, page: 1, limit: 25, totalPages: 1 } }, error: undefined });
    return Promise.resolve({ data: { data: [] }, error: undefined });
  });
});

describe('VendorList page', () => {
  it('renders the page heading and a vendor row', async () => {
    renderVendorList();
    await waitFor(() => expect(screen.getByText('🏬 Vendors')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText('Ubiquiti Networks')).toBeInTheDocument());
    expect(screen.getByText('sales@ubnt.com')).toBeInTheDocument();
    expect(screen.getByText('Net 30')).toBeInTheDocument();
  });

  it('shows empty message when no vendors', async () => {
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/vendors')
        return Promise.resolve({ data: { data: [], meta: { total: 0, page: 1, limit: 25, totalPages: 0 } }, error: undefined });
      return Promise.resolve({ data: { data: [] }, error: undefined });
    });
    renderVendorList();
    await waitFor(() => expect(screen.getByText(/No vendors found/)).toBeInTheDocument());
  });

  it('New Vendor opens the create modal, submits, and POSTs to /vendors', async () => {
    mockApiPost.mockResolvedValue({ data: { data: { ...vendor1, id: 2, name: 'MikroTik' } }, error: undefined });
    renderVendorList();
    await waitFor(() => expect(screen.getByText('🏬 Vendors')).toBeInTheDocument());

    fireEvent.click(screen.getByText('+ New Vendor'));
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'New Vendor' })).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: 'MikroTik' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Vendor' }));

    await waitFor(() => expect(mockApiPost).toHaveBeenCalledWith(
      '/vendors',
      expect.objectContaining({ body: expect.objectContaining({ name: 'MikroTik', status: 'active' }) }),
    ));
  });

  it('Edit opens the modal pre-filled and PUTs the update', async () => {
    mockApiPut.mockResolvedValue({ data: { data: { ...vendor1, name: 'Ubiquiti Updated' } }, error: undefined });
    renderVendorList();
    await waitFor(() => expect(screen.getByText('Ubiquiti Networks')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Edit'));
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Edit Vendor' })).toBeInTheDocument());
    expect(screen.getByDisplayValue('Ubiquiti Networks')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: 'Ubiquiti Updated' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

    await waitFor(() => expect(mockApiPut).toHaveBeenCalledWith(
      '/vendors/{id}',
      expect.objectContaining({
        params: { path: { id: 1 } },
        body: expect.objectContaining({ name: 'Ubiquiti Updated' }),
      }),
    ));
  });

  it('Delete asks for confirmation then DELETEs the vendor', async () => {
    mockApiDelete.mockResolvedValue({ data: undefined, error: undefined });
    renderVendorList();
    await waitFor(() => expect(screen.getByText('Ubiquiti Networks')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Delete'));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(mockApiDelete).toHaveBeenCalledWith(
      '/vendors/{id}',
      expect.objectContaining({ params: { path: { id: 1 } } }),
    ));
  });
});
