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
const {
  buildAccountingSource,
  buildAuthenticationSource,
  buildRouterSource,
  getReadiness,
} = require('../src/services/pppoeReadinessService');

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
          detail: expect.any(String), detailCode: 'authentication_not_configured',
          detailParams: {},
        },
        routerEvents: {
          status: 'not_configured', lastReceivedAt: null, events24h: 0,
          detail: expect.any(String), detailCode: 'router_none_active', detailParams: {},
          coveredNas: 0, totalNas: 0, maintenanceNas: 0,
        },
        accounting: {
          status: 'not_configured', lastReceivedAt: null, events24h: 0,
          detail: expect.any(String), detailCode: 'accounting_not_configured',
          detailParams: {},
        },
      },
    });
    expect(db.query.mock.calls.every(([, params]) => params.includes(31))).toBe(true);
  });

  test('publishes stable localization metadata for every readiness source branch', () => {
    const recent = { lastReceivedAt: new Date().toISOString(), events24h: 1 };
    const quiet = { lastReceivedAt: null, events24h: 0 };
    const historical = { lastReceivedAt: new Date().toISOString(), events24h: 0 };
    const embeddedRunning = { enabled: true, running: true, authPort: 1812 };
    const embeddedStopped = { enabled: true, running: false, authPort: 1812 };

    const sources = [
      buildAuthenticationSource(quiet, embeddedStopped),
      buildAuthenticationSource(recent, embeddedRunning),
      buildAuthenticationSource(recent, stopped),
      buildAuthenticationSource(recent, stopped, true),
      buildAuthenticationSource(historical, embeddedRunning),
      buildAuthenticationSource(historical, stopped),
      buildAuthenticationSource(historical, stopped, true),
      buildAuthenticationSource(quiet, stopped),
      buildAuthenticationSource(quiet, stopped, true),
      buildRouterSource(quiet, 0, 0),
      buildRouterSource(quiet, 0, 0, 2),
      buildRouterSource(quiet, 0, 2),
      buildRouterSource(recent, 2, 2),
      buildRouterSource(recent, 1, 2),
      buildRouterSource(quiet, 1, 2),
      buildAccountingSource(recent, stopped),
      buildAccountingSource(quiet, embeddedStopped),
      buildAccountingSource(quiet, embeddedRunning),
      buildAccountingSource(quiet, stopped),
      buildAccountingSource(quiet, stopped, true),
    ];

    expect(sources.map((source) => source.detailCode)).toEqual([
      'authentication_embedded_not_running',
      'authentication_recent_embedded',
      'authentication_recent_external',
      'authentication_recent_isolated',
      'authentication_waiting_embedded',
      'authentication_waiting_external',
      'authentication_waiting_isolated',
      'authentication_not_configured',
      'authentication_not_configured_isolated',
      'router_none_active',
      'router_all_maintenance',
      'router_none_covered',
      'router_ready_all',
      'router_partial_coverage',
      'router_waiting_no_events',
      'accounting_recent',
      'accounting_embedded_not_running',
      'accounting_waiting',
      'accounting_not_configured',
      'accounting_not_configured_isolated',
    ]);
    for (const source of sources) expect(source.detailParams).toEqual(expect.any(Object));
    expect(sources[1].detailParams).toEqual({ authPort: 1812 });
    expect(sources[10].detailParams).toEqual({ maintenanceNas: 2 });
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
    const accountingCall = db.query.mock.calls.find(([sql]) => sql.includes('FROM connection_logs'));
    const [accountingSql, accountingParams] = accountingCall;
    expect(accountingSql).toContain('WHERE cl.organization_id = ?');
    expect(accountingSql).not.toContain('JOIN nas');
    expect(accountingSql).not.toContain('cl.username');
    expect(accountingParams).toEqual([4]);
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

  test('excludes maintenance NAS devices and their recent events from readiness', async () => {
    const recent = new Date('2026-08-14T12:00:00Z');
    mockSources({
      // This is the result after the SQL predicate excludes the maintained
      // router's recent row; the SQL assertions below guard that behavior.
      router: { last_received_at: null, events_24h: 0 },
      nas: [
        {
          id: 20,
          ip_address: '10.0.0.20',
          api_username: 'u',
          api_password_encrypted: 'ok',
          maintenance_mode: '1',
        },
        {
          id: 21,
          ip_address: '10.0.0.21',
          api_username: 'u',
          api_password_encrypted: 'ok',
          maintenance_mode: '0',
        },
      ],
      auth: { last_received_at: recent, events_24h: 1 },
    });

    const result = await getReadiness(8);

    expect(result.sources.routerEvents).toMatchObject({
      status: 'waiting',
      coveredNas: 1,
      totalNas: 1,
      maintenanceNas: 1,
      detailCode: 'router_waiting_no_events',
      detailParams: { coveredNas: 1, totalNas: 1, maintenanceNas: 1 },
    });
    expect(routerProvisioningService.nasToConn).toHaveBeenCalledTimes(1);
    expect(routerProvisioningService.nasToConn).toHaveBeenCalledWith(
      expect.objectContaining({ id: 21 }),
    );

    const eventSql = db.query.mock.calls.find(([sql]) => sql.includes('FROM pppoe_event_logs'))[0];
    expect(eventSql).toContain('source_nas.id = pel.nas_id');
    expect(eventSql).toContain('source_nas.organization_id = pel.organization_id');
    expect(eventSql).toContain("source_nas.status = 'active'");
    expect(eventSql).toContain('source_nas.deleted_at IS NULL');
    expect(eventSql).toContain('pel.nas_id IS NULL');
    expect(eventSql).toContain('COALESCE(source_nas.maintenance_mode, 0) = 0');
  });

  test('retains loose-coupled RouterOS history whose NAS row no longer exists', async () => {
    const recent = new Date('2026-08-14T12:00:00Z');
    mockSources({
      router: { last_received_at: recent, events_24h: 1 },
      nas: [{
        id: 40,
        ip_address: '10.0.0.40',
        api_username: 'u',
        api_password_encrypted: 'ok',
        maintenance_mode: 0,
      }],
    });

    const result = await getReadiness(12);

    expect(result.sources.routerEvents).toMatchObject({
      status: 'ready', events24h: 1, coveredNas: 1, totalNas: 1,
    });
    const eventSql = db.query.mock.calls.find(([sql]) => sql.includes('FROM pppoe_event_logs'))[0];
    // NULL after the LEFT JOIN includes both explicit nas_id=NULL events and
    // non-null historical nas_id values whose NAS row was later hard-deleted.
    expect(eventSql).toContain('COALESCE(source_nas.maintenance_mode, 0) = 0');
    expect(eventSql).not.toContain('COALESCE(source_nas.maintenance_mode, 1)');
  });

  test('retains history from inactive or archived NAS devices even if their old flag is set', async () => {
    const recent = new Date('2026-08-14T12:00:00Z');
    mockSources({
      router: { last_received_at: recent, events_24h: 2 },
      nas: [{
        id: 41,
        ip_address: '10.0.0.41',
        api_username: 'u',
        api_password_encrypted: 'ok',
        maintenance_mode: 0,
      }],
    });

    const result = await getReadiness(13);

    expect(result.sources.routerEvents).toMatchObject({ status: 'ready', events24h: 2 });
    const eventSql = db.query.mock.calls.find(([sql]) => sql.includes('FROM pppoe_event_logs'))[0];
    // Only a live NAS joins as source_nas; inactive/deleted rows become an
    // unmatched LEFT JOIN and therefore keep their loose-coupled history.
    expect(eventSql).toMatch(
      /source_nas\.organization_id = pel\.organization_id[\s\S]*source_nas\.status = 'active'[\s\S]*source_nas\.deleted_at IS NULL/,
    );
    expect(eventSql).toContain('COALESCE(source_nas.maintenance_mode, 0) = 0');
  });

  test('reports an all-maintenance fleet without claiming there are no active NAS devices', async () => {
    mockSources({
      nas: [{
        id: 30,
        ip_address: '10.0.0.30',
        api_username: 'u',
        api_password_encrypted: 'ok',
        maintenance_mode: 1,
      }],
    });

    const result = await getReadiness(10);

    expect(result.sources.routerEvents).toMatchObject({
      status: 'not_configured',
      coveredNas: 0,
      totalNas: 0,
      maintenanceNas: 1,
      detailCode: 'router_all_maintenance',
      detailParams: { maintenanceNas: 1 },
    });
    expect(result.sources.routerEvents.detail).toMatch(/only active mikrotik nas is in maintenance mode/i);
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
    expect(result.sources.authentication).toMatchObject({
      detailCode: 'authentication_not_configured_isolated', detailParams: {},
    });
    expect(result.sources.authentication.detail).toContain('isolated database');
    expect(result.sources.accounting).toMatchObject({ status: 'not_configured' });
    expect(result.sources.accounting).toMatchObject({
      detailCode: 'accounting_not_configured_isolated', detailParams: {},
    });
    expect(result.sources.accounting.detail).toContain('isolated database');
  });
});
