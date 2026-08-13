import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/api/client', () => ({
  api: { GET: vi.fn(), POST: vi.fn() },
  tokenStore: { getAccess: () => 'tok', setAccess: vi.fn(), getRefresh: () => null, setRefresh: vi.fn(), clear: vi.fn() },
}));

import { api } from '@/api/client';
import { NewContractModal } from '../NewContractModal';

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

function renderModal() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onCreated = vi.fn();
  render(
    <QueryClientProvider client={qc}>
      <NewContractModal lockedClientId={9} lockedClientName="Acme Corp" onClose={vi.fn()} onCreated={onCreated} />
    </QueryClientProvider>,
  );
  return { onCreated };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockLocale = 'global';
  mockRole = 'admin';
  mockPermissions = undefined;
  (api.GET as unknown as ReturnType<typeof vi.fn>).mockImplementation((path: string) => {
    if (path === '/plans') {
      return Promise.resolve({ data: { data: [{ id: 3, name: 'Gold 100Mbps' }] }, error: undefined });
    }
    if (path === '/document-templates') {
      return Promise.resolve({
        data: { data: [{ id: 15, template_type: 'activation_contract', contract_template_mx_id: 77, contract_template_mx_environment: 'production', is_active: 1 }] },
        error: undefined,
      });
    }
    if (path === '/consumer-protection/contract-environment') {
      return Promise.resolve({ data: { data: { contract_environment: 'production' } }, error: undefined });
    }
    if (path === '/consumer-protection/contract-templates-mx/77') {
      return Promise.resolve({
        data: { data: {
          id: 77,
          template_name: 'PROFECO Internet 2026',
          ift_registration_number: 'IFT-77',
          registered_at: '2026-07-01',
          version: '2026.1',
          template_body: 'Exact registered terms',
          status: 'registered',
          environment: 'production',
        } },
        error: undefined,
      });
    }
    return Promise.resolve({ data: { data: [] }, error: undefined });
  });
  (api.POST as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { data: { id: 1 } }, error: undefined });
});

describe('NewContractModal', () => {
  it('locks the client, lists plans, and POSTs /contracts with client_id + plan_id', async () => {
    const { onCreated } = renderModal();
    expect(screen.getByDisplayValue('Acme Corp')).toBeInTheDocument();

    const planOpt = await screen.findByRole('option', { name: 'Gold 100Mbps' }) as HTMLOptionElement;
    fireEvent.change(planOpt.closest('select')!, { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Contract' }));

    await waitFor(() => expect(api.POST).toHaveBeenCalledWith(
      '/contracts',
      expect.objectContaining({ body: expect.objectContaining({ client_id: 9, plan_id: 3, connection_type: 'pppoe' }) }),
    ));
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(onCreated).toHaveBeenCalledWith(1);
    const body = (api.POST as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1].body;
    expect(body).not.toHaveProperty('facturar');
  });

  it('shows and submits the CFDI option only for an MX organization', async () => {
    mockLocale = 'MX';
    renderModal();
    const planOpt = await screen.findByRole('option', { name: 'Gold 100Mbps' }) as HTMLOptionElement;
    fireEvent.change(planOpt.closest('select')!, { target: { value: '3' } });
    const source = await screen.findByRole('option', { name: 'PROFECO Internet 2026' });
    fireEvent.change(source.closest('select')!, { target: { value: '77' } });
    fireEvent.click(screen.getByLabelText('Generate CFDI invoice automatically'));
    fireEvent.click(screen.getByRole('button', { name: 'Create Contract' }));

    await waitFor(() => expect(api.POST).toHaveBeenCalledWith(
      '/contracts',
      expect.objectContaining({ body: expect.objectContaining({ facturar: true, contract_template_mx_id: 77 }) }),
    ));
  });

  it('offers only the source linked by every active activation document', async () => {
    mockLocale = 'MX';
    renderModal();

    const source = await screen.findByRole('option', { name: 'PROFECO Internet 2026' });
    expect(source).toHaveValue('77');
    expect(screen.queryByRole('option', { name: /Unrelated registered source/ })).not.toBeInTheDocument();
    expect(api.GET).toHaveBeenCalledWith('/consumer-protection/contract-templates-mx/77');
    expect(api.GET).not.toHaveBeenCalledWith('/consumer-protection/contract-templates-mx');
  });

  it('resolves only the active template from the organization contract environment', async () => {
    mockLocale = 'MX';
    (api.GET as unknown as ReturnType<typeof vi.fn>).mockImplementation((path: string) => {
      if (path === '/plans') {
        return Promise.resolve({ data: { data: [{ id: 3, name: 'Gold 100Mbps' }] }, error: undefined });
      }
      if (path === '/consumer-protection/contract-environment') {
        return Promise.resolve({ data: { data: { contract_environment: 'sandbox' } }, error: undefined });
      }
      if (path === '/document-templates') {
        return Promise.resolve({ data: { data: [
          { id: 15, template_type: 'activation_contract', contract_template_mx_id: 77, contract_template_mx_environment: 'production', is_active: 1 },
          { id: 16, template_type: 'activation_contract', contract_template_mx_id: 88, contract_template_mx_environment: 'sandbox', is_active: 1 },
        ] }, error: undefined });
      }
      if (path === '/consumer-protection/contract-templates-mx/88') {
        return Promise.resolve({ data: { data: {
          id: 88,
          template_name: 'Sandbox contract test',
          ift_registration_number: null,
          registered_at: null,
          version: 'sim-1',
          template_body: 'TEST / SIMULATION',
          status: 'sandbox_ready',
          environment: 'sandbox',
        } }, error: undefined });
      }
      return Promise.resolve({ data: { data: [] }, error: undefined });
    });

    renderModal();
    const source = await screen.findByRole('option', { name: 'Sandbox contract test' });
    expect(source).toHaveValue('88');
    expect(screen.getByTestId('mx-contract-sandbox-banner')).toHaveTextContent(/NO LEGAL EFFECT/);
    expect(api.GET).toHaveBeenCalledWith('/consumer-protection/contract-templates-mx/88');
    expect(api.GET).not.toHaveBeenCalledWith('/consumer-protection/contract-templates-mx/77');
  });

  it('warns about ambiguous active sources while leaving final derivation to the create endpoint', async () => {
    mockLocale = 'MX';
    (api.GET as unknown as ReturnType<typeof vi.fn>).mockImplementation((path: string) => {
      if (path === '/plans') {
        return Promise.resolve({ data: { data: [{ id: 3, name: 'Gold 100Mbps' }] }, error: undefined });
      }
      if (path === '/document-templates') {
        return Promise.resolve({ data: { data: [
          { id: 15, template_type: 'activation_contract', contract_template_mx_id: 77, contract_template_mx_environment: 'production', is_active: 1 },
          { id: 16, template_type: 'activation_contract', contract_template_mx_id: 88, contract_template_mx_environment: 'production', is_active: 1 },
        ] }, error: undefined });
      }
      if (path === '/consumer-protection/contract-environment') {
        return Promise.resolve({ data: { data: { contract_environment: 'production' } }, error: undefined });
      }
      return Promise.resolve({ data: { data: [] }, error: undefined });
    });
    renderModal();

    expect(await screen.findByText(/reference different sources/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create Contract' })).not.toBeDisabled();
    expect(api.GET).not.toHaveBeenCalledWith('/consumer-protection/contract-templates-mx');
    expect(api.POST).not.toHaveBeenCalled();
  });

  it('does not query MX legal-document endpoints or send an MX source for global organizations', async () => {
    renderModal();
    await screen.findByRole('option', { name: 'Gold 100Mbps' });

    expect(api.GET).not.toHaveBeenCalledWith('/document-templates');
    expect((api.GET as unknown as ReturnType<typeof vi.fn>).mock.calls.some(
      ([path]) => String(path).includes('/consumer-protection/contract-templates-mx'),
    )).toBe(false);
    expect(screen.queryByLabelText('Registered MX contract source *')).not.toBeInTheDocument();
  });

  it('lets an MX contract creator rely on server derivation without legal-template view permissions', async () => {
    mockLocale = 'MX';
    mockRole = 'custom';
    mockPermissions = ['contracts.create'];
    renderModal();

    const planOpt = await screen.findByRole('option', { name: 'Gold 100Mbps' }) as HTMLOptionElement;
    fireEvent.change(planOpt.closest('select')!, { target: { value: '3' } });
    expect(screen.getByText(/server will apply the exact source/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create Contract' })).not.toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Create Contract' }));

    await waitFor(() => expect(api.POST).toHaveBeenCalled());
    const body = (api.POST as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1].body;
    expect(body).not.toHaveProperty('contract_template_mx_id');
    expect(api.GET).not.toHaveBeenCalledWith('/document-templates');
  });
});
