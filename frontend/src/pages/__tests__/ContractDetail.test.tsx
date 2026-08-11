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
const mockApiPost = vi.fn();
vi.mock('@/api/client', () => ({
  api: { GET: (...a: unknown[]) => mockApiGet(...a), POST: (...a: unknown[]) => mockApiPost(...a), PUT: vi.fn(), DELETE: vi.fn() },
  tokenStore: { getAccess: () => 'tok', setAccess: vi.fn(), getRefresh: () => null, setRefresh: vi.fn(), clear: vi.fn() },
  authedFetch: vi.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(input, init)),
}));

let mockRole = 'admin';
let mockLocale: 'global' | 'MX' = 'global';
let mockPermissions: string[] | undefined;
vi.mock('@/auth/AuthContext', () => ({
  useAuth: () => ({ user: { id: 1, role: mockRole, permissions: mockPermissions, organization_locale: mockLocale } }),
}));

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
  mockLocale = 'global';
  mockPermissions = undefined;
  mockGql.mockResolvedValue({ contract: makeContract('pppoe') });
  mockApiGet.mockResolvedValue({ data: { data: [radiusAccount] }, error: undefined });
  mockApiPost.mockResolvedValue({ data: { data: {} }, error: undefined });
  global.fetch = vi.fn();
});

function jsonResponse(data: unknown, ok = true) {
  return Promise.resolve({ ok, json: async () => ({ data }) } as Response);
}

function pendingActivation(overrides: Record<string, unknown> = {}) {
  return {
    contract_id: 5,
    client_id: 3,
    status: 'pending',
    connection_type: 'pppoe',
    test_window_expires_at: null,
    radius_status: 'inactive',
    service_order: { id: 71, order_number: 'SO-71', status: 'in_process', assigned_to: 4, started_at: '2026-08-10T10:00:00Z' },
    work_order: { id: 81, status: 'in_progress', assigned_to: 4, acceptance: null },
    documents: [],
    speed_test: null,
    can_activate: false,
    blockers: ['work_order_not_completed', 'acceptance_missing', 'speed_test_missing'],
    ...overrides,
  };
}

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
    expect(global.fetch).not.toHaveBeenCalledWith(
      '/api/v1/contracts/5/regenerate-pppoe',
      expect.objectContaining({ method: 'POST' }),
    );

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
    expect(global.fetch).not.toHaveBeenCalledWith(
      '/api/v1/contracts/5/regenerate-pppoe',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('does not show a PPPoE tab for a non-PPPoE contract', async () => {
    mockGql.mockResolvedValue({ contract: makeContract('ipoe') });
    renderDetail();
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Contract #5' })).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'PPPoE' })).not.toBeInTheDocument();
  });
});

// =============================================================================
// Pending-contract activation handoff
// =============================================================================
describe('ContractDetail — guided activation', () => {
  beforeEach(() => {
    mockGql.mockResolvedValue({ contract: { ...makeContract('pppoe'), status: 'pending' } });
  });

  it('shows the staged activation card on a pending contract and never offers Suspend', async () => {
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => jsonResponse(pendingActivation()));
    renderDetail();

    expect(await screen.findByRole('heading', { name: 'Activate contract' })).toBeInTheDocument();
    expect(screen.getAllByText(/Line OFF until permanent activation/).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Suspend' })).not.toBeInTheDocument();
    expect(screen.getByText(/Record the technician speed-test result/)).toBeInTheDocument();
  });

  it('does not offer preparation to a contract editor without installations.start', async () => {
    mockRole = 'custom';
    mockPermissions = ['contracts.view', 'contracts.update'];
    const state = pendingActivation({
      service_order: null,
      service_order_prepared: false,
      work_order: null,
      work_order_prepared: false,
      blockers: ['service_order_missing', 'work_order_missing'],
    });
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => jsonResponse(state));
    renderDetail();

    expect(await screen.findByText(/requires both contracts.update and installations.start/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Prepare installation visit' })).not.toBeInTheDocument();
    expect((global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.some(
      ([url, init]) => String(url).endsWith('/activation/prepare') && init?.method === 'POST',
    )).toBe(false);
  });

  it('lets a contract operator reassign an unfinished activation visit', async () => {
    mockApiGet.mockImplementation((path: unknown) => {
      if (path === '/work-orders/assignable-users') {
        return Promise.resolve({
          data: { data: [{ id: 7, first_name: 'Ada', last_name: 'Lovelace' }] },
          error: undefined,
        });
      }
      return Promise.resolve({ data: { data: [radiusAccount] }, error: undefined });
    });
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation((_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') {
        return jsonResponse(pendingActivation({
          service_order: { id: 71, order_number: 'SO-71', status: 'in_process', assigned_to: 7, started_at: '2026-08-10T10:00:00Z' },
          work_order: { id: 81, status: 'assigned', assigned_to: 7, acceptance: null },
        }));
      }
      return jsonResponse(pendingActivation());
    });
    renderDetail();

    fireEvent.click(await screen.findByRole('button', { name: 'Reassign technician' }));
    fireEvent.change(await screen.findByLabelText('Technician (optional)'), { target: { value: '7' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reassign technician' }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
      '/api/v1/contracts/5/activation/prepare',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ assigned_to: 7 }) }),
    ));
  });

  it('cancels the linked activation visit through the fail-closed contract command', async () => {
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation((_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') {
        return jsonResponse({
          ...pendingActivation(),
          status: 'cancelled',
          test_window_cleanup_pending: true,
          cancelled: true,
          cancellation: { contract_cancelled: true, service_order_id: 71, service_order_cancelled: true },
        });
      }
      return jsonResponse(pendingActivation());
    });
    renderDetail();

    fireEvent.click(await screen.findByRole('button', { name: 'Cancel activation' }));
    expect(screen.getByText(/Cancel the installation visit/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel activation' }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
      '/api/v1/contracts/5/activation/cancel',
      { method: 'POST' },
    ));
    expect(await screen.findByText(/Activation and the installation visit were cancelled/)).toBeInTheDocument();
    expect(screen.getByText(/live-session shutdown is still being verified/)).toBeInTheDocument();
    expect(screen.queryByText(/subscriber line (is|are) off/i)).not.toBeInTheDocument();
  });

  it('clears stale cancellation success and returns a never-activated renewal to the activation card', async () => {
    let contractStatus = 'pending';
    let renewed = false;
    let recommissioned = false;
    const readyState = pendingActivation({
      work_order: { id: 81, status: 'completed', assigned_to: 4, acceptance: { acceptance_signal_dbm: -61 } },
      speed_test: { download_mbps: 100, upload_mbps: 50 },
      can_activate: true,
      blockers: [],
    });
    const closedState = pendingActivation({
      service_order: {
        id: 71,
        order_number: 'SO-71',
        status: 'cancelled',
        assigned_to: 4,
        started_at: '2026-08-10T10:00:00Z',
      },
      work_order: { id: 81, status: 'completed', assigned_to: 4, acceptance: { acceptance_signal_dbm: -61 } },
      speed_test: { download_mbps: 100, upload_mbps: 50 },
      can_activate: false,
      blockers: ['service_order_not_in_process'],
    });
    mockGql.mockImplementation(() => Promise.resolve({
      contract: { ...makeContract('pppoe'), status: contractStatus },
    }));
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/activation/cancel') && init?.method === 'POST') {
        contractStatus = 'cancelled';
        return jsonResponse({
          ...pendingActivation(),
          status: 'cancelled',
          cancelled: true,
          cancellation: { contract_cancelled: true, service_order_id: 71, service_order_cancelled: true },
        });
      }
      if (url.endsWith('/renew') && init?.method === 'POST') {
        contractStatus = 'pending';
        renewed = true;
        return jsonResponse({ status: 'pending', activation_required: true });
      }
      if (url.endsWith('/activation/prepare') && init?.method === 'POST') {
        recommissioned = true;
        return jsonResponse(readyState);
      }
      if (url.endsWith('/activate') && init?.method === 'POST') {
        contractStatus = 'active';
        return jsonResponse({ ...readyState, status: 'active' });
      }
      return jsonResponse(recommissioned ? readyState : renewed ? closedState : pendingActivation());
    });
    renderDetail();

    fireEvent.click(await screen.findByRole('button', { name: 'Cancel activation' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel activation' }));
    expect(await screen.findByText(/Activation and the installation visit were cancelled/)).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: 'Renew' }));

    expect(await screen.findByRole('heading', { name: 'Activate contract' })).toBeInTheDocument();
    expect(screen.queryByText(/Activation and the installation visit were cancelled/)).not.toBeInTheDocument();
    expect(screen.getAllByText(/Line OFF until permanent activation/).length).toBeGreaterThan(0);

    fireEvent.click(await screen.findByRole('button', { name: 'Create replacement commissioning visit' }));
    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
      '/api/v1/contracts/5/activation/prepare',
      expect.objectContaining({ method: 'POST' }),
    ));

    const activateButton = screen.getByRole('button', { name: 'Activate contract permanently' });
    await waitFor(() => expect(activateButton).not.toBeDisabled());
    fireEvent.click(activateButton);
    expect(await screen.findByText(/subscriber line is now permanently on/i)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText(/Line OFF until permanent activation/)).not.toBeInTheDocument());
  });

  it('surfaces a commissioning-technician lookup failure instead of showing an unexplained empty picker', async () => {
    mockApiGet.mockImplementation((path: unknown) => {
      if (path === '/work-orders/assignable-users') {
        return Promise.resolve({
          data: undefined,
          error: { error: { message: 'Technician directory unavailable' } },
        });
      }
      return Promise.resolve({ data: { data: [radiusAccount] }, error: undefined });
    });
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => jsonResponse(pendingActivation({
      service_order: { id: 71, order_number: 'SO-71', status: 'in_process', assigned_to: null, started_at: '2026-08-10T10:00:00Z' },
      work_order: { id: 81, status: 'pending', assigned_to: null, acceptance: null },
    })));
    renderDetail();

    expect(await screen.findByText('Technician directory unavailable')).toBeInTheDocument();
  });

  it('offers a replacement commissioning visit for a historical completed work order missing evidence', async () => {
    const historical = pendingActivation({
      work_order: { id: 81, status: 'completed', assigned_to: 4, acceptance: null },
      speed_test: null,
      blockers: ['acceptance_missing', 'speed_test_missing'],
    });
    const replacement = pendingActivation({
      work_order: { id: 82, status: 'assigned', assigned_to: 4, acceptance: null },
    });
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation((_input: RequestInfo | URL, init?: RequestInit) => (
      init?.method === 'POST' ? jsonResponse(replacement) : jsonResponse(historical)
    ));
    renderDetail();

    expect(await screen.findByText(/activation order is closed or its historical visit lacks/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Create replacement commissioning visit' }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
      '/api/v1/contracts/5/activation/prepare',
      expect.objectContaining({ method: 'POST' }),
    ));
    expect(await screen.findByText('#82')).toBeInTheDocument();
  });

  it('renders the neutral service acknowledgment step for a global organization', async () => {
    const state = pendingActivation({
      documents: [{ id: 41, template_type: 'service_acknowledgment', title: 'Service installation acknowledgment', status: 'pending', signer_name: null, signed_at: null }],
      blockers: ['signature_missing'],
    });
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => jsonResponse(state));
    renderDetail();

    await screen.findByRole('heading', { name: 'Activate contract' });
    expect(screen.getByTestId('activation-documents')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Customer service acknowledgment/ })).toBeInTheDocument();
    expect(screen.getByText('Service installation acknowledgment')).toBeInTheDocument();
    expect(screen.getByText(/does not add jurisdiction-specific legal terms/i)).toBeInTheDocument();
    expect((global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.every(([url]) => !String(url).includes('/signed-documents'))).toBe(true);
  });

  it('captures explicit communication choices with the global handoff signature', async () => {
    const state = pendingActivation({
      documents: [{ id: 41, template_type: 'service_acknowledgment', title: 'Service installation acknowledgment', status: 'pending', signer_name: null, signed_at: null }],
      blockers: ['signature_missing'],
    });
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => jsonResponse(state));
    mockApiGet.mockImplementation((path: unknown) => {
      if (path === '/signed-documents/{id}') {
        return Promise.resolve({
          data: {
            data: {
              id: 41,
              template_type: 'service_acknowledgment',
              title: 'Service installation acknowledgment',
              status: 'pending',
              signer_name: null,
              signed_at: null,
              rendered_body: 'I confirm the **service handoff**.',
              communication_contacts: { email: true, phone: false },
              privacy_notice: {
                version: 'global-2026-08',
                content: '# Customer privacy\nWe use contact details as described here.',
                hash: 'a'.repeat(64),
              },
            },
          },
          error: undefined,
        });
      }
      return Promise.resolve({ data: { data: [radiusAccount] }, error: undefined });
    });
    renderDetail();

    fireEvent.click(await screen.findByRole('button', { name: 'Read & sign' }));
    const dialog = await screen.findByRole('dialog', { name: 'Sign document' });
    expect(await within(dialog).findByText('Customer privacy')).toBeInTheDocument();
    expect(within(dialog).getByText(/version global-2026-08/i)).toBeInTheDocument();

    const email = within(dialog).getByRole('checkbox', { name: 'Email' });
    const sms = within(dialog).getByRole('checkbox', { name: /SMS/ });
    const whatsapp = within(dialog).getByRole('checkbox', { name: /WhatsApp/ });
    const reviewed = within(dialog).getByRole('checkbox', { name: /customer reviewed the privacy notice/i });
    expect(email).not.toBeChecked();
    expect(sms).not.toBeChecked();
    expect(whatsapp).not.toBeChecked();
    expect(sms).toBeDisabled();
    expect(whatsapp).toBeDisabled();

    fireEvent.change(within(dialog).getByLabelText('Full name of signer'), { target: { value: 'Ada Customer' } });
    const canvas = within(dialog).getByTestId('activation-signature-canvas') as HTMLCanvasElement;
    Object.defineProperty(canvas, 'getContext', {
      value: () => ({ beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(), clearRect: vi.fn() }),
    });
    Object.defineProperty(canvas, 'setPointerCapture', { value: vi.fn() });
    Object.defineProperty(canvas, 'toDataURL', { value: () => 'data:image/png;base64,c2ln' });
    fireEvent.pointerDown(canvas, { clientX: 1, clientY: 1, pointerId: 1 });
    fireEvent.pointerMove(canvas, { clientX: 10, clientY: 10, pointerId: 1 });
    fireEvent.pointerUp(canvas, { pointerId: 1 });
    fireEvent.click(email);

    const signButton = within(dialog).getByRole('button', { name: 'Sign document' });
    expect(signButton).toBeDisabled();
    fireEvent.click(reviewed);
    expect(signButton).not.toBeDisabled();
    fireEvent.click(signButton);

    await waitFor(() => expect(mockApiPost).toHaveBeenCalledWith(
      '/signed-documents/{id}/sign',
      expect.objectContaining({
        params: { path: { id: 41 } },
        body: {
          signer_name: 'Ada Customer',
          signature_image: 'data:image/png;base64,c2ln',
          communication_opt_ins: { email: true, sms: false, whatsapp: false },
          communication_choices_confirmed: true,
          privacy_notice_version: 'global-2026-08',
          privacy_notice_hash: 'a'.repeat(64),
        },
      }),
    ));
  });

  it('preserves communication choices already captured by another handoff document', async () => {
    const state = pendingActivation({
      documents: [{ id: 42, template_type: 'service_acknowledgment', title: 'Second handoff acknowledgment', status: 'pending', signer_name: null, signed_at: null }],
      blockers: ['signature_missing'],
    });
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => jsonResponse(state));
    mockApiGet.mockImplementation((path: unknown) => {
      if (path === '/signed-documents/{id}') {
        return Promise.resolve({
          data: {
            data: {
              id: 42,
              template_type: 'service_acknowledgment',
              title: 'Second handoff acknowledgment',
              status: 'pending',
              signer_name: null,
              signed_at: null,
              rendered_body: 'A second required handoff document.',
              communication_choices_recorded: true,
            },
          },
          error: undefined,
        });
      }
      return Promise.resolve({ data: { data: [radiusAccount] }, error: undefined });
    });
    renderDetail();

    fireEvent.click(await screen.findByRole('button', { name: 'Read & sign' }));
    const dialog = await screen.findByRole('dialog', { name: 'Sign document' });
    expect(await within(dialog).findByTestId('communication-choices-recorded')).toHaveTextContent(/already captured with another handoff document/i);
    expect(within(dialog).queryByText('Optional marketing communications')).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('requires the MX arrival authorization before starting temporary internet', async () => {
    mockLocale = 'MX';
    const state = pendingActivation({
      documents: [
        { id: 40, template_type: 'installation_authorization', title: 'Installation authorization', status: 'pending', signer_name: null, signed_at: null },
        { id: 41, template_type: 'activation_contract', title: 'Activation contract', status: 'pending', signer_name: null, signed_at: null },
      ],
      blockers: ['signature_missing', 'speed_test_missing'],
    });
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => jsonResponse(state));
    renderDetail();

    expect(await screen.findByText('Installation authorization')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start temporary internet' })).toBeDisabled();
    expect(screen.getByText(/before starting temporary internet/)).toBeInTheDocument();
    expect(screen.getByText('Activation contract')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Client contract signature/ })).toBeInTheDocument();
  });

  it('explains when an MX activation-contract template must be published first', async () => {
    mockLocale = 'MX';
    const state = pendingActivation({
      documents: [],
      blockers: ['activation_template_missing'],
    });
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => jsonResponse(state));
    renderDetail();

    expect(await screen.findByText(/Publish an activation-contract template/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Activate contract permanently' })).toBeDisabled();
  });

  it('does not dispatch an MX installation visit before its activation template exists', async () => {
    mockLocale = 'MX';
    const state = pendingActivation({
      service_order: null,
      work_order: null,
      documents: [],
      blockers: ['service_order_missing', 'work_order_missing', 'activation_template_missing'],
    });
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => jsonResponse(state));
    renderDetail();

    expect(await screen.findByRole('button', { name: 'Prepare installation visit' })).toBeDisabled();
  });

  it('does not expose MX document metadata or controls without signed_documents.view', async () => {
    mockLocale = 'MX';
    mockRole = 'custom';
    mockPermissions = ['contracts.view'];
    const state = pendingActivation({
      documents: [{ id: 41, template_type: 'activation_contract', title: 'Private activation terms', status: 'pending', signer_name: null, signed_at: null }],
      blockers: ['signature_missing'],
    });
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => jsonResponse(state));
    renderDetail();

    await screen.findByRole('heading', { name: 'Activate contract' });
    expect(screen.queryByText('Private activation terms')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Read & sign' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('activation-documents')).not.toBeInTheDocument();
  });

  it('shows non-sensitive preparation state when service and work-order details are redacted', async () => {
    mockRole = 'custom';
    mockPermissions = ['contracts.view'];
    const state = pendingActivation({
      service_order_prepared: true,
      service_order: null,
      work_order_prepared: true,
      work_order: null,
      speed_test: null,
      speed_test_recorded: true,
    });
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => jsonResponse(state));
    renderDetail();

    expect(await screen.findByText(/installation visit is prepared/i)).toBeInTheDocument();
    expect(screen.getByText(/Commissioning is in progress/)).toBeInTheDocument();
    expect(screen.queryByText(/contract manager must prepare/)).not.toBeInTheDocument();
    expect(screen.queryByText('SO-71')).not.toBeInTheDocument();
    expect(screen.queryByText('#81')).not.toBeInTheDocument();
  });

  it('allows a contract operator to backfill late MX documents without exposing their metadata', async () => {
    mockLocale = 'MX';
    mockRole = 'custom';
    mockPermissions = ['contracts.view', 'contracts.update', 'installations.start'];
    const state = pendingActivation({
      documents: [],
      document_sync_required: true,
      blockers: ['signature_missing'],
    });
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation((_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') return jsonResponse({ ...state, document_sync_required: false });
      return jsonResponse(state);
    });
    renderDetail();

    fireEvent.click(await screen.findByRole('button', { name: 'Refresh activation documents' }));
    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
      '/api/v1/contracts/5/activation/prepare',
      expect.objectContaining({ method: 'POST' }),
    ));
    expect(screen.queryByTestId('activation-documents')).not.toBeInTheDocument();
  });

  it('still enforces the MX arrival gate without exposing document metadata', async () => {
    mockLocale = 'MX';
    mockRole = 'custom';
    mockPermissions = ['contracts.view', 'work_orders.update', 'speed_tests.create'];
    const state = pendingActivation({
      work_order: { id: 81, status: 'in_progress', assigned_to: 1, acceptance: null },
      documents: [],
      arrival_authorization_pending: true,
      blockers: ['signature_missing', 'speed_test_missing'],
    });
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => jsonResponse(state));
    renderDetail();

    expect(await screen.findByRole('button', { name: 'Start temporary internet' })).toBeDisabled();
    expect(screen.queryByTestId('activation-documents')).not.toBeInTheDocument();
  });

  it('allows document viewing without offering signing unless signed_documents.sign is present', async () => {
    mockLocale = 'MX';
    mockRole = 'custom';
    mockPermissions = ['contracts.view', 'signed_documents.view'];
    const state = pendingActivation({
      documents: [{ id: 41, template_type: 'activation_contract', title: 'Activation terms', status: 'pending', signer_name: null, signed_at: null }],
      blockers: ['signature_missing'],
    });
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => jsonResponse(state));
    const first = renderDetail();

    expect(await screen.findByText('Activation terms')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Read & sign' })).not.toBeInTheDocument();
    expect(screen.getByText('Signing permission required')).toBeInTheDocument();

    first.unmount();
    mockPermissions = ['contracts.view', 'signed_documents.view', 'signed_documents.sign'];
    renderDetail();
    expect(await screen.findByRole('button', { name: 'Read & sign' })).toBeInTheDocument();
  });

  it('records a PPPoE technician speed test through test-window/complete, which closes temporary access', async () => {
    const openState = pendingActivation({
      test_window_expires_at: '2099-08-10T12:00:00Z',
      radius_status: 'active',
      blockers: ['work_order_not_completed', 'acceptance_missing', 'test_window_open', 'speed_test_missing'],
    });
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation((_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') return jsonResponse({ speed_test: { id: 91 }, nas_disabled: false, nas_disable_warning: 'router timeout' });
      return jsonResponse(openState);
    });
    renderDetail();

    fireEvent.change(await screen.findByLabelText('Download (Mbps)'), { target: { value: '98.5' } });
    fireEvent.change(screen.getByLabelText('Upload (Mbps)'), { target: { value: '47.2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Record speed test & switch line off' }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
      '/api/v1/work-orders/81/test-window/complete',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ download_mbps: 98.5, upload_mbps: 47.2 }),
      }),
    ));
    expect(await screen.findByText(/router timeout/)).toBeInTheDocument();
  });

  it('does not claim the line is fully off while live-session cleanup is still pending', async () => {
    const cleanupState = pendingActivation({
      test_window_expires_at: '2000-01-01T00:00:00Z',
      test_window_cleanup_pending: true,
      radius_status: 'inactive',
      speed_test: { download_mbps: 98.5, upload_mbps: 47.2 },
      speed_test_recorded: true,
      blockers: ['work_order_not_completed', 'acceptance_missing', 'test_window_cleanup_pending'],
    });
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => jsonResponse(cleanupState));
    renderDetail();

    expect(await screen.findByText(/New logins blocked · live-session shutdown pending/)).toBeInTheDocument();
    expect(screen.getByText(/measurement is saved and new authentication is blocked/i)).toBeInTheDocument();
    expect(screen.queryByText('Temporary internet is off again.')).not.toBeInTheDocument();
    expect(screen.queryByText('The subscriber line remains off.')).not.toBeInTheDocument();
  });

  it('surfaces a live-session disconnect warning returned by test completion', async () => {
    const openState = pendingActivation({
      test_window_expires_at: '2099-08-10T12:00:00Z',
      radius_status: 'active',
      blockers: ['work_order_not_completed', 'acceptance_missing', 'test_window_open', 'speed_test_missing'],
    });
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation((_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') {
        return jsonResponse({ speed_test: { id: 91 }, disconnect_warning: 'Disconnect request timed out' });
      }
      return jsonResponse(openState);
    });
    renderDetail();

    fireEvent.change(await screen.findByLabelText('Download (Mbps)'), { target: { value: '98.5' } });
    fireEvent.change(screen.getByLabelText('Upload (Mbps)'), { target: { value: '47.2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Record speed test & switch line off' }));

    expect(await screen.findByText(/Disconnect request timed out/)).toBeInTheDocument();
  });

  it('does not offer commissioning or acceptance actions to an unassigned technician, but keeps End as a safety action', async () => {
    mockRole = 'custom';
    mockPermissions = ['contracts.view', 'work_orders.update'];
    const openState = pendingActivation({
      test_window_expires_at: '2099-08-10T12:00:00Z',
      radius_status: 'active',
      speed_test: { download_mbps: 100, upload_mbps: 50 },
      blockers: ['work_order_not_completed', 'acceptance_missing', 'test_window_open'],
    });
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => jsonResponse(openState));
    renderDetail();

    expect(await screen.findByRole('button', { name: 'End temporary internet' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Download (Mbps)')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Complete installation visit' })).not.toBeInTheDocument();
  });

  it('lets an effective contract supervisor operate another technician\'s commissioning visit', async () => {
    mockRole = 'custom';
    mockPermissions = ['contracts.view', 'contracts.update', 'work_orders.update', 'speed_tests.create'];
    const openState = pendingActivation({
      test_window_expires_at: '2099-08-10T12:00:00Z',
      radius_status: 'active',
      blockers: ['work_order_not_completed', 'acceptance_missing', 'test_window_open', 'speed_test_missing'],
    });
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => jsonResponse(openState));
    renderDetail();

    expect(await screen.findByLabelText('Download (Mbps)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Record speed test & switch line off' })).toBeInTheDocument();
  });

  it('does not offer speed evidence controls without speed_tests.create, even to the assigned operator', async () => {
    mockRole = 'custom';
    mockPermissions = ['contracts.view', 'work_orders.update'];
    const openState = pendingActivation({
      work_order: { id: 81, status: 'in_progress', assigned_to: 1, acceptance: {} },
      test_window_expires_at: '2099-08-10T12:00:00Z',
      radius_status: 'active',
      blockers: ['work_order_not_completed', 'acceptance_missing', 'test_window_open', 'speed_test_missing'],
    });
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => jsonResponse(openState));
    renderDetail();

    expect(await screen.findByRole('button', { name: 'End temporary internet' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Download (Mbps)')).not.toBeInTheDocument();
  });

  it('records static-line evidence without showing a RADIUS test-window control', async () => {
    const staticState = pendingActivation({ connection_type: 'static', radius_status: null });
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation((_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') return jsonResponse({ id: 92 });
      return jsonResponse(staticState);
    });
    renderDetail();

    expect(await screen.findByText('Manual network shutoff required')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Start temporary internet' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Download (Mbps)'), { target: { value: '80' } });
    fireEvent.change(screen.getByLabelText('Upload (Mbps)'), { target: { value: '20' } });
    fireEvent.click(screen.getByRole('button', { name: 'Record technician speed test' }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
      '/api/v1/work-orders/81/commissioning-test',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ download_mbps: 80, upload_mbps: 20 }),
      }),
    ));
  });

  it('does not claim a static line was switched off automatically after its measurement', async () => {
    const staticState = pendingActivation({
      connection_type: 'static',
      radius_status: null,
      speed_test: { download_mbps: 80, upload_mbps: 20 },
      blockers: ['work_order_not_completed', 'acceptance_missing'],
    });
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => jsonResponse(staticState));
    renderDetail();

    expect((await screen.findAllByText(/verify the static\/non-RADIUS line has been switched off manually/i)).length).toBeGreaterThan(0);
    expect(screen.queryByText('Temporary internet is off again.')).not.toBeInTheDocument();
  });

  it('completes the linked installation work order with acceptance evidence', async () => {
    const testedState = pendingActivation({
      speed_test: { download_mbps: 100, upload_mbps: 50 },
      blockers: ['work_order_not_completed', 'acceptance_missing'],
    });
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation((_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'PATCH') return jsonResponse({ id: 81, status: 'completed' });
      return jsonResponse(testedState);
    });
    renderDetail();

    fireEvent.change(await screen.findByLabelText('Wireless signal (dBm)'), { target: { value: '-61' } });
    fireEvent.click(screen.getByRole('button', { name: 'Complete installation visit' }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
      '/api/v1/work-orders/81',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ status: 'completed', acceptance_signal_dbm: -61 }),
      }),
    ));
  });

  it('allows handoff from the non-sensitive speed evidence flag when measurements are redacted', async () => {
    mockRole = 'custom';
    mockPermissions = ['contracts.view', 'contracts.update', 'work_orders.update'];
    const testedState = pendingActivation({
      speed_test: null,
      speed_test_recorded: true,
      blockers: ['work_order_not_completed', 'acceptance_missing'],
    });
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => jsonResponse(testedState));
    renderDetail();

    expect(await screen.findByText('Speed test recorded.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Complete installation visit' })).toBeInTheDocument();
    expect(screen.queryByText(/Mbps down/)).not.toBeInTheDocument();
  });

  it('permanently activates only through the dedicated final action', async () => {
    const readyState = pendingActivation({
      work_order: { id: 81, status: 'completed', assigned_to: 4, acceptance: { acceptance_signal_dbm: -61 } },
      speed_test: { download_mbps: 100, upload_mbps: 50 },
      can_activate: true,
      blockers: [],
    });
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation((_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') return jsonResponse({ ...readyState, status: 'active', network_activation: { nas_pushed: false, nas_push_error: 'CoA unavailable' } });
      return jsonResponse(readyState);
    });
    renderDetail();

    fireEvent.click(await screen.findByRole('button', { name: 'Activate contract permanently' }));
    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
      '/api/v1/contracts/5/activate',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ billing: 'already_paid' }) }),
    ));
    expect(await screen.findByText(/CoA unavailable/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry network activation' })).toBeInTheDocument();
  });

  it('does not claim permanent network turn-on for a manually controlled static line', async () => {
    mockGql.mockResolvedValue({ contract: { ...makeContract('static'), status: 'pending' } });
    const readyState = pendingActivation({
      connection_type: 'static',
      work_order: { id: 81, status: 'completed', assigned_to: 4, acceptance: { acceptance_signal_dbm: -61 } },
      speed_test: { download_mbps: 100, upload_mbps: 50 },
      can_activate: true,
      blockers: [],
    });
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation((_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') return jsonResponse({ ...readyState, status: 'active' });
      return jsonResponse(readyState);
    });
    renderDetail();

    fireEvent.click(await screen.findByRole('button', { name: 'Activate contract permanently' }));

    expect(await screen.findByText(/Enable the static\/non-RADIUS line manually/)).toBeInTheDocument();
    expect(screen.queryByText(/subscriber line is now permanently on/i)).not.toBeInTheDocument();
  });

  it('does not offer invoice creation to a contract operator without invoices.create', async () => {
    mockRole = 'custom';
    mockPermissions = ['contracts.view', 'contracts.update'];
    const readyState = pendingActivation({
      work_order: { id: 81, status: 'completed', assigned_to: 4, acceptance: { acceptance_signal_dbm: -61 } },
      speed_test: { download_mbps: 100, upload_mbps: 50 },
      can_activate: true,
      blockers: [],
    });
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => jsonResponse(readyState));
    renderDetail();

    expect(await screen.findByRole('button', { name: 'Activate contract permanently' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Create installation invoice')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Installation already paid')).toBeChecked();
  });

  it('surfaces when Renew reopens a never-activated contract into the guided activation flow', async () => {
    mockGql
      .mockResolvedValueOnce({ contract: { ...makeContract('pppoe'), status: 'cancelled' } })
      .mockResolvedValue({ contract: { ...makeContract('pppoe'), status: 'pending' } });
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation((_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') return jsonResponse({ status: 'pending', activation_required: true });
      return jsonResponse(pendingActivation());
    });
    renderDetail();

    fireEvent.click(await screen.findByRole('button', { name: 'Renew' }));
    expect(await screen.findByText(/Line OFF until permanent activation/i)).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Activate contract' })).toBeInTheDocument();
  });

  it('restores the idempotent network Retry control after reloading an eligible active contract', async () => {
    mockGql.mockResolvedValue({ contract: makeContract('pppoe') });
    const activeState = pendingActivation({
      status: 'active',
      work_order: { id: 81, status: 'completed', assigned_to: 4, acceptance: { acceptance_signal_dbm: -61 } },
      speed_test: { download_mbps: 100, upload_mbps: 50 },
      can_activate: false,
      blockers: ['contract_not_pending'],
      network_retry_available: true,
    });
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation((_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') return jsonResponse({ contract_id: 5, service_order_id: 71, radius_id: 9, nas_id: 2, success: true });
      return jsonResponse(activeState);
    });
    renderDetail();

    fireEvent.click(await screen.findByRole('button', { name: 'Retry network activation' }));
    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
      '/api/v1/contracts/5/activation/retry-network',
      { method: 'POST' },
    ));
    expect(await screen.findByText('Network activation synchronized successfully.')).toBeInTheDocument();
  });

  it('keeps network recovery actionable when the retry command returns success:false', async () => {
    mockGql.mockResolvedValue({ contract: makeContract('pppoe') });
    const activeState = pendingActivation({ status: 'active', network_retry_available: true });
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation((_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') return jsonResponse({ contract_id: 5, service_order_id: 71, radius_id: 9, nas_id: 2, success: false, error: 'Router still unreachable' });
      return jsonResponse(activeState);
    });
    renderDetail();

    fireEvent.click(await screen.findByRole('button', { name: 'Retry network activation' }));
    expect(await screen.findByText(/Router still unreachable/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry network activation' })).toBeEnabled();
  });
});

describe('ContractDetail — renewal network recovery', () => {
  it('keeps a failed RouterOS renewal restore visible and offers an idempotent retry', async () => {
    mockGql.mockResolvedValue({ contract: { ...makeContract('pppoe'), status: 'cancelled' } });
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/renew')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            data: { status: 'active', activation_required: false },
            network_activation: { nas_pushed: false, nas_push_error: 'router timeout' },
          }),
        } as Response);
      }
      if (url.endsWith('/activation')) {
        return jsonResponse(pendingActivation({
          status: 'active',
          service_order: null,
          work_order: null,
          network_retry_available: true,
        }));
      }
      return jsonResponse({});
    });
    renderDetail();

    fireEvent.click(await screen.findByRole('button', { name: 'Renew' }));

    expect(await screen.findByText(/router timeout/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry network activation' })).toBeInTheDocument();
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
    mockApiPost.mockResolvedValue({ data: { data: { id: 42 } }, error: undefined });

    renderDetail();
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Contract #5' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Devices' }));

    fireEvent.click(await screen.findByRole('button', { name: '+ New network device' }));
    const dialog = await screen.findByRole('dialog', { name: 'New device' });
    fireEvent.change(within(dialog).getByLabelText('Name *'), { target: { value: 'RGEW1300G — sala' } });
    fireEvent.change(within(dialog).getByLabelText('MAC address'), { target: { value: 'AA:BB:CC:DD:EE:FF' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create device' }));

    await waitFor(() => expect(mockApiPost).toHaveBeenCalledWith('/devices', expect.objectContaining({
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
    mockApiPost.mockResolvedValue({ data: { data: {} }, error: undefined });

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

    await waitFor(() => expect(mockApiPost).toHaveBeenCalledWith('/cpe-management/devices/install', expect.objectContaining({
      body: expect.objectContaining({ contract_id: 5, cpe_device_id: 91, ownership: 'rented' }),
    })));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Install equipment' })).not.toBeInTheDocument());
  });

  it('typed-new-serial mode sends new_serial + inventory_item_id and honors sold ownership', async () => {
    mockInventoryPaths();
    mockApiPost.mockResolvedValue({ data: { data: {} }, error: undefined });

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

    await waitFor(() => expect(mockApiPost).toHaveBeenCalledWith('/cpe-management/devices/install', expect.objectContaining({
      body: expect.objectContaining({ contract_id: 5, new_serial: 'RGEW-NEW-42', inventory_item_id: 1, ownership: 'sold' }),
    })));
  });

  it('refuses to submit without a serial instead of posting a half-formed install', async () => {
    mockInventoryPaths();
    mockApiPost.mockClear();

    renderDetail();
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Contract #5' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Devices' }));
    fireEvent.click(await screen.findByRole('button', { name: '+ Install equipment' }));
    const dialog = await screen.findByRole('dialog', { name: 'Install equipment' });

    fireEvent.click(within(dialog).getByRole('button', { name: 'Install equipment' }));
    expect(await within(dialog).findByText('Select a serial.')).toBeInTheDocument();
    expect(mockApiPost).not.toHaveBeenCalled();
  });
});
