// =============================================================================
// FireISP 5.0 — SnmpMetrics page tests
// =============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { SnmpMetrics } from '../SnmpMetrics';

vi.mock('@/api/client', () => ({
  tokenStore: {
    getAccess: () => 'test-token',
    setAccess: vi.fn(),
    getRefresh: () => null,
    setRefresh: vi.fn(),
    clear: vi.fn(),
  },
}));

// Mock global fetch used by the page's own apiFetch() helper.
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function okResponse(body: unknown): Response {
  return { ok: true, status: 200, json: () => Promise.resolve(body) } as unknown as Response;
}
function notFoundResponse(): Response {
  return {
    ok: false,
    status: 404,
    json: () => Promise.resolve({ error: { message: 'Device not found' } }),
  } as unknown as Response;
}

const fleetResponse = {
  data: [
    {
      id: 5,
      name: 'Core-Router-01',
      ip_address: '10.0.0.1',
      type: 'router',
      status: 'online',
      site_id: 1,
      consecutive_poll_failures: 0,
      last_polled_at: '2026-07-16T11:55:00.000Z',
      last_poll_error: null,
      latest: { cpu_usage: 42, memory_usage: 55, uptime_ticks: 123456, polled_at: '2026-07-16T11:55:00.000Z' },
      cpu_spark: [
        { t: '2026-07-16T11:00:00.000Z', v: 40 },
        { t: '2026-07-16T11:30:00.000Z', v: 42 },
      ],
      traffic_samples: [
        { t: '2026-07-16T11:50:00.000Z', in_octets: 1_000_000, out_octets: 500_000, interface_signature: '1,2' },
        { t: '2026-07-16T11:55:00.000Z', in_octets: 2_000_000, out_octets: 600_000, interface_signature: '1,2' },
      ],
    },
    {
      id: 6,
      name: 'Switch-02',
      ip_address: '10.0.0.2',
      type: 'switch',
      status: 'offline',
      site_id: 1,
      consecutive_poll_failures: 3,
      last_polled_at: null,
      last_poll_error: 'SNMP timeout',
      latest: null,
      cpu_spark: [],
      traffic_samples: [],
    },
  ],
};

function metricsResponseFor(deviceId: number) {
  return {
    data: [
      { ts: '2026-07-16T10:00:00.000Z', interface_id: null, if_in_octets: null, if_out_octets: null, if_in_errors: null, if_out_errors: null, cpu_usage: 40, memory_usage: null, signal_strength: null, latency_ms: null, uptime_ticks: 100000 },
      { ts: '2026-07-16T11:00:00.000Z', interface_id: null, if_in_octets: null, if_out_octets: null, if_in_errors: null, if_out_errors: null, cpu_usage: 42, memory_usage: null, signal_strength: null, latency_ms: null, uptime_ticks: 100360 },
    ],
    meta: { device_id: deviceId, resolution: '1hr', lookback_hours: 168, interfaces: [] },
  };
}

function mockDefaultFetch() {
  mockFetch.mockImplementation((url: string) => {
    if (url.includes('/snmp-metrics/fleet')) {
      return Promise.resolve(okResponse(fleetResponse));
    }
    if (url.includes('/snmp-metrics?')) {
      const match = /device_id=(\d+)/.exec(url);
      const deviceId = match ? Number(match[1]) : 0;
      if (deviceId === 5) return Promise.resolve(okResponse(metricsResponseFor(5)));
      return Promise.resolve(notFoundResponse());
    }
    return Promise.resolve(okResponse({ data: [] }));
  });
}

function renderPage(initialEntry = '/snmp-metrics') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path="/snmp-metrics" element={<SnmpMetrics />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('SnmpMetrics — fleet glance (level 1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDefaultFetch();
  });

  it('renders a card per device with name, status pill, CPU/memory and rate', async () => {
    renderPage();

    await waitFor(() => expect(screen.getByText('Core-Router-01')).toBeInTheDocument());
    expect(screen.getByText('Online')).toBeInTheDocument();
    expect(screen.getByText('42.0 %')).toBeInTheDocument(); // CPU
    expect(screen.getByText('55.0 %')).toBeInTheDocument(); // Memory

    // Switch-02 is offline with no metrics yet
    expect(screen.getByText('Switch-02')).toBeInTheDocument();
    expect(screen.getByText('Offline')).toBeInTheDocument();
    expect(screen.getByText('No data yet')).toBeInTheDocument();
    expect(screen.getByText('3 failed polls')).toBeInTheDocument();
  });

  it('shows an honest gap (—), never a fabricated multi-Gbps spike, when the paired traffic buckets have different interface membership', async () => {
    // Interface "3" is missing from the older bucket and reappears in the
    // newer one — its own multi-month cumulative counter would land in a
    // naive delta, producing a huge but non-negative "rate" that the
    // negative-delta guard alone would miss.
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('/snmp-metrics/fleet')) {
        return Promise.resolve(okResponse({
          data: [{
            ...fleetResponse.data[0],
            traffic_samples: [
              { t: '2026-07-16T11:50:00.000Z', in_octets: 1_000_000, out_octets: 500_000, interface_signature: '1,2' },
              { t: '2026-07-16T11:55:00.000Z', in_octets: 50_000_000_000, out_octets: 20_000_000_000, interface_signature: '1,2,3' },
            ],
          }],
        }));
      }
      return Promise.resolve(okResponse({ data: [] }));
    });

    renderPage();
    await waitFor(() => expect(screen.getByText('Core-Router-01')).toBeInTheDocument());

    expect(screen.getByText('In: —')).toBeInTheDocument();
    expect(screen.getByText('Out: —')).toBeInTheDocument();
    expect(screen.queryByText(/Gbps/)).not.toBeInTheDocument();
  });

  it('filters the grid by name/IP', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('Core-Router-01')).toBeInTheDocument());

    const filterInput = screen.getByPlaceholderText('Filter by name or IP…');
    await userEvent.type(filterInput, 'switch');

    expect(screen.queryByText('Core-Router-01')).not.toBeInTheDocument();
    expect(screen.getByText('Switch-02')).toBeInTheDocument();
  });

  it('shows an empty-fleet message when the org has no SNMP devices', async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('/snmp-metrics/fleet')) return Promise.resolve(okResponse({ data: [] }));
      return Promise.resolve(okResponse({ data: [] }));
    });
    renderPage();
    await waitFor(() => expect(screen.getByText('No SNMP-enabled devices found.')).toBeInTheDocument());
  });

  it('clicking a card drills into the device history level (sets ?device_id=)', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('Core-Router-01')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('link', { name: 'View metric history for Core-Router-01' }));

    // Now on level 2: back link + device name heading, fleet grid gone.
    await waitFor(() => expect(screen.getByRole('heading', { name: /Core-Router-01/ })).toBeInTheDocument());
    expect(screen.getByRole('button', { name: '← All devices' })).toBeInTheDocument();
    expect(screen.queryByText('Switch-02')).not.toBeInTheDocument();
  });

  it('activating a card via keyboard (Enter) also drills in', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('Core-Router-01')).toBeInTheDocument());

    const card = screen.getByRole('link', { name: 'View metric history for Core-Router-01' });
    card.focus();
    fireEvent.keyDown(card, { key: 'Enter' });

    await waitFor(() => expect(screen.getByRole('heading', { name: /Core-Router-01/ })).toBeInTheDocument());
  });
});

describe('SnmpMetrics — device history (level 2, deep-linked)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDefaultFetch();
  });

  it('renders the history view directly when ?device_id= is present on load', async () => {
    renderPage('/snmp-metrics?device_id=5');

    await waitFor(() => expect(screen.getByRole('heading', { name: /Core-Router-01/ })).toBeInTheDocument());
    expect(screen.getByRole('button', { name: '← All devices' })).toBeInTheDocument();
    expect(screen.getByText('CPU Usage (%)')).toBeInTheDocument();
  });

  it('shows an explicit not-found state for a device_id that is unknown/foreign, never a silent empty page', async () => {
    renderPage('/snmp-metrics?device_id=999');

    await waitFor(() => expect(screen.getByText('Device not found')).toBeInTheDocument());
    expect(screen.getByText(/doesn't exist, or doesn't belong to your organization/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '← All devices' })).toBeInTheDocument();
  });

  it('shows the not-found state for a syntactically invalid device_id (no network call needed)', async () => {
    renderPage('/snmp-metrics?device_id=abc');

    await waitFor(() => expect(screen.getByText('Device not found')).toBeInTheDocument());
  });

  it('"← All devices" returns to the fleet grid', async () => {
    renderPage('/snmp-metrics?device_id=5');
    await waitFor(() => expect(screen.getByRole('heading', { name: /Core-Router-01/ })).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: '← All devices' }));

    await waitFor(() => expect(screen.getByText('Switch-02')).toBeInTheDocument());
  });

  it('shows a hover tooltip with a crosshair on the chart', async () => {
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 640, height: 160, top: 0, left: 0, right: 640, bottom: 160, x: 0, y: 0, toJSON: () => ({}),
    } as DOMRect);

    renderPage('/snmp-metrics?device_id=5');
    await waitFor(() => expect(screen.getByText('CPU Usage (%)')).toBeInTheDocument());

    // Only the CPU chart has data in this fixture, so exactly one hit-rect exists.
    const hitRect = screen.getByTestId('snmp-chart-hit-rect');
    fireEvent.mouseMove(hitRect, { clientX: 320 });

    await waitFor(() => expect(screen.getByText('CPU Usage (%): 42.0 %')).toBeInTheDocument());

    fireEvent.mouseLeave(hitRect);
    await waitFor(() => expect(screen.queryByText(/CPU Usage \(%\): 42.0 %/)).not.toBeInTheDocument());
  });
});
