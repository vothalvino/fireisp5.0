// =============================================================================
// FireISP 5.0 — ContractList page tests
// =============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { ContractList } from '../ContractList';

// ---------------------------------------------------------------------------
// Mock API client
// ---------------------------------------------------------------------------

const mockApiGet = vi.fn();
vi.mock('@/api/client', () => ({
  api: { GET: (...args: unknown[]) => mockApiGet(...args) },
  tokenStore: { getAccess: () => 'tok', setAccess: vi.fn(), getRefresh: () => null, setRefresh: vi.fn(), clear: vi.fn() },
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
      </MemoryRouter>
    </QueryClientProvider>
  );
}

const client1 = { id: 10, name: 'Acme Corp', email: 'a@example.com', status: 'active' };

describe('ContractList page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
