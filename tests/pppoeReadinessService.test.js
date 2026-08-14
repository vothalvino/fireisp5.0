// =============================================================================
// PPPoE diagnostics readiness tests
// =============================================================================

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  getTenantConnectionConfig: jest.fn(),
}));
jest.mock('../src/services/radiusServerService', () => ({ getStatus: jest.fn() }));
jest.mock('../src/services/routerProvisioningService', () => ({ nasToConn: jest.fn() }));

const db = require('../src/config/database');
const radiusServerService = require('../src/services/radiusServerService');
const routerProvisioningService = require('../src/services/routerProvisioningService');
const { getReadiness } = require('../src/services/pppoeReadinessService');

function mockSources({ auth = {}, router = {}, accounting = {}, nas = [] } = {}) {
  db.query.mockImplementation((sql) => {
    if (sql.includes('FROM radpostauth')) return Promise.resolve([[auth]]);
    if (sql.includes('FROM pppoe_event_logs')) return Promise.resolve([[router]]);
    if (sql.includes('FROM connection_logs')) return Promise.resolve([[accounting]]);
    if (sql.includes('FROM nas')) return Promise.resolve([nas]);
    throw new Error(`unexpected query: ${sql}`);
  });
}

describe('pppoeReadinessService', () => {
  const stopped = { enabled: false, running: false, authPort: 1812, acctPort: 1813, counters: {} };

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.RADIUS_ACCOUNTING_SECRET;
    db.getTenantConnectionConfig.mockResolvedValue(null);
    radiusServerService.getStatus.mockReturnValue(stopped);
    routerProvisioningService.nasToConn.mockImplementation((nas) => {
      if (nas.api_password_encrypted === 'bad') throw new Error('bad credential envelope');
      return { host: nas.ip_address };
    });
  });

  test('returns exact not-configured source shape for an empty tenant', async () => {
    mockSources();
    const result = await getReadiness(31);

    expect(result).toEqual({
      overall: 'not_configured',
      sources: {
        authentication: {
          status: 'not_configured', lastReceivedAt: null, events24h: 0,
          detail: expect.any(String),
        },
        routerEvents: {
          status: 'not_configured', lastReceivedAt: null, events24h: 0,
          detail: expect.any(String), coveredNas: 0, totalNas: 0,
        },
        accounting: {
          status: 'not_configured', lastReceivedAt: null, events24h: 0,
          detail: expect.any(String),
        },
      },
    });
    expect(db.query.mock.calls.every(([, params]) => params.includes(31))).toBe(true);
  });

  test('returns partial when only some telemetry/RouterOS coverage is ready', async () => {
    process.env.RADIUS_ACCOUNTING_SECRET = 'configured';
    const recent = new Date('2026-08-14T12:00:00Z');
    mockSources({
      auth: { last_received_at: recent, events_24h: 8 },
      nas: [
        { id: 1, ip_address: '10.0.0.1', api_username: 'u', api_password_encrypted: 'ok' },
        { id: 2, ip_address: '10.0.0.2', api_username: 'u', api_password_encrypted: 'bad' },
      ],
    });

    const result = await getReadiness(4);
    expect(result.overall).toBe('partial');
    expect(result.sources.authentication.status).toBe('ready');
    expect(result.sources.routerEvents).toMatchObject({ status: 'waiting', coveredNas: 1, totalNas: 2 });
    expect(result.sources.accounting.status).toBe('waiting');
    const accountingSql = db.query.mock.calls.find(([sql]) => sql.includes('FROM connection_logs'))[0];
    expect(accountingSql).toContain('JOIN nas n ON n.id = cl.nas_id');
    expect(accountingSql).not.toContain('cl.username');
  });

  test('returns ready when all three tenant sources have recent events and full NAS coverage', async () => {
    const recent = new Date('2026-08-14T12:00:00Z');
    radiusServerService.getStatus.mockReturnValue({
      enabled: true, running: true, authPort: 1812, acctPort: 1813, counters: {},
    });
    mockSources({
      auth: { last_received_at: recent, events_24h: 2 },
      router: { last_received_at: recent, events_24h: 3 },
      accounting: { last_received_at: recent, events_24h: 4 },
      nas: [{ id: 1, ip_address: '10.0.0.1', api_username: 'u', api_password_encrypted: 'ok' }],
    });

    const result = await getReadiness(12);
    expect(result.overall).toBe('ready');
    expect(Object.values(result.sources).map((source) => source.status)).toEqual([
      'ready', 'ready', 'ready',
    ]);
  });

  test('does not count a NATed NAS without a usable WireGuard tunnel as covered', async () => {
    mockSources({
      nas: [{
        id: 3,
        ip_address: '10.255.0.3',
        api_username: 'u',
        api_password_encrypted: 'ok',
        access_mode: 'nated',
        wg_tunnel_id: 10,
        wg_state: 'pending',
        wg_server_peer_synced: 1,
      }],
    });

    const result = await getReadiness(6);
    expect(result.sources.routerEvents).toMatchObject({
      status: 'not_configured', coveredNas: 0, totalNas: 1,
    });
    expect(routerProvisioningService.nasToConn).not.toHaveBeenCalled();
  });

  test('does not claim install-wide RADIUS feeds configure an isolated tenant', async () => {
    process.env.RADIUS_ACCOUNTING_SECRET = 'install-wide-secret';
    db.getTenantConnectionConfig.mockResolvedValue({ database: 'tenant_44' });
    radiusServerService.getStatus.mockReturnValue({
      enabled: true, running: true, authPort: 1812, acctPort: 1813, counters: {},
    });
    mockSources();

    const result = await getReadiness(44);

    expect(result.sources.authentication).toMatchObject({ status: 'not_configured' });
    expect(result.sources.authentication.detail).toContain('isolated database');
    expect(result.sources.accounting).toMatchObject({ status: 'not_configured' });
    expect(result.sources.accounting.detail).toContain('isolated database');
  });
});
