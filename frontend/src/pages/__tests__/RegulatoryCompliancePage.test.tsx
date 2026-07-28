// =============================================================================
// FireISP 5.0 — RegulatoryCompliancePage tests (§16)
// =============================================================================
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
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
