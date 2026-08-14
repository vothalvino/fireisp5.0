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
  useTranslation: () => ({
    t: (_key: string, fallback: string, values?: Record<string, string | number>) => {
      if (!values) return fallback;
      return Object.entries(values).reduce(
        (message, [key, value]) => message.split(`{{${key}}}`).join(String(value)),
        fallback,
      );
    },
  }),
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

const readyReadiness = {
  overall: 'ready',
  sources: {
    authentication: {
      status: 'ready',
      lastReceivedAt: '2026-06-01T12:00:00.000Z',
      events24h: 9,
      detail: 'Authentication records are arriving.',
    },
    routerEvents: {
      status: 'ready',
      lastReceivedAt: '2026-06-01T11:55:00.000Z',
      events24h: 12,
      detail: 'All configured NAS routers are covered.',
      coveredNas: 2,
      totalNas: 2,
    },
    accounting: {
      status: 'ready',
      lastReceivedAt: '2026-06-01T11:58:00.000Z',
      events24h: 25,
      detail: 'Accounting records are arriving.',
    },
  },
};

function defaultApiResponse(path: string) {
  if (path === '/pppoe/diagnostics/auth-failures') {
    return {
      data: {
        data: {
          failures: [failure1],
          counts: { bad_password: 1, unknown_user: 0, session_limit: 0, no_pool: 0, other: 0 },
          total: 1,
        },
      },
      error: undefined,
    };
  }
  if (path === '/pppoe/events') {
    return { data: { data: [event1], meta: { total: 1, page: 1, limit: 25 } }, error: undefined };
  }
  if (path === '/radius/mac-move-events') {
    return { data: { data: [macMove1], meta: { total: 1, page: 1, limit: 25 } }, error: undefined };
  }
  if (path === '/pppoe/diagnostics/mtu-issues') {
    return { data: { data: { advisories: [mtuAdvisory1] } }, error: undefined };
  }
  if (path === '/pppoe/diagnostics/readiness') {
    return { data: { data: readyReadiness }, error: undefined };
  }
  return { data: { data: [] }, error: undefined };
}

function setupMocks() {
  mockApiGet.mockImplementation((path: string) => {
    return Promise.resolve(defaultApiResponse(path));
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
    expect(screen.getByText(/Correlate RADIUS authentication/)).toBeInTheDocument();
    expect(screen.getByText('Auth Failures')).toBeInTheDocument();
    expect(screen.getByText('Event Log')).toBeInTheDocument();
    expect(screen.getByText('MAC Moves')).toBeInTheDocument();
    expect(screen.getByText('MTU Advisories')).toBeInTheDocument();
  });

  it('associates accessible labels with the auth and event filters', async () => {
    const user = userEvent.setup();
    renderPage();

    expect(screen.getByLabelText('From')).toHaveAttribute('type', 'datetime-local');
    expect(screen.getByLabelText('To')).toHaveAttribute('type', 'datetime-local');
    expect(screen.getByLabelText('Username')).toHaveAttribute('id', 'pppoe-auth-username');

    await user.click(screen.getByRole('tab', { name: 'Event Log' }));
    expect(screen.getByLabelText('Username')).toHaveAttribute('id', 'pppoe-events-username');
    expect(screen.getByLabelText('Stage')).toHaveValue('');
    expect(screen.getByLabelText('Severity')).toHaveValue('');
  });

  it('implements roving tab focus, panel relationships, and keyboard activation', async () => {
    const user = userEvent.setup();
    renderPage();

    const authTab = screen.getByRole('tab', { name: 'Auth Failures' });
    const eventTab = screen.getByRole('tab', { name: 'Event Log' });
    const macTab = screen.getByRole('tab', { name: 'MAC Moves' });
    const mtuTab = screen.getByRole('tab', { name: 'MTU Advisories' });

    expect(authTab).toHaveAttribute('aria-selected', 'true');
    expect(authTab).toHaveAttribute('tabindex', '0');
    expect(eventTab).toHaveAttribute('tabindex', '-1');
    expect(authTab).toHaveAttribute('aria-controls', 'pppoe-diagnostics-panel-auth_failures');
    expect(screen.getByRole('tabpanel', { name: 'Auth Failures' })).toHaveAttribute(
      'id',
      'pppoe-diagnostics-panel-auth_failures',
    );

    authTab.focus();
    await user.keyboard('{ArrowRight}');
    expect(eventTab).toHaveFocus();
    expect(eventTab).toHaveAttribute('aria-selected', 'true');
    expect(eventTab).toHaveAttribute('tabindex', '0');
    expect(authTab).toHaveAttribute('tabindex', '-1');
    expect(screen.getByRole('tabpanel', { name: 'Event Log' })).toBeInTheDocument();

    await user.keyboard('{End}');
    expect(mtuTab).toHaveFocus();
    expect(mtuTab).toHaveAttribute('aria-selected', 'true');

    await user.keyboard('{Home}');
    expect(authTab).toHaveFocus();

    await user.keyboard('{ArrowLeft}');
    expect(mtuTab).toHaveFocus();
    expect(macTab).toHaveAttribute('tabindex', '-1');
  });

  it('unwraps the real auth-failure envelope and shows the raw RADIUS evidence', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('jdoe')).toBeInTheDocument());
    // reason badge rendered by ReasonBadge: replaces _ with space
    // "bad password" appears in both the counts summary and the table badge — check at least one exists
    expect(screen.getAllByText('bad password').length).toBeGreaterThan(0);
    // NAS IP column
    expect(screen.getByText('10.0.0.1')).toBeInTheDocument();
    expect(screen.getByText('Access-Reject')).toBeInTheDocument();
  });

  it('event log tab shows events', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByText('Event Log'));
    await waitFor(() => expect(screen.getByText('jsmith')).toBeInTheDocument());
    // LCP appears in stage column and in stage filter dropdown — check for lcp_failed reason code
    expect(screen.getByText('lcp_failed')).toBeInTheDocument();
    expect(screen.getByText('LCP negotiation failed')).toHaveStyle({ whiteSpace: 'normal' });
  });

  it('mac moves tab shows mac move events', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByText('MAC Moves'));
    await waitFor(() => expect(screen.getByText('AA:BB:CC:DD:EE:01')).toBeInTheDocument());
    expect(screen.getByText('AA:BB:CC:DD:EE:02')).toBeInTheDocument();
  });

  it('unwraps the real MTU envelope and shows the complete advisory evidence', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByText('MTU Advisories'));
    await waitFor(() => expect(screen.getByText('BigMTU (#3)')).toBeInTheDocument());
    expect(screen.getByText(/heuristic/i)).toBeInTheDocument();
    expect(screen.getByText(mtuAdvisory1.description)).toHaveStyle({ whiteSpace: 'normal' });
  });

  it('shows empty state for auth failures when none returned', async () => {
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/pppoe/diagnostics/auth-failures')
        return Promise.resolve({
          data: { data: { failures: [], counts: { bad_password: 0, unknown_user: 0, session_limit: 0, no_pool: 0, other: 0 }, total: 0 } },
          error: undefined,
        });
      return Promise.resolve(defaultApiResponse(path));
    });
    renderPage();
    await waitFor(() => expect(screen.getByText('No authentication failures found in the selected window.')).toBeInTheDocument());
  });

  it('treats the legacy flat auth body as an error instead of a clean empty result', async () => {
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/pppoe/diagnostics/auth-failures') {
        return Promise.resolve({
          data: {
            failures: [failure1],
            counts: { bad_password: 1, unknown_user: 0, session_limit: 0, no_pool: 0, other: 0 },
            total: 1,
          },
          error: undefined,
        });
      }
      return Promise.resolve(defaultApiResponse(path));
    });

    renderPage();
    await waitFor(() => expect(screen.getByText('Failed to load auth failures.')).toBeInTheDocument());
    expect(screen.queryByText('No authentication failures found in the selected window.')).not.toBeInTheDocument();
  });

  it('surfaces an auth API failure', async () => {
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/pppoe/diagnostics/auth-failures') {
        return Promise.resolve({ data: undefined, error: { message: 'Forbidden' } });
      }
      return Promise.resolve(defaultApiResponse(path));
    });

    renderPage();
    await waitFor(() => expect(screen.getByText('Failed to load auth failures.')).toBeInTheDocument());
  });

  it('treats a flat MTU body as an error instead of showing no advisories', async () => {
    const user = userEvent.setup();
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/pppoe/diagnostics/mtu-issues') {
        return Promise.resolve({ data: { advisories: [mtuAdvisory1] }, error: undefined });
      }
      return Promise.resolve(defaultApiResponse(path));
    });

    renderPage();
    await user.click(screen.getByText('MTU Advisories'));
    await waitFor(() => expect(screen.getByText('Failed to load MTU advisories.')).toBeInTheDocument());
    expect(screen.queryByText('No MTU advisories.')).not.toBeInTheDocument();
  });

  it('warns when telemetry is partial and shows last-received and configured polling coverage', async () => {
    const partialReadiness = {
      overall: 'partial',
      sources: {
        authentication: readyReadiness.sources.authentication,
        routerEvents: {
          status: 'waiting',
          lastReceivedAt: null,
          events24h: 0,
          detail: 'No RouterOS PPPoE events have been received yet.',
          coveredNas: 1,
          totalNas: 2,
        },
        accounting: {
          status: 'not_configured',
          lastReceivedAt: null,
          events24h: 0,
          detail: 'RADIUS accounting ingestion is not configured.',
        },
      },
    };
    mockApiGet.mockImplementation((path: string) => Promise.resolve(
      path === '/pppoe/diagnostics/readiness'
        ? { data: { data: partialReadiness }, error: undefined }
        : defaultApiResponse(path),
    ));

    renderPage();
    await waitFor(() => expect(screen.getByText('Diagnostics partially ready')).toBeInTheDocument());
    expect(screen.getByText(/Empty results may be incomplete/)).toBeInTheDocument();
    expect(screen.getAllByText('Never')).toHaveLength(2);
    expect(screen.getByText('NAS configured for polling')).toBeInTheDocument();
    expect(screen.getByText('1 / 2')).toBeInTheDocument();
    expect(screen.getByText('No RouterOS PPPoE events have been received yet.')).toBeInTheDocument();
  });

  it('keeps an all-ready banner compact and can reveal source details', async () => {
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => expect(screen.getByText('Diagnostics ready')).toBeInTheDocument());
    expect(screen.queryByText('Events (24h)')).not.toBeInTheDocument();
    expect(screen.getByText('2 / 2 NAS configured for polling')).toBeInTheDocument();

    await user.click(screen.getByText('Show source details'));
    expect(screen.getAllByText('Events (24h)')).toHaveLength(3);
    expect(screen.getByText('Hide source details')).toBeInTheDocument();
  });

  it('accepts not configured only when every source is not configured', async () => {
    const missingSource = {
      status: 'not_configured',
      lastReceivedAt: null,
      events24h: 0,
      detail: 'This source is not configured.',
    };
    const notConfiguredReadiness = {
      overall: 'not_configured',
      sources: {
        authentication: missingSource,
        routerEvents: { ...missingSource, coveredNas: 0, totalNas: 0 },
        accounting: missingSource,
      },
    };
    mockApiGet.mockImplementation((path: string) => Promise.resolve(
      path === '/pppoe/diagnostics/readiness'
        ? { data: { data: notConfiguredReadiness }, error: undefined }
        : defaultApiResponse(path),
    ));

    renderPage();
    await waitFor(() => expect(screen.getByText('Diagnostics not configured')).toBeInTheDocument());
    expect(screen.getAllByText('not configured')).toHaveLength(3);
  });

  it('warns when the readiness response itself fails validation', async () => {
    mockApiGet.mockImplementation((path: string) => Promise.resolve(
      path === '/pppoe/diagnostics/readiness'
        ? { data: { data: { overall: 'ready', sources: {} } }, error: undefined }
        : defaultApiResponse(path),
    ));

    renderPage();
    await waitFor(() => expect(screen.getByText('Readiness unavailable')).toBeInTheDocument());
    expect(screen.getByText(/Empty results may be incomplete/)).toBeInTheDocument();
  });

  it('rejects a null readiness detail required by the wire contract', async () => {
    const invalidReadiness = {
      ...readyReadiness,
      sources: {
        ...readyReadiness.sources,
        authentication: { ...readyReadiness.sources.authentication, detail: null },
      },
    };
    mockApiGet.mockImplementation((path: string) => Promise.resolve(
      path === '/pppoe/diagnostics/readiness'
        ? { data: { data: invalidReadiness }, error: undefined }
        : defaultApiResponse(path),
    ));

    renderPage();
    await waitFor(() => expect(screen.getByText('Readiness unavailable')).toBeInTheDocument());
  });

  it('rejects a false-green overall state that contradicts its source statuses', async () => {
    const inconsistentReadiness = {
      ...readyReadiness,
      sources: {
        ...readyReadiness.sources,
        routerEvents: { ...readyReadiness.sources.routerEvents, status: 'waiting' },
      },
    };
    mockApiGet.mockImplementation((path: string) => Promise.resolve(
      path === '/pppoe/diagnostics/readiness'
        ? { data: { data: inconsistentReadiness }, error: undefined }
        : defaultApiResponse(path),
    ));

    renderPage();
    await waitFor(() => expect(screen.getByText('Readiness unavailable')).toBeInTheDocument());
    expect(screen.queryByText('Diagnostics ready')).not.toBeInTheDocument();
  });
});
