// =============================================================================
// FireISP 5.0 — DeviceDetail page tests
// =============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
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
  firmware_version: '7.14',
  snmp_enabled: true,
  snmp_version: 'v2c',
  status: 'online',
  notes: 'Main distribution router',
  last_polled_at: '2026-06-01T10:00:00.000Z',
  last_poll_error: null,
};

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
      return Promise.resolve({ data: { data: [] }, error: undefined });
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
    await waitFor(() => expect(screen.getByText('online')).toBeInTheDocument());
  });

  it('shows key device fields', async () => {
    renderDetail();
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Core-Router-01' })).toBeInTheDocument(),
    );
    expect(screen.getByText('MikroTik')).toBeInTheDocument();
    expect(screen.getByText('CCR2004')).toBeInTheDocument();
    expect(screen.getByText('10.0.0.1')).toBeInTheDocument();
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
      expect(screen.getByText('Unassigned')).toBeInTheDocument();
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

      // Client-name lookup still pending — falls back to the raw id
      expect(screen.getByRole('link', { name: '#7' })).toHaveAttribute('href', '/clients/7');

      resolveClientLookup({ data: { data: { id: 7, name: 'Acme Corp' } }, error: undefined });

      await waitFor(() =>
        expect(screen.getByRole('link', { name: 'Acme Corp' })).toHaveAttribute('href', '/clients/7'),
      );
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
      await waitFor(() => expect(screen.getByRole('link', { name: 'Acme Corp' })).toBeInTheDocument());

      await userEvent.click(screen.getByRole('button', { name: 'Change' }));

      expect(screen.getByText('Acme Corp')).toBeInTheDocument();
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
      await waitFor(() => expect(screen.getByRole('link', { name: 'Acme Corp' })).toBeInTheDocument());

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
