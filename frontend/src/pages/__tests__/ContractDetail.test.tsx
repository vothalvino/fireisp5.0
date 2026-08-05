// =============================================================================
// FireISP 5.0 — ContractDetail PPPoE tab tests
// =============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { ContractDetail } from '../ContractDetail';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockGql = vi.fn();
vi.mock('@/api/graphql', () => ({ gql: (...a: unknown[]) => mockGql(...a) }));

const mockApiGet = vi.fn();
vi.mock('@/api/client', () => ({
  api: { GET: (...a: unknown[]) => mockApiGet(...a), POST: vi.fn(), PUT: vi.fn(), DELETE: vi.fn() },
  tokenStore: { getAccess: () => 'tok', setAccess: vi.fn(), getRefresh: () => null, setRefresh: vi.fn(), clear: vi.fn() },
  authedFetch: vi.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(input, init)),
}));

let mockRole = 'admin';
vi.mock('@/auth/AuthContext', () => ({ useAuth: () => ({ user: { id: 1, role: mockRole } }) }));

function makeContract(connectionType: string) {
  return {
    id: '5', clientId: '3', planId: '2', connectionType,
    startDate: '2024-01-01', endDate: null, billingDay: 1, status: 'active',
    ipAddress: null, priceOverride: null, notes: null, createdAt: '2024-01-01',
    client: { id: '3', name: 'Acme Corp', status: 'active' },
    invoices: [], devices: [], addons: [],
  };
}

const radiusAccount = { id: 99, username: 'sub_ada', password: 'topsecret', status: 'active' };

beforeEach(() => {
  vi.clearAllMocks();
  mockRole = 'admin';
  mockGql.mockResolvedValue({ contract: makeContract('pppoe') });
  mockApiGet.mockResolvedValue({ data: { data: [radiusAccount] }, error: undefined });
  global.fetch = vi.fn();
});

function renderDetail() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/contracts/5']}>
        <Routes>
          <Route path="/contracts/:id" element={<ContractDetail />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ContractDetail — PPPoE credentials', () => {
  it('shows a PPPoE tab for a PPPoE contract and reveals the credentials', async () => {
    renderDetail();
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Contract #5' })).toBeInTheDocument());

    const pppoeTab = screen.getByRole('button', { name: 'PPPoE' });
    fireEvent.click(pppoeTab);

    // Username shown immediately (base, password-free fetch); the password
    // comes from a second, separately-gated /credentials fetch and is masked
    // until revealed — wait for it (findByRole) rather than assuming it has
    // already resolved by the time the base account renders.
    await waitFor(() => expect(screen.getByText('sub_ada')).toBeInTheDocument());
    expect(screen.queryByText('topsecret')).not.toBeInTheDocument();

    const showBtn = await screen.findByRole('button', { name: 'Show' });
    fireEvent.click(showBtn);
    expect(screen.getByText('topsecret')).toBeInTheDocument();
  });

  it('shows an insufficient-permission note in place of the password when the credentials fetch 403s', async () => {
    mockApiGet.mockImplementation((path: unknown) => {
      if (typeof path === 'string' && path.includes('/credentials')) {
        return Promise.resolve({
          data: undefined,
          error: { error: { code: 'FORBIDDEN' } },
          response: { status: 403 },
        });
      }
      return Promise.resolve({ data: { data: [radiusAccount] }, error: undefined });
    });

    renderDetail();
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Contract #5' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'PPPoE' }));

    // Username still visible (base fetch only needs devices.view).
    await waitFor(() => expect(screen.getByText('sub_ada')).toBeInTheDocument());
    // Password never rendered, replaced by the permission note instead.
    expect(screen.queryByText('topsecret')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Show' })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/Insufficient permission to view the password/)).toBeInTheDocument());
  });

  it('asks for confirmation before regenerating, then displays the new value', async () => {
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ data: { username: 'sub_ada', password: 'rotated-xyz' }, pushed: false }),
    });

    renderDetail();
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Contract #5' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'PPPoE' }));
    await waitFor(() => expect(screen.getByText('sub_ada')).toBeInTheDocument());

    // Clicking the trigger opens a confirm dialog and does NOT call the API yet.
    fireEvent.click(screen.getByRole('button', { name: 'Regenerate password' }));
    const dialog = await screen.findByRole('dialog');
    expect(global.fetch).not.toHaveBeenCalled();

    // Confirm inside the dialog → API called, new password shown.
    fireEvent.click(within(dialog).getByRole('button', { name: 'Regenerate password' }));
    await waitFor(() => expect(screen.getByText('rotated-xyz')).toBeInTheDocument());
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/v1/contracts/5/regenerate-pppoe',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('cancelling the confirm dialog does not regenerate', async () => {
    renderDetail();
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Contract #5' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'PPPoE' }));
    await waitFor(() => expect(screen.getByText('sub_ada')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Regenerate password' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('does not show a PPPoE tab for a non-PPPoE contract', async () => {
    mockGql.mockResolvedValue({ contract: makeContract('ipoe') });
    renderDetail();
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Contract #5' })).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'PPPoE' })).not.toBeInTheDocument();
  });
});

// =============================================================================
// Devices tab — installed equipment (cpe_devices) + New device modal
// =============================================================================
const INSTALLED_UNIT = {
  id: 7, serial_number: 'RGEW-GUI-0001', manufacturer: 'Ruijie', product_class: 'RG-EW1300G',
  ownership: 'rented', lifecycle_state: 'assigned', last_inform_at: '2026-08-04T23:28:36.000Z',
  item_name: 'RGEW1300G', item_sku: 'RGEW-1300G',
};

function mockGetByPath({ equipment = [INSTALLED_UNIT], equipmentError = false } = {}) {
  mockApiGet.mockImplementation((path: string) => {
    if (path === '/cpe-management/devices') {
      return equipmentError
        ? Promise.resolve({ data: undefined, error: { error: { message: 'forbidden' } } })
        : Promise.resolve({ data: { data: equipment, meta: { total: equipment.length } }, error: undefined });
    }
    return Promise.resolve({ data: { data: [radiusAccount] }, error: undefined });
  });
}

describe('ContractDetail — Devices tab equipment + creation', () => {
  it('shows the installed equipment that flowed in from the install/TR-069 path', async () => {
    mockGetByPath();
    renderDetail();
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Contract #5' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Devices' }));

    expect(await screen.findByText('RGEW-GUI-0001')).toBeInTheDocument();
    expect(screen.getByText('RGEW1300G (RGEW-1300G)')).toBeInTheDocument();
    expect(screen.getByText('Ruijie / RG-EW1300G')).toBeInTheDocument();
    expect(screen.getByText('Installed equipment')).toBeInTheDocument();
  });

  it('hides the equipment section quietly when the caller may not view cpe devices', async () => {
    mockGetByPath({ equipmentError: true });
    renderDetail();
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Contract #5' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Devices' }));

    await waitFor(() => expect(screen.getByText('Network devices')).toBeInTheDocument());
    // The query settles into its error state asynchronously — wait for the
    // section to withdraw rather than sampling mid-flight.
    await waitFor(() => expect(screen.queryByText('Installed equipment')).not.toBeInTheDocument());
  });

  it('explains the empty equipment state instead of showing nothing', async () => {
    mockGetByPath({ equipment: [] });
    renderDetail();
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Contract #5' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Devices' }));
    expect(await screen.findByText(/appear here automatically/)).toBeInTheDocument();
  });

  it('creates a device pre-linked to the contract and its client from the New device modal', async () => {
    mockGetByPath();
    const { api } = await import('@/api/client');
    (api.POST as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { data: { id: 42 } }, error: undefined });

    renderDetail();
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Contract #5' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Devices' }));

    fireEvent.click(await screen.findByRole('button', { name: '+ New network device' }));
    const dialog = await screen.findByRole('dialog', { name: 'New device' });
    fireEvent.change(within(dialog).getByLabelText('Name *'), { target: { value: 'RGEW1300G — sala' } });
    fireEvent.change(within(dialog).getByLabelText('MAC address'), { target: { value: 'AA:BB:CC:DD:EE:FF' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create device' }));

    await waitFor(() => expect(api.POST).toHaveBeenCalledWith('/devices', expect.objectContaining({
      body: expect.objectContaining({
        name: 'RGEW1300G — sala',
        type: 'indoor_cpe',
        contract_id: 5,
        client_id: 3,
        mac_address: 'AA:BB:CC:DD:EE:FF',
      }),
    })));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'New device' })).not.toBeInTheDocument());
  });

  it('hides the New device button from a role without devices.create', async () => {
    mockRole = 'billing';
    mockGetByPath();
    renderDetail();
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Contract #5' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Devices' }));
    await screen.findByText('Installed equipment');
    expect(screen.queryByRole('button', { name: '+ New network device' })).not.toBeInTheDocument();
  });
});

// =============================================================================
// Install equipment — the inventory-connected path on the contract page
// =============================================================================
describe('ContractDetail — Install equipment from inventory', () => {
  function mockInventoryPaths() {
    mockApiGet.mockImplementation((path: string, opts?: { params?: { query?: Record<string, unknown> } }) => {
      if (path === '/inventory/items') {
        return Promise.resolve({ data: { data: [{ id: 1, name: 'RGEW1300G', sku: 'RGEW-1300G' }] }, error: undefined });
      }
      if (path === '/cpe-management/devices') {
        const q = opts?.params?.query ?? {};
        if (q.lifecycle_state === 'in_stock') {
          return Promise.resolve({ data: { data: [{ id: 91, serial_number: 'RGEW-STOCK-7' }] }, error: undefined });
        }
        return Promise.resolve({ data: { data: [], meta: { total: 0 } }, error: undefined });
      }
      return Promise.resolve({ data: { data: [radiusAccount] }, error: undefined });
    });
  }

  it('installs an in-stock serial against the contract through the inventory endpoint', async () => {
    mockInventoryPaths();
    const { api } = await import('@/api/client');
    (api.POST as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { data: {} }, error: undefined });

    renderDetail();
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Contract #5' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Devices' }));

    fireEvent.click(await screen.findByRole('button', { name: '+ Install equipment' }));
    const dialog = await screen.findByRole('dialog', { name: 'Install equipment' });

    // The catalog resolves asynchronously — changing the select before its
    // option exists is a no-op that leaves itemId empty.
    await within(dialog).findByRole('option', { name: /RGEW1300G/ });
    fireEvent.change(within(dialog).getByLabelText('Product'), { target: { value: '1' } });
    await waitFor(() => expect(within(dialog).getByText('RGEW-STOCK-7')).toBeInTheDocument());
    fireEvent.change(within(dialog).getByLabelText('Serial'), { target: { value: '91' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Install equipment' }));

    await waitFor(() => expect(api.POST).toHaveBeenCalledWith('/cpe-management/devices/install', expect.objectContaining({
      body: expect.objectContaining({ contract_id: 5, cpe_device_id: 91, ownership: 'rented' }),
    })));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Install equipment' })).not.toBeInTheDocument());
  });

  it('typed-new-serial mode sends new_serial + inventory_item_id and honors sold ownership', async () => {
    mockInventoryPaths();
    const { api } = await import('@/api/client');
    (api.POST as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { data: {} }, error: undefined });

    renderDetail();
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Contract #5' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Devices' }));
    fireEvent.click(await screen.findByRole('button', { name: '+ Install equipment' }));
    const dialog = await screen.findByRole('dialog', { name: 'Install equipment' });

    await within(dialog).findByRole('option', { name: /RGEW1300G/ });
    fireEvent.change(within(dialog).getByLabelText('Product'), { target: { value: '1' } });
    fireEvent.click(within(dialog).getByLabelText('Type a new serial'));
    fireEvent.change(within(dialog).getByLabelText('New serial number'), { target: { value: 'RGEW-NEW-42' } });
    fireEvent.click(within(dialog).getByLabelText('Sold (raises an invoice)'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Install equipment' }));

    await waitFor(() => expect(api.POST).toHaveBeenCalledWith('/cpe-management/devices/install', expect.objectContaining({
      body: expect.objectContaining({ contract_id: 5, new_serial: 'RGEW-NEW-42', inventory_item_id: 1, ownership: 'sold' }),
    })));
  });

  it('refuses to submit without a serial instead of posting a half-formed install', async () => {
    mockInventoryPaths();
    const { api } = await import('@/api/client');
    (api.POST as ReturnType<typeof vi.fn>).mockClear();

    renderDetail();
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Contract #5' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Devices' }));
    fireEvent.click(await screen.findByRole('button', { name: '+ Install equipment' }));
    const dialog = await screen.findByRole('dialog', { name: 'Install equipment' });

    fireEvent.click(within(dialog).getByRole('button', { name: 'Install equipment' }));
    expect(await within(dialog).findByText('Select a serial.')).toBeInTheDocument();
    expect(api.POST).not.toHaveBeenCalled();
  });
});
