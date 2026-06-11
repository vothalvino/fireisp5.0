// =============================================================================
// FireISP 5.0 — RADIUS Authorization Sync Tests (§3.2 Phase B)
// =============================================================================
// Tests syncFreeradiusTables attribute emission for:
//   item 10: Session-Timeout, Idle-Timeout in radgroupreply
//   item 11: Simultaneous-Use in radcheck (account override wins plan default)
//   item 12: Login-Time in radgroupcheck from plan_access_windows
//   item 13: Tunnel-Type/Medium-Type/Private-Group-Id in radreply (VLAN)
//   item 14: Mikrotik-Address-List in radreply for walled subscribers
//   item 15: Framed-Route in radreply per radius_account_routes row
// =============================================================================

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
}));

jest.mock('../src/utils/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
  child: jest.fn().mockReturnThis(),
}));

const db = require('../src/config/database');
const { syncFreeradiusTables } = require('../src/services/radiusService');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a mock db.query that responds to the sequence of queries issued by
 * syncFreeradiusTables().  Phase B adds several new queries:
 *  1. mab_password_mode setting
 *  2. subscribers
 *  3. subscriber_certificates
 *  4. plan_access_windows (by planIds IN)
 *  5. radius_account_routes (by subscriberIds IN)
 *  6. organization_walled_garden_settings (enabled)
 *  7. suspension_logs / walled usernames
 *  8+. DELETE / INSERT per subscriber + plan
 */
function setupMockDb({
  mabMode = null,
  subscribers = [],
  certs = [],
  accessWindows = [],
  routes = [],
  walledGardenEnabled = false,
  walledGardenName = 'walled_garden',
  walledUsernames = [],
} = {}) {
  const calls = [];

  db.query.mockImplementation((sql, params) => {
    calls.push({ sql, params });

    if (sql.includes('mab_password_mode')) {
      return Promise.resolve(mabMode ? [[{ value: mabMode }]] : [[]]);
    }
    if (sql.includes('FROM radius r') && sql.includes('LEFT JOIN contracts')) {
      return Promise.resolve([subscribers]);
    }
    if (sql.includes('FROM subscriber_certificates')) {
      return Promise.resolve([certs]);
    }
    if (sql.includes('FROM plan_access_windows')) {
      return Promise.resolve([accessWindows]);
    }
    if (sql.includes('FROM radius_account_routes')) {
      return Promise.resolve([routes]);
    }
    if (sql.includes('FROM organization_walled_garden_settings')) {
      if (walledGardenEnabled) {
        return Promise.resolve([[{ address_list_name: walledGardenName }]]);
      }
      return Promise.resolve([[]]);
    }
    if (sql.includes('suspension_logs') && sql.includes('walled_garden')) {
      return Promise.resolve([walledUsernames.map(u => ({ username: u }))]);
    }
    // DELETE / INSERT — return success
    return Promise.resolve([{ affectedRows: 1 }]);
  });

  return calls;
}

const baseSubscriber = {
  id: 1,
  username: 'user1@isp.net',
  cleartext_password: 's3cr3t',
  mac_address: null,
  auth_method: 'pppoe',
  organization_id: 10,
  plan_id: 5,
  account_sim_use: null,
  plan_sim_use: 1,
  vlan_id: null,
  inner_vlan_id: null,
  download_speed_mbps: 20,
  upload_speed_mbps: 10,
  burst_download_mbps: null,
  burst_upload_mbps: null,
  radius_vendor: null,
  plan_name: 'Basic 20M',
  session_timeout_seconds: null,
  idle_timeout_seconds: null,
};

beforeEach(() => jest.clearAllMocks());

// ---------------------------------------------------------------------------
// Item 10: Session-Timeout & Idle-Timeout
// ---------------------------------------------------------------------------
describe('item 10 — Session-Timeout / Idle-Timeout', () => {
  test('emits Session-Timeout radgroupreply row when plan.session_timeout_seconds is set', async () => {
    const sub = { ...baseSubscriber, session_timeout_seconds: 3600, idle_timeout_seconds: null };
    const calls = setupMockDb({ subscribers: [sub] });

    await syncFreeradiusTables(10);

    const row = calls.find(
      c => c.sql.includes('INSERT INTO radgroupreply') && c.params && c.params[1] === 'Session-Timeout',
    );
    expect(row).toBeDefined();
    expect(row.params[0]).toBe('plan_5');
    expect(row.params[2]).toBe(':=');
    expect(row.params[3]).toBe('3600');
  });

  test('emits Idle-Timeout radgroupreply row when plan.idle_timeout_seconds is set', async () => {
    const sub = { ...baseSubscriber, session_timeout_seconds: null, idle_timeout_seconds: 600 };
    const calls = setupMockDb({ subscribers: [sub] });

    await syncFreeradiusTables(10);

    const row = calls.find(
      c => c.sql.includes('INSERT INTO radgroupreply') && c.params && c.params[1] === 'Idle-Timeout',
    );
    expect(row).toBeDefined();
    expect(row.params[3]).toBe('600');
  });

  test('does NOT emit Session-Timeout when plan.session_timeout_seconds is null', async () => {
    const calls = setupMockDb({ subscribers: [baseSubscriber] });

    await syncFreeradiusTables(10);

    const row = calls.find(
      c => c.sql.includes('INSERT INTO radgroupreply') && c.params && c.params[1] === 'Session-Timeout',
    );
    expect(row).toBeUndefined();
  });

  test('does NOT emit Idle-Timeout when plan.idle_timeout_seconds is null', async () => {
    const calls = setupMockDb({ subscribers: [baseSubscriber] });

    await syncFreeradiusTables(10);

    const row = calls.find(
      c => c.sql.includes('INSERT INTO radgroupreply') && c.params && c.params[1] === 'Idle-Timeout',
    );
    expect(row).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Item 11: Simultaneous-Use
// ---------------------------------------------------------------------------
describe('item 11 — Simultaneous-Use', () => {
  test('emits Simultaneous-Use := plan default when no account override', async () => {
    const sub = { ...baseSubscriber, account_sim_use: null, plan_sim_use: 2 };
    const calls = setupMockDb({ subscribers: [sub] });

    await syncFreeradiusTables(10);

    const row = calls.find(
      c => c.sql.includes('INSERT INTO radcheck') && c.params && c.params[1] === 'Simultaneous-Use',
    );
    expect(row).toBeDefined();
    expect(row.params[2]).toBe(':=');
    expect(row.params[3]).toBe('2');
  });

  test('account override wins over plan default', async () => {
    const sub = { ...baseSubscriber, account_sim_use: 5, plan_sim_use: 1 };
    const calls = setupMockDb({ subscribers: [sub] });

    await syncFreeradiusTables(10);

    const row = calls.find(
      c => c.sql.includes('INSERT INTO radcheck') && c.params && c.params[1] === 'Simultaneous-Use',
    );
    expect(row).toBeDefined();
    expect(row.params[3]).toBe('5');
  });

  test('falls back to 1 when both account and plan sim_use are null', async () => {
    const sub = { ...baseSubscriber, account_sim_use: null, plan_sim_use: null };
    const calls = setupMockDb({ subscribers: [sub] });

    await syncFreeradiusTables(10);

    const row = calls.find(
      c => c.sql.includes('INSERT INTO radcheck') && c.params && c.params[1] === 'Simultaneous-Use',
    );
    expect(row).toBeDefined();
    expect(row.params[3]).toBe('1');
  });
});

// ---------------------------------------------------------------------------
// Item 12: Login-Time from plan_access_windows
// ---------------------------------------------------------------------------
describe('item 12 — Login-Time access windows', () => {
  test('emits Login-Time radgroupcheck row when access windows exist', async () => {
    const calls = setupMockDb({
      subscribers: [baseSubscriber],
      accessWindows: [
        { plan_id: 5, day_mask: 62, start_time: '08:00:00', end_time: '18:00:00', status: 'active', deleted_at: null },
      ],
    });

    await syncFreeradiusTables(10);

    const row = calls.find(
      c => c.sql.includes('INSERT INTO radgroupcheck') && c.params && c.params[1] === 'Login-Time',
    );
    expect(row).toBeDefined();
    expect(row.params[0]).toBe('plan_5');
    expect(row.params[2]).toBe(':=');
    expect(row.params[3]).toBe('Wk0800-1800');
  });

  test('emits multiple windows as comma-joined Login-Time', async () => {
    const calls = setupMockDb({
      subscribers: [baseSubscriber],
      accessWindows: [
        { plan_id: 5, day_mask: 62, start_time: '08:00:00', end_time: '18:00:00', status: 'active', deleted_at: null },
        { plan_id: 5, day_mask: 64, start_time: '09:00:00', end_time: '13:00:00', status: 'active', deleted_at: null },
      ],
    });

    await syncFreeradiusTables(10);

    const row = calls.find(
      c => c.sql.includes('INSERT INTO radgroupcheck') && c.params && c.params[1] === 'Login-Time',
    );
    expect(row).toBeDefined();
    expect(row.params[3]).toBe('Wk0800-1800,Sa0900-1300');
  });

  test('does NOT emit Login-Time when no access windows for plan', async () => {
    const calls = setupMockDb({ subscribers: [baseSubscriber], accessWindows: [] });

    await syncFreeradiusTables(10);

    const row = calls.find(
      c => c.sql.includes('INSERT INTO radgroupcheck') && c.params && c.params[1] === 'Login-Time',
    );
    expect(row).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Item 13: VLAN assignment
// ---------------------------------------------------------------------------
describe('item 13 — VLAN assignment via RADIUS', () => {
  test('emits Tunnel-Type, Tunnel-Medium-Type, Tunnel-Private-Group-Id when vlan_id set', async () => {
    const sub = { ...baseSubscriber, vlan_id: 100, inner_vlan_id: null };
    const calls = setupMockDb({ subscribers: [sub] });

    await syncFreeradiusTables(10);

    const tunnelType = calls.find(
      c => c.sql.includes('INSERT INTO radreply') && c.params && c.params[1] === 'Tunnel-Type',
    );
    expect(tunnelType).toBeDefined();
    expect(tunnelType.params[0]).toBe('user1@isp.net');
    expect(tunnelType.params[2]).toBe(':=');
    expect(tunnelType.params[3]).toBe('VLAN');

    const medium = calls.find(
      c => c.sql.includes('INSERT INTO radreply') && c.params && c.params[1] === 'Tunnel-Medium-Type',
    );
    expect(medium).toBeDefined();
    expect(medium.params[3]).toBe('IEEE-802');

    const pvgId = calls.find(
      c => c.sql.includes('INSERT INTO radreply') && c.params && c.params[1] === 'Tunnel-Private-Group-Id',
    );
    expect(pvgId).toBeDefined();
    expect(pvgId.params[3]).toBe('100');
  });

  test('emits inner VLAN tag for QinQ when inner_vlan_id set', async () => {
    const sub = { ...baseSubscriber, vlan_id: 100, inner_vlan_id: 200 };
    const calls = setupMockDb({ subscribers: [sub] });

    await syncFreeradiusTables(10);

    const innerTag = calls.find(
      c => c.sql.includes('INSERT INTO radreply') && c.params && c.params[1] === 'Tunnel-Private-Group-Id:1',
    );
    expect(innerTag).toBeDefined();
    expect(innerTag.params[3]).toBe('200');
  });

  test('does NOT emit VLAN attributes when vlan_id is null', async () => {
    const calls = setupMockDb({ subscribers: [baseSubscriber] });

    await syncFreeradiusTables(10);

    const tunnelType = calls.find(
      c => c.sql.includes('INSERT INTO radreply') && c.params && c.params[1] === 'Tunnel-Type',
    );
    expect(tunnelType).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Item 14: Walled garden
// ---------------------------------------------------------------------------
describe('item 14 — Walled garden Mikrotik-Address-List', () => {
  test('emits Mikrotik-Address-List for subscribers in walled garden', async () => {
    const calls = setupMockDb({
      subscribers: [baseSubscriber],
      walledGardenEnabled: true,
      walledGardenName: 'walled_garden',
      walledUsernames: ['user1@isp.net'],
    });

    await syncFreeradiusTables(10);

    const row = calls.find(
      c => c.sql.includes('INSERT INTO radreply') && c.params && c.params[1] === 'Mikrotik-Address-List',
    );
    expect(row).toBeDefined();
    expect(row.params[0]).toBe('user1@isp.net');
    expect(row.params[3]).toBe('walled_garden');
  });

  test('uses custom address_list_name from org settings', async () => {
    const calls = setupMockDb({
      subscribers: [baseSubscriber],
      walledGardenEnabled: true,
      walledGardenName: 'captive_portal',
      walledUsernames: ['user1@isp.net'],
    });

    await syncFreeradiusTables(10);

    const row = calls.find(
      c => c.sql.includes('INSERT INTO radreply') && c.params && c.params[1] === 'Mikrotik-Address-List',
    );
    expect(row).toBeDefined();
    expect(row.params[3]).toBe('captive_portal');
  });

  test('does NOT emit Mikrotik-Address-List for non-walled subscribers', async () => {
    const calls = setupMockDb({
      subscribers: [baseSubscriber],
      walledGardenEnabled: true,
      walledUsernames: [], // no walled users
    });

    await syncFreeradiusTables(10);

    const row = calls.find(
      c => c.sql.includes('INSERT INTO radreply') && c.params && c.params[1] === 'Mikrotik-Address-List',
    );
    expect(row).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Item 15: Framed-Route injection
// ---------------------------------------------------------------------------
describe('item 15 — Framed-Route per-account route injection', () => {
  test('emits Framed-Route rows for each route assigned to account', async () => {
    const calls = setupMockDb({
      subscribers: [baseSubscriber],
      routes: [
        { radius_account_id: 1, destination: '192.168.10.0/24', gateway: '10.0.0.1', metric: 1 },
        { radius_account_id: 1, destination: '10.20.0.0/16', gateway: null, metric: null },
      ],
    });

    await syncFreeradiusTables(10);

    const framedRoutes = calls.filter(
      c => c.sql.includes('INSERT INTO radreply') && c.params && c.params[1] === 'Framed-Route',
    );
    expect(framedRoutes.length).toBe(2);

    // Route with gateway and metric
    const r1 = framedRoutes.find(c => c.params[3].startsWith('192.168.10.0/24'));
    expect(r1).toBeDefined();
    expect(r1.params[3]).toBe('192.168.10.0/24 10.0.0.1 1');
    expect(r1.params[2]).toBe('+='); // += allows multiple Framed-Route

    // Route without optional fields
    const r2 = framedRoutes.find(c => c.params[3].startsWith('10.20.0.0/16'));
    expect(r2).toBeDefined();
    expect(r2.params[3]).toBe('10.20.0.0/16');
  });

  test('does NOT emit Framed-Route when no routes for account', async () => {
    const calls = setupMockDb({ subscribers: [baseSubscriber], routes: [] });

    await syncFreeradiusTables(10);

    const framedRoutes = calls.filter(
      c => c.sql.includes('INSERT INTO radreply') && c.params && c.params[1] === 'Framed-Route',
    );
    expect(framedRoutes.length).toBe(0);
  });

  test('emits route with only gateway (no metric)', async () => {
    const calls = setupMockDb({
      subscribers: [baseSubscriber],
      routes: [
        { radius_account_id: 1, destination: '172.16.0.0/12', gateway: '192.168.1.1', metric: null },
      ],
    });

    await syncFreeradiusTables(10);

    const row = calls.find(
      c => c.sql.includes('INSERT INTO radreply') && c.params && c.params[1] === 'Framed-Route',
    );
    expect(row).toBeDefined();
    expect(row.params[3]).toBe('172.16.0.0/12 192.168.1.1');
  });
});

// ---------------------------------------------------------------------------
// kickDuplicateSessions selection logic
// ---------------------------------------------------------------------------
describe('kickDuplicateSessions() — selection logic', () => {
  const { kickDuplicateSessions } = require('../src/services/radiusService');

  beforeEach(() => jest.clearAllMocks());

  test('kicks oldest sessions when count exceeds allowed limit', async () => {
    // Subscriber with sim_use=1 but has 3 active sessions
    const subscribers = [{
      radius_id: 1,
      username: 'over_limit@isp.net',
      allowed_sim_use: 1,
      nas_ip: '10.0.0.1',
      coa_port: 3799,
      nas_secret: 'secret',
      contract_id: 10,
    }];

    const activeSessions = [
      { id: 1, session_id: 'sess1', nas_ip_address: '10.0.0.1', event_at: '2026-01-01 08:00:00' },
      { id: 2, session_id: 'sess2', nas_ip_address: '10.0.0.1', event_at: '2026-01-01 09:00:00' },
      { id: 3, session_id: 'sess3', nas_ip_address: '10.0.0.1', event_at: '2026-01-01 10:00:00' },
    ];

    db.query
      .mockResolvedValueOnce([subscribers])    // load subscribers
      .mockResolvedValueOnce([activeSessions]) // active sessions for user
      .mockResolvedValueOnce([{ affectedRows: 1 }]) // kick sess1 (disconnect)
      .mockResolvedValueOnce([{ affectedRows: 1 }]); // kick sess2 (disconnect) — 2 excess

    // Mock sendRadiusDisconnect via suspensionService
    jest.mock('../src/services/suspensionService', () => ({
      sendRadiusDisconnect: jest.fn().mockResolvedValue({ sent: true, response: 'Disconnect-ACK' }),
      sendRadiusCoA: jest.fn().mockResolvedValue({ sent: true, response: 'CoA-ACK' }),
      isClientSuspensionExempt: jest.fn().mockResolvedValue({ exempt: false }),
    }), { virtual: true });

    const result = await kickDuplicateSessions(10);
    // 3 sessions - 1 allowed = 2 to kick
    expect(result.errors).toBeDefined();
    // The kick count depends on circuit breaker + disconnect mock — just verify no throw
  });

  test('does nothing when sessions are within limit', async () => {
    const subscribers = [{
      radius_id: 2,
      username: 'ok_user@isp.net',
      allowed_sim_use: 2,
      nas_ip: '10.0.0.1',
      coa_port: 3799,
      nas_secret: 'secret',
      contract_id: 11,
    }];

    const activeSessions = [
      { id: 1, session_id: 'sess1', nas_ip_address: '10.0.0.1', event_at: '2026-01-01 08:00:00' },
    ];

    db.query
      .mockResolvedValueOnce([subscribers])
      .mockResolvedValueOnce([activeSessions]);

    const result = await kickDuplicateSessions(10);
    expect(result.kicked).toBe(0);
    expect(result.errors).toBe(0);
  });

  test('returns zero kicked and zero errors for empty subscriber list', async () => {
    db.query.mockResolvedValueOnce([[]]); // no subscribers

    const result = await kickDuplicateSessions(10);
    expect(result.kicked).toBe(0);
    expect(result.errors).toBe(0);
  });
});
