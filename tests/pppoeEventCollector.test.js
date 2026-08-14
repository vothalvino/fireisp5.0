// =============================================================================
// RouterOS PPPoE event collector tests
// =============================================================================

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  withPrimaryContext: jest.fn((callback) => callback()),
  withTenantContext: jest.fn((_organizationId, callback) => callback()),
}));
jest.mock('../src/services/routerProvisioningService', () => ({ nasToConn: jest.fn() }));
jest.mock('../src/services/routerosService', () => ({
  createClient: jest.fn(),
  parseAttrs: jest.fn((words) => Object.fromEntries(words.map((word) => {
    const split = word.indexOf('=', 1);
    return [word.slice(1, split), word.slice(split + 1)];
  }))),
}));
jest.mock('../src/services/pppoeDiagnosticsService', () => ({
  parseRouterOsLogLine: jest.fn((message) => message.includes('authenticated')
    ? { stage: 'AUTH', severity: 'info', reason_code: 'auth_ok', message }
    : null),
}));
jest.mock('../src/utils/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
  child: jest.fn().mockReturnThis(),
}));

const db = require('../src/config/database');
const routerProvisioningService = require('../src/services/routerProvisioningService');
const routerosService = require('../src/services/routerosService');
const {
  collectPppoeEvents,
  deriveEventIdentity,
  hasPppTopic,
  makeSourceKey,
  parseRouterLogTime,
} = require('../src/services/pppoeEventCollector');

function sentence(id, message, time = 'aug/14/2026 10:00:00', topics = 'ppp,info') {
  return ['!re', `=.id=${id}`, `=time=${time}`, `=topics=${topics}`, `=message=${message}`];
}

describe('pppoeEventCollector', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.PPPOE_EVENT_POLL_LIMIT;
    routerProvisioningService.nasToConn.mockImplementation((nas) => ({ host: nas.ip_address }));
  });

  test('derives subscriber identity and produces a stable source key', () => {
    expect(deriveEventIdentity('<alice@example.net>: authenticated from aa-bb-cc-dd-ee-ff')).toEqual({
      username: 'alice@example.net',
      mac: 'AA:BB:CC:DD:EE:FF',
    });
    const attrs = { '.id': '*1', time: '10:00:00', topics: 'ppp,info', message: 'x' };
    expect(makeSourceKey(4, attrs)).toMatch(/^[0-9a-f]{64}$/);
    expect(makeSourceKey(4, attrs)).toBe(makeSourceKey(4, attrs));
    expect(hasPppTopic('info,ppp,account')).toBe(true);
    expect(hasPppTopic('warning,pppoe')).toBe(true);
    expect(hasPppTopic('interface,info')).toBe(false);
  });

  test('parses RouterOS date, year-less date, and time-only timestamps', () => {
    const now = new Date(2026, 0, 1, 0, 30, 0);
    expect(parseRouterLogTime('aug/14/2026 10:11:12', now)).toBeInstanceOf(Date);
    expect(parseRouterLogTime('dec/31 23:59:00', now).getFullYear()).toBe(2025);
    expect(parseRouterLogTime('23:59:00', now).getDate()).not.toBe(now.getDate());
  });

  test('caps each poll, inserts tenant-stamped events with INSERT IGNORE, and closes the client', async () => {
    process.env.PPPOE_EVENT_POLL_LIMIT = '50';
    const nas = {
      id: 7, organization_id: 42, ip_address: '10.0.0.7',
      api_username: 'collector', api_password_encrypted: 'secret',
    };
    const client = {
      run: jest.fn().mockResolvedValue(Array.from({ length: 60 }, (_, i) =>
        sentence(`*${i}`, `<user${i}>: authenticated`))),
      close: jest.fn().mockResolvedValue(undefined),
    };
    db.query
      .mockResolvedValueOnce([[nas]])
      .mockResolvedValueOnce([{ affectedRows: 48 }]);
    routerosService.createClient.mockResolvedValueOnce(client);

    const result = await collectPppoeEvents(42);

    expect(result).toMatchObject({
      nasTotal: 1, nasSucceeded: 1, nasFailed: 0,
      logsRead: 60, logsConsidered: 50, eventsRecognized: 50,
      inserted: 48, deduplicated: 2, pollLimit: 50,
    });
    expect(client.run).toHaveBeenCalledWith([
      '/log/print', '=.proplist=.id,time,topics,message',
    ]);
    expect(client.close).toHaveBeenCalledTimes(1);
    expect(db.query.mock.calls[0][0]).toContain("wg.state IN ('active', 'manual')");
    expect(db.query.mock.calls[0][0]).toContain('wg.server_peer_synced = 1');
    expect(db.query.mock.calls[0][0]).toContain('n.maintenance_mode = 0');
    expect(db.query.mock.calls[0][1]).toEqual([42]);
    const insertCall = db.query.mock.calls[1];
    expect(insertCall[0]).toContain('INSERT IGNORE INTO pppoe_event_logs');
    expect(insertCall[0]).toContain('source_key');
    expect(insertCall[1]).toContain(42);
    expect(insertCall[1]).toContain(7);
  });

  test('closes a failed client and continues polling the next NAS', async () => {
    const nasRows = [
      { id: 1, organization_id: 9, ip_address: '10.0.0.1', api_username: 'u', api_password_encrypted: 'p' },
      { id: 2, organization_id: 9, ip_address: '10.0.0.2', api_username: 'u', api_password_encrypted: 'p' },
    ];
    const failedClient = {
      run: jest.fn().mockRejectedValue(new Error('router unavailable')),
      close: jest.fn().mockResolvedValue(undefined),
    };
    const goodClient = {
      run: jest.fn().mockResolvedValue([sentence('*2', '<bob>: authenticated')]),
      close: jest.fn().mockResolvedValue(undefined),
    };
    db.query
      .mockResolvedValueOnce([nasRows])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);
    routerosService.createClient
      .mockResolvedValueOnce(failedClient)
      .mockResolvedValueOnce(goodClient);

    const result = await collectPppoeEvents(9);

    expect(result).toMatchObject({ nasTotal: 2, nasSucceeded: 1, nasFailed: 1, inserted: 1 });
    expect(result.failures).toEqual([{ nasId: 1, message: 'router unavailable' }]);
    expect(failedClient.close).toHaveBeenCalledTimes(1);
    expect(goodClient.close).toHaveBeenCalledTimes(1);
  });

  test('does not classify generic connected messages from non-PPP topics', async () => {
    const nas = {
      id: 8, organization_id: 42, ip_address: '10.0.0.8',
      api_username: 'collector', api_password_encrypted: 'secret',
    };
    const client = {
      run: jest.fn().mockResolvedValue([
        sentence('*1', 'ether1 connected', 'aug/14/2026 10:00:00', 'interface,info'),
      ]),
      close: jest.fn().mockResolvedValue(undefined),
    };
    db.query.mockResolvedValueOnce([[nas]]);
    routerosService.createClient.mockResolvedValueOnce(client);

    const result = await collectPppoeEvents(42);

    expect(result).toMatchObject({
      logsRead: 1, logsConsidered: 1, eventsRecognized: 0, inserted: 0,
    });
    expect(db.query).toHaveBeenCalledTimes(1);
    expect(client.close).toHaveBeenCalledTimes(1);
  });

  test('a global sweep excludes stale primary copies and fans out to isolated tenant databases', async () => {
    const isolatedNas = {
      id: 91, organization_id: 91, ip_address: '10.91.0.1',
      api_username: 'collector', api_password_encrypted: 'secret',
    };
    const client = {
      run: jest.fn().mockResolvedValue([sentence('*91', '<isolated-user>: authenticated')]),
      close: jest.fn().mockResolvedValue(undefined),
    };
    db.query.mockImplementation((sql, params = []) => {
      if (/SELECT odc\.organization_id/.test(sql)) {
        return Promise.resolve([[{ organization_id: 91 }]]);
      }
      if (/SELECT n\.id/.test(sql) && params.length === 0) return Promise.resolve([[]]);
      if (/SELECT n\.id/.test(sql) && params[0] === 91) return Promise.resolve([[isolatedNas]]);
      if (/INSERT IGNORE INTO pppoe_event_logs/.test(sql)) return Promise.resolve([{ affectedRows: 1 }]);
      return Promise.resolve([[]]);
    });
    routerosService.createClient.mockResolvedValueOnce(client);

    const result = await collectPppoeEvents();

    expect(result).toMatchObject({
      databaseScopesTotal: 2,
      databaseScopesSucceeded: 2,
      databaseScopesFailed: 0,
      nasTotal: 1,
      inserted: 1,
    });
    expect(db.withPrimaryContext).toHaveBeenCalledTimes(2);
    expect(db.withTenantContext).toHaveBeenCalledWith(91, expect.any(Function));
    const sharedNasQuery = db.query.mock.calls.find(([sql, params = []]) =>
      /SELECT n\.id/.test(sql) && params.length === 0);
    expect(sharedNasQuery[0]).toContain("odc.isolation_mode = 'isolated'");
    expect(client.close).toHaveBeenCalledTimes(1);
  });
});
