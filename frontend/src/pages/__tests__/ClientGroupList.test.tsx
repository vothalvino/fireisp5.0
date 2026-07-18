// =============================================================================
// FireISP 5.0 — ClientGroupList page tests (§1.1)
// =============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { ClientGroupList } from '../ClientGroupList';

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

const group1 = {
  id: 1, name: 'Familia García', billing_mode: 'shared',
  primary_client_id: 7, notes: 'Shared home plan', created_at: '2024-01-01',
};

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <ClientGroupList />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

// Path-aware GET: list, members, billing, client picker.
function installGet() {
  mockApiGet.mockImplementation((path: string) => {
    if (path === '/client-groups')
      return Promise.resolve({ data: { data: [group1], meta: { total: 1, page: 1, limit: 200, totalPages: 1 } }, error: undefined });
    if (path === '/client-groups/{id}/members')
      return Promise.resolve({ data: { data: [
        { id: 7, name: 'Ana', email: 'ana@x.mx', phone: null, client_type: 'residential', status: 'active' },
        { id: 8, name: 'Beto', email: 'beto@x.mx', phone: null, client_type: 'residential', status: 'active' },
      ] }, error: undefined });
    if (path === '/client-groups/{id}/billing')
      return Promise.resolve({ data: { data: {
        group: { id: 1, name: 'Familia García', primary_client_id: 7 },
        members: [
          { client_id: 7, name: 'Ana', is_primary: true, balance: 100, currency: 'MXN' },
          { client_id: 8, name: 'Beto', is_primary: false, balance: 50, currency: 'MXN' },
        ],
        open_invoices: [],
        group_balance: 150, group_currency: 'MXN', payable_total: 150,
      } }, error: undefined });
    if (path === '/clients')
      return Promise.resolve({ data: { data: [{ id: 9, name: 'Carla', client_group_id: null }] }, error: undefined });
    return Promise.resolve({ data: {}, error: undefined });
  });
}

describe('ClientGroupList page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installGet();
  });

  it('renders the page heading', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('Account Groups')).toBeInTheDocument());
  });

  it('renders a group row after data loads', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('Familia García')).toBeInTheDocument());
  });

  it('shows the empty state when there are no groups', async () => {
    mockApiGet.mockResolvedValue({
      data: { data: [], meta: { total: 0, page: 1, limit: 200, totalPages: 0 } },
      error: undefined,
    });
    renderPage();
    await waitFor(() => expect(screen.getByText('No account groups yet.')).toBeInTheDocument());
  });

  async function expandGroup() {
    renderPage();
    await waitFor(() => expect(screen.getByText('Familia García')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /Members/ }));
  }

  it('expanding a shared group shows members with balances, Add members, and Pay', async () => {
    await expandGroup();
    // Members + their per-member balances (from /billing)
    await waitFor(() => expect(screen.getByText('Ana')).toBeInTheDocument());
    expect(screen.getByText('Beto')).toBeInTheDocument();
    expect(screen.getByText('MXN 100.00')).toBeInTheDocument();
    expect(screen.getByText('MXN 50.00')).toBeInTheDocument();
    // Group toolbar
    expect(screen.getByRole('button', { name: /Add members/ })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: /Pay group balance/ })).toBeInTheDocument());
    // Primary star on Ana (primary_client_id=7)
    expect(screen.getByTitle('Primary (billing owner)')).toBeInTheDocument();
  });

  it('Add members opens a client picker and posts the selected ids', async () => {
    mockApiPost.mockResolvedValue({ data: { data: { added: 1, members: [] } }, error: undefined });
    await expandGroup();
    fireEvent.click(await screen.findByRole('button', { name: /Add members/ }));

    const dialog = await screen.findByRole('dialog', { name: 'Add members' });
    // The picker searched clients and lists Carla
    const carla = await within(dialog).findByText('Carla');
    fireEvent.click(carla);
    fireEvent.click(within(dialog).getByRole('button', { name: /Add 1 member/ }));

    await waitFor(() => expect(mockApiPost).toHaveBeenCalledWith('/client-groups/{id}/members', expect.objectContaining({
      body: { client_ids: [9] },
    })));
  });

  it('Pay group balance posts the amount to the pay endpoint', async () => {
    mockApiPost.mockResolvedValue({ data: { data: { allocated_total: 150, unallocated_credit: 0, settled_invoices: [{}] } }, error: undefined });
    await expandGroup();
    fireEvent.click(await screen.findByRole('button', { name: /Pay group balance/ }));

    const dialog = await screen.findByRole('dialog', { name: 'Pay group balance' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Pay now' }));

    await waitFor(() => expect(mockApiPost).toHaveBeenCalledWith('/client-groups/{id}/pay', expect.objectContaining({
      body: expect.objectContaining({ amount: 150 }),
    })));
    await waitFor(() => expect(within(dialog).getByText(/Applied MXN 150.00/)).toBeInTheDocument());
  });

  it('the add-members picker disables clients already in the group (no double-add)', async () => {
    // /clients returns a client (id 7) who is already a member of this group.
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/client-groups')
        return Promise.resolve({ data: { data: [group1], meta: { total: 1, page: 1, limit: 200, totalPages: 1 } }, error: undefined });
      if (path === '/client-groups/{id}/members')
        return Promise.resolve({ data: { data: [{ id: 7, name: 'Ana', email: null, phone: null, client_type: 'residential', status: 'active' }] }, error: undefined });
      if (path === '/client-groups/{id}/billing')
        return Promise.resolve({ data: { data: { group: { id: 1, name: 'Familia García', primary_client_id: 7 }, members: [], open_invoices: [], group_balance: 0, group_currency: 'MXN', payable_total: 0 } }, error: undefined });
      if (path === '/clients')
        return Promise.resolve({ data: { data: [{ id: 7, name: 'Ana', client_group_id: 1 }, { id: 9, name: 'Carla', client_group_id: null }] }, error: undefined });
      return Promise.resolve({ data: {}, error: undefined });
    });
    await expandGroup();
    fireEvent.click(await screen.findByRole('button', { name: /Add members/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Add members' });

    // Ana (already a member) is shown but her checkbox is disabled.
    await within(dialog).findByText('Ana');
    const checkboxes = within(dialog).getAllByRole('checkbox');
    // The already-member checkbox is disabled; the other is enabled.
    expect(checkboxes.some(c => (c as HTMLInputElement).disabled)).toBe(true);
    expect(within(dialog).getByText('already in this group')).toBeInTheDocument();
  });

  it('primary is chosen by client search in the group form (not a raw id)', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('Familia García')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: '+ New Group' }));

    const dialog = await screen.findByRole('dialog', { name: 'New Account Group' });
    // No numeric id input for the primary; it's a search box.
    const search = within(dialog).getByPlaceholderText(/Search for the billing owner/);
    fireEvent.focus(search);
    fireEvent.change(search, { target: { value: 'Car' } });
    // The search dropdown offers Carla to pick.
    await waitFor(() => expect(within(dialog).getByText(/Carla/)).toBeInTheDocument());
  });
});
