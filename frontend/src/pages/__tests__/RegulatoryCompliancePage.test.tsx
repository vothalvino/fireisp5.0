// =============================================================================
// FireISP 5.0 — RegulatoryCompliancePage tests (§16)
// =============================================================================
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import RegulatoryCompliancePage from '../RegulatoryCompliancePage';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { changeLanguage: vi.fn() },
  }),
}));

// The consumer-protection tab is MX-locale-gated; default the mocked org to MX
// so the full 8-tab layout renders, and flip per-test for the global case.
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

describe('RegulatoryCompliancePage', () => {
  it('renders the page title', () => {
    render(<RegulatoryCompliancePage />);
    expect(screen.getByText('regulatoryCompliance.title')).toBeDefined();
  });

  it('renders all 8 tab buttons', () => {
    render(<RegulatoryCompliancePage />);
    // consent appears in both the button strip and the active tab h2 — use getAllByText
    expect(screen.getAllByText('regulatoryCompliance.tabs.consent').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('regulatoryCompliance.tabs.dsar').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('regulatoryCompliance.tabs.identity').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('regulatoryCompliance.tabs.numbering').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('regulatoryCompliance.tabs.uso').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('regulatoryCompliance.tabs.consumer').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('regulatoryCompliance.tabs.residency').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('regulatoryCompliance.tabs.audit').length).toBeGreaterThanOrEqual(1);
  });

  it('shows consent tab content by default', () => {
    render(<RegulatoryCompliancePage />);
    // Consent tab heading should be rendered (same key as tab button, appears twice —
    // once in the tab strip and once as the h2)
    const matches = screen.getAllByText('regulatoryCompliance.tabs.consent');
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  it('hides the MX-gated consumer-protection tab for global-locale orgs', () => {
    mockUser.current = { organization_locale: 'global', role: 'admin' };
    try {
      render(<RegulatoryCompliancePage />);
      expect(screen.queryByText('regulatoryCompliance.tabs.consumer')).toBeNull();
      expect(screen.getAllByText('regulatoryCompliance.tabs.dsar').length).toBeGreaterThanOrEqual(1);
    } finally {
      mockUser.current = { organization_locale: 'MX', role: 'admin' };
    }
  });
});

// ---------------------------------------------------------------------------
// Consent tab — the controls must not render for roles the backend will 403.
// PrivateRoute lets readonly and technician onto this page as well as billing,
// and migration 321 grants those two only subscriber_consents.view. Withdraw
// needs .manage, which ONLY admin has.
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
    render(<RegulatoryCompliancePage />);
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
    render(<RegulatoryCompliancePage />);
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
  };

  function openConsumerTab() {
    render(<RegulatoryCompliancePage />);
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
      if (url.endsWith('/consumer-protection/contract-templates-mx') && !options?.method) {
        return Promise.resolve({
          ok: true, json: () => Promise.resolve({ data: [REGISTERED_TEMPLATE] }),
        } as unknown as Response);
      }
      return Promise.resolve({
        ok: true, json: () => Promise.resolve({ data: [] }),
      } as unknown as Response);
    });

    openConsumerTab();
    expect(await screen.findByText('Contrato 2026')).toBeDefined();
    expect(screen.getByText('regulatoryCompliance.consumer.registry.externalWarning')).toBeDefined();
    fireEvent.click(screen.getByText('regulatoryCompliance.consumer.registry.create'));

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
        }),
      }),
    ));
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
      if (url.endsWith('/consumer-protection/contract-templates-mx')) {
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
    fireEvent.change(screen.getByLabelText('regulatoryCompliance.consumer.registry.status'), { target: { value: 'expired' } });
    fireEvent.click(screen.getByText('common.save'));

    expect(await screen.findByText('Registered MX contract text is permanently immutable; create a new version')).toBeDefined();
  });

  it('shows a localized registry fetch error', async () => {
    vi.mocked(fetch).mockImplementation((input) => {
      if (String(input).endsWith('/consumer-protection/contract-templates-mx')) {
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
