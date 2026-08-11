// =============================================================================
// FireISP 5.0 — ContractList page tests
// =============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { ContractList } from '../ContractList';

// ---------------------------------------------------------------------------
// Mock API client
// ---------------------------------------------------------------------------

const mockApiGet = vi.fn();
const mockApiPut = vi.fn();
const mockApiPost = vi.fn();
const mockAuthedFetch = vi.fn();
vi.mock('@/api/client', () => ({
  api: {
    GET: (...args: unknown[]) => mockApiGet(...args),
    PUT: (...args: unknown[]) => mockApiPut(...args),
    POST: (...args: unknown[]) => mockApiPost(...args),
  },
  authedFetch: (...args: unknown[]) => mockAuthedFetch(...args),
  tokenStore: { getAccess: () => 'tok', setAccess: vi.fn(), getRefresh: () => null, setRefresh: vi.fn(), clear: vi.fn() },
}));

let mockLocale: 'global' | 'MX' = 'global';
let mockRole = 'admin';
let mockPermissions: string[] | undefined;
vi.mock('@/auth/AuthContext', () => ({
  useAuth: () => ({ user: {
    id: 1,
    role: mockRole,
    permissions: mockPermissions,
    organization_locale: mockLocale,
  } }),
}));

const contract1 = {
  id: 1, client_id: 10, plan_id: 2, connection_type: 'fiber',
  start_date: '2024-01-01', end_date: null, billing_day: 1,
  ip_address: '10.0.0.1', price_override: null, status: 'active',
  facturar: true, notes: null,
};

function renderContractList() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <ContractList />
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

function LocationProbe() {
  const location = useLocation();
  return <span data-testid="location">{location.pathname}</span>;
}

const client1 = { id: 10, name: 'Acme Corp', email: 'a@example.com', status: 'active' };

describe('ContractList page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLocale = 'global';
    mockRole = 'admin';
    mockPermissions = undefined;
    mockAuthedFetch.mockResolvedValue({ ok: true, json: async () => ({ data: {} }) });
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/contracts')
        return Promise.resolve({ data: { data: [contract1], meta: { total: 1, page: 1, limit: 20, totalPages: 1 } }, error: undefined });
      if (path === '/plans')
        return Promise.resolve({ data: { data: [] }, error: undefined });
      if (path === '/clients')
        return Promise.resolve({ data: { data: [client1] }, error: undefined });
      return Promise.resolve({ data: { data: [] }, error: undefined });
    });
  });

  it('renders the page heading', async () => {
    renderContractList();
    await waitFor(() => expect(screen.getByText('📄 Contracts')).toBeInTheDocument());
  });

  it('renders a contract row after data loads', async () => {
    renderContractList();
    // IP address is shown in the table
    await waitFor(() => expect(screen.getByText('10.0.0.1')).toBeInTheDocument());
  });

  it('renders the client name in the Client column', async () => {
    renderContractList();
    await waitFor(() => expect(screen.getByText('Acme Corp')).toBeInTheDocument());
  });

  it('renders the narrow numeric client ID column', async () => {
    renderContractList();
    await waitFor(() => expect(screen.getByText('10.0.0.1')).toBeInTheDocument());
    // The narrow ID cell should show raw client_id "10"
    const cells = screen.getAllByText('10');
    expect(cells.length).toBeGreaterThanOrEqual(1);
  });

  it('shows empty message when no contracts', async () => {
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/contracts')
        return Promise.resolve({ data: { data: [], meta: { total: 0, page: 1, limit: 20, totalPages: 0 } }, error: undefined });
      return Promise.resolve({ data: { data: [] }, error: undefined });
    });
    renderContractList();
    await waitFor(() => expect(screen.getByText(/No contracts found/)).toBeInTheDocument());
  });

  describe('Edit Contract modal — escalation toggles (migration 387)', () => {
    it('offers only same-family connection changes so Edit cannot strand provisioned service', async () => {
      mockApiGet.mockImplementation((path: string) => {
        if (path === '/contracts') return Promise.resolve({
          data: { data: [{ ...contract1, connection_type: 'pppoe' }], meta: { total: 1, page: 1, limit: 20, totalPages: 1 } },
          error: undefined,
        });
        if (path === '/plans') return Promise.resolve({ data: { data: [] }, error: undefined });
        if (path === '/clients') return Promise.resolve({ data: { data: [client1] }, error: undefined });
        return Promise.resolve({ data: { data: [] }, error: undefined });
      });
      renderContractList();
      fireEvent.click(await screen.findByRole('button', { name: /Edit/i }));
      const connection = screen.getByLabelText('Connection Type');

      expect(within(connection).getByRole('option', { name: 'PPPoE' })).toBeInTheDocument();
      expect(within(connection).getByRole('option', { name: 'PPPoE Dual' })).toBeInTheDocument();
      expect(within(connection).queryByRole('option', { name: 'Static' })).not.toBeInTheDocument();
      expect(within(connection).queryByRole('option', { name: 'Dual' })).not.toBeInTheDocument();
    });

    it('does not expose or submit lifecycle status from the generic Edit form', async () => {
      mockApiPut.mockResolvedValue({ data: { data: contract1 }, error: undefined });
      renderContractList();
      await waitFor(() => expect(screen.getByText('10.0.0.1')).toBeInTheDocument());

      fireEvent.click(screen.getByRole('button', { name: /Edit/i }));
      const dialog = await screen.findByRole('dialog', { name: /Edit Contract/i });
      expect(within(dialog).queryByLabelText('Status')).not.toBeInTheDocument();

      fireEvent.click(within(dialog).getByRole('button', { name: 'Save Changes' }));
      await waitFor(() => expect(mockApiPut).toHaveBeenCalled());
      const request = mockApiPut.mock.calls[0][1] as { body: Record<string, unknown> };
      expect(request.body).not.toHaveProperty('status');
      expect(request.body).not.toHaveProperty('facturar');
    });

    it('defaults escalation_enabled ON and escalate_on_disconnect OFF when the contract has neither field set, and both are togglable', async () => {
      renderContractList();
      await waitFor(() => expect(screen.getByText('10.0.0.1')).toBeInTheDocument());

      fireEvent.click(screen.getByRole('button', { name: /Edit/i }));
      await waitFor(() => expect(screen.getByText('📝 Edit Contract #1')).toBeInTheDocument());

      const enabledCheckbox = screen.getByLabelText('Auto-escalation enabled') as HTMLInputElement;
      const disconnectCheckbox = screen.getByLabelText('Escalate on disconnection (client has UPS)') as HTMLInputElement;

      // contract1 fixture has no escalation_enabled/escalate_on_disconnect
      // fields at all (undefined) — matches "no value yet" for a contract
      // created before migration 387 backfilled the DB default.
      expect(enabledCheckbox.checked).toBe(true);
      expect(disconnectCheckbox.checked).toBe(false);

      fireEvent.click(enabledCheckbox);
      fireEvent.click(disconnectCheckbox);
      expect(enabledCheckbox.checked).toBe(false);
      expect(disconnectCheckbox.checked).toBe(true);
    });

    it('respects an explicit escalation_enabled: false on the contract', async () => {
      mockApiGet.mockImplementation((path: string) => {
        if (path === '/contracts')
          return Promise.resolve({
            data: { data: [{ ...contract1, escalation_enabled: 0, escalate_on_disconnect: 1 }], meta: { total: 1, page: 1, limit: 20, totalPages: 1 } },
            error: undefined,
          });
        if (path === '/plans') return Promise.resolve({ data: { data: [] }, error: undefined });
        if (path === '/clients') return Promise.resolve({ data: { data: [client1] }, error: undefined });
        return Promise.resolve({ data: { data: [] }, error: undefined });
      });

      renderContractList();
      await waitFor(() => expect(screen.getByText('10.0.0.1')).toBeInTheDocument());
      fireEvent.click(screen.getByRole('button', { name: /Edit/i }));
      await waitFor(() => expect(screen.getByText('📝 Edit Contract #1')).toBeInTheDocument());

      expect((screen.getByLabelText('Auto-escalation enabled') as HTMLInputElement).checked).toBe(false);
      expect((screen.getByLabelText('Escalate on disconnection (client has UPS)') as HTMLInputElement).checked).toBe(true);
    });
  });

  it('sends a pending contract to guided activation and does not offer Suspend', async () => {
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/contracts') return Promise.resolve({
        data: { data: [{ ...contract1, status: 'pending' }], meta: { total: 1, page: 1, limit: 20, totalPages: 1 } },
        error: undefined,
      });
      if (path === '/plans') return Promise.resolve({ data: { data: [] }, error: undefined });
      if (path === '/clients') return Promise.resolve({ data: { data: [client1] }, error: undefined });
      return Promise.resolve({ data: { data: [] }, error: undefined });
    });

    renderContractList();
    const activate = await screen.findByRole('link', { name: /Activate/ });
    expect(activate).toHaveAttribute('href', '/contracts/1');
    expect(screen.queryByRole('button', { name: /Suspend/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Delete/ })).not.toBeInTheDocument();
  });

  it('cancels a pending contract through the canonical activation shutdown command', async () => {
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/contracts') return Promise.resolve({
        data: { data: [{ ...contract1, status: 'pending' }], meta: { total: 1, page: 1, limit: 20, totalPages: 1 } },
        error: undefined,
      });
      if (path === '/plans') return Promise.resolve({ data: { data: [] }, error: undefined });
      if (path === '/clients') return Promise.resolve({ data: { data: [client1] }, error: undefined });
      return Promise.resolve({ data: { data: [] }, error: undefined });
    });
    renderContractList();

    fireEvent.click(await screen.findByRole('button', { name: /Cancel/ }));
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Yes, confirm' }));

    await waitFor(() => expect(mockAuthedFetch).toHaveBeenCalledWith(
      '/api/v1/contracts/1/activation/cancel',
      { method: 'POST' },
    ));
  });

  it('navigates a never-activated renewal to its required activation workflow', async () => {
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/contracts') return Promise.resolve({
        data: { data: [{ ...contract1, status: 'cancelled' }], meta: { total: 1, page: 1, limit: 20, totalPages: 1 } },
        error: undefined,
      });
      if (path === '/plans') return Promise.resolve({ data: { data: [] }, error: undefined });
      if (path === '/clients') return Promise.resolve({ data: { data: [client1] }, error: undefined });
      return Promise.resolve({ data: { data: [] }, error: undefined });
    });
    mockAuthedFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ data: { status: 'pending', activation_required: true } }),
    });
    renderContractList();

    fireEvent.click(await screen.findByRole('button', { name: /Renew/ }));
    const dialog = await screen.findByRole('dialog', { name: /Renew Contract/i });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Renew' }));

    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/contracts/1'));
  });

  it('surfaces a RouterOS restore failure after renewal and links to the safe retry', async () => {
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/contracts') return Promise.resolve({
        data: { data: [{ ...contract1, status: 'cancelled' }], meta: { total: 1, page: 1, limit: 20, totalPages: 1 } },
        error: undefined,
      });
      if (path === '/plans') return Promise.resolve({ data: { data: [] }, error: undefined });
      if (path === '/clients') return Promise.resolve({ data: { data: [client1] }, error: undefined });
      return Promise.resolve({ data: { data: [] }, error: undefined });
    });
    mockAuthedFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: { status: 'active', activation_required: false },
        network_activation: { nas_pushed: false, nas_push_error: 'router timeout' },
      }),
    });
    renderContractList();

    fireEvent.click(await screen.findByRole('button', { name: /Renew/ }));
    const dialog = await screen.findByRole('dialog', { name: /Renew Contract/i });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Renew' }));

    expect(await screen.findByText(/router timeout/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Open the contract to retry/ })).toHaveAttribute('href', '/contracts/1');
  });

  it('keeps the MX-only CFDI option out of global create and edit forms', async () => {
    renderContractList();
    await waitFor(() => expect(screen.getByText('10.0.0.1')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: '+ New Contract' }));
    expect(screen.queryByLabelText(/Generate CFDI invoice automatically/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    fireEvent.click(screen.getByRole('button', { name: /Edit/i }));
    expect(screen.queryByLabelText(/Generate CFDI invoice automatically/)).not.toBeInTheDocument();
  });

  it('creates an MX contract with the exact source shared by active activation documents', async () => {
    mockLocale = 'MX';
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/contracts') return Promise.resolve({
        data: { data: [], meta: { total: 0, page: 1, limit: 20, totalPages: 0 } },
        error: undefined,
      });
      if (path === '/plans') return Promise.resolve({ data: { data: [{ id: 2, name: 'Fiber 100' }] }, error: undefined });
      if (path === '/clients') return Promise.resolve({ data: { data: [client1] }, error: undefined });
      if (path === '/document-templates') return Promise.resolve({
        data: { data: [{ id: 15, template_type: 'activation_contract', contract_template_mx_id: 77, is_active: 1 }] },
        error: undefined,
      });
      if (path === '/consumer-protection/contract-templates-mx/77') return Promise.resolve({
        data: { data: {
          id: 77,
          template_name: 'PROFECO Internet 2026',
          ift_registration_number: 'IFT-77',
          registered_at: '2026-07-01',
          version: '2026.1',
          template_body: 'Exact registered terms',
          status: 'registered',
        } },
        error: undefined,
      });
      return Promise.resolve({ data: { data: [] }, error: undefined });
    });
    mockApiPost.mockResolvedValue({ data: { data: { id: 91 } }, error: undefined });
    renderContractList();

    fireEvent.click(await screen.findByRole('button', { name: '+ New Contract' }));
    fireEvent.change(screen.getByLabelText(/Client \*/), { target: { value: '10' } });
    fireEvent.change(screen.getByLabelText(/Plan \*/), { target: { value: '2' } });
    const source = await screen.findByRole('option', { name: 'PROFECO Internet 2026' });
    fireEvent.change(source.closest('select')!, { target: { value: '77' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Contract' }));

    await waitFor(() => expect(mockApiPost).toHaveBeenCalledWith(
      '/contracts',
      expect.objectContaining({ body: expect.objectContaining({ contract_template_mx_id: 77 }) }),
    ));
    expect(screen.queryByRole('option', { name: /Unrelated registered source/ })).not.toBeInTheDocument();
  });

  it('lets an MX contract creator omit the source when legal-template metadata is not viewable', async () => {
    mockLocale = 'MX';
    mockRole = 'custom';
    mockPermissions = ['contracts.create'];
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/contracts') return Promise.resolve({
        data: { data: [], meta: { total: 0, page: 1, limit: 20, totalPages: 0 } },
        error: undefined,
      });
      if (path === '/plans') return Promise.resolve({ data: { data: [{ id: 2, name: 'Fiber 100' }] }, error: undefined });
      if (path === '/clients') return Promise.resolve({ data: { data: [client1] }, error: undefined });
      return Promise.resolve({ data: { data: [] }, error: undefined });
    });
    mockApiPost.mockResolvedValue({ data: { data: { id: 92 } }, error: undefined });
    renderContractList();

    fireEvent.click(await screen.findByRole('button', { name: '+ New Contract' }));
    fireEvent.change(screen.getByLabelText(/Client \*/), { target: { value: '10' } });
    fireEvent.change(screen.getByLabelText(/Plan \*/), { target: { value: '2' } });
    expect(screen.getByText(/server will apply the exact source/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Create Contract' }));

    await waitFor(() => expect(mockApiPost).toHaveBeenCalled());
    const body = mockApiPost.mock.calls[0][1].body as Record<string, unknown>;
    expect(body).not.toHaveProperty('contract_template_mx_id');
    expect(mockApiGet).not.toHaveBeenCalledWith('/document-templates');
  });

  it('repairs a pending MX contract to the source used by the active activation document', async () => {
    mockLocale = 'MX';
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/contracts') return Promise.resolve({
        data: { data: [{ ...contract1, status: 'pending', contract_template_mx_id: 66 }], meta: { total: 1, page: 1, limit: 20, totalPages: 1 } },
        error: undefined,
      });
      if (path === '/plans') return Promise.resolve({ data: { data: [{ id: 2, name: 'Fiber 100' }] }, error: undefined });
      if (path === '/clients') return Promise.resolve({ data: { data: [client1] }, error: undefined });
      if (path === '/document-templates') return Promise.resolve({
        data: { data: [{ id: 15, template_type: 'activation_contract', contract_template_mx_id: 77, is_active: 1 }] },
        error: undefined,
      });
      if (path === '/consumer-protection/contract-templates-mx/77') return Promise.resolve({
        data: { data: {
          id: 77,
          template_name: 'PROFECO Internet 2026',
          ift_registration_number: 'IFT-77',
          registered_at: '2026-07-01',
          version: '2026.1',
          template_body: 'Exact registered terms',
          status: 'registered',
        } },
        error: undefined,
      });
      return Promise.resolve({ data: { data: [] }, error: undefined });
    });
    mockApiPut.mockResolvedValue({ data: { data: contract1 }, error: undefined });
    renderContractList();

    fireEvent.click(await screen.findByRole('button', { name: /Edit/i }));
    const source = await screen.findByRole('option', { name: 'PROFECO Internet 2026' });
    fireEvent.change(source.closest('select')!, { target: { value: '77' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

    await waitFor(() => expect(mockApiPut).toHaveBeenCalledWith(
      '/contracts/{id}',
      expect.objectContaining({ body: expect.objectContaining({ contract_template_mx_id: 77 }) }),
    ));
  });

  describe('Edit Contract modal — diagnostic threshold overrides (migration 388)', () => {
    it('pre-fills blank when the contract has no overrides set, and Save omits nothing — sends explicit null for every blank field', async () => {
      mockApiPut.mockResolvedValue({ data: { data: contract1 }, error: undefined });
      renderContractList();
      await waitFor(() => expect(screen.getByText('10.0.0.1')).toBeInTheDocument());

      fireEvent.click(screen.getByRole('button', { name: /Edit/i }));
      await waitFor(() => expect(screen.getByText('📝 Edit Contract #1')).toBeInTheDocument());

      const optical = screen.getByLabelText('Fiber optical threshold override (dBm)') as HTMLInputElement;
      const wirelessSignal = screen.getByLabelText('Wireless signal threshold override (dBm)') as HTMLInputElement;
      const capacity = screen.getByLabelText('Wireless link-capacity threshold override (Mbps)') as HTMLInputElement;
      expect(optical.value).toBe('');
      expect(wirelessSignal.value).toBe('');
      expect(capacity.value).toBe('');

      fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

      await waitFor(() =>
        expect(mockApiPut).toHaveBeenCalledWith(
          '/contracts/{id}',
          expect.objectContaining({
            body: expect.objectContaining({
              optical_min_dbm: null,
              wireless_signal_min_dbm: null,
              wireless_link_capacity_min_mbps: null,
            }),
          }),
        ),
      );
    });

    it('pre-fills existing override values from the contract and round-trips an edited value as a number', async () => {
      mockApiGet.mockImplementation((path: string) => {
        if (path === '/contracts')
          return Promise.resolve({
            data: {
              data: [{ ...contract1, optical_min_dbm: -30, wireless_signal_min_dbm: -68, wireless_link_capacity_min_mbps: '15.00' }],
              meta: { total: 1, page: 1, limit: 20, totalPages: 1 },
            },
            error: undefined,
          });
        if (path === '/plans') return Promise.resolve({ data: { data: [] }, error: undefined });
        if (path === '/clients') return Promise.resolve({ data: { data: [client1] }, error: undefined });
        return Promise.resolve({ data: { data: [] }, error: undefined });
      });
      mockApiPut.mockResolvedValue({ data: { data: contract1 }, error: undefined });

      renderContractList();
      await waitFor(() => expect(screen.getByText('10.0.0.1')).toBeInTheDocument());
      fireEvent.click(screen.getByRole('button', { name: /Edit/i }));
      await waitFor(() => expect(screen.getByText('📝 Edit Contract #1')).toBeInTheDocument());

      const optical = screen.getByLabelText('Fiber optical threshold override (dBm)') as HTMLInputElement;
      const wirelessSignal = screen.getByLabelText('Wireless signal threshold override (dBm)') as HTMLInputElement;
      const capacity = screen.getByLabelText('Wireless link-capacity threshold override (Mbps)') as HTMLInputElement;
      expect(optical.value).toBe('-30');
      expect(wirelessSignal.value).toBe('-68');
      // DECIMAL(8,2) round-trips as the exact string the API returned
      // ("15.00", not "15") — the form doesn't reformat it, only Number()s
      // it on submit.
      expect(capacity.value).toBe('15.00');

      await userEvent.clear(optical);
      await userEvent.type(optical, '-35');
      fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

      await waitFor(() =>
        expect(mockApiPut).toHaveBeenCalledWith(
          '/contracts/{id}',
          expect.objectContaining({
            body: expect.objectContaining({
              optical_min_dbm: -35,
              wireless_signal_min_dbm: -68,
              wireless_link_capacity_min_mbps: 15,
            }),
          }),
        ),
      );
    });
  });

  describe('RADIUS credentials modal (split base/credentials fetch)', () => {
    const radiusAccount = { id: 99, username: 'sub_ada', status: 'active', ip_address: null, ipv6_address: null, auth_method: 'pppoe', mac_address: null, vlan_id: null, profile: null, nas_id: null };

    it('shows the cleartext password after reveal when the credentials fetch succeeds', async () => {
      mockApiGet.mockImplementation((path: string) => {
        if (path === '/contracts')
          return Promise.resolve({ data: { data: [contract1], meta: { total: 1, page: 1, limit: 20, totalPages: 1 } }, error: undefined });
        if (path === '/plans') return Promise.resolve({ data: { data: [] }, error: undefined });
        if (path === '/clients') return Promise.resolve({ data: { data: [client1] }, error: undefined });
        if (path === '/radius/contract/{contractId}')
          return Promise.resolve({ data: { data: [radiusAccount] }, error: undefined });
        if (path === '/radius/contract/{contractId}/credentials')
          return Promise.resolve({ data: { data: [{ ...radiusAccount, password: 'topsecret' }] }, error: undefined });
        return Promise.resolve({ data: { data: [] }, error: undefined });
      });

      renderContractList();
      await waitFor(() => expect(screen.getByText('10.0.0.1')).toBeInTheDocument());
      fireEvent.click(screen.getByRole('button', { name: /Credentials/ }));

      await waitFor(() => expect(screen.getByText('sub_ada')).toBeInTheDocument());
      expect(screen.queryByText('topsecret')).not.toBeInTheDocument();

      const showBtn = await screen.findByRole('button', { name: 'Show' });
      fireEvent.click(showBtn);
      expect(screen.getByText('topsecret')).toBeInTheDocument();
    });

    it('shows an insufficient-permission note in place of the password when the credentials fetch 403s, while the account itself stays visible', async () => {
      mockApiGet.mockImplementation((path: string) => {
        if (path === '/contracts')
          return Promise.resolve({ data: { data: [contract1], meta: { total: 1, page: 1, limit: 20, totalPages: 1 } }, error: undefined });
        if (path === '/plans') return Promise.resolve({ data: { data: [] }, error: undefined });
        if (path === '/clients') return Promise.resolve({ data: { data: [client1] }, error: undefined });
        if (path === '/radius/contract/{contractId}')
          return Promise.resolve({ data: { data: [radiusAccount] }, error: undefined });
        if (path === '/radius/contract/{contractId}/credentials')
          return Promise.resolve({ data: undefined, error: { error: { code: 'FORBIDDEN' } }, response: { status: 403 } });
        return Promise.resolve({ data: { data: [] }, error: undefined });
      });

      renderContractList();
      await waitFor(() => expect(screen.getByText('10.0.0.1')).toBeInTheDocument());
      fireEvent.click(screen.getByRole('button', { name: /Credentials/ }));

      // Username / account still visible — only the password field is gated.
      await waitFor(() => expect(screen.getByText('sub_ada')).toBeInTheDocument());
      expect(screen.queryByRole('button', { name: 'Show' })).not.toBeInTheDocument();
      await waitFor(() => expect(screen.getByText(/Insufficient permission to view the password/)).toBeInTheDocument());
    });
  });
});
