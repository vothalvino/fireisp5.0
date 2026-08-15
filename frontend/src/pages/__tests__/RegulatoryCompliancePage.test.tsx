// =============================================================================
// FireISP 5.0 — RegulatoryCompliancePage tests (§16)
// =============================================================================
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import RegulatoryCompliancePage from '../RegulatoryCompliancePage';
import { LEGAL_DOCUMENT_PLACEHOLDER_HELP } from '@/legalDocumentPlaceholders';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { changeLanguage: vi.fn() },
  }),
}));

// The consumer-protection tab is MX-locale-gated; default the mocked org to MX
// so the full 9-tab layout renders, and flip per-test for the global case.
type MockUser = { organization_locale?: string; role?: string; permissions?: string[] };
const mockUser = vi.hoisted(() => ({ current: { organization_locale: 'MX', role: 'admin' } as MockUser }));
vi.mock('@/auth/AuthContext', () => ({
  useAuth: () => ({ user: mockUser.current }),
}));

vi.stubGlobal('fetch', vi.fn(() =>
  Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ data: [] }),
  } as unknown as Response),
));

// Mock localStorage
Object.defineProperty(window, 'localStorage', {
  value: {
    getItem: vi.fn(() => 'mock-token'),
    setItem: vi.fn(),
    removeItem: vi.fn(),
  },
  writable: true,
});

function renderCompliancePage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <RegulatoryCompliancePage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('RegulatoryCompliancePage', () => {
  it('renders the Mexico-specific page title for MX organizations', () => {
    renderCompliancePage();
    expect(screen.getByText('regulatoryCompliance.titleMx')).toBeDefined();
  });

  it('renders the generic page title for global organizations', () => {
    mockUser.current = { organization_locale: 'global', role: 'admin' };
    try {
      renderCompliancePage();
      expect(screen.getByText('regulatoryCompliance.title')).toBeDefined();
      expect(screen.queryByText('regulatoryCompliance.titleMx')).toBeNull();
    } finally {
      mockUser.current = { organization_locale: 'MX', role: 'admin' };
    }
  });

  it('renders all 9 tab buttons for an authorized admin', () => {
    renderCompliancePage();
    // consent appears in both the button strip and the active tab h2 — use getAllByText
    expect(screen.getAllByText('regulatoryCompliance.tabs.consent').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('regulatoryCompliance.tabs.dsar').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('regulatoryCompliance.tabs.government').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('regulatoryCompliance.tabs.identity').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('regulatoryCompliance.tabs.numbering').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('regulatoryCompliance.tabs.uso').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('regulatoryCompliance.tabs.consumer').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('regulatoryCompliance.tabs.residency').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('regulatoryCompliance.tabs.audit').length).toBeGreaterThanOrEqual(1);
  });

  it('shows consent tab content by default', () => {
    renderCompliancePage();
    // Consent tab heading should be rendered (same key as tab button, appears twice —
    // once in the tab strip and once as the h2)
    const matches = screen.getAllByText('regulatoryCompliance.tabs.consent');
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  it('hides the MX-gated consumer-protection tab for global-locale orgs', () => {
    mockUser.current = { organization_locale: 'global', role: 'admin' };
    try {
      renderCompliancePage();
      expect(screen.queryByText('regulatoryCompliance.tabs.consumer')).toBeNull();
      expect(screen.getAllByText('regulatoryCompliance.tabs.dsar').length).toBeGreaterThanOrEqual(1);
    } finally {
      mockUser.current = { organization_locale: 'MX', role: 'admin' };
    }
  });

  it('shows an empty-safe access state and makes no API calls when no tab is permitted', () => {
    mockUser.current = { organization_locale: 'MX', role: 'support', permissions: [] };
    vi.mocked(fetch).mockClear();
    try {
      renderCompliancePage();
      expect(screen.getByRole('alert')).toHaveTextContent('regulatoryCompliance.accessDenied');
      expect(screen.queryByText('regulatoryCompliance.tabs.consent')).toBeNull();
      expect(screen.queryByText('regulatoryCompliance.tabs.government')).toBeNull();
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      mockUser.current = { organization_locale: 'MX', role: 'admin' };
    }
  });
});

describe('GovernmentRequestsTab — case-bound IP attribution gate', () => {
  const RECEIVED_CASE = {
    id: 73,
    authority_name: 'Fiscalía Estatal',
    authority_ref: 'OF-2026-73',
    request_type: 'ip_traceability',
    client_id: 7,
    contract_id: 9,
    ip_address: '198.51.100.8',
    public_port: 62001,
    protocol: 'tcp',
    observed_at: '2026-08-14T10:15:01.000Z',
    legal_basis: 'Oficio judicial autorizado',
    notes: 'Responder únicamente con evidencia de atribución de IP.',
    status: 'received',
    created_at: '2026-08-14T09:00:00.000Z',
  };

  function installGovernmentApi(row = RECEIVED_CASE) {
    vi.mocked(fetch).mockImplementation((input, options) => {
      const url = String(input);
      if (url.includes('/regulatory-compliance/gov-data-requests?') && !options?.method) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: [row] }) } as unknown as Response);
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: [], id: 99 }) } as unknown as Response);
    });
  }

  async function openGovernment() {
    renderCompliancePage();
    fireEvent.click(screen.getByText('regulatoryCompliance.tabs.government'));
    await screen.findByText('Fiscalía Estatal');
  }

  afterEach(() => {
    mockUser.current = { organization_locale: 'MX', role: 'admin' };
    vi.mocked(fetch).mockClear();
    vi.mocked(fetch).mockImplementation(() => Promise.resolve({
      ok: true, json: () => Promise.resolve({ data: [] }),
    } as unknown as Response));
  });

  it('hides the tab without the government-request view permission', () => {
    mockUser.current = { organization_locale: 'MX', role: 'billing', permissions: ['dsar_requests.view'] };
    renderCompliancePage();
    expect(screen.queryByText('regulatoryCompliance.tabs.government')).toBeNull();
  });

  it('opens the only permitted tab for a custom legal-response principal', async () => {
    mockUser.current = {
      organization_locale: 'MX', role: 'support', permissions: ['gov_data_requests.view'],
    };
    installGovernmentApi();
    renderCompliancePage();

    expect(await screen.findByText('Fiscalía Estatal')).toBeInTheDocument();
    expect(screen.getAllByText('regulatoryCompliance.tabs.government')).toHaveLength(2);
    expect(screen.queryByText('regulatoryCompliance.tabs.consent')).toBeNull();
  });

  it('creates an exact CGNAT traceability case without broad network-history fields', async () => {
    installGovernmentApi();
    await openGovernment();

    fireEvent.change(screen.getByLabelText('regulatoryCompliance.government.authority'), { target: { value: 'Fiscalía Estatal' } });
    fireEvent.change(screen.getByLabelText('regulatoryCompliance.government.officialReference'), { target: { value: 'OF-2026-99' } });
    fireEvent.change(screen.getByLabelText('regulatoryCompliance.government.legalBasis'), { target: { value: 'Orden judicial 99' } });
    fireEvent.change(screen.getByLabelText('regulatoryCompliance.government.publicIpv4'), { target: { value: '198.51.100.9' } });
    fireEvent.change(screen.getByLabelText('regulatoryCompliance.government.publicPort'), { target: { value: '62002' } });
    fireEvent.change(screen.getByLabelText('regulatoryCompliance.government.protocol'), { target: { value: 'tcp' } });
    fireEvent.change(screen.getByLabelText('regulatoryCompliance.government.exactTimestamp'), { target: { value: '2026-08-14T10:15:01' } });
    fireEvent.click(screen.getByText('regulatoryCompliance.government.create'));

    await waitFor(() => {
      const call = vi.mocked(fetch).mock.calls.find(([input, options]) =>
        String(input).endsWith('/regulatory-compliance/gov-data-requests') && options?.method === 'POST');
      expect(call).toBeDefined();
      expect(JSON.parse(String(call?.[1]?.body))).toEqual({
        authority_name: 'Fiscalía Estatal',
        authority_ref: 'OF-2026-99',
        request_type: 'ip_traceability',
        legal_basis: 'Orden judicial 99',
        ip_address: '198.51.100.9',
        public_port: 62002,
        protocol: 'tcp',
        observed_at: new Date('2026-08-14T10:15:01').toISOString(),
      });
    });
  });

  it('creates a direct-public traceability case without inventing port or protocol', async () => {
    installGovernmentApi();
    await openGovernment();

    fireEvent.change(screen.getByLabelText('regulatoryCompliance.government.authority'), { target: { value: 'Fiscalía Estatal' } });
    fireEvent.change(screen.getByLabelText('regulatoryCompliance.government.officialReference'), { target: { value: 'OF-2026-100' } });
    fireEvent.change(screen.getByLabelText('regulatoryCompliance.government.legalBasis'), { target: { value: 'Orden judicial 100' } });
    fireEvent.change(screen.getByLabelText('regulatoryCompliance.government.assignmentMode'), { target: { value: 'direct' } });
    expect(screen.queryByLabelText('regulatoryCompliance.government.publicPort')).toBeNull();
    expect(screen.queryByLabelText('regulatoryCompliance.government.protocol')).toBeNull();
    fireEvent.change(screen.getByLabelText('regulatoryCompliance.government.publicIpv4'), { target: { value: '203.0.113.20' } });
    fireEvent.change(screen.getByLabelText('regulatoryCompliance.government.exactTimestamp'), { target: { value: '2026-08-14T10:15:01' } });
    fireEvent.click(screen.getByText('regulatoryCompliance.government.create'));

    await waitFor(() => {
      const call = vi.mocked(fetch).mock.calls.find(([input, options]) =>
        String(input).endsWith('/regulatory-compliance/gov-data-requests') && options?.method === 'POST');
      expect(JSON.parse(String(call?.[1]?.body))).toMatchObject({
        request_type: 'ip_traceability',
        ip_address: '203.0.113.20',
        public_port: null,
        protocol: null,
        observed_at: new Date('2026-08-14T10:15:01').toISOString(),
      });
    });
  });

  it('requires validation/start-processing before exposing the exact lookup link', async () => {
    let status = 'received';
    vi.mocked(fetch).mockImplementation((input, options) => {
      const url = String(input);
      if (url.includes('/regulatory-compliance/gov-data-requests?') && !options?.method) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ data: [{ ...RECEIVED_CASE, status }] }),
        } as unknown as Response);
      }
      if (url.endsWith('/gov-data-requests/73/process')) status = 'processing';
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: [] }) } as unknown as Response);
    });
    await openGovernment();
    expect(screen.getByRole('note')).toHaveTextContent('regulatoryCompliance.government.workflowHelp');
    const caseRow = screen.getByText('Fiscalía Estatal').closest('tr');
    expect(caseRow).not.toBeNull();
    expect(caseRow).toHaveTextContent('Oficio judicial autorizado');
    expect(caseRow).toHaveTextContent('regulatoryCompliance.government.subjectClient');
    expect(caseRow).toHaveTextContent('regulatoryCompliance.government.subjectContract');
    expect(caseRow).toHaveTextContent('regulatoryCompliance.government.caseNotes');
    expect(caseRow).toHaveTextContent('198.51.100.8:62001 TCP');
    expect(caseRow).toHaveTextContent('2026-08-14T10:15:01.000Z');
    expect(screen.queryByText('regulatoryCompliance.government.openLookup')).toBeNull();
    fireEvent.click(screen.getByText('regulatoryCompliance.government.startProcessing'));
    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      '/api/v1/regulatory-compliance/gov-data-requests/73/process',
      expect.objectContaining({ method: 'PUT' }),
    ));

    expect(await screen.findByText('regulatoryCompliance.government.openLookup')).toHaveAttribute('href', '/connection-logs');
  });

  it('lets a manager close a processing case before releasing its evidence hold', async () => {
    let status = 'processing';
    vi.mocked(fetch).mockImplementation((input, options) => {
      const url = String(input);
      if (url.includes('/regulatory-compliance/gov-data-requests?') && !options?.method) {
        return Promise.resolve({
          ok: true, json: () => Promise.resolve({ data: [{ ...RECEIVED_CASE, status }] }),
        } as unknown as Response);
      }
      if (url.endsWith('/gov-data-requests/73/fulfill')) status = 'fulfilled';
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true }) } as unknown as Response);
    });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    await openGovernment();
    fireEvent.click(screen.getByText('regulatoryCompliance.government.fulfill'));

    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      '/api/v1/regulatory-compliance/gov-data-requests/73/fulfill',
      expect.objectContaining({ method: 'PUT' }),
    ));
    expect(await screen.findByLabelText('regulatoryCompliance.government.releaseReason')).toBeInTheDocument();
    expect(confirm).toHaveBeenCalledWith('regulatoryCompliance.government.fulfillConfirm');
    confirm.mockRestore();
  });

  it('requires and submits an audited reason when rejecting a case', async () => {
    installGovernmentApi({ ...RECEIVED_CASE, status: 'processing' });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    await openGovernment();

    const reject = screen.getByText('regulatoryCompliance.government.reject');
    expect(reject).toBeDisabled();
    fireEvent.change(screen.getByLabelText('regulatoryCompliance.government.rejectReason'), {
      target: { value: 'Authority withdrew request OF-2026-73.' },
    });
    expect(reject).toBeEnabled();
    fireEvent.click(reject);

    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      '/api/v1/regulatory-compliance/gov-data-requests/73/reject',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ reason: 'Authority withdrew request OF-2026-73.' }),
      }),
    ));
    expect(confirm).toHaveBeenCalledOnce();
    confirm.mockRestore();
  });

  it('releases a terminal case evidence hold only with manage permission, a reason, and confirmation', async () => {
    installGovernmentApi({ ...RECEIVED_CASE, status: 'fulfilled' });
    await openGovernment();

    const release = screen.getByText('regulatoryCompliance.government.releaseEvidenceHold');
    expect(release).toBeDisabled();
    fireEvent.change(screen.getByLabelText('regulatoryCompliance.government.releaseReason'), {
      target: { value: 'Final response delivered; normal retention may resume.' },
    });
    expect(release).toBeEnabled();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    fireEvent.click(release);

    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      '/api/v1/regulatory-compliance/gov-data-requests/73/release-evidence-hold',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ reason: 'Final response delivered; normal retention may resume.' }),
      }),
    ));
    expect(await screen.findByText('regulatoryCompliance.government.releaseRecorded')).toBeInTheDocument();
    expect(confirm).toHaveBeenCalledOnce();
    confirm.mockRestore();
  });

  it('does not expose evidence-hold release to a view-only legal responder', async () => {
    mockUser.current = {
      organization_locale: 'MX', role: 'support', permissions: ['gov_data_requests.view'],
    };
    installGovernmentApi({ ...RECEIVED_CASE, status: 'rejected' });
    renderCompliancePage();
    await screen.findByText('Fiscalía Estatal');

    expect(screen.queryByText('regulatoryCompliance.government.releaseEvidenceHold')).toBeNull();
    expect(screen.queryByLabelText('regulatoryCompliance.government.releaseReason')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Consent tab — the controls must not render for roles the backend will 403.
// The route accepts any authenticated principal; tab and action visibility
// must therefore follow the resolved permission set exactly.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// DSAR tab — migration 432 gives billing .manage, which is what makes the
// fulfil/reject controls reachable by the role the page is scoped to. Before
// 432 the tab was read-only for everyone and the routes had no UI at all.
// ---------------------------------------------------------------------------

describe('DsarTab permission gating', () => {
  const OPEN_DSAR = {
    id: 7, request_type: 'access', status: 'pending',
    due_at: '2026-08-27T00:00:00.000Z', legal_hold: 0,
  };

  const renderDsar = async (u: MockUser, rows = [OPEN_DSAR]) => {
    mockUser.current = { organization_locale: 'MX', ...u };
    vi.mocked(fetch).mockImplementation(() => Promise.resolve({
      ok: true, json: () => Promise.resolve({ data: rows }),
    } as unknown as Response));
    renderCompliancePage();
    // Switch off the default consent tab.
    fireEvent.click(screen.getAllByText('regulatoryCompliance.tabs.dsar')[0]);
    await screen.findByText('access');
  };

  afterEach(() => {
    mockUser.current = { organization_locale: 'MX', role: 'admin' };
    vi.mocked(fetch).mockImplementation(() => Promise.resolve({
      ok: true, json: () => Promise.resolve({ data: [] }),
    } as unknown as Response));
  });

  it('billing can now log AND close a request (migration 432)', async () => {
    await renderDsar({ role: 'billing', permissions: ['dsar_requests.view', 'dsar_requests.create', 'dsar_requests.manage'] });
    expect(screen.getByText('regulatoryCompliance.dsar.create')).toBeDefined();
    expect(screen.getByText('regulatoryCompliance.dsar.fulfill')).toBeDefined();
    expect(screen.getByText('regulatoryCompliance.dsar.reject')).toBeDefined();
  });

  it('a view-only role sees neither the form nor the actions', async () => {
    await renderDsar({ role: 'readonly', permissions: ['dsar_requests.view'] });
    expect(screen.queryByText('regulatoryCompliance.dsar.create')).toBeNull();
    expect(screen.queryByText('regulatoryCompliance.dsar.fulfill')).toBeNull();
  });

  it('an ALREADY-CLOSED request offers no actions, even to a manager', async () => {
    // Fulfilling a rejected request (or vice versa) is not a thing.
    await renderDsar(
      { role: 'billing', permissions: ['dsar_requests.view', 'dsar_requests.manage'] },
      [{ ...OPEN_DSAR, status: 'fulfilled' }],
    );
    expect(screen.queryByText('regulatoryCompliance.dsar.fulfill')).toBeNull();
    expect(screen.queryByText('regulatoryCompliance.dsar.reject')).toBeNull();
  });

  it('a legal-hold request stays actionable — the hold is not a closure', async () => {
    await renderDsar(
      { role: 'billing', permissions: ['dsar_requests.view', 'dsar_requests.manage'] },
      [{ ...OPEN_DSAR, status: 'legal_hold', legal_hold: 1 }],
    );
    expect(screen.getByText('regulatoryCompliance.dsar.fulfill')).toBeDefined();
  });

  it('fulfil PUTs to the resolve endpoint', async () => {
    await renderDsar({ role: 'billing', permissions: ['dsar_requests.view', 'dsar_requests.manage'] });
    fireEvent.click(screen.getByText('regulatoryCompliance.dsar.fulfill'));
    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      '/api/v1/regulatory-compliance/dsar-requests/7/fulfill',
      expect.objectContaining({ method: 'PUT' }),
    ));
  });
});

describe('ConsentTab permission gating', () => {
  // The list MUST come back non-empty. With the default {data: []} stub no row
  // renders at all, so every "withdraw is hidden" assertion would pass against
  // an ungated button — a test that asserts nothing.
  const ACTIVE_CONSENT = {
    id: 1, client_id: 42, purpose: 'service_delivery', channel: 'web',
    consent_version: 'default-1', given_at: '2026-07-01T00:00:00.000Z', withdrawn_at: null,
  };

  const renderWith = async (u: MockUser) => {
    mockUser.current = { organization_locale: 'MX', ...u };
    vi.mocked(fetch).mockImplementation(() => Promise.resolve({
      ok: true, json: () => Promise.resolve({ data: [ACTIVE_CONSENT] }),
    } as unknown as Response));
    renderCompliancePage();
    // Wait for the row itself, so the withdraw assertions run against a
    // rendered row rather than an empty table.
    await screen.findByText('service_delivery');
  };

  afterEach(() => {
    mockUser.current = { organization_locale: 'MX', role: 'admin' };
    vi.mocked(fetch).mockImplementation(() => Promise.resolve({
      ok: true, json: () => Promise.resolve({ data: [] }),
    } as unknown as Response));
  });

  it('admin sees both the create form and the withdraw control', async () => {
    await renderWith({ role: 'admin' });
    expect(screen.getByText('regulatoryCompliance.consent.create')).toBeDefined();
    expect(screen.getByText('regulatoryCompliance.consent.withdraw')).toBeDefined();
  });

  it('billing keeps the create form (it has .create) but loses withdraw (.manage is admin-only)', async () => {
    await renderWith({ role: 'billing', permissions: ['subscriber_consents.view', 'subscriber_consents.create'] });
    expect(screen.getByText('regulatoryCompliance.consent.create')).toBeDefined();
    expect(screen.queryByText('regulatoryCompliance.consent.withdraw')).toBeNull();
  });

  it('a view-only role (readonly / technician) sees neither control', async () => {
    await renderWith({ role: 'readonly', permissions: ['subscriber_consents.view'] });
    expect(screen.queryByText('regulatoryCompliance.consent.create')).toBeNull();
    expect(screen.queryByText('regulatoryCompliance.consent.withdraw')).toBeNull();
  });
});

describe('Consumer Protection MX registered-template evidence', () => {
  const REGISTERED_TEMPLATE = {
    id: 17,
    template_name: 'Contrato 2026',
    template_body: 'Texto exacto registrado {{client.name}}',
    version: '2026.1',
    ift_registration_number: 'CRT-2026-17',
    registered_at: '2026-07-15',
    status: 'registered',
    environment: 'production',
  };

  function openConsumerTab() {
    renderCompliancePage();
    fireEvent.click(screen.getByText('regulatoryCompliance.tabs.consumer'));
  }

  afterEach(() => {
    mockUser.current = { organization_locale: 'MX', role: 'admin' };
    vi.mocked(fetch).mockImplementation(() => Promise.resolve({
      ok: true, json: () => Promise.resolve({ data: [] }),
    } as unknown as Response));
  });

  it('lists org-scoped evidence and creates an operator-confirmed registered source with exact text', async () => {
    vi.mocked(fetch).mockImplementation((input, options) => {
      const url = String(input);
      if (url.includes('/consumer-protection/contract-templates-mx?') && !options?.method) {
        return Promise.resolve({
          ok: true, json: () => Promise.resolve({ data: [REGISTERED_TEMPLATE] }),
        } as unknown as Response);
      }
      if (url.endsWith('/consumer-protection/contract-environment')) {
        return Promise.resolve({
          ok: true, json: () => Promise.resolve({ data: { contract_environment: 'production' } }),
        } as unknown as Response);
      }
      return Promise.resolve({
        ok: true, json: () => Promise.resolve({ data: [] }),
      } as unknown as Response);
    });

    openConsumerTab();
    expect(await screen.findByText('Contrato 2026')).toBeDefined();
    expect(screen.getByText('regulatoryCompliance.consumer.registry.externalWarning')).toBeDefined();
    await waitFor(() => expect(screen.getByLabelText(
      'regulatoryCompliance.consumer.registry.environment.label',
    )).toHaveValue('production'));
    fireEvent.click(screen.getByText('regulatoryCompliance.consumer.registry.create'));
    expect(screen.getByText(LEGAL_DOCUMENT_PLACEHOLDER_HELP)).toBeDefined();

    fireEvent.change(screen.getByLabelText('regulatoryCompliance.consumer.registry.name'), { target: { value: 'Contrato 2027' } });
    fireEvent.change(screen.getByLabelText('regulatoryCompliance.consumer.registry.version'), { target: { value: '2027.1' } });
    fireEvent.change(screen.getByLabelText('regulatoryCompliance.consumer.registry.exactText'), { target: { value: 'Texto registrado exacto  2027\nSin normalizar.' } });
    fireEvent.change(screen.getByLabelText('regulatoryCompliance.consumer.registry.registrationNumber'), { target: { value: 'CRT-2027-01' } });
    fireEvent.change(screen.getByLabelText('regulatoryCompliance.consumer.registry.registrationDate'), { target: { value: '2027-01-12' } });
    fireEvent.change(screen.getByLabelText('regulatoryCompliance.consumer.registry.status'), { target: { value: 'registered' } });
    fireEvent.click(screen.getByText('common.save'));
    expect(await screen.findByText('regulatoryCompliance.consumer.registry.registrationRequired')).toBeDefined();
    expect(vi.mocked(fetch).mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false);

    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByText('common.save'));

    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      '/api/v1/consumer-protection/contract-templates-mx',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          template_name: 'Contrato 2027',
          template_body: 'Texto registrado exacto  2027\nSin normalizar.',
          version: '2027.1',
          ift_registration_number: 'CRT-2027-01',
          registered_at: '2027-01-12',
          status: 'registered',
          environment: 'production',
        }),
      }),
    ));
  });

  it('creates a clearly separated sandbox-ready source without fabricated registration metadata', async () => {
    vi.mocked(fetch).mockImplementation((input, options) => {
      const url = String(input);
      if (url.endsWith('/consumer-protection/contract-environment')) {
        return Promise.resolve({
          ok: true, json: () => Promise.resolve({ data: { contract_environment: 'sandbox' } }),
        } as unknown as Response);
      }
      if (url.includes('/consumer-protection/contract-templates-mx?') && !options?.method) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: [] }) } as unknown as Response);
      }
      return Promise.resolve({
        ok: true, json: () => Promise.resolve({ data: options?.method ? {} : [] }),
      } as unknown as Response);
    });

    openConsumerTab();
    await screen.findByText('regulatoryCompliance.consumer.registry.environment.sandboxSummary');
    fireEvent.click(screen.getByText('regulatoryCompliance.consumer.registry.create'));
    expect(screen.getByText('regulatoryCompliance.consumer.registry.environment.sandboxSourceWarning')).toBeDefined();
    expect(screen.queryByLabelText('regulatoryCompliance.consumer.registry.registrationNumber')).toBeNull();

    fireEvent.change(screen.getByLabelText('regulatoryCompliance.consumer.registry.name'), { target: { value: 'Contrato de prueba' } });
    fireEvent.change(screen.getByLabelText('regulatoryCompliance.consumer.registry.version'), { target: { value: 'sim-1' } });
    fireEvent.change(screen.getByLabelText('regulatoryCompliance.consumer.registry.exactText'), { target: { value: 'Texto de simulación' } });
    fireEvent.change(screen.getByLabelText('regulatoryCompliance.consumer.registry.status'), { target: { value: 'sandbox_ready' } });
    fireEvent.click(screen.getByText('common.save'));

    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      '/api/v1/consumer-protection/contract-templates-mx',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          template_name: 'Contrato de prueba',
          template_body: 'Texto de simulación',
          version: 'sim-1',
          ift_registration_number: null,
          registered_at: null,
          status: 'sandbox_ready',
          environment: 'sandbox',
        }),
      }),
    ));
  });

  it('requires an explicit confirmation before switching new contracts to production', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.mocked(fetch).mockImplementation((input, options) => {
      const url = String(input);
      if (url.endsWith('/consumer-protection/contract-environment')) {
        const environment = options?.method === 'PUT' ? 'production' : 'sandbox';
        return Promise.resolve({
          ok: true, json: () => Promise.resolve({ data: { contract_environment: environment } }),
        } as unknown as Response);
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: [] }) } as unknown as Response);
    });

    try {
      openConsumerTab();
      const selector = await screen.findByLabelText('regulatoryCompliance.consumer.registry.environment.label');
      expect(selector).toHaveValue('sandbox');
      fireEvent.change(selector, { target: { value: 'production' } });

      expect(confirm).toHaveBeenCalledWith(
        'regulatoryCompliance.consumer.registry.environment.productionConfirmation',
      );
      await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalledWith(
        '/api/v1/consumer-protection/contract-environment',
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({ contract_environment: 'production' }),
        }),
      ));
      await waitFor(() => expect(selector).toHaveValue('production'));
    } finally {
      confirm.mockRestore();
    }
  });

  it('surfaces a production preflight failure and leaves the selector in sandbox', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.mocked(fetch).mockImplementation((input, options) => {
      const url = String(input);
      if (url.endsWith('/consumer-protection/contract-environment') && options?.method === 'PUT') {
        return Promise.resolve({
          ok: false,
          status: 422,
          json: () => Promise.resolve({
            error: { code: 'MX_CONTRACT_PRODUCTION_NOT_READY', message: 'Add an eligible production source and activation template first.' },
          }),
        } as unknown as Response);
      }
      if (url.endsWith('/consumer-protection/contract-environment')) {
        return Promise.resolve({
          ok: true, json: () => Promise.resolve({ data: { contract_environment: 'sandbox' } }),
        } as unknown as Response);
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: [] }) } as unknown as Response);
    });

    try {
      openConsumerTab();
      const selector = await screen.findByLabelText('regulatoryCompliance.consumer.registry.environment.label');
      fireEvent.change(selector, { target: { value: 'production' } });

      expect(await screen.findByText('Add an eligible production source and activation template first.')).toBeDefined();
      expect(selector).toHaveValue('sandbox');
    } finally {
      confirm.mockRestore();
    }
  });

  it('fails closed instead of claiming sandbox when the active environment cannot be loaded', async () => {
    vi.mocked(fetch).mockImplementation((input) => {
      const url = String(input);
      if (url.endsWith('/consumer-protection/contract-environment')) {
        return Promise.resolve({
          ok: false,
          status: 503,
          json: () => Promise.resolve({ error: { message: 'environment unavailable' } }),
        } as unknown as Response);
      }
      if (url.includes('/consumer-protection/contract-templates-mx?')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: [] }) } as unknown as Response);
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: [] }) } as unknown as Response);
    });

    openConsumerTab();
    expect(await screen.findByText('regulatoryCompliance.consumer.registry.environment.loadError')).toBeDefined();
    expect(screen.queryByLabelText('regulatoryCompliance.consumer.registry.environment.label')).toBeNull();
    expect(screen.queryByText('regulatoryCompliance.consumer.registry.environment.sandboxSummary')).toBeNull();
    expect(screen.getByRole('button', { name: 'common.retry' })).toBeDefined();
  });

  it('paginates the registry so sources after the first 100 remain visible', async () => {
    const source101 = {
      ...REGISTERED_TEMPLATE,
      id: 101,
      template_name: 'Contrato 101',
      version: '101.0',
    };
    vi.mocked(fetch).mockImplementation((input) => {
      const url = String(input);
      if (url.endsWith('/consumer-protection/contract-environment')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ data: { contract_environment: 'sandbox' } }),
        } as unknown as Response);
      }
      if (url.includes('/consumer-protection/contract-templates-mx?')) {
        const page = new URL(url, 'https://fireisp.test').searchParams.get('page');
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            data: page === '2' ? [source101] : [REGISTERED_TEMPLATE],
            meta: { total: 101, page: Number(page), limit: 100, totalPages: 2 },
          }),
        } as unknown as Response);
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: [] }) } as unknown as Response);
    });

    openConsumerTab();
    expect(await screen.findByText('Contrato 2026')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'common.next' }));
    expect(await screen.findByText('Contrato 101')).toBeDefined();
    expect(screen.queryByText('Contrato 2026')).toBeNull();
  });

  it('keeps frozen registered evidence read-only and surfaces backend immutability errors', async () => {
    vi.mocked(fetch).mockImplementation((input, options) => {
      const url = String(input);
      if (url.endsWith('/consumer-protection/contract-templates-mx/17') && options?.method === 'PUT') {
        return Promise.resolve({
          ok: false,
          status: 422,
          json: () => Promise.resolve({ error: { message: 'Registered MX contract text is permanently immutable; create a new version' } }),
        } as unknown as Response);
      }
      if (url.includes('/consumer-protection/contract-templates-mx?')) {
        return Promise.resolve({
          ok: true, json: () => Promise.resolve({ data: [REGISTERED_TEMPLATE] }),
        } as unknown as Response);
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: [] }) } as unknown as Response);
    });

    openConsumerTab();
    await screen.findByText('Contrato 2026');
    fireEvent.click(screen.getByText('common.edit'));
    expect(screen.getByLabelText('regulatoryCompliance.consumer.registry.exactText')).toHaveAttribute('readonly');
    expect(screen.getByLabelText('regulatoryCompliance.consumer.registry.environment.sourceEnvironment')).toBeDisabled();
    fireEvent.change(screen.getByLabelText('regulatoryCompliance.consumer.registry.status'), { target: { value: 'expired' } });
    fireEvent.click(screen.getByText('common.save'));

    expect(await screen.findByText('Registered MX contract text is permanently immutable; create a new version')).toBeDefined();
  });

  it('shows a localized registry fetch error', async () => {
    vi.mocked(fetch).mockImplementation((input) => {
      if (String(input).includes('/consumer-protection/contract-templates-mx?')) {
        return Promise.resolve({
          ok: false, status: 500, json: () => Promise.resolve({}),
        } as unknown as Response);
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: [] }) } as unknown as Response);
    });
    openConsumerTab();
    expect(await screen.findByText('regulatoryCompliance.consumer.registry.loadError')).toBeDefined();
  });
});
