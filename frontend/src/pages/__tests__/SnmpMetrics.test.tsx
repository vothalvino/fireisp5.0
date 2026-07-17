// =============================================================================
// FireISP 5.0 — SnmpMetrics page tests
// =============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
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

// ---------------------------------------------------------------------------
// Throughput reachability fix — the history fetch used to always send
// interface_id='' by default, which the backend treats as "device-level
// rows only": meta.interfaces was always [], the interface picker never
// rendered, and the Throughput chart could never have data. Fixed by
// omitting interface_id entirely until a specific interface is picked, and
// deriving CPU/memory/etc. from device-level rows only (mixed responses now
// interleave device-level + per-interface rows).
// ---------------------------------------------------------------------------

// Real backend shape for the default (no interface_id) fetch: device-level
// rows (interface_id: '' — the 1hr/1day rollup convention) interleaved with
// per-interface rows sharing the exact same period_start per bucket.
function mixedHourlyResponseFor(deviceId: number) {
  return {
    data: [
      { ts: '2026-07-16T09:00:00.000Z', interface_id: '', if_in_octets: null, if_out_octets: null, if_in_errors: null, if_out_errors: null, cpu_usage: 40, memory_usage: 50, signal_strength: null, latency_ms: null },
      { ts: '2026-07-16T09:00:00.000Z', interface_id: 'eth0', if_in_octets: 1_000_000, if_out_octets: 500_000, if_in_errors: 0, if_out_errors: 0, cpu_usage: null, memory_usage: null, signal_strength: null, latency_ms: null },
      { ts: '2026-07-16T09:00:00.000Z', interface_id: 'eth1', if_in_octets: 800_000, if_out_octets: 400_000, if_in_errors: 0, if_out_errors: 0, cpu_usage: null, memory_usage: null, signal_strength: null, latency_ms: null },
      { ts: '2026-07-16T10:00:00.000Z', interface_id: '', if_in_octets: null, if_out_octets: null, if_in_errors: null, if_out_errors: null, cpu_usage: 45, memory_usage: 52, signal_strength: null, latency_ms: null },
      { ts: '2026-07-16T10:00:00.000Z', interface_id: 'eth0', if_in_octets: 1_500_000, if_out_octets: 700_000, if_in_errors: 2, if_out_errors: 0, cpu_usage: null, memory_usage: null, signal_strength: null, latency_ms: null },
      { ts: '2026-07-16T10:00:00.000Z', interface_id: 'eth1', if_in_octets: 1_200_000, if_out_octets: 600_000, if_in_errors: 0, if_out_errors: 0, cpu_usage: null, memory_usage: null, signal_strength: null, latency_ms: null },
    ],
    meta: { device_id: deviceId, resolution: '1hr', lookback_hours: 168, interfaces: ['eth0', 'eth1'] },
  };
}

// eth1 is missing from the first bucket (dropped that poll) and reappears in
// the second with its own huge cumulative counter — this must never turn
// into a fabricated multi-Gbps rate.
function reappearingInterfaceResponseFor(deviceId: number) {
  return {
    data: [
      { ts: '2026-07-16T09:00:00.000Z', interface_id: '', if_in_octets: null, if_out_octets: null, if_in_errors: null, if_out_errors: null, cpu_usage: 40, memory_usage: 50, signal_strength: null, latency_ms: null },
      { ts: '2026-07-16T09:00:00.000Z', interface_id: 'eth0', if_in_octets: 1_000_000, if_out_octets: 500_000, if_in_errors: 0, if_out_errors: 0, cpu_usage: null, memory_usage: null, signal_strength: null, latency_ms: null },
      { ts: '2026-07-16T10:00:00.000Z', interface_id: '', if_in_octets: null, if_out_octets: null, if_in_errors: null, if_out_errors: null, cpu_usage: 42, memory_usage: 51, signal_strength: null, latency_ms: null },
      { ts: '2026-07-16T10:00:00.000Z', interface_id: 'eth0', if_in_octets: 1_100_000, if_out_octets: 520_000, if_in_errors: 0, if_out_errors: 0, cpu_usage: null, memory_usage: null, signal_strength: null, latency_ms: null },
      { ts: '2026-07-16T10:00:00.000Z', interface_id: 'eth1', if_in_octets: 40_000_000_000, if_out_octets: 15_000_000_000, if_in_errors: 0, if_out_errors: 0, cpu_usage: null, memory_usage: null, signal_strength: null, latency_ms: null },
    ],
    meta: { device_id: deviceId, resolution: '1hr', lookback_hours: 168, interfaces: ['eth0', 'eth1'] },
  };
}

// Real backend shape when a SPECIFIC interface is picked (?interface=eth0):
// the backend's interface_id=eth0 filter returns ONLY that interface's rows
// — no device-level rows at all.
function singleInterfaceResponseFor(deviceId: number, iface: string) {
  return {
    data: [
      { ts: '2026-07-16T09:00:00.000Z', interface_id: iface, if_in_octets: 1_000_000, if_out_octets: 500_000, if_in_errors: 0, if_out_errors: 0, cpu_usage: null, memory_usage: null, signal_strength: null, latency_ms: null },
      { ts: '2026-07-16T10:00:00.000Z', interface_id: iface, if_in_octets: 1_500_000, if_out_octets: 700_000, if_in_errors: 2, if_out_errors: 1, cpu_usage: null, memory_usage: null, signal_strength: null, latency_ms: null },
    ],
    meta: { device_id: deviceId, resolution: '1hr', lookback_hours: 168, interfaces: [iface] },
  };
}

function mockThroughputFetch(deviceResponse: unknown = mixedHourlyResponseFor(5)) {
  mockFetch.mockImplementation((url: string) => {
    if (url.includes('/snmp-metrics/fleet')) return Promise.resolve(okResponse(fleetResponse));
    if (url.includes('/snmp-metrics?')) {
      const ifaceMatch = /[?&]interface_id=([^&]+)/.exec(url);
      if (ifaceMatch) {
        return Promise.resolve(okResponse(singleInterfaceResponseFor(5, decodeURIComponent(ifaceMatch[1]))));
      }
      return Promise.resolve(okResponse(deviceResponse));
    }
    return Promise.resolve(okResponse({ data: [] }));
  });
}

describe('SnmpMetrics — throughput reachability (mixed device-level + per-interface rows)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('never sends interface_id when no interface is picked, so the backend returns mixed rows and the Throughput chart is finally reachable', async () => {
    mockThroughputFetch();
    renderPage('/snmp-metrics?device_id=5');

    await waitFor(() => expect(screen.getByText('CPU Usage (%)')).toBeInTheDocument());

    // The fetch itself never carries interface_id at all (not even '').
    const historyCall = mockFetch.mock.calls.find((call) => (call[0] as string).includes('/snmp-metrics?'));
    expect(historyCall).toBeDefined();
    expect(historyCall![0]).not.toMatch(/interface_id/);

    // Previously unreachable — hasThroughput was permanently false.
    expect(screen.getByText('Throughput')).toBeInTheDocument();
  });

  it('derives CPU/memory from device-level rows only, ignoring interleaved per-interface rows', async () => {
    mockThroughputFetch();
    renderPage('/snmp-metrics?device_id=5');

    await waitFor(() => expect(screen.getByText('CPU Usage (%)')).toBeInTheDocument());
    expect(screen.getByText('45.0 %')).toBeInTheDocument(); // latest device-level CPU (10:00 bucket)
    expect(screen.getByText('52.0 %')).toBeInTheDocument(); // latest device-level memory
  });

  it('sums per-interface octets into a signature-guarded rate (identical interface sets across buckets)', async () => {
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 640, height: 160, top: 0, left: 0, right: 640, bottom: 160, x: 0, y: 0, toJSON: () => ({}),
    } as DOMRect);

    mockThroughputFetch();
    renderPage('/snmp-metrics?device_id=5');
    await waitFor(() => expect(screen.getByText('Throughput')).toBeInTheDocument());

    const throughputBox = screen.getByText('Throughput').parentElement as HTMLElement;
    const hitRect = within(throughputBox).getByTestId('snmp-chart-hit-rect');
    fireEvent.mouseMove(hitRect, { clientX: 320 });

    // Bucket sums: 09:00 → in=1,800,000 out=900,000; 10:00 → in=2,700,000 out=1,300,000.
    // Δin = 900,000 B over 3600s = 2,000 bps = 2.0 Kbps; Δout ≈ 889 bps.
    await waitFor(() => expect(within(throughputBox).getByText('↓ In: 2.0 Kbps')).toBeInTheDocument());
    expect(within(throughputBox).getByText('↑ Out: 889 bps')).toBeInTheDocument();
  });

  it('shows an honest gap, never a fabricated multi-Gbps spike, when an interface reappears between buckets', async () => {
    mockThroughputFetch(reappearingInterfaceResponseFor(5));
    renderPage('/snmp-metrics?device_id=5');

    await waitFor(() => expect(screen.getByText('CPU Usage (%)')).toBeInTheDocument());
    expect(screen.queryByText(/Gbps/)).not.toBeInTheDocument();
  });

  it('populates the interface picker from meta.interfaces with an "All interfaces (sum)" default', async () => {
    mockThroughputFetch();
    renderPage('/snmp-metrics?device_id=5');

    await waitFor(() => expect(screen.getByText('CPU Usage (%)')).toBeInTheDocument());

    const select = screen.getByRole('combobox');
    expect(within(select).getByText('All interfaces (sum)')).toBeInTheDocument();
    expect(within(select).getByText('eth0')).toBeInTheDocument();
    expect(within(select).getByText('eth1')).toBeInTheDocument();
  });

  it('single-interface mode hides the device-level charts and falls the summary tiles back to the fleet snapshot', async () => {
    mockThroughputFetch();
    renderPage('/snmp-metrics?device_id=5&interface=eth0');

    await waitFor(() => expect(screen.getByText('Throughput')).toBeInTheDocument());

    expect(screen.queryByText('CPU Usage (%)')).not.toBeInTheDocument();
    expect(screen.queryByText('Memory Usage (%)')).not.toBeInTheDocument();
    // Errors chart shows for the selected interface instead.
    expect(screen.getByText('Errors')).toBeInTheDocument();
    // Summary tiles still show real numbers — the fleet card's latest
    // snapshot for device 5 (cpu_usage: 42, memory_usage: 55).
    expect(screen.getByText('42.0 %')).toBeInTheDocument();
    expect(screen.getByText('55.0 %')).toBeInTheDocument();
  });

  it('picking a specific interface sends its interface_id and only that interface appears in the picker options fetched for it', async () => {
    mockThroughputFetch();
    renderPage('/snmp-metrics?device_id=5&interface=eth0');

    await waitFor(() => expect(screen.getByText('Throughput')).toBeInTheDocument());

    const historyCall = mockFetch.mock.calls.find((call) => (call[0] as string).includes('/snmp-metrics?'));
    expect(historyCall).toBeDefined();
    expect(historyCall![0]).toMatch(/interface_id=eth0/);
  });
});
