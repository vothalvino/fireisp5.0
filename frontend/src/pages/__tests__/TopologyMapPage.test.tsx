// =============================================================================
// FireISP 5.0 — TopologyMapPage tests (§13)
// =============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { TopologyMapPage } from '../TopologyMapPage';

// ---------------------------------------------------------------------------
// Mock react-leaflet — jsdom has no canvas/SVG renderer for Leaflet
// ---------------------------------------------------------------------------
vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="map-container">{children}</div>
  ),
  TileLayer: () => null,
  CircleMarker: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="circle-marker">{children}</div>
  ),
  Polyline: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="polyline">{children}</div>
  ),
  Popup: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="popup">{children}</div>
  ),
  Tooltip: ({ children }: { children: React.ReactNode }) => (
    <span data-testid="tooltip">{children}</span>
  ),
}));

// Mock leaflet CSS import
vi.mock('leaflet/dist/leaflet.css', () => ({}));

// ---------------------------------------------------------------------------
// Mock API client
// ---------------------------------------------------------------------------
const mockApiGet = vi.fn();
const mockApiPost = vi.fn();
const mockApiDelete = vi.fn();

vi.mock('@/api/client', () => ({
  api: {
    GET: (...args: unknown[]) => mockApiGet(...args),
    POST: (...args: unknown[]) => mockApiPost(...args),
    DELETE: (...args: unknown[]) => mockApiDelete(...args),
    PUT: vi.fn(),
  },
  tokenStore: {
    getAccess: () => 'test-token',
    setAccess: vi.fn(),
    getRefresh: () => null,
    setRefresh: vi.fn(),
    clear: vi.fn(),
  },
}));

vi.mock('@/auth/AuthContext', () => ({
  useAuth: () => ({ user: { id: 1, role: 'admin' } }),
}));

// ---------------------------------------------------------------------------
// Sample data
// ---------------------------------------------------------------------------
const sampleGraph = {
  nodes: [
    { id: 1, name: 'OLT-01', type: 'olt', role: 'core', status: 'active', ip_address: '10.0.0.1', latitude: 19.43, longitude: -99.13, site_name: 'POP-MX' },
    { id: 2, name: 'AP-01', type: 'ptmp_ap', role: 'access', status: 'down', ip_address: '10.0.0.2', latitude: 19.44, longitude: -99.14, site_name: null },
  ],
  edges: [
    { id: 1, source: 1, target: 2, medium: 'fiber', status: 'active', bandwidth_mbps: 1000, utilization: 45 },
  ],
};

const sampleCustomers = [
  { id: 1, name: 'Alice Smith', latitude: 19.45, longitude: -99.15, address: '123 Main St', status: 'active' },
  { id: 2, name: 'Bob Jones', latitude: 19.46, longitude: -99.16, address: null, status: 'inactive' },
];

const sampleInfrastructure = {
  infrastructure: [
    { id: 1, name: 'Tower-A', type: 'tower', latitude: 19.47, longitude: -99.17, address: 'Hill Rd' },
  ],
  sites: [
    { id: 10, name: 'POP-MX', type: 'pop', latitude: 19.43, longitude: -99.13, address: null },
  ],
};

const sampleFiberRoutes = [
  { id: 1, name: 'Trunk-01', status: 'active', gis_path: null, segments: [] },
];

const sampleDualHomed = [
  { id: 1, name: 'Router-Core', type: 'router', role: 'core', status: 'active', ip_address: '10.0.0.3', latitude: 19.43, longitude: -99.13, site_name: 'POP-MX', upstream_link_count: 2 },
];

const sampleImpact = {
  device: sampleGraph.nodes[0],
  impacted: [{ ...sampleGraph.nodes[1], dependency_type: 'network', is_redundant: false }],
  edge_count: 1,
  affected_contracts: 3,
  affected_clients: 3,
};

// ---------------------------------------------------------------------------
// Setup default mocks
// ---------------------------------------------------------------------------
const sampleFabric = {
  nodes: [
    { id: 1, name: 'core-rtr-01', type: 'router', role: 'core', status: 'online', site_id: 10, site_name: 'POP-MX', tier: 0, metrics: { cpu_usage: 12, memory_usage: 40, uptime_ticks: 8640000, temperature_c: 35, rx_power_dbm: -18, firmware: '7.1', clients: null } },
    { id: 2, name: 'olt-norte', type: 'olt', role: 'access', status: 'offline', site_id: 11, site_name: 'PoP-Norte', tier: 2, metrics: { cpu_usage: null, memory_usage: null, uptime_ticks: null, temperature_c: null, rx_power_dbm: -26, firmware: '2.1', clients: 142 } },
  ],
  edges: [{ id: 1, source: 1, target: 2, status: 'down', utilization: null, bandwidth_mbps: 1000 }],
  incidents: [{ id: 5, device_id: 2, site_id: 11, title: 'Outage - PoP-Norte', detail: '142 clients down', severity: 'critical', started_at: '2026-07-17T05:00:00Z' }],
};

function setupMocks() {
  mockApiGet.mockImplementation((path: string) => {
    if (path.includes('/topology/map/fabric')) {
      return Promise.resolve({ data: { data: sampleFabric }, error: undefined });
    }
    if (path.includes('/topology/map/network')) {
      return Promise.resolve({ data: { data: sampleGraph }, error: undefined });
    }
    if (path.includes('/topology/map/customers')) {
      return Promise.resolve({ data: { data: sampleCustomers }, error: undefined });
    }
    if (path.includes('/topology/map/infrastructure')) {
      return Promise.resolve({ data: { data: sampleInfrastructure }, error: undefined });
    }
    if (path.includes('/topology/map/fiber-routes')) {
      return Promise.resolve({ data: { data: sampleFiberRoutes }, error: undefined });
    }
    if (path.includes('/topology/map/dual-homed')) {
      return Promise.resolve({ data: { data: sampleDualHomed }, error: undefined });
    }
    if (path.includes('/topology/map/impact/')) {
      return Promise.resolve({ data: { data: sampleImpact }, error: undefined });
    }
    if (path.includes('/topology/map/cascade/')) {
      return Promise.resolve({ data: { data: { device: sampleGraph.nodes[0], chain: [] } }, error: undefined });
    }
    if (path.includes('/topology/geofences')) {
      return Promise.resolve({ data: { data: [] }, error: undefined });
    }
    if (path.includes('/topology/infrastructure')) {
      return Promise.resolve({ data: { data: [] }, error: undefined });
    }
    return Promise.resolve({ data: { data: [] }, error: undefined });
  });
  mockApiPost.mockResolvedValue({ data: { data: { id: 99 } }, error: undefined });
  mockApiDelete.mockResolvedValue({ data: undefined, error: undefined });
}

// ---------------------------------------------------------------------------
// Render helper
// ---------------------------------------------------------------------------
function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <TopologyMapPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('TopologyMapPage (§13)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupMocks();
  });

  it('renders the page heading', async () => {
    renderPage();
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /topology.*map/i })).toBeInTheDocument(),
    );
  });

  it('renders all four tabs including Network Fabric', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /network fabric/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /network topology/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /geographic map/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /dependency/i })).toBeInTheDocument();
    });
  });

  it('defaults to the Network Fabric tab and renders an incident from data', async () => {
    renderPage();
    await waitFor(() =>
      expect(mockApiGet).toHaveBeenCalledWith(
        expect.stringContaining('/topology/map/fabric'),
        expect.anything(),
      ),
    );
    expect(await screen.findByText(/Outage - PoP-Norte/i)).toBeInTheDocument();
  });

  it('renders the Leaflet map container on Network Topology tab', async () => {
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /network topology/i }));
    await waitFor(() =>
      expect(screen.getAllByTestId('map-container').length).toBeGreaterThan(0),
    );
  });

  it('renders device markers when network data loads', async () => {
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /network topology/i }));
    await waitFor(() =>
      expect(screen.getAllByTestId('circle-marker').length).toBeGreaterThan(0),
    );
  });

  it('renders link polylines when edges have positions', async () => {
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /network topology/i }));
    await waitFor(() =>
      expect(screen.getAllByTestId('polyline').length).toBeGreaterThan(0),
    );
  });

  it('device search box is present on Network Topology tab', async () => {
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /network topology/i }));
    await waitFor(() => {
      const inputs = screen.getAllByRole('textbox');
      expect(inputs.length).toBeGreaterThan(0);
    });
  });

  it('switching to Geographic Map tab renders the map', async () => {
    renderPage();
    const geoTab = await screen.findByRole('button', { name: /geographic map/i });
    await userEvent.click(geoTab);
    await waitFor(() =>
      expect(screen.getAllByTestId('map-container').length).toBeGreaterThan(0),
    );
  });

  it('switching to Dependency tab renders dual-homed section', async () => {
    renderPage();
    const depTab = await screen.findByRole('button', { name: /dependency/i });
    await userEvent.click(depTab);
    await waitFor(() =>
      expect(screen.getByText(/Router-Core/i)).toBeInTheDocument(),
    );
  });

  it('fabric reboot surfaces an honest failure on 422 (never a fake success)', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    // openapi-fetch resolves (does not throw) on non-2xx: { error, response }.
    mockApiPost.mockResolvedValueOnce({ error: { message: 'unsupported' }, response: { status: 422 } });
    renderPage();
    // Fabric is the default tab; the offline incident device is auto-selected,
    // so the inspector's Reboot button is present.
    const rebootBtn = await screen.findByRole('button', { name: /^reboot$/i });
    await userEvent.click(rebootBtn);
    expect(await screen.findByText(/supported/i)).toBeInTheDocument();
    expect(screen.queryByText(/reboot issued/i)).not.toBeInTheDocument();
    confirmSpy.mockRestore();
  });

  it('calls network API when the Network Topology tab is opened', async () => {
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /network topology/i }));
    await waitFor(() =>
      expect(mockApiGet).toHaveBeenCalledWith(
        expect.stringContaining('/topology/map/network'),
        expect.anything(),
      ),
    );
  });

  it('calls customers API when Geographic Map tab is opened', async () => {
    renderPage();
    const geoTab = await screen.findByRole('button', { name: /geographic map/i });
    await userEvent.click(geoTab);
    await waitFor(() =>
      expect(mockApiGet).toHaveBeenCalledWith(
        expect.stringContaining('/topology/map/customers'),
        expect.anything(),
      ),
    );
  });
});
