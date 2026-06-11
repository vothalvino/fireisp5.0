// =============================================================================
// FireISP 5.0 — PppoeDiagnostics page tests
// =============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { PppoeDiagnostics } from '../PppoeDiagnostics';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }),
}));

const mockApiGet = vi.fn();

vi.mock('@/api/client', () => ({
  api: { GET: (...args: unknown[]) => mockApiGet(...args) },
  tokenStore: {
    getAccess: () => 'tok',
    setAccess: vi.fn(),
    getRefresh: () => null,
    setRefresh: vi.fn(),
    clear: vi.fn(),
  },
}));

const failure1 = {
  username: 'jdoe',
  authdate: '2026-06-01T12:00:00.000Z',
  nas_ip_address: '10.0.0.1',
  calling_station_id: 'AA:BB:CC:DD:EE:FF',
  reason: 'bad_password',
  reply: 'Access-Reject',
};

const event1 = {
  id: 1,
  username: 'jsmith',
  mac: 'AA:BB:CC:DD:EE:01',
  stage: 'LCP',
  severity: 'error',
  message: 'LCP negotiation failed',
  reason_code: 'lcp_failed',
  logged_at: '2026-06-01T11:00:00.000Z',
};

const macMove1 = {
  id: 1,
  username: 'jdoe',
  old_mac: 'AA:BB:CC:DD:EE:01',
  new_mac: 'AA:BB:CC:DD:EE:02',
  old_nas_id: 1,
  new_nas_id: 2,
  detected_at: '2026-06-01T10:00:00.000Z',
};

const mtuAdvisory1 = {
  type: 'mtu_exceeds_pppoe_ceiling',
  profile_id: 3,
  profile_name: 'BigMTU',
  username: null,
  mtu: 1500,
  description: 'Profile BigMTU has mtu=1500 which exceeds the PPPoE ceiling of 1492.',
};

function setupMocks() {
  mockApiGet.mockImplementation((path: string) => {
    if (path === '/pppoe/diagnostics/auth-failures')
      return Promise.resolve({
        data: {
          failures: [failure1],
          counts: { bad_password: 1, unknown_user: 0, session_limit: 0, no_pool: 0, other: 0 },
          total: 1,
        },
        error: undefined,
      });
    if (path === '/pppoe/events')
      return Promise.resolve({
        data: { data: [event1], meta: { total: 1, page: 1, limit: 25 } },
        error: undefined,
      });
    if (path === '/radius/mac-move-events')
      return Promise.resolve({
        data: { data: [macMove1], meta: { total: 1, page: 1, limit: 25 } },
        error: undefined,
      });
    if (path === '/pppoe/diagnostics/mtu-issues')
      return Promise.resolve({
        data: { advisories: [mtuAdvisory1] },
        error: undefined,
      });
    return Promise.resolve({ data: { data: [] }, error: undefined });
  });
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <PppoeDiagnostics />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('PppoeDiagnostics page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupMocks();
  });

  it('renders page heading and tabs', () => {
    renderPage();
    expect(screen.getByText('PPPoE Diagnostics')).toBeInTheDocument();
    expect(screen.getByText('Auth Failures')).toBeInTheDocument();
    expect(screen.getByText('Event Log')).toBeInTheDocument();
    expect(screen.getByText('MAC Moves')).toBeInTheDocument();
    expect(screen.getByText('MTU Advisories')).toBeInTheDocument();
  });

  it('auth failures tab shows failure row and reason badge', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('jdoe')).toBeInTheDocument());
    // reason badge rendered by ReasonBadge: replaces _ with space
    // "bad password" appears in both the counts summary and the table badge — check at least one exists
    expect(screen.getAllByText('bad password').length).toBeGreaterThan(0);
    // NAS IP column
    expect(screen.getByText('10.0.0.1')).toBeInTheDocument();
  });

  it('event log tab shows events', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByText('Event Log'));
    await waitFor(() => expect(screen.getByText('jsmith')).toBeInTheDocument());
    // LCP appears in stage column and in stage filter dropdown — check for lcp_failed reason code
    expect(screen.getByText('lcp_failed')).toBeInTheDocument();
  });

  it('mac moves tab shows mac move events', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByText('MAC Moves'));
    await waitFor(() => expect(screen.getByText('AA:BB:CC:DD:EE:01')).toBeInTheDocument());
    expect(screen.getByText('AA:BB:CC:DD:EE:02')).toBeInTheDocument();
  });

  it('mtu issues tab shows advisory and heuristic note', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByText('MTU Advisories'));
    await waitFor(() => expect(screen.getByText('BigMTU (#3)')).toBeInTheDocument());
    expect(screen.getByText(/heuristic/i)).toBeInTheDocument();
  });

  it('shows empty state for auth failures when none returned', async () => {
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/pppoe/diagnostics/auth-failures')
        return Promise.resolve({
          data: { failures: [], counts: { bad_password: 0, unknown_user: 0, session_limit: 0, no_pool: 0, other: 0 }, total: 0 },
          error: undefined,
        });
      return Promise.resolve({ data: { data: [] }, error: undefined });
    });
    renderPage();
    await waitFor(() => expect(screen.getByText('No authentication failures found in the selected window.')).toBeInTheDocument());
  });
});
