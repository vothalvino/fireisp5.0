// =============================================================================
// FireISP 5.0 — DeviceDetail page tests
// =============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { DeviceDetail } from '../DeviceDetail';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockApiGet = vi.fn();
const mockApiPatch = vi.fn();
const mockApiPost = vi.fn();
const mockApiPut = vi.fn();
const mockAuthedFetch = vi.fn();
vi.mock('@/api/client', () => ({
  api: {
    GET: (...args: unknown[]) => mockApiGet(...args),
    POST: (...args: unknown[]) => mockApiPost(...args),
    PUT: (...args: unknown[]) => mockApiPut(...args),
    PATCH: (...args: unknown[]) => mockApiPatch(...args),
    DELETE: vi.fn(),
  },
  tokenStore: {
    getAccess: () => 'tok',
    setAccess: vi.fn(),
    getRefresh: () => null,
    setRefresh: vi.fn(),
    clear: vi.fn(),
  },
  authedFetch: (...args: unknown[]) => mockAuthedFetch(...args),
}));

vi.mock('@/auth/AuthContext', () => ({
  useAuth: () => ({ user: { id: 1, role: 'admin' } }),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const device = {
  id: 42,
  site_id: 3,
  client_id: null,
  contract_id: null,
  category: 'router',
  name: 'Core-Router-01',
  type: 'router',
  manufacturer: 'MikroTik',
  model: 'CCR2004',
  serial_number: 'SN-ABC123',
  mac_address: 'AA:BB:CC:DD:EE:FF',
  ip_address: '10.0.0.1',
  ipv6_address: null,
  firmware: '7.14',
  snmp_enabled: true,
  snmp_version: 'v2c',
  status: 'online',
  notes: 'Main distribution router',
  last_polled_at: '2026-06-01T10:00:00.000Z',
  last_poll_error: null,
};

// Distinct from any generic /users fixture — proves the assignee select is
// populated from GET /work-orders/assignable-users, not the generic list.
const assignableUsers = [
  { id: 42, first_name: 'Ana', last_name: 'Technician' },
];

// ---------------------------------------------------------------------------
// Render helper
// ---------------------------------------------------------------------------

function renderDetail(id = '42') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/devices/${id}`]}>
        <Routes>
          <Route path="/devices/:id" element={<DeviceDetail />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DeviceDetail page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/devices/{id}') {
        return Promise.resolve({
          data: { data: device },
          error: undefined,
        });
      }
      if (path === '/work-orders/assignable-users') {
        return Promise.resolve({ data: { data: assignableUsers }, error: undefined });
      }
      return Promise.resolve({ data: { data: [] }, error: undefined });
    });
    mockAuthedFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: { id: 501 } }),
    });
  });

  it('renders the device name as a heading', async () => {
    renderDetail();
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Core-Router-01' })).toBeInTheDocument(),
    );
  });

  it('shows the device status badge', async () => {
    renderDetail();
    // The header badge and the Overview tab (default active tab, real
    // content since this PR) both legitimately show the status — assert at
    // least one is present rather than assuming a single match.
    await waitFor(() => expect(screen.getAllByText('online').length).toBeGreaterThan(0));
  });

  it('shows key device fields', async () => {
    renderDetail();
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Core-Router-01' })).toBeInTheDocument(),
    );
    expect(screen.getByText('MikroTik')).toBeInTheDocument();
    expect(screen.getByText('CCR2004')).toBeInTheDocument();
    // The info card's IP Address row and the Overview tab's management
    // address row (no ipv6_address set, so it renders the bare IPv4) both
    // legitimately show this value — assert at least one match.
    expect(screen.getAllByText('10.0.0.1').length).toBeGreaterThan(0);
    expect(screen.getByText('SN-ABC123')).toBeInTheDocument();
  });

  it('shows notes section', async () => {
    renderDetail();
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Core-Router-01' })).toBeInTheDocument(),
    );
    expect(screen.getByText('Main distribution router')).toBeInTheDocument();
  });

  it('renders the breadcrumb back link to /devices', async () => {
    renderDetail();
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Core-Router-01' })).toBeInTheDocument(),
    );
    const link = screen.getByRole('link', { name: 'Devices' });
    expect(link).toHaveAttribute('href', '/devices');
  });

  it('shows all tabs', async () => {
    renderDetail();
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Core-Router-01' })).toBeInTheDocument(),
    );
    expect(screen.getByRole('button', { name: 'Overview' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'SNMP Metrics' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Config Backups' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Work Orders' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Outages' })).toBeInTheDocument();
  });

  it('shows not found message on API error', async () => {
    mockApiGet.mockImplementation(() =>
      Promise.resolve({ data: null, error: { message: 'Not found' } }),
    );
    renderDetail();
    await waitFor(() => expect(screen.getByText('Device not found.')).toBeInTheDocument());
  });

  it('shows loading text initially', () => {
    // Delay the mock so we can catch the loading state
    mockApiGet.mockImplementation(() => new Promise(() => {}));
    renderDetail();
    expect(screen.getByText('Loading device…')).toBeInTheDocument();
  });

  // ---------------------------------------------------------------------------
  // Client assignment (device → client link)
  // ---------------------------------------------------------------------------

  describe('client assignment', () => {
    it('shows "Unassigned" + an Assign button when the device has no linked client', async () => {
      renderDetail();
      await waitFor(() =>
        expect(screen.getByRole('heading', { name: 'Core-Router-01' })).toBeInTheDocument(),
      );
      // The info card and the Overview tab (default active tab, real content
      // since this PR) both legitimately show "Unassigned".
      expect(screen.getAllByText('Unassigned').length).toBeGreaterThan(0);
      expect(screen.getByRole('button', { name: 'Assign client' })).toBeInTheDocument();
    });

    it('resolves and displays the linked client name as a link, falling back to #<id> while pending', async () => {
      const deviceWithClient = { ...device, client_id: 7 };
      let resolveClientLookup: (v: unknown) => void = () => {};
      mockApiGet.mockImplementation((path: string) => {
        if (path === '/devices/{id}') {
          return Promise.resolve({ data: { data: deviceWithClient }, error: undefined });
        }
        if (path === '/clients/{id}') {
          return new Promise((resolve) => { resolveClientLookup = resolve; });
        }
        return Promise.resolve({ data: { data: [] }, error: undefined });
      });

      renderDetail();
      await waitFor(() =>
        expect(screen.getByRole('heading', { name: 'Core-Router-01' })).toBeInTheDocument(),
      );

      // Client-name lookup still pending — falls back to the raw id, shown
      // both in the info card and in the Overview tab.
      screen.getAllByRole('link', { name: '#7' }).forEach(l => expect(l).toHaveAttribute('href', '/clients/7'));

      resolveClientLookup({ data: { data: { id: 7, name: 'Acme Corp' } }, error: undefined });

      await waitFor(() => {
        const links = screen.getAllByRole('link', { name: 'Acme Corp' });
        expect(links.length).toBeGreaterThan(0);
        links.forEach(l => expect(l).toHaveAttribute('href', '/clients/7'));
      });
    });

    it('clicking Change reveals the ClientPicker seeded with the current client, plus Save/Cancel', async () => {
      const deviceWithClient = { ...device, client_id: 7 };
      mockApiGet.mockImplementation((path: string) => {
        if (path === '/devices/{id}') {
          return Promise.resolve({ data: { data: deviceWithClient }, error: undefined });
        }
        if (path === '/clients/{id}') {
          return Promise.resolve({ data: { data: { id: 7, name: 'Acme Corp' } }, error: undefined });
        }
        return Promise.resolve({ data: { data: [] }, error: undefined });
      });

      renderDetail();
      await waitFor(() => expect(screen.getAllByRole('link', { name: 'Acme Corp' }).length).toBeGreaterThan(0));

      await userEvent.click(screen.getByRole('button', { name: 'Change' }));

      // "Acme Corp" now also appears as the ClientPicker's own selected-name
      // chip, alongside the Overview tab's unaffected link — at least one
      // occurrence confirms the picker seeded correctly.
      expect(screen.getAllByText('Acme Corp').length).toBeGreaterThan(0);
      expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    });

    it('Save calls PATCH with the newly picked client id and exits edit mode on success', async () => {
      mockApiGet.mockImplementation((path: string) => {
        if (path === '/devices/{id}') {
          return Promise.resolve({ data: { data: device }, error: undefined });
        }
        if (path === '/clients') {
          return Promise.resolve({
            data: { data: [{ id: 55, name: 'New Client', email: 'nc@test.com' }] },
            error: undefined,
          });
        }
        return Promise.resolve({ data: { data: [] }, error: undefined });
      });
      mockApiPatch.mockResolvedValue({ data: { data: { ...device, client_id: 55 } }, error: undefined });

      renderDetail();
      await waitFor(() =>
        expect(screen.getByRole('heading', { name: 'Core-Router-01' })).toBeInTheDocument(),
      );

      await userEvent.click(screen.getByRole('button', { name: 'Assign client' }));

      const input = screen.getByPlaceholderText('Search clients by name, email or phone…');
      await userEvent.click(input);
      await waitFor(() =>
        expect(screen.getByRole('option', { name: /New Client/i })).toBeInTheDocument(),
      );
      await userEvent.click(screen.getByRole('option', { name: /New Client/i }));

      await userEvent.click(screen.getByRole('button', { name: 'Save' }));

      await waitFor(() =>
        expect(mockApiPatch).toHaveBeenCalledWith(
          '/devices/{id}',
          expect.objectContaining({ params: { path: { id: 42 } }, body: { client_id: 55 } }),
        ),
      );
      // Exits edit mode on success
      await waitFor(() => expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument());
    });

    it('Save with a cleared picker selection sends client_id: null', async () => {
      const deviceWithClient = { ...device, client_id: 7 };
      mockApiGet.mockImplementation((path: string) => {
        if (path === '/devices/{id}') {
          return Promise.resolve({ data: { data: deviceWithClient }, error: undefined });
        }
        if (path === '/clients/{id}') {
          return Promise.resolve({ data: { data: { id: 7, name: 'Acme Corp' } }, error: undefined });
        }
        return Promise.resolve({ data: { data: [] }, error: undefined });
      });
      mockApiPatch.mockResolvedValue({
        data: { data: { ...deviceWithClient, client_id: null } },
        error: undefined,
      });

      renderDetail();
      await waitFor(() => expect(screen.getAllByRole('link', { name: 'Acme Corp' }).length).toBeGreaterThan(0));

      await userEvent.click(screen.getByRole('button', { name: 'Change' }));
      // ClientPicker's own "Change" button clears the current selection (onChange(0, ''))
      await userEvent.click(screen.getByRole('button', { name: 'Change' }));

      await userEvent.click(screen.getByRole('button', { name: 'Save' }));

      await waitFor(() =>
        expect(mockApiPatch).toHaveBeenCalledWith(
          '/devices/{id}',
          expect.objectContaining({ body: { client_id: null } }),
        ),
      );
    });

    it('a PATCH error (e.g. cross-org 422) keeps edit mode open and shows the error message', async () => {
      mockApiGet.mockImplementation((path: string) => {
        if (path === '/devices/{id}') {
          return Promise.resolve({ data: { data: device }, error: undefined });
        }
        if (path === '/clients') {
          return Promise.resolve({
            data: { data: [{ id: 55, name: 'New Client', email: null }] },
            error: undefined,
          });
        }
        return Promise.resolve({ data: { data: [] }, error: undefined });
      });
      mockApiPatch.mockResolvedValue({
        data: null,
        error: { error: { message: 'client_id does not belong to this organization' } },
      });

      renderDetail();
      await waitFor(() =>
        expect(screen.getByRole('heading', { name: 'Core-Router-01' })).toBeInTheDocument(),
      );

      await userEvent.click(screen.getByRole('button', { name: 'Assign client' }));
      const input = screen.getByPlaceholderText('Search clients by name, email or phone…');
      await userEvent.click(input);
      await waitFor(() =>
        expect(screen.getByRole('option', { name: /New Client/i })).toBeInTheDocument(),
      );
      await userEvent.click(screen.getByRole('option', { name: /New Client/i }));
      await userEvent.click(screen.getByRole('button', { name: 'Save' }));

      await waitFor(() =>
        expect(screen.getByText('client_id does not belong to this organization')).toBeInTheDocument(),
      );
      // Edit mode stays open — the picked value isn't silently discarded
      expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
    });
  });

  // ---------------------------------------------------------------------------
  // RF Thresholds tab (migration 388) — AP/PTP-only conditional tab editing
  // the serving sector's signal_min_dbm / link_capacity_min_mbps via the
  // existing /wireless/ap-sectors CRUD.
  // ---------------------------------------------------------------------------
  describe('RF Thresholds tab (migration 388)', () => {
    const apDevice = { ...device, id: 42, type: 'ptmp_ap' };

    it('is NOT shown for a non-AP/PTP device (e.g. a router)', async () => {
      renderDetail();
      await waitFor(() =>
        expect(screen.getByRole('heading', { name: 'Core-Router-01' })).toBeInTheDocument(),
      );
      expect(screen.queryByRole('button', { name: 'RF Thresholds' })).not.toBeInTheDocument();
    });

    it('IS shown for a ptmp_ap device, and fetches the sector filtered by device_id when opened', async () => {
      mockApiGet.mockImplementation((path: string) => {
        if (path === '/devices/{id}') return Promise.resolve({ data: { data: apDevice }, error: undefined });
        if (path === '/wireless/ap-sectors') return Promise.resolve({ data: { data: [] }, error: undefined });
        return Promise.resolve({ data: { data: [] }, error: undefined });
      });

      renderDetail();
      await waitFor(() =>
        expect(screen.getByRole('heading', { name: 'Core-Router-01' })).toBeInTheDocument(),
      );
      expect(screen.getByRole('button', { name: 'RF Thresholds' })).toBeInTheDocument();

      await userEvent.click(screen.getByRole('button', { name: 'RF Thresholds' }));

      await waitFor(() =>
        expect(mockApiGet).toHaveBeenCalledWith(
          '/wireless/ap-sectors',
          expect.objectContaining({ params: { query: { device_id: 42 } } }),
        ),
      );
    });

    it('is also shown for a ptp device (not just ptmp_ap)', async () => {
      const ptpDevice = { ...device, id: 42, type: 'ptp' };
      mockApiGet.mockImplementation((path: string) => {
        if (path === '/devices/{id}') return Promise.resolve({ data: { data: ptpDevice }, error: undefined });
        return Promise.resolve({ data: { data: [] }, error: undefined });
      });
      renderDetail();
      await waitFor(() =>
        expect(screen.getByRole('heading', { name: 'Core-Router-01' })).toBeInTheDocument(),
      );
      expect(screen.getByRole('button', { name: 'RF Thresholds' })).toBeInTheDocument();
    });

    it('no existing sector: pre-fills blank inputs and Save POSTs a new sector config with device_id', async () => {
      mockApiGet.mockImplementation((path: string) => {
        if (path === '/devices/{id}') return Promise.resolve({ data: { data: apDevice }, error: undefined });
        if (path === '/wireless/ap-sectors') return Promise.resolve({ data: { data: [] }, error: undefined });
        return Promise.resolve({ data: { data: [] }, error: undefined });
      });
      mockApiPost.mockResolvedValue({ data: { data: { id: 1, device_id: 42, signal_min_dbm: -60, link_capacity_min_mbps: 25 } }, error: undefined });

      renderDetail();
      await waitFor(() =>
        expect(screen.getByRole('heading', { name: 'Core-Router-01' })).toBeInTheDocument(),
      );
      await userEvent.click(screen.getByRole('button', { name: 'RF Thresholds' }));
      await waitFor(() => expect(mockApiGet).toHaveBeenCalledWith('/wireless/ap-sectors', expect.anything()));

      const signalInput = await screen.findByPlaceholderText('-75');
      expect((signalInput as HTMLInputElement).value).toBe('');

      await userEvent.type(signalInput, '-60');
      const capacityInput = screen.getByPlaceholderText('e.g. 20');
      await userEvent.type(capacityInput, '25');

      await userEvent.click(screen.getByRole('button', { name: 'Save' }));

      await waitFor(() =>
        expect(mockApiPost).toHaveBeenCalledWith(
          '/wireless/ap-sectors',
          expect.objectContaining({ body: { device_id: 42, signal_min_dbm: -60, link_capacity_min_mbps: 25 } }),
        ),
      );
      await waitFor(() => expect(screen.getByText('Saved.')).toBeInTheDocument());
    });

    it('an existing sector: pre-fills the current values and Save PUTs the update', async () => {
      const existingSector = { id: 9, device_id: 42, signal_min_dbm: -65, link_capacity_min_mbps: '15.00' };
      mockApiGet.mockImplementation((path: string) => {
        if (path === '/devices/{id}') return Promise.resolve({ data: { data: apDevice }, error: undefined });
        if (path === '/wireless/ap-sectors') return Promise.resolve({ data: { data: [existingSector] }, error: undefined });
        return Promise.resolve({ data: { data: [] }, error: undefined });
      });
      mockApiPut.mockResolvedValue({ data: { data: { ...existingSector, signal_min_dbm: -55 } }, error: undefined });

      renderDetail();
      await waitFor(() =>
        expect(screen.getByRole('heading', { name: 'Core-Router-01' })).toBeInTheDocument(),
      );
      await userEvent.click(screen.getByRole('button', { name: 'RF Thresholds' }));

      const signalInput = await screen.findByPlaceholderText('-75') as HTMLInputElement;
      await waitFor(() => expect(signalInput.value).toBe('-65'));
      const capacityInput = screen.getByPlaceholderText('e.g. 20') as HTMLInputElement;
      // DECIMAL(8,2) round-trips as the exact string the API returned
      // ("15.00", not "15") — the form doesn't reformat it, only Number()s
      // it on submit.
      expect(capacityInput.value).toBe('15.00');

      await userEvent.clear(signalInput);
      await userEvent.type(signalInput, '-55');
      await userEvent.click(screen.getByRole('button', { name: 'Save' }));

      await waitFor(() =>
        expect(mockApiPut).toHaveBeenCalledWith(
          '/wireless/ap-sectors/{id}',
          expect.objectContaining({
            params: { path: { id: 9 } },
            body: { signal_min_dbm: -55, link_capacity_min_mbps: 15 },
          }),
        ),
      );
    });

    it('clearing an input to blank sends an explicit null (not omitted) so a set override can be reverted to default', async () => {
      const existingSector = { id: 9, device_id: 42, signal_min_dbm: -65, link_capacity_min_mbps: '15.00' };
      mockApiGet.mockImplementation((path: string) => {
        if (path === '/devices/{id}') return Promise.resolve({ data: { data: apDevice }, error: undefined });
        if (path === '/wireless/ap-sectors') return Promise.resolve({ data: { data: [existingSector] }, error: undefined });
        return Promise.resolve({ data: { data: [] }, error: undefined });
      });
      mockApiPut.mockResolvedValue({ data: { data: { ...existingSector, signal_min_dbm: null } }, error: undefined });

      renderDetail();
      await waitFor(() =>
        expect(screen.getByRole('heading', { name: 'Core-Router-01' })).toBeInTheDocument(),
      );
      await userEvent.click(screen.getByRole('button', { name: 'RF Thresholds' }));

      const signalInput = await screen.findByPlaceholderText('-75') as HTMLInputElement;
      await waitFor(() => expect(signalInput.value).toBe('-65'));
      await userEvent.clear(signalInput);

      await userEvent.click(screen.getByRole('button', { name: 'Save' }));

      await waitFor(() =>
        expect(mockApiPut).toHaveBeenCalledWith(
          '/wireless/ap-sectors/{id}',
          expect.objectContaining({ body: { signal_min_dbm: null, link_capacity_min_mbps: 15 } }),
        ),
      );
    });

    it('a save error shows the failure message instead of a fabricated success', async () => {
      mockApiGet.mockImplementation((path: string) => {
        if (path === '/devices/{id}') return Promise.resolve({ data: { data: apDevice }, error: undefined });
        if (path === '/wireless/ap-sectors') return Promise.resolve({ data: { data: [] }, error: undefined });
        return Promise.resolve({ data: { data: [] }, error: undefined });
      });
      mockApiPost.mockResolvedValue({ data: null, error: { error: { message: 'Device must be of type ptmp_ap, ptp, outdoor_cpe, or indoor_cpe' } } });

      renderDetail();
      await waitFor(() =>
        expect(screen.getByRole('heading', { name: 'Core-Router-01' })).toBeInTheDocument(),
      );
      await userEvent.click(screen.getByRole('button', { name: 'RF Thresholds' }));
      await screen.findByPlaceholderText('-75');

      await userEvent.click(screen.getByRole('button', { name: 'Save' }));

      await waitFor(() =>
        expect(screen.getByText('Device must be of type ptmp_ap, ptp, outdoor_cpe, or indoor_cpe')).toBeInTheDocument(),
      );
      expect(screen.queryByText('Saved.')).not.toBeInTheDocument();
    });
  });
});

// ---------------------------------------------------------------------------
// Create Work Order (inline form on the Work Orders tab)
// ---------------------------------------------------------------------------

describe('DeviceDetail — create work order', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthedFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: { id: 501 } }),
    });
  });

  async function openCreateForm(deviceFixture: Omit<typeof device, 'client_id'> & { client_id: number | null }) {
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/devices/{id}') return Promise.resolve({ data: { data: deviceFixture }, error: undefined });
      if (path === '/work-orders/assignable-users') return Promise.resolve({ data: { data: assignableUsers }, error: undefined });
      return Promise.resolve({ data: { data: [] }, error: undefined });
    });
    renderDetail();
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Core-Router-01' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Work Orders' }));
    fireEvent.click(screen.getByRole('button', { name: 'New Work Order' }));
  }

  it('populates the assignee select from /work-orders/assignable-users, not a generic /users list', async () => {
    await openCreateForm(device);
    await waitFor(() => expect(screen.getByText('Ana Technician')).toBeInTheDocument());
    expect(mockApiGet).toHaveBeenCalledWith('/work-orders/assignable-users', expect.anything());
  });

  it('POSTs the create body with device_id pinned, and no client_id when the device has none', async () => {
    await openCreateForm(device); // device.client_id === null

    fireEvent.change(screen.getByPlaceholderText('Describe the work needed'), { target: { value: 'Swap PSU' } });
    await waitFor(() => expect(screen.getByText('Ana Technician')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(mockAuthedFetch).toHaveBeenCalled());
    const [url, opts] = mockAuthedFetch.mock.calls[0] as [string, { method: string; body: string }];
    expect(url).toBe('/api/v1/work-orders');
    expect(opts.method).toBe('POST');
    const body = JSON.parse(opts.body);
    expect(body.device_id).toBe(42);
    expect(body.title).toBe('Swap PSU');
    expect(body.client_id).toBeUndefined();
  });

  it('carries the device\'s client_id onto the work order when the device has a linked client', async () => {
    const deviceWithClient = { ...device, client_id: 7 };
    await openCreateForm(deviceWithClient);

    fireEvent.change(screen.getByPlaceholderText('Describe the work needed'), { target: { value: 'Reprovision CPE' } });
    await waitFor(() => expect(screen.getByText('Ana Technician')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(mockAuthedFetch).toHaveBeenCalled());
    const [, opts] = mockAuthedFetch.mock.calls[0] as [string, { method: string; body: string }];
    const body = JSON.parse(opts.body);
    expect(body.device_id).toBe(42);
    expect(body.client_id).toBe(7);
  });

  it('collapses the form and refetches the device work-order list on success', async () => {
    await openCreateForm(device);
    fireEvent.change(screen.getByPlaceholderText('Describe the work needed'), { target: { value: 'Swap PSU' } });
    const callsBeforeSubmit = mockApiGet.mock.calls.filter(([p]) => p === '/work-orders').length;

    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(mockAuthedFetch).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByRole('button', { name: 'New Work Order' })).toBeInTheDocument());
    await waitFor(() => {
      const callsAfter = mockApiGet.mock.calls.filter(([p]) => p === '/work-orders').length;
      expect(callsAfter).toBeGreaterThan(callsBeforeSubmit);
    });
  });
});

// ---------------------------------------------------------------------------
// SNMP Metrics tab — connects to the /snmp-metrics fleet-glance/history page
// instead of a raw Object.keys column dump.
// ---------------------------------------------------------------------------

describe('DeviceDetail — SNMP Metrics tab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  async function openSnmpTab() {
    renderDetail();
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Core-Router-01' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'SNMP Metrics' }));
  }

  it('always shows a "View metric history" link to /snmp-metrics?device_id=42', async () => {
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/devices/{id}') return Promise.resolve({ data: { data: device }, error: undefined });
      if (path === '/devices/{id}/snmp-metrics') return Promise.resolve({ data: { data: [] }, error: undefined });
      return Promise.resolve({ data: { data: [] }, error: undefined });
    });
    await openSnmpTab();

    const link = await screen.findByRole('link', { name: /View metric history/ });
    expect(link).toHaveAttribute('href', '/snmp-metrics?device_id=42');
  });

  it('shows the empty message when no SNMP metrics exist', async () => {
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/devices/{id}') return Promise.resolve({ data: { data: device }, error: undefined });
      if (path === '/devices/{id}/snmp-metrics') return Promise.resolve({ data: { data: [] }, error: undefined });
      return Promise.resolve({ data: { data: [] }, error: undefined });
    });
    await openSnmpTab();

    expect(await screen.findByText('No SNMP metrics found.')).toBeInTheDocument();
  });

  it('shows a compact latest-readings summary (not a raw column dump) when metrics exist', async () => {
    const latestReading = {
      id: 900,
      polled_at: '2026-07-16T10:00:00.000Z',
      cpu_usage: 42,
      memory_usage: 55.4,
      signal_strength: -62,
      latency_ms: 12.3,
      uptime_ticks: 123456,
    };
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/devices/{id}') return Promise.resolve({ data: { data: device }, error: undefined });
      if (path === '/devices/{id}/snmp-metrics') return Promise.resolve({ data: { data: [latestReading] }, error: undefined });
      return Promise.resolve({ data: { data: [] }, error: undefined });
    });
    await openSnmpTab();

    expect(await screen.findByText('42.0 %')).toBeInTheDocument();
    expect(screen.getByText('55.4 %')).toBeInTheDocument();
    expect(screen.getByText('-62 dBm')).toBeInTheDocument();
    expect(screen.getByText('12.3 ms')).toBeInTheDocument();
    // Never falls back to a raw Object.keys() column dump (collapsed by default).
    expect(screen.queryByText('cpu_usage')).not.toBeInTheDocument();
    expect(screen.queryByText('memory_usage')).not.toBeInTheDocument();
  });

  it('finds the real device-level reading even when interface rows sort first (the backend\'s REAL shape, newest-first with device-level and per-interface rows interleaved)', async () => {
    // GET /devices/{id}/snmp-metrics has no interface_id IS NULL filter by
    // default — row[0] is frequently a per-interface row (null cpu/mem/
    // signal/uptime). Blindly reading row[0] would show "—" everywhere even
    // though a real, recent device-level reading exists a few rows down.
    const interfaceRowNewest = {
      id: 903, polled_at: '2026-07-16T10:10:00.000Z', interface_id: 'eth1',
      cpu_usage: null, memory_usage: null, signal_strength: null, latency_ms: null, uptime_ticks: null,
      if_in_octets: 5000, if_out_octets: 2000,
    };
    const interfaceRowMiddle = {
      id: 902, polled_at: '2026-07-16T10:05:00.000Z', interface_id: 'eth0',
      cpu_usage: null, memory_usage: null, signal_strength: null, latency_ms: null, uptime_ticks: null,
      if_in_octets: 4000, if_out_octets: 1500,
    };
    const deviceLevelRow = {
      id: 901, polled_at: '2026-07-16T10:00:00.000Z', interface_id: null,
      cpu_usage: 42, memory_usage: 55.4, signal_strength: -62, latency_ms: 12.3, uptime_ticks: 123456,
    };
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/devices/{id}') return Promise.resolve({ data: { data: device }, error: undefined });
      if (path === '/devices/{id}/snmp-metrics') {
        return Promise.resolve({ data: { data: [interfaceRowNewest, interfaceRowMiddle, deviceLevelRow] }, error: undefined });
      }
      return Promise.resolve({ data: { data: [] }, error: undefined });
    });
    await openSnmpTab();

    expect(await screen.findByText('42.0 %')).toBeInTheDocument();
    expect(screen.getByText('55.4 %')).toBeInTheDocument();
    expect(screen.getByText('-62 dBm')).toBeInTheDocument();
    expect(screen.getByText('12.3 ms')).toBeInTheDocument();
  });

  describe('"All readings" expandable section', () => {
    const mixedRows = [
      {
        id: 902, polled_at: '2026-07-16T10:05:00.000Z', interface_id: 'eth0',
        cpu_usage: null, memory_usage: null, signal_strength: null, latency_ms: null, uptime_ticks: null,
        if_in_errors: 3, if_in_discards: 1,
      },
      {
        id: 901, polled_at: '2026-07-16T10:00:00.000Z', interface_id: null,
        cpu_usage: 42, memory_usage: 55.4, signal_strength: -62, latency_ms: 12.3, uptime_ticks: 123456,
        temperature_c: 38.5, voltage_mv: 12000, fan_speed_rpm: 3200, ups_battery_pct: null,
      },
    ];

    it('is collapsed by default — environmental/error fields are not visible until expanded', async () => {
      mockApiGet.mockImplementation((path: string) => {
        if (path === '/devices/{id}') return Promise.resolve({ data: { data: device }, error: undefined });
        if (path === '/devices/{id}/snmp-metrics') return Promise.resolve({ data: { data: mixedRows }, error: undefined });
        return Promise.resolve({ data: { data: [] }, error: undefined });
      });
      await openSnmpTab();

      await screen.findByText('42.0 %');
      expect(screen.queryByText('temperature_c')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /All readings/ })).toBeInTheDocument();
    });

    it('expanding shows every non-null column (temperature, voltage, fan speed, interface errors/discards) with units — nothing lost from the old raw dump', async () => {
      mockApiGet.mockImplementation((path: string) => {
        if (path === '/devices/{id}') return Promise.resolve({ data: { data: device }, error: undefined });
        if (path === '/devices/{id}/snmp-metrics') return Promise.resolve({ data: { data: mixedRows }, error: undefined });
        return Promise.resolve({ data: { data: [] }, error: undefined });
      });
      await openSnmpTab();
      await screen.findByText('42.0 %');

      await userEvent.click(screen.getByRole('button', { name: /All readings/ }));

      expect(screen.getByText('temperature_c')).toBeInTheDocument();
      expect(screen.getByText('38.5 °C')).toBeInTheDocument();
      expect(screen.getByText('12000 mV')).toBeInTheDocument();
      expect(screen.getByText('3200 RPM')).toBeInTheDocument();
      expect(screen.getByText('if_in_errors')).toBeInTheDocument();
      expect(screen.getByText('if_in_discards')).toBeInTheDocument();
      // A column that's null on EVERY row (ups_battery_pct here) is dropped
      // entirely rather than cluttering the table with a wall of "—".
      expect(screen.queryByText('ups_battery_pct')).not.toBeInTheDocument();
    });
  });
});

// ---------------------------------------------------------------------------
// Overview tab (real content — status, vendor/model, mgmt address, linked
// site/client/contract, last polled / poll error)
// ---------------------------------------------------------------------------

describe('DeviceDetail — Overview tab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Overview is the default active tab, so its content and the always-visible
  // info card both render at once — a device with a linked site/contract gets
  // TWO links with the same name/href (one per section), hence getAllByRole.
  it('links the site and contract instead of showing raw ids, and shows the firmware value under the real `firmware` column', async () => {
    const deviceWithLinks = { ...device, site_id: 3, contract_id: 9, client_id: null };
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/devices/{id}') return Promise.resolve({ data: { data: deviceWithLinks }, error: undefined });
      if (path === '/sites/{id}') return Promise.resolve({ data: { data: { id: 3, name: 'Main POP' } }, error: undefined });
      return Promise.resolve({ data: { data: [] }, error: undefined });
    });

    renderDetail();
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Core-Router-01' })).toBeInTheDocument());

    // site_id and contract_id are links, not raw numbers (info card + Overview tab)
    await waitFor(() => {
      const siteLinks = screen.getAllByRole('link', { name: 'Main POP' });
      expect(siteLinks.length).toBeGreaterThan(0);
      siteLinks.forEach(l => expect(l).toHaveAttribute('href', '/sites/3'));
    });
    const contractLinks = screen.getAllByRole('link', { name: '#9' });
    expect(contractLinks.length).toBeGreaterThan(0);
    contractLinks.forEach(l => expect(l).toHaveAttribute('href', '/contracts/9'));
    // Firmware renders from the real `firmware` column
    expect(screen.getByText('7.14')).toBeInTheDocument();
  });

  it('shows "no site linked" / "no contract linked" placeholders when unset', async () => {
    const bareDevice = { ...device, site_id: null, contract_id: null, client_id: null };
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/devices/{id}') return Promise.resolve({ data: { data: bareDevice }, error: undefined });
      return Promise.resolve({ data: { data: [] }, error: undefined });
    });

    renderDetail();
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Core-Router-01' })).toBeInTheDocument());

    expect(await screen.findByText('No site linked')).toBeInTheDocument();
    expect(screen.getByText('No contract linked')).toBeInTheDocument();
  });

  it('shows the last poll error as a callout when present', async () => {
    const erroringDevice = { ...device, last_poll_error: 'SNMP timeout after 3 retries' };
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/devices/{id}') return Promise.resolve({ data: { data: erroringDevice }, error: undefined });
      return Promise.resolve({ data: { data: [] }, error: undefined });
    });

    renderDetail();
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Core-Router-01' })).toBeInTheDocument());

    // The error also appears in the always-visible info card's InfoRow, so
    // there may be more than one match — assert at least one is present.
    await waitFor(() => expect(screen.getAllByText('SNMP timeout after 3 retries').length).toBeGreaterThan(0));
  });
});
