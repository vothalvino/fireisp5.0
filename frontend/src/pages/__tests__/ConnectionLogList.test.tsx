// =============================================================================
// FireISP 5.0 — Connections page tests
// =============================================================================
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import i18n from '@/i18n';
import { ConnectionLogList } from '../ConnectionLogList';

const mocks = vi.hoisted(() => ({
  apiGet: vi.fn(),
  authedFetch: vi.fn(),
  user: {
    current: {
      id: 1,
      role: 'admin',
      organization_locale: 'global',
      permissions: [] as string[],
    },
  },
}));

vi.mock('@/api/client', () => ({
  api: { GET: (...args: unknown[]) => mocks.apiGet(...args) },
  authedFetch: (...args: unknown[]) => mocks.authedFetch(...args),
  tokenStore: { getAccess: () => 'token', setAccess: vi.fn(), getRefresh: () => null, setRefresh: vi.fn(), clear: vi.fn() },
}));

vi.mock('@/auth/AuthContext', () => ({
  useAuth: () => ({ user: mocks.user.current }),
}));

const session = {
  id: 41,
  organization_id: 1,
  client_id: 7,
  client_name: 'Ada Subscriber',
  contract_id: 9,
  username: 'ada@isp',
  assigned_ipv4: '10.20.30.40',
  assigned_ipv6: '2001:db8:100::/56',
  event_type: 'stop',
  state: 'ended',
  event_at: '2026-08-14T11:02:03.000Z',
  session_start: '2026-08-14T10:00:00.000Z',
  session_end: '2026-08-14T11:02:03.000Z',
  session_duration: '3723',
  nas_id: 3,
  nas_name: 'POP Norte',
  nas_ip_address: '192.0.2.10',
  nas_port_id: 'ether8',
  mac: 'AA:BB:CC:DD:EE:FF',
  radius_session_id: 'radius-123',
  bytes_in: '1048576',
  bytes_out: 524288,
  terminate_cause: 'User-Request',
};

const cgnatLookup = {
  data: {
    status: 'matched',
    reason: null,
    candidate_count: 1,
    gov_data_request_id: 73,
    attributionMethod: 'cgnat_binding',
    query: {
      public_ipv4: '198.51.100.8',
      public_port: 62001,
      protocol: 'tcp',
      observed_at: '2026-08-14T10:15:01.000Z',
    },
    attribution: {
      binding_id: 82,
      binding_type: 'single_port',
      client_id: 7,
      client_name: 'Ada Subscriber',
      contract_id: 9,
      username: 'ada@isp',
      radius_session_id: 'radius-123',
      private_ipv4: '10.20.30.40',
      private_port_start: 51515,
      private_port_end: 51515,
      public_ipv4: '198.51.100.8',
      public_port_start: 62001,
      public_port_end: 62001,
      protocol: 'tcp',
      allocated_at: '2026-08-14T10:00:00.000Z',
      released_at: null,
      exporter_id: 'routeros-3',
      nat_instance_id: 'nat-a',
      nat_pool_id: 'pool-a',
      nat_realm: 'north',
      allocation_device_recorded_at: '2026-08-14T10:00:00.000Z',
      allocation_received_at: '2026-08-14T10:00:00.100Z',
      integrity_hash: 'sha256-fixture',
    },
  },
};

const readiness = {
  data: {
    ready: true,
    status: 'ready',
    checked_at: '2026-08-14T12:00:00.000Z',
    database_scope: 'shared',
    active_nas: 4,
    maintenance_nas: 0,
    active_contracts: 100,
    session_logger: {
      configured: true,
      receiving: true,
      healthy: true,
      status: 'receiving',
      last_event_at: '2026-08-14T11:58:00.000Z',
      lifecycle_evidence_24h: 125,
      active_sessions: 20,
      covered_sources: 4,
      total_sources: 4,
      coverage_status: 'complete',
    },
    cgnat_attribution: {
      configured: true,
      ready: true,
      status: 'ready',
      coverage_status: 'complete',
      last_received_at: '2026-08-14T11:59:00.000Z',
      bindings_24h: 900,
      expected_exporters: 4,
      complete_exporters: 4,
      clock_status: 'reported',
      max_clock_offset_ms: 18,
      loss_status: 'clear',
      sequence_gap_events_24h: 0,
      reported_lost_records_24h: 0,
      incomplete_metadata_24h: 0,
    },
    retention: {
      session_months: 24,
      cgnat_months: 6,
      last_run_at: null,
      last_status: null,
      partition_event_enabled: true,
      radius_partitions: 24,
    },
    caveats: [],
  },
};

function response(body: unknown, status = 200, headerValues?: HeadersInit): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(body),
    blob: vi.fn().mockResolvedValue(new Blob(['csv'], { type: 'text/csv' })),
    headers: new Headers(headerValues),
  } as unknown as Response;
}

function installDefaultApi(options?: { sessionRows?: unknown[]; sessionTotal?: number; lookupResponse?: unknown; lookupStatus?: number }) {
  mocks.apiGet.mockImplementation(async (path: string) => {
    if (path === '/connection-logs/readiness') return { data: readiness };
    const rows = options?.sessionRows ?? [session];
    return { data: { data: rows, meta: { total: options?.sessionTotal ?? rows.length, page: 1, limit: 50 } } };
  });
  mocks.authedFetch.mockImplementation(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/connection-logs/ip-attribution/lookup')) {
      return response(options?.lookupResponse ?? cgnatLookup, options?.lookupStatus ?? 200);
    }
    if (url.includes('/connection-logs/export')) return response('csv');
    return response({}, 404);
  });
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/connection-logs']}>
        <ConnectionLogList />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function requestedUrls(): string[] {
  const typedUrls = mocks.apiGet.mock.calls.map(([path, options]) => {
    const params = new URLSearchParams();
    const query = options?.params?.query as Record<string, unknown> | undefined;
    Object.entries(query ?? {}).forEach(([key, value]) => {
      if (value !== undefined && value !== null) params.set(key, String(value));
    });
    const encoded = params.toString();
    return `/api/v1${String(path)}${encoded ? `?${encoded}` : ''}`;
  });
  return [
    ...typedUrls,
    ...mocks.authedFetch.mock.calls.map(([input]) => String(input)),
  ];
}

function latestUrl(fragment: string): URL {
  const matches = requestedUrls().filter((url) => url.includes(fragment));
  const raw = matches[matches.length - 1];
  if (!raw) throw new Error(`No request matched ${fragment}`);
  return new URL(raw, 'http://localhost');
}

function latestApiQuery(path: string): Record<string, unknown> {
  const matches = mocks.apiGet.mock.calls.filter(([candidate]) => candidate === path);
  const call = matches[matches.length - 1];
  return (call?.[1]?.params?.query ?? {}) as Record<string, unknown>;
}

function installDownloadBrowser() {
  const createUrl = vi.fn().mockReturnValue('blob:connection-export');
  const revokeUrl = vi.fn();
  const filenames: string[] = [];
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createUrl });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeUrl });
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function captureDownload(this: HTMLAnchorElement) {
    filenames.push(this.download);
  });
  return { createUrl, revokeUrl, click, filenames };
}

describe('ConnectionLogList', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.user.current = {
      id: 1,
      role: 'admin',
      organization_locale: 'global',
      permissions: [],
    };
    installDefaultApi();
    await i18n.changeLanguage('en');
  });

  it('renders normalized subscriber evidence and drill-down links for a global organization', async () => {
    renderPage();

    expect(await screen.findByRole('heading', { level: 1, name: 'Connection evidence' })).toBeInTheDocument();
    expect(screen.getByText(/does not provide NAT translation evidence/i)).toBeInTheDocument();
    expect(await screen.findByText('10.20.30.40')).toBeInTheDocument();
    expect(screen.getByText('2001:db8:100::/56')).toBeInTheDocument();
    expect(screen.getByText('AA:BB:CC:DD:EE:FF')).toBeInTheDocument();
    expect(screen.getByText('radius-123')).toBeInTheDocument();
    expect(screen.getByText('User request')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ada Subscriber' })).toHaveAttribute('href', '/clients/7');
    expect(screen.getByRole('link', { name: '#9' })).toHaveAttribute('href', '/contracts/9');
    expect(screen.getByRole('link', { name: 'POP Norte' })).toHaveAttribute('href', '/nas/3');
    expect(screen.getByText('1h 2m')).toBeInTheDocument();
    expect(screen.getByText('24 months')).toBeInTheDocument();
    expect(screen.getByText('6 months')).toBeInTheDocument();
  });

  it('renders in Spanish for an MX organization without locale-gating the page', async () => {
    mocks.user.current = {
      id: 2,
      role: 'support',
      organization_locale: 'MX',
      permissions: ['connection_logs.view'],
    };
    await i18n.changeLanguage('es');
    renderPage();

    expect(await screen.findByRole('heading', { level: 1, name: 'Evidencia de conexión' })).toBeInTheDocument();
    expect(screen.getByText(/No aporta evidencia de traducción NAT/i)).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Sesiones de suscriptores' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Atribución de IP' })).not.toBeInTheDocument();
    expect(requestedUrls().some((url) => /\/connection-logs\?/.test(url))).toBe(true);
  });

  it('localizes standard RADIUS terminate causes and preserves unknown vendor evidence', async () => {
    await i18n.changeLanguage('es');
    installDefaultApi({
      sessionRows: [
        { ...session, id: 41, terminate_cause: 'NAS-Reboot' },
        { ...session, id: 42, username: 'vendor@isp', terminate_cause: 'Vendor-Specific-77' },
      ],
    });
    renderPage();

    expect(await screen.findByText('Reinicio del NAS')).toBeInTheDocument();
    expect(screen.getByText('Vendor-Specific-77')).toBeInTheDocument();
    expect(screen.queryByText('NAS-Reboot')).not.toBeInTheDocument();
  });

  it('renders the Portuguese empty state without falling back to English', async () => {
    await i18n.changeLanguage('pt-BR');
    installDefaultApi({ sessionRows: [] });
    renderPage();

    expect(await screen.findByRole('heading', { level: 1, name: 'Evidências de conexão' })).toBeInTheDocument();
    expect(await screen.findByText('Nenhuma sessão de assinante corresponde a estes filtros.')).toBeInTheDocument();
    expect(screen.queryByText(/No subscriber sessions/)).not.toBeInTheDocument();
  });

  it('runs a case-bound CGNAT lookup and renders only exact attribution evidence', async () => {
    mocks.user.current = {
      id: 3,
      role: 'support',
      organization_locale: 'global',
      permissions: ['connection_logs.view', 'ip_attribution.view', 'gov_data_requests.view'],
    };
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('tab', { name: 'IP attribution' }));
    await user.type(screen.getByLabelText('Government request ID'), '73');
    await user.type(screen.getByLabelText('Public IPv4'), '198.51.100.8');
    await user.type(screen.getByLabelText('Public source port'), '62001');
    await user.selectOptions(screen.getByLabelText('Transport protocol'), 'tcp');
    fireEvent.change(screen.getByLabelText('Exact timestamp'), { target: { value: '2026-08-14T10:15:01' } });
    await user.click(screen.getByRole('button', { name: 'Run exact lookup' }));

    expect(await screen.findByText('One assignment found')).toBeInTheDocument();
    expect(await screen.findByText('10.20.30.40:51515')).toBeInTheDocument();
    expect(screen.getByText('198.51.100.8:62001')).toBeInTheDocument();
    expect(screen.getByText('Assignment window').parentElement).toHaveTextContent('active / no release received');
    expect(screen.getByText('CGNAT binding')).toBeInTheDocument();
    expect(screen.getByText(/does not prove which person/i)).toBeInTheDocument();
    expect(screen.queryByText(/destination/i)).not.toBeInTheDocument();

    const lookupCall = mocks.authedFetch.mock.calls.find(([input]) => String(input).includes('/ip-attribution/lookup'));
    expect(lookupCall?.[1]).toMatchObject({ method: 'POST' });
    expect(JSON.parse(String(lookupCall?.[1]?.body))).toEqual({
      gov_data_request_id: 73,
      public_ipv4: '198.51.100.8',
      public_port: 62001,
      protocol: 'tcp',
      observed_at: new Date('2026-08-14T10:15:01').toISOString(),
    });
    expect(screen.queryByRole('button', { name: 'Download case evidence CSV' })).not.toBeInTheDocument();
  });

  it('exports only the frozen case-bound lookup with the server filename and evidence checksum', async () => {
    mocks.user.current = {
      id: 3,
      role: 'support',
      organization_locale: 'global',
      permissions: [
        'ip_attribution.view', 'ip_attribution.export', 'gov_data_requests.view',
      ],
    };
    let exportShouldFail = true;
    let finishExport: ((value: Response) => void) | undefined;
    mocks.authedFetch.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/ip-attribution/lookup')) return Promise.resolve(response(cgnatLookup));
      if (url.includes('/ip-attribution/export')) {
        if (exportShouldFail) {
          exportShouldFail = false;
          return Promise.resolve(response({ error: { code: 'FAILED' } }, 500));
        }
        return new Promise<Response>(resolve => { finishExport = resolve; });
      }
      return Promise.resolve(response({}, 404));
    });
    const { filenames } = installDownloadBrowser();
    const user = userEvent.setup();
    renderPage();
    expect(mocks.apiGet).not.toHaveBeenCalled();
    await user.click(await screen.findByRole('tab', { name: 'IP attribution' }));
    await user.type(screen.getByLabelText('Government request ID'), '73');
    await user.type(screen.getByLabelText('Public IPv4'), '198.51.100.8');
    await user.type(screen.getByLabelText('Public source port'), '62001');
    await user.selectOptions(screen.getByLabelText('Transport protocol'), 'tcp');
    fireEvent.change(screen.getByLabelText('Exact timestamp'), { target: { value: '2026-08-14T10:15:01' } });
    expect(screen.queryByRole('button', { name: 'Download case evidence CSV' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Run exact lookup' }));

    const exportButton = await screen.findByRole('button', { name: 'Download case evidence CSV' });
    await user.click(exportButton);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The case evidence CSV could not be prepared. No file was downloaded.',
    );

    await user.click(exportButton);
    expect(await screen.findByRole('button', { name: 'Preparing case CSV…' })).toBeDisabled();
    const checksum = '53bb9b0b38ac812554abeb88ea6d56760d07ec147a75e8761c4f57ecc298218f';
    finishExport?.(response('csv', 200, {
      'Content-Disposition': 'attachment; filename="authority-case-73.csv"',
      'X-Evidence-SHA256': checksum,
    }));

    expect(await screen.findByRole('status')).toHaveTextContent(`Evidence SHA-256: ${checksum}`);
    expect(filenames).toContain('authority-case-73.csv');
    const exportCalls = mocks.authedFetch.mock.calls.filter(([input]) => String(input).includes('/ip-attribution/export'));
    expect(exportCalls).toHaveLength(2);
    expect(JSON.parse(String(exportCalls[1]?.[1]?.body))).toEqual({
      gov_data_request_id: 73,
      public_ipv4: '198.51.100.8',
      public_port: 62001,
      protocol: 'tcp',
      observed_at: new Date('2026-08-14T10:15:01').toISOString(),
    });
  });

  it('refuses to download case evidence when the CSV bytes fail the server checksum', async () => {
    mocks.user.current = {
      id: 3,
      role: 'support',
      organization_locale: 'global',
      permissions: ['ip_attribution.view', 'ip_attribution.export', 'gov_data_requests.view'],
    };
    mocks.authedFetch.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/ip-attribution/lookup')) return Promise.resolve(response(cgnatLookup));
      if (url.includes('/ip-attribution/export')) {
        return Promise.resolve(response('csv', 200, { 'X-Evidence-SHA256': 'a'.repeat(64) }));
      }
      return Promise.resolve(response({}, 404));
    });
    const { createUrl, filenames } = installDownloadBrowser();
    renderPage();
    await screen.findByRole('tab', { name: 'IP attribution' });
    fireEvent.change(screen.getByLabelText('Government request ID'), { target: { value: '73' } });
    fireEvent.change(screen.getByLabelText('Public IPv4'), { target: { value: '198.51.100.8' } });
    fireEvent.change(screen.getByLabelText('Public source port'), { target: { value: '62001' } });
    fireEvent.change(screen.getByLabelText('Transport protocol'), { target: { value: 'tcp' } });
    fireEvent.change(screen.getByLabelText('Exact timestamp'), { target: { value: '2026-08-14T10:15:01' } });
    fireEvent.click(screen.getByRole('button', { name: 'Run exact lookup' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Download case evidence CSV' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The CSV failed SHA-256 verification. No file was downloaded',
    );
    expect(createUrl).not.toHaveBeenCalled();
    expect(filenames).toEqual([]);
  });

  it('requires an exact authorized tuple before sending a shared-address lookup', async () => {
    mocks.user.current.permissions = ['connection_logs.view', 'ip_attribution.view', 'gov_data_requests.view'];
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('tab', { name: 'IP attribution' }));
    await user.click(screen.getByRole('button', { name: 'Run exact lookup' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Enter a valid government request ID.');
    expect(mocks.authedFetch.mock.calls.some(([input]) => String(input).includes('/ip-attribution/lookup'))).toBe(false);
  });

  it('hides attribution readiness and workflow without both restricted permissions', async () => {
    mocks.user.current = {
      id: 4,
      role: 'support',
      organization_locale: 'global',
      permissions: ['connection_logs.view'],
    };
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByText(/Attribution readiness is restricted/)).toBeInTheDocument();
    const sessionsTab = screen.getByRole('tab', { name: 'Subscriber sessions' });
    expect(screen.queryByRole('tab', { name: 'IP attribution' })).not.toBeInTheDocument();
    expect(screen.queryByText('CGNAT / address-assignment collector')).not.toBeInTheDocument();
    expect(requestedUrls().some((url) => url.includes('/ip-attribution'))).toBe(false);
    sessionsTab.focus();
    await user.keyboard('{End}{ArrowRight}');
    expect(sessionsTab).toHaveFocus();
    expect(sessionsTab).toHaveAttribute('aria-selected', 'true');
  });

  it('lands an attribution-only legal responder on the restricted lookup without fetching session or readiness ledgers', async () => {
    mocks.user.current = {
      id: 6,
      role: 'support',
      organization_locale: 'global',
      permissions: ['ip_attribution.view', 'gov_data_requests.view'],
    };
    const user = userEvent.setup();
    renderPage();

    const attributionTab = await screen.findByRole('tab', { name: 'IP attribution' });
    expect(attributionTab).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByRole('tab', { name: 'Subscriber sessions' })).not.toBeInTheDocument();
    expect(screen.queryByText('Evidence readiness')).not.toBeInTheDocument();
    expect(mocks.apiGet).not.toHaveBeenCalled();

    await user.selectOptions(screen.getByLabelText('Assignment mode'), 'direct');
    await user.type(screen.getByLabelText('Government request ID'), '74');
    await user.type(screen.getByLabelText('Public IPv4'), '203.0.113.9');
    fireEvent.change(screen.getByLabelText('Exact timestamp'), { target: { value: '2026-08-14T10:15:01' } });
    await user.click(screen.getByRole('button', { name: 'Run exact lookup' }));
    expect(await screen.findByText('One assignment found')).toBeInTheDocument();
    expect(mocks.apiGet).not.toHaveBeenCalled();
  });

  it('applies comprehensive session filters, converts local dates to UTC, and resets to page one', async () => {
    const user = userEvent.setup();
    installDefaultApi({ sessionTotal: 120 });
    renderPage();
    await screen.findByText('ada@isp');

    await user.click(screen.getByRole('button', { name: 'Next →' }));
    await waitFor(() => expect(latestUrl('/connection-logs?').searchParams.get('page')).toBe('2'));
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-08-14T08:30' } });
    await user.type(screen.getByLabelText('Client ID'), '7');
    await user.type(screen.getByLabelText('Contract ID'), '9');
    await user.type(screen.getByLabelText('Username'), 'ada@isp');
    await user.type(screen.getByLabelText('Assigned IPv4 or IPv6'), '10.20.30.40');
    await user.type(screen.getByLabelText('Access server'), 'POP Norte');
    await user.type(screen.getByLabelText('RADIUS session ID'), 'radius-123');
    await user.type(screen.getByLabelText('Subscriber MAC'), 'AA:BB');
    await user.selectOptions(screen.getByLabelText('Session state'), 'ended');
    await user.click(screen.getByRole('button', { name: 'Apply filters' }));

    await waitFor(() => {
      const url = latestUrl('/connection-logs?');
      expect(url.searchParams.get('page')).toBe('1');
      expect(url.searchParams.get('date_from')).toBe(new Date('2026-08-14T08:30').toISOString());
      expect(url.searchParams.get('client_id')).toBe('7');
      expect(url.searchParams.get('contract_id')).toBe('9');
      expect(url.searchParams.get('username')).toBe('ada@isp');
      expect(url.searchParams.get('ip_address')).toBe('10.20.30.40');
      expect(url.searchParams.get('nas')).toBe('POP Norte');
      expect(url.searchParams.get('session_id')).toBe('radius-123');
      expect(url.searchParams.get('mac')).toBe('AA:BB');
      expect(url.searchParams.get('state')).toBe('ended');
    });
    expect(latestApiQuery('/connection-logs')).toMatchObject({
      page: 1,
      limit: 50,
      client_id: 7,
      contract_id: 9,
      state: 'ended',
    });
  });

  it('supports direct public assignment lookup without requiring or sending port and protocol', async () => {
    mocks.user.current.permissions = ['connection_logs.view', 'ip_attribution.view', 'gov_data_requests.view'];
    installDefaultApi({ lookupResponse: {
      data: {
        status: 'matched', candidate_count: 1, gov_data_request_id: 74,
        attributionMethod: 'direct_public_assignment',
        query: { public_ipv4: '203.0.113.9', public_port: null, protocol: null, observed_at: '2026-08-14T10:15:01.000Z' },
        attribution: {
          connection_log_id: 41, client_id: 7, client_name: 'Ada Subscriber', contract_id: 9,
          username: 'ada@isp', radius_session_id: 'radius-123', public_ipv4: '203.0.113.9',
          assigned_at: '2026-08-14T10:00:00.000Z', released_at: null,
          assignment_evidence_received_at: '2026-08-14T10:00:00.100Z', evidence_hash: 'direct-hash',
        },
      },
    } });
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('tab', { name: 'IP attribution' }));
    await user.selectOptions(screen.getByLabelText('Assignment mode'), 'direct');
    expect(screen.queryByLabelText('Public source port')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Transport protocol')).not.toBeInTheDocument();
    await user.type(screen.getByLabelText('Government request ID'), '74');
    await user.type(screen.getByLabelText('Public IPv4'), '203.0.113.9');
    fireEvent.change(screen.getByLabelText('Exact timestamp'), { target: { value: '2026-08-14T10:15:01' } });
    await user.click(screen.getByRole('button', { name: 'Run exact lookup' }));

    expect(await screen.findByText('Direct public assignment')).toBeInTheDocument();
    expect(screen.getByText('203.0.113.9')).toBeInTheDocument();
    expect(screen.getByText('Assignment window').parentElement).toHaveTextContent('active / no release received');
    expect(screen.getByText('Collector receipt time').parentElement).not.toHaveTextContent('—');
    expect(screen.getByText('Accounting evidence ID').parentElement).toHaveTextContent('41');
    expect(screen.getByText('Consistency hash').parentElement).toHaveTextContent('direct-hash');
    expect(screen.queryByText('Private address / port allocation')).not.toBeInTheDocument();
    expect(screen.queryByText('Protocol')).not.toBeInTheDocument();
    expect(screen.queryByText('Mapping type')).not.toBeInTheDocument();
    expect(screen.queryByText('NAT pool / realm')).not.toBeInTheDocument();
    expect(screen.queryByText('CGNAT or access gateway')).not.toBeInTheDocument();
    expect(screen.queryByText('Evidence source')).not.toBeInTheDocument();
    expect(screen.queryByText('Device-recorded event time')).not.toBeInTheDocument();
    const call = mocks.authedFetch.mock.calls.find(([input]) => String(input).includes('/ip-attribution/lookup'));
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({
      gov_data_request_id: 74,
      public_ipv4: '203.0.113.9',
      observed_at: new Date('2026-08-14T10:15:01').toISOString(),
    });
  });

  it('fails closed when no exact attribution evidence is available', async () => {
    mocks.user.current.permissions = ['connection_logs.view', 'ip_attribution.view', 'gov_data_requests.view'];
    installDefaultApi({ lookupResponse: {
      data: {
        status: 'unavailable', reason: 'no_direct_assignment', candidate_count: 0,
        gov_data_request_id: 76, attributionMethod: null,
        query: { public_ipv4: '203.0.113.11', public_port: null, protocol: null, observed_at: '2026-08-14T10:15:01.000Z' },
      },
    } });
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('tab', { name: 'IP attribution' }));
    await user.selectOptions(screen.getByLabelText('Assignment mode'), 'direct');
    await user.type(screen.getByLabelText('Government request ID'), '76');
    await user.type(screen.getByLabelText('Public IPv4'), '203.0.113.11');
    fireEvent.change(screen.getByLabelText('Exact timestamp'), { target: { value: '2026-08-14T10:15:01' } });
    await user.click(screen.getByRole('button', { name: 'Run exact lookup' }));

    expect(await screen.findByText('No assignment available')).toBeInTheDocument();
    expect(screen.getByText(/Do not infer an account/i)).toBeInTheDocument();
    expect(screen.queryByText('Subscriber account record')).not.toBeInTheDocument();
    expect(screen.queryByText(/no_direct_assignment/i)).not.toBeInTheDocument();
  });

  it('fails closed when the backend reports incomplete exporter coverage', async () => {
    mocks.user.current.permissions = ['connection_logs.view', 'ip_attribution.view', 'gov_data_requests.view'];
    installDefaultApi({ lookupResponse: {
      data: {
        status: 'unavailable', reason: 'incomplete_exporter_pool_coverage', candidate_count: 1,
        gov_data_request_id: 77, attributionMethod: null,
        query: { public_ipv4: '198.51.100.8', public_port: 62001, protocol: 'tcp', observed_at: '2026-08-14T10:15:01.000Z' },
        attribution: { client_id: 7, client_name: 'Must Not Render' },
      },
    } });
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('tab', { name: 'IP attribution' }));
    await user.type(screen.getByLabelText('Government request ID'), '77');
    await user.type(screen.getByLabelText('Public IPv4'), '198.51.100.8');
    await user.type(screen.getByLabelText('Public source port'), '62001');
    await user.selectOptions(screen.getByLabelText('Transport protocol'), 'tcp');
    fireEvent.change(screen.getByLabelText('Exact timestamp'), { target: { value: '2026-08-14T10:15:01' } });
    await user.click(screen.getByRole('button', { name: 'Run exact lookup' }));

    expect(await screen.findByText('Evidence is incomplete')).toBeInTheDocument();
    expect(screen.queryByText('Must Not Render')).not.toBeInTheDocument();
    expect(screen.queryByText('Subscriber account record')).not.toBeInTheDocument();
    expect(screen.queryByText(/incomplete_exporter_pool_coverage/i)).not.toBeInTheDocument();
  });

  it('downgrades a malformed matched response instead of guessing from partial evidence', async () => {
    mocks.user.current.permissions = ['connection_logs.view', 'ip_attribution.view', 'gov_data_requests.view'];
    installDefaultApi({ lookupResponse: {
      data: {
        status: 'matched', candidate_count: 1, gov_data_request_id: 78,
        attributionMethod: 'direct_public_assignment',
        query: { public_ipv4: '203.0.113.12', observed_at: '2026-08-14T10:15:01.000Z' },
        attribution: {
          connection_log_id: 42, client_id: 7, contract_id: 9,
          public_ipv4: '203.0.113.12', assigned_at: '2026-08-14T10:00:00.000Z',
        },
      },
    } });
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('tab', { name: 'IP attribution' }));
    await user.selectOptions(screen.getByLabelText('Assignment mode'), 'direct');
    await user.type(screen.getByLabelText('Government request ID'), '78');
    await user.type(screen.getByLabelText('Public IPv4'), '203.0.113.12');
    fireEvent.change(screen.getByLabelText('Exact timestamp'), { target: { value: '2026-08-14T10:15:01' } });
    await user.click(screen.getByRole('button', { name: 'Run exact lookup' }));

    expect(await screen.findByText('Evidence is incomplete')).toBeInTheDocument();
    expect(screen.queryByText('Subscriber account record')).not.toBeInTheDocument();
  });

  it('fails closed on ambiguous attribution and never displays a candidate', async () => {
    mocks.user.current.permissions = ['connection_logs.view', 'ip_attribution.view', 'gov_data_requests.view'];
    installDefaultApi({ lookupResponse: {
      data: {
        status: 'ambiguous', candidate_count: 2, gov_data_request_id: 75,
        attributionMethod: null,
        attribution: { client_id: 7, client_name: 'Must Not Render' },
      },
    } });
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('tab', { name: 'IP attribution' }));
    await user.selectOptions(screen.getByLabelText('Assignment mode'), 'direct');
    await user.type(screen.getByLabelText('Government request ID'), '75');
    await user.type(screen.getByLabelText('Public IPv4'), '203.0.113.10');
    fireEvent.change(screen.getByLabelText('Exact timestamp'), { target: { value: '2026-08-14T10:15:01' } });
    await user.click(screen.getByRole('button', { name: 'Run exact lookup' }));

    expect(await screen.findByText('Attribution is ambiguous')).toBeInTheDocument();
    expect(screen.getByText(/2 candidate assignments overlap/i)).toBeInTheDocument();
    expect(screen.queryByText('Must Not Render')).not.toBeInTheDocument();
    expect(screen.queryByText('Subscriber account record')).not.toBeInTheDocument();
  });

  it('supports arrow-key tab navigation with a roving tab stop', async () => {
    mocks.user.current.permissions = ['connection_logs.view', 'ip_attribution.view', 'gov_data_requests.view'];
    const user = userEvent.setup();
    renderPage();
    const sessionsTab = await screen.findByRole('tab', { name: 'Subscriber sessions' });
    sessionsTab.focus();
    await user.keyboard('{ArrowRight}');

    const attributionTab = screen.getByRole('tab', { name: 'IP attribution' });
    expect(attributionTab).toHaveAttribute('aria-selected', 'true');
    expect(attributionTab).toHaveAttribute('tabindex', '0');
    expect(attributionTab).toHaveFocus();
    expect(await screen.findByText('Restricted legal-response workflow')).toBeInTheDocument();

    await user.keyboard('{ArrowRight}');
    expect(sessionsTab).toHaveAttribute('aria-selected', 'true');
    expect(sessionsTab).toHaveFocus();
  });

  it('shows independent readiness details and localized retryable errors', async () => {
    renderPage();
    expect(await screen.findByText('RADIUS accounting')).toBeInTheDocument();
    expect(screen.getByText('CGNAT / address-assignment collector')).toBeInTheDocument();
    expect(screen.getByText('Coverage status')).toBeInTheDocument();
    expect(screen.getByText('Clock status')).toBeInTheDocument();
    expect(screen.getByText('Reported · max 18 ms')).toBeInTheDocument();
    expect(screen.getByText('Delivery / loss status')).toBeInTheDocument();
    expect(screen.getByText('No reported loss')).toBeInTheDocument();
    expect(screen.getByText('125')).toBeInTheDocument();
    expect(screen.getByText(/authoritative_baseline_confirmed.*baseline_reference.*session_instance_id/)).toBeInTheDocument();
    expect(screen.getAllByText('Receiving').length).toBeGreaterThan(1);

    mocks.apiGet.mockImplementation(async (path: string) => {
      if (path === '/connection-logs/readiness') return { error: { error: 'unavailable' } };
      if (path === '/connection-logs') return { error: { error: 'unavailable' } };
      return { data: { data: [], meta: { total: 0, page: 1, limit: 50 } } };
    });
    renderPage();
    expect(await screen.findByText('Logging readiness could not be checked.')).toBeInTheDocument();
    expect(await screen.findByText('Subscriber sessions could not be loaded.')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Retry' }).length).toBeGreaterThanOrEqual(2);
  });

  it('does not mark a receiving but explicitly unhealthy incomplete logger as ready', async () => {
    const incompleteReadiness = {
      ...readiness,
      data: {
        ...readiness.data,
        session_logger: {
          ...readiness.data.session_logger,
          ready: false,
          receiving: true,
          healthy: false,
          status: 'incomplete',
        },
      },
    };
    mocks.apiGet.mockImplementation(async (path: string) => {
      if (path === '/connection-logs/readiness') return { data: incompleteReadiness };
      return { data: { data: [session], meta: { total: 1, page: 1, limit: 50 } } };
    });

    renderPage();

    const heading = await screen.findByRole('heading', { name: 'Subscriber accounting' });
    const card = heading.parentElement?.parentElement;
    expect(card).not.toBeNull();
    expect(within(card!).getByText('Needs attention')).toBeInTheDocument();
    expect(within(card!).queryByText('Receiving')).not.toBeInTheDocument();
    expect(within(card!).getByText(/Configure RADIUS accounting start/i)).toBeInTheDocument();
  });

  it('warns when subscriber retention is below the Mexico policy baseline', async () => {
    const lowRetention = {
      ...readiness,
      data: {
        ...readiness.data,
        retention: { ...readiness.data.retention, session_months: 12 },
      },
    };
    mocks.apiGet.mockImplementation(async (path: string) => {
      if (path === '/connection-logs/readiness') return { data: lowRetention };
      return { data: { data: [session], meta: { total: 1, page: 1, limit: 50 } } };
    });

    renderPage();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /12 months, below FireISP's 24-month Mexico policy baseline/i,
    );
  });

  it('blocks a session CSV export until both date filters have been applied', async () => {
    mocks.user.current = {
      id: 5,
      role: 'support',
      organization_locale: 'MX',
      permissions: ['connection_logs.view', 'connection_logs.export'],
    };
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByText(/exports require an applied From and To range/i)).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: 'Export sessions CSV' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Set both From and To, then apply the filters before exporting.',
    );
    expect(requestedUrls().some((url) => url.includes('/connection-logs/export'))).toBe(false);
    expect(screen.queryByRole('tab', { name: 'IP attribution' })).not.toBeInTheDocument();
  });

  it('blocks a session CSV export when To is before From', async () => {
    mocks.user.current.permissions = ['connection_logs.view', 'connection_logs.export'];
    const user = userEvent.setup();
    renderPage();
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-08-15T10:00' } });
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-08-14T10:00' } });
    await user.click(screen.getByRole('button', { name: 'Apply filters' }));
    await user.click(screen.getByRole('button', { name: 'Export sessions CSV' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('For export, To must not be before From.');
    expect(requestedUrls().some((url) => url.includes('/connection-logs/export'))).toBe(false);
  });

  it('blocks a session CSV export covering more than 366 days', async () => {
    mocks.user.current.permissions = ['connection_logs.view', 'connection_logs.export'];
    const user = userEvent.setup();
    renderPage();
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2025-01-01T00:00' } });
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-01-03T00:00' } });
    await user.click(screen.getByRole('button', { name: 'Apply filters' }));
    await user.click(screen.getByRole('button', { name: 'Export sessions CSV' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Session CSV exports can cover no more than 366 days.',
    );
    expect(requestedUrls().some((url) => url.includes('/connection-logs/export'))).toBe(false);
  });

  it('exports an applied, bounded session range as UTC ISO instants', async () => {
    mocks.user.current = {
      id: 5,
      role: 'support',
      organization_locale: 'MX',
      permissions: ['connection_logs.view', 'connection_logs.export'],
    };
    const { click } = installDownloadBrowser();
    const user = userEvent.setup();
    renderPage();
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-08-14T09:00' } });
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-08-14T10:00' } });
    await user.click(screen.getByRole('button', { name: 'Apply filters' }));
    await user.click(screen.getByRole('button', { name: 'Export sessions CSV' }));

    await waitFor(() => expect(requestedUrls().some((url) => url.includes('/connection-logs/export'))).toBe(true));
    const exportCall = mocks.authedFetch.mock.calls.find(([input]) => String(input).includes('/connection-logs/export'));
    const exportUrl = new URL(String(exportCall?.[0]), 'http://localhost');
    expect(exportUrl.searchParams.get('date_from')).toBe(new Date('2026-08-14T09:00').toISOString());
    expect(exportUrl.searchParams.get('date_to')).toBe(new Date('2026-08-14T10:00').toISOString());
    expect(exportCall?.[1]).toMatchObject({ headers: { Accept: 'text/csv' } });
    expect(click).toHaveBeenCalled();
    expect(screen.queryByRole('tab', { name: 'IP attribution' })).not.toBeInTheDocument();
  });

  it('shows a bounded localized error when the lookup exceeds the authorized case scope', async () => {
    mocks.user.current.permissions = ['connection_logs.view', 'ip_attribution.view', 'gov_data_requests.view'];
    installDefaultApi({ lookupResponse: { code: 'CASE_SCOPE_MISMATCH', error: 'raw server detail' }, lookupStatus: 403 });
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('tab', { name: 'IP attribution' }));
    await user.selectOptions(screen.getByLabelText('Assignment mode'), 'direct');
    await user.type(screen.getByLabelText('Government request ID'), '75');
    await user.type(screen.getByLabelText('Public IPv4'), '203.0.113.10');
    fireEvent.change(screen.getByLabelText('Exact timestamp'), { target: { value: '2026-08-14T10:15:01' } });
    await user.click(screen.getByRole('button', { name: 'Run exact lookup' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The lookup values do not exactly match the values authorized by this case.',
    );
    expect(screen.queryByText('raw server detail')).not.toBeInTheDocument();
  });
});
