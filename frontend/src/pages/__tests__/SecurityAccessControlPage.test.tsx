// =============================================================================
// FireISP 5.0 — SecurityAccessControlPage tests (§17)
// =============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { SecurityAccessControlPage } from '../SecurityAccessControlPage';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

vi.mock('@/api/client', () => ({
  api: { GET: vi.fn() },
  tokenStore: {
    getAccess: () => 'test-token',
    setAccess: vi.fn(),
    getRefresh: () => null,
    setRefresh: vi.fn(),
    clear: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const sampleCredential = {
  id: 1,
  credential_id: 'AABBCCDDEEFF11223344',
  friendly_name: 'YubiKey 5C',
  aaguid: null,
  created_at: '2025-01-10T00:00:00Z',
};

const samplePolicy = {
  min_length: 12,
  max_length: 128,
  require_uppercase: 1,
  require_lowercase: 1,
  require_digits: 1,
  require_symbols: 0,
  rotation_days: 90,
  lockout_attempts: 5,
  lockout_duration_minutes: 30,
};

const sampleIpEntry = {
  id: 1,
  ip_address: '192.168.1.10',
  description: 'Dev office',
  is_active: 1,
  expires_at: null,
};

const sampleRateLimit = {
  id: 1,
  token_id: 42,
  requests_per_minute: 60,
  requests_per_hour: 1000,
  requests_per_day: null,
};

const sampleFirewallRule = {
  id: 1,
  name: 'Block external SSH',
  action: 'deny',
  protocol: 'tcp',
  direction: 'inbound',
  src_ip: null,
  dst_ip: '10.0.0.1',
  is_active: 1,
};

const sampleEncryptionKey = {
  id: 1,
  key_alias: 'primary-aes-key',
  algorithm: 'AES-256-GCM',
  key_size: 256,
  status: 'active',
  rotated_at: null,
  expires_at: null,
};

const sampleTlsConfig = {
  min_tls_version: 'TLSv1.2',
  recommended_tls_version: 'TLSv1.3',
  cipher_suites: ['TLS_AES_256_GCM_SHA384'],
  notes: 'FireISP enforces TLSv1.2+ for all API endpoints.',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeJsonResponse(body: unknown, ok = true) {
  return {
    ok,
    status: ok ? 200 : 404,
    json: () => Promise.resolve(body),
  } as Response;
}

function setupMocks() {
  mockFetch.mockImplementation((url: string) => {
    const path = typeof url === 'string' ? url : '';
    if (path.endsWith('/security-admin/webauthn'))
      return Promise.resolve(makeJsonResponse({ data: [sampleCredential] }));
    if (path.endsWith('/security-admin/password-policy'))
      return Promise.resolve(makeJsonResponse({ data: samplePolicy }));
    if (path.endsWith('/security-admin/admin-ip-allowlist'))
      return Promise.resolve(makeJsonResponse({ data: [sampleIpEntry] }));
    if (path.endsWith('/security-admin/api-key-rate-limits'))
      return Promise.resolve(makeJsonResponse({ data: [sampleRateLimit] }));
    if (path.endsWith('/network-security/firewall-rules'))
      return Promise.resolve(makeJsonResponse({ data: [sampleFirewallRule] }));
    if (path.endsWith('/network-security/ddos-protection'))
      return Promise.resolve(makeJsonResponse({ data: [] }));
    if (path.endsWith('/network-security/blackhole-routes'))
      return Promise.resolve(makeJsonResponse({ data: [] }));
    if (path.endsWith('/network-security/dns-blocklists'))
      return Promise.resolve(makeJsonResponse({ data: [] }));
    if (path.endsWith('/network-security/cpe-security-scans'))
      return Promise.resolve(makeJsonResponse({ data: [] }));
    if (path.endsWith('/data-security/encryption-keys'))
      return Promise.resolve(makeJsonResponse({ data: [sampleEncryptionKey] }));
    if (path.endsWith('/data-security/data-masking'))
      return Promise.resolve(makeJsonResponse({ data: [] }));
    if (path.endsWith('/data-security/secure-deletion-log'))
      return Promise.resolve(makeJsonResponse({ data: [] }));
    if (path.endsWith('/data-security/tls-config'))
      return Promise.resolve(makeJsonResponse({ data: sampleTlsConfig }));
    return Promise.resolve(makeJsonResponse({ data: [] }));
  });
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <SecurityAccessControlPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SecurityAccessControlPage (§17)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupMocks();
  });

  it('renders the page heading', () => {
    renderPage();
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
  });

  it('renders 4 tabs', () => {
    renderPage();
    const buttons = screen.getAllByRole('button');
    // At least 4 tab buttons should be present
    expect(buttons.length).toBeGreaterThanOrEqual(4);
  });

  it('shows User Security tab content on mount', async () => {
    renderPage();
    // WebAuthn section heading
    await waitFor(() =>
      expect(screen.getByText(/webauthn/i)).toBeInTheDocument(),
    );
  });

  it('shows WebAuthn credential friendly name after load', async () => {
    renderPage();
    await waitFor(() =>
      expect(screen.getByText('YubiKey 5C')).toBeInTheDocument(),
    );
  });

  it('shows password policy min length after load', async () => {
    renderPage();
    await waitFor(() =>
      expect(screen.getByText('12')).toBeInTheDocument(),
    );
  });

  it('shows admin IP allowlist entry after load', async () => {
    renderPage();
    await waitFor(() =>
      expect(screen.getByText('192.168.1.10')).toBeInTheDocument(),
    );
  });

  it('switches to API Security tab and shows rate limits', async () => {
    renderPage();
    const tabs = screen.getAllByRole('button');
    const apiTab = tabs.find(b => /api/i.test(b.textContent ?? ''));
    expect(apiTab).toBeDefined();
    await userEvent.click(apiTab!);
    await waitFor(() =>
      expect(screen.getByText('60')).toBeInTheDocument(),
    );
  });

  it('switches to Network Security tab and shows firewall rules', async () => {
    renderPage();
    const tabs = screen.getAllByRole('button');
    const netTab = tabs.find(b => /network/i.test(b.textContent ?? ''));
    expect(netTab).toBeDefined();
    await userEvent.click(netTab!);
    await waitFor(() =>
      expect(screen.getByText('deny')).toBeInTheDocument(),
    );
  });

  it('switches to Data Security tab and shows TLS info', async () => {
    renderPage();
    const tabs = screen.getAllByRole('button');
    const dataTab = tabs.find(b => /data/i.test(b.textContent ?? ''));
    expect(dataTab).toBeDefined();
    await userEvent.click(dataTab!);
    await waitFor(() =>
      expect(screen.getByText(/TLSv1\.3/i)).toBeInTheDocument(),
    );
  });

  it('shows encryption key alias on Data Security tab', async () => {
    renderPage();
    const tabs = screen.getAllByRole('button');
    const dataTab = tabs.find(b => /data/i.test(b.textContent ?? ''));
    await userEvent.click(dataTab!);
    await waitFor(() =>
      expect(screen.getByText('primary-aes-key')).toBeInTheDocument(),
    );
  });

  it('handles no password policy gracefully', async () => {
    mockFetch.mockImplementation((url: string) => {
      const path = typeof url === 'string' ? url : '';
      if (path.endsWith('/security-admin/password-policy'))
        return Promise.resolve(makeJsonResponse({}, false));
      if (path.endsWith('/security-admin/webauthn'))
        return Promise.resolve(makeJsonResponse({ data: [] }));
      if (path.endsWith('/security-admin/admin-ip-allowlist'))
        return Promise.resolve(makeJsonResponse({ data: [] }));
      return Promise.resolve(makeJsonResponse({ data: [] }));
    });
    renderPage();
    await waitFor(() =>
      expect(screen.queryByText('12')).not.toBeInTheDocument(),
    );
  });
});
