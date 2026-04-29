// =============================================================================
// FireISP 5.0 — topologyContextService Tests (P1 §3.1)
// =============================================================================

// ---------------------------------------------------------------------------
// Database mock
// ---------------------------------------------------------------------------
const mockQuery = jest.fn();
jest.mock('../src/config/database', () => ({
  query:         mockQuery,
  queryReplica:  jest.fn(),
  execute:       jest.fn(),
  getConnection: jest.fn(),
  close:         jest.fn(),
  pool:          { end: jest.fn() },
}));

// ---------------------------------------------------------------------------
// ContractTopologyPath model mock
// ---------------------------------------------------------------------------
const mockFindByContractId  = jest.fn();
const mockUpsertPath        = jest.fn();
const mockInvalidate        = jest.fn();
const mockInvalidateByDevice = jest.fn();
const mockInvalidateByLink  = jest.fn();

jest.mock('../src/models/ContractTopologyPath', () => ({
  findByContractId:  mockFindByContractId,
  upsertPath:        mockUpsertPath,
  invalidate:        mockInvalidate,
  invalidateByDevice: mockInvalidateByDevice,
  invalidateByLink:  mockInvalidateByLink,
}));

const service = require('../src/services/topologyContextService');

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

/** A linear graph: CPE (id:1) → access (id:2) → core (id:3) via links 10, 11 */
function mockLinearGraph() {
  // loadGraph query 1: devices
  mockQuery.mockResolvedValueOnce([[
    { id: 1, contract_id: 100, role: 'access', status: 'online', type: 'indoor_cpe', site_id: null },
    { id: 2, contract_id: null, role: 'access', status: 'online', type: 'router', site_id: null },
    { id: 3, contract_id: null, role: 'core', status: 'online', type: 'router', site_id: null },
  ], []]);

  // loadGraph query 2: links
  mockQuery.mockResolvedValueOnce([[
    { id: 10, device_a_id: 1, device_b_id: 2, medium: 'fiber', role: 'access', status: 'active' },
    { id: 11, device_a_id: 2, device_b_id: 3, medium: 'fiber', role: 'backhaul', status: 'active' },
  ], []]);
}

afterEach(() => {
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// buildPath
// ---------------------------------------------------------------------------

describe('topologyContextService.buildPath', () => {
  it('returns empty path when contract not found', async () => {
    mockQuery.mockResolvedValueOnce([[], []]);  // contract query
    const path = await service.buildPath(999);
    expect(path).toEqual([]);
    expect(mockUpsertPath).not.toHaveBeenCalled();
  });

  it('returns empty path and caches it when contract has no CPE device', async () => {
    // contract row without cpe_device_id
    mockQuery.mockResolvedValueOnce([[
      { id: 100, organization_id: 1, cpe_device_id: null },
    ], []]);
    mockUpsertPath.mockResolvedValueOnce({});

    const path = await service.buildPath(100);
    expect(path).toEqual([]);
    expect(mockUpsertPath).toHaveBeenCalledWith(100, []);
  });

  it('traverses a linear CPE → access → core path', async () => {
    // contract query
    mockQuery.mockResolvedValueOnce([[
      { id: 100, organization_id: 1, cpe_device_id: 1 },
    ], []]);

    mockLinearGraph();
    mockUpsertPath.mockResolvedValueOnce({});

    const path = await service.buildPath(100);

    expect(path).toBeTruthy();
    expect(path.length).toBeGreaterThanOrEqual(1);
    // First hop is the CPE
    expect(path[0].device_id).toBe(1);
    // Last hop reaches a core/backhaul device
    const lastHop = path[path.length - 1];
    expect([3]).toContain(lastHop.device_id);
    expect(mockUpsertPath).toHaveBeenCalledWith(100, path);
  });

  it('returns single-hop stub when no core device is reachable', async () => {
    // contract query
    mockQuery.mockResolvedValueOnce([[
      { id: 100, organization_id: 1, cpe_device_id: 5 },
    ], []]);

    // Graph with isolated CPE
    mockQuery.mockResolvedValueOnce([[
      { id: 5, contract_id: 100, role: 'access', status: 'online', type: 'indoor_cpe', site_id: null },
    ], []]);
    mockQuery.mockResolvedValueOnce([[], []]);  // no links
    mockUpsertPath.mockResolvedValueOnce({});

    const path = await service.buildPath(100);
    expect(path).toHaveLength(1);
    expect(path[0].device_id).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// getPath
// ---------------------------------------------------------------------------

describe('topologyContextService.getPath', () => {
  it('returns cached path without rebuilding', async () => {
    const cached = JSON.stringify([{ device_id: 1, role: 'access', link_id: null, medium: null }]);
    mockFindByContractId.mockResolvedValueOnce({ path: cached });

    const path = await service.getPath(100);
    expect(path).toHaveLength(1);
    expect(path[0].device_id).toBe(1);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('rebuilds when cache miss', async () => {
    mockFindByContractId.mockResolvedValueOnce(null);

    // buildPath internals: contract not found → empty
    mockQuery.mockResolvedValueOnce([[], []]);

    const path = await service.getPath(999);
    expect(path).toEqual([]);
  });

  it('parses already-parsed JSON objects returned by some DB drivers', async () => {
    const pathArr = [{ device_id: 7, role: 'core', link_id: 20, medium: 'fiber' }];
    mockFindByContractId.mockResolvedValueOnce({ path: pathArr });  // already an array

    const path = await service.getPath(100);
    expect(path).toEqual(pathArr);
  });
});

// ---------------------------------------------------------------------------
// summarize
// ---------------------------------------------------------------------------

describe('topologyContextService.summarize', () => {
  it('returns empty snapshot when path is empty', async () => {
    mockFindByContractId.mockResolvedValueOnce({ path: '[]' });

    const snap = await service.summarize(100);
    expect(snap).toEqual({
      cpe: null, accessDevice: null, backhauls: [], pop: null, activeOutages: [],
    });
  });

  it('returns cpe, accessDevice, pop, and backhauls from path', async () => {
    const pathArr = [
      { device_id: 1, role: 'access', link_id: null, medium: null },
      { device_id: 2, role: 'distribution', link_id: 10, medium: 'fiber' },
      { device_id: 3, role: 'core', link_id: 11, medium: 'fiber' },
    ];
    mockFindByContractId.mockResolvedValueOnce({ path: JSON.stringify(pathArr) });

    // Device enrichment query
    mockQuery.mockResolvedValueOnce([[
      { id: 1, name: 'CPE-1', type: 'indoor_cpe', role: 'access', status: 'online', ip_address: '10.0.0.1', site_id: null },
      { id: 2, name: 'SW-2',  type: 'switch',     role: 'distribution', status: 'online', ip_address: '10.0.1.1', site_id: null },
      { id: 3, name: 'R-3',   type: 'router',     role: 'core', status: 'online', ip_address: '10.0.2.1', site_id: null },
    ], []]);

    // Active outages query
    mockQuery.mockResolvedValueOnce([[], []]);

    const snap = await service.summarize(100);

    expect(snap.cpe.id).toBe(1);
    expect(snap.accessDevice.id).toBe(2);
    expect(snap.pop.id).toBe(3);
    expect(snap.backhauls).toHaveLength(1);
    expect(snap.backhauls[0].device.id).toBe(2);
    expect(snap.backhauls[0].medium).toBe('fiber');
    expect(snap.activeOutages).toHaveLength(0);
  });

  it('includes active outages for devices on the path', async () => {
    const pathArr = [
      { device_id: 1, role: 'access', link_id: null, medium: null },
      { device_id: 2, role: 'core', link_id: 10, medium: 'wireless' },
    ];
    mockFindByContractId.mockResolvedValueOnce({ path: JSON.stringify(pathArr) });

    mockQuery.mockResolvedValueOnce([[
      { id: 1, name: 'CPE', type: 'indoor_cpe', role: 'access', status: 'online', ip_address: null, site_id: null },
      { id: 2, name: 'AP',  type: 'ptmp_ap', role: 'core', status: 'online', ip_address: '10.0.1.1', site_id: null },
    ], []]);

    // Active outage on device 2
    mockQuery.mockResolvedValueOnce([[
      { id: 55, title: 'AP Down', severity: 'high', start_time: '2026-04-29T10:00:00Z', device_id: 2, site_id: null },
    ], []]);

    const snap = await service.summarize(100);
    expect(snap.activeOutages).toHaveLength(1);
    expect(snap.activeOutages[0].id).toBe(55);
  });
});

// ---------------------------------------------------------------------------
// invalidate
// ---------------------------------------------------------------------------

describe('topologyContextService.invalidate', () => {
  it('calls ContractTopologyPath.invalidate for contract type', async () => {
    mockInvalidate.mockResolvedValueOnce(undefined);
    await service.invalidate(100, 'contract');
    expect(mockInvalidate).toHaveBeenCalledWith(100);
  });

  it('calls invalidateByDevice for device type', async () => {
    mockInvalidateByDevice.mockResolvedValueOnce(undefined);
    await service.invalidate(5, 'device');
    expect(mockInvalidateByDevice).toHaveBeenCalledWith(5);
  });

  it('calls invalidateByLink for link type', async () => {
    mockInvalidateByLink.mockResolvedValueOnce(undefined);
    await service.invalidate(10, 'link');
    expect(mockInvalidateByLink).toHaveBeenCalledWith(10);
  });
});
