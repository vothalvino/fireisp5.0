// =============================================================================
// FireISP 5.0 — PPPoE Service Profile Sync Tests (Phase B §4)
// =============================================================================
// Tests the extensions to syncFreeradiusTables that inject PPPoE service
// profile attributes (Framed-MTU, MS-Primary-DNS-Server, Session-Timeout,
// Mikrotik-Rate-Limit, etc.) into FreeRADIUS radreply rows.
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
// Mock DB dispatcher (extends radiusFreeradiusSync.test.js pattern)
// ---------------------------------------------------------------------------

/**
 * Build a mock db.query that dispatches based on SQL keywords.
 * Extended call sequence for Phase B (after Phase A steps):
 *   1.  settings (mab_password_mode)
 *   2.  subscribers (FROM radius r LEFT JOIN … LEFT JOIN ip_pools)
 *   3.  subscriber_certificates
 *   4.  plan_access_windows
 *   5.  radius_account_routes
 *   6.  organization_walled_garden_settings
 *   7.  suspension_logs walled_garden check
 *   8.  pppoe_service_profiles (Phase B)
 *   9+  DELETE / INSERT per subscriber + plan
 */
function setupMockDb({ subscribers, profiles = [], walledUsernames = [] }) {
  const calls = [];
  db.query.mockImplementation((sql, params) => {
    calls.push({ sql, params });

    // 1. Settings
    if (sql.includes('mab_password_mode')) {
      return Promise.resolve([[]]);
    }
    // 2. Subscribers (Phase B adds LEFT JOIN ip_pools)
    if (sql.includes('FROM radius r') && sql.includes('LEFT JOIN contracts')) {
      return Promise.resolve([subscribers]);
    }
    // 3. Certificates
    if (sql.includes('FROM subscriber_certificates')) {
      return Promise.resolve([[]]);
    }
    // 4. plan_access_windows
    if (sql.includes('FROM plan_access_windows')) {
      return Promise.resolve([[]]);
    }
    // 5. radius_account_routes
    if (sql.includes('FROM radius_account_routes')) {
      return Promise.resolve([[]]);
    }
    // 6. walled garden settings
    if (sql.includes('FROM organization_walled_garden_settings')) {
      return Promise.resolve([[]]);
    }
    // 7. walled usernames
    // The walled-garden lookup no longer keys off a bogus action='walled_garden'
    // (not an ENUM value) — it matches action='suspended' + a 'walled_garden:'
    // reason prefix, in which the underscore is LIKE-escaped ('walled\\_garden:%').
    if (sql.includes('suspension_logs') && sql.includes('walled')) {
      return Promise.resolve([walledUsernames.map(u => ({ username: u }))]);
    }
    // 8. PPPoE service profiles (Phase B)
    if (sql.includes('FROM pppoe_service_profiles') && !sql.includes('WHERE id IN')) {
      return Promise.resolve([profiles]);
    }
    // DELETE / INSERT — return success
    return Promise.resolve([{ affectedRows: 1 }]);
  });
  return calls;
}

// Base subscriber with a service profile at the account level
function makeSubscriber(overrides = {}) {
  return {
    id: 1,
    username: 'user1@isp.net',
    cleartext_password: 's3cr3t',
    mac_address: null,
    auth_method: 'pppoe',
    organization_id: 10,
    account_profile_id: null,
    pool_profile_id: null,
    ipv4_pool_id: null,
    plan_id: 5,
    download_speed_mbps: 20,
    upload_speed_mbps: 10,
    burst_download_mbps: null,
    burst_upload_mbps: null,
    radius_vendor: null,
    plan_name: 'Basic 20M',
    session_timeout_seconds: null,
    idle_timeout_seconds: null,
    account_sim_use: null,
    plan_sim_use: 1,
    vlan_id: null,
    inner_vlan_id: null,
    ...overrides,
  };
}

const baseProfile = {
  id: 10,
  organization_id: 10,
  name: 'Standard PPPoE',
  mtu: 1492,
  mru: 1492,
  dns_primary: '8.8.8.8',
  dns_secondary: '8.8.4.4',
  session_timeout_seconds: null,
  idle_timeout_seconds: null,
  rate_limit_override: null,
  address_list: null,
  filter_id: null,
  status: 'active',
  deleted_at: null,
};

beforeEach(() => jest.clearAllMocks());

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('syncFreeradiusTables — PPPoE profile attribute injection', () => {
  test('emits Framed-MTU when account-level profile has mtu set', async () => {
    const sub = makeSubscriber({ account_profile_id: 10 });
    const profile = { ...baseProfile, mtu: 1480 };
    const calls = setupMockDb({ subscribers: [sub], profiles: [profile] });

    await syncFreeradiusTables(10);

    const mtuRow = calls.find(
      c => c.sql.includes('INSERT INTO radreply') && c.params && c.params[1] === 'Framed-MTU',
    );
    expect(mtuRow).toBeDefined();
    expect(mtuRow.params[0]).toBe('user1@isp.net');
    expect(mtuRow.params[3]).toBe('1480');
  });

  test('emits MS-Primary-DNS-Server and MS-Secondary-DNS-Server when dns set in profile', async () => {
    const sub = makeSubscriber({ account_profile_id: 10 });
    const profile = { ...baseProfile, dns_primary: '1.1.1.1', dns_secondary: '1.0.0.1' };
    const calls = setupMockDb({ subscribers: [sub], profiles: [profile] });

    await syncFreeradiusTables(10);

    const dnsRow = calls.find(
      c => c.sql.includes('INSERT INTO radreply') && c.params && c.params[1] === 'MS-Primary-DNS-Server',
    );
    expect(dnsRow).toBeDefined();
    expect(dnsRow.params[3]).toBe('1.1.1.1');

    const dns2Row = calls.find(
      c => c.sql.includes('INSERT INTO radreply') && c.params && c.params[1] === 'MS-Secondary-DNS-Server',
    );
    expect(dns2Row).toBeDefined();
    expect(dns2Row.params[3]).toBe('1.0.0.1');
  });

  test('account-level service_profile_id overrides pool-level service_profile_id', async () => {
    // account_profile_id = 10 (mtu 1480), pool_profile_id = 11 (mtu 1500)
    // Should use profile 10 (account wins)
    const sub = makeSubscriber({ account_profile_id: 10, pool_profile_id: 11 });
    const profileAccount = { ...baseProfile, id: 10, mtu: 1480 };
    const profilePool = { ...baseProfile, id: 11, mtu: 1500 };
    const calls = setupMockDb({ subscribers: [sub], profiles: [profileAccount, profilePool] });

    await syncFreeradiusTables(10);

    const mtuRows = calls.filter(
      c => c.sql.includes('INSERT INTO radreply') && c.params && c.params[1] === 'Framed-MTU',
    );
    expect(mtuRows).toHaveLength(1);
    // Should be 1480 (account profile), not 1500 (pool profile)
    expect(mtuRows[0].params[3]).toBe('1480');
  });

  test('pool-level profile used when no account-level profile set', async () => {
    const sub = makeSubscriber({ account_profile_id: null, pool_profile_id: 11 });
    const profile = { ...baseProfile, id: 11, mtu: 1500 };
    const calls = setupMockDb({ subscribers: [sub], profiles: [profile] });

    await syncFreeradiusTables(10);

    const mtuRow = calls.find(
      c => c.sql.includes('INSERT INTO radreply') && c.params && c.params[1] === 'Framed-MTU',
    );
    expect(mtuRow).toBeDefined();
    expect(mtuRow.params[3]).toBe('1500');
  });

  test('emits Mikrotik-Rate-Limit when profile has rate_limit_override', async () => {
    const sub = makeSubscriber({ account_profile_id: 10 });
    const profile = { ...baseProfile, rate_limit_override: '20M/10M' };
    const calls = setupMockDb({ subscribers: [sub], profiles: [profile] });

    await syncFreeradiusTables(10);

    const rateLimitRow = calls.find(
      c => c.sql.includes('INSERT INTO radreply') && c.params && c.params[1] === 'Mikrotik-Rate-Limit',
    );
    expect(rateLimitRow).toBeDefined();
    expect(rateLimitRow.params[3]).toBe('20M/10M');
  });

  test('emits Session-Timeout from profile per-user when profile sets it', async () => {
    const sub = makeSubscriber({ account_profile_id: 10 });
    const profile = { ...baseProfile, session_timeout_seconds: 3600 };
    const calls = setupMockDb({ subscribers: [sub], profiles: [profile] });

    await syncFreeradiusTables(10);

    const timeoutRow = calls.find(
      c => c.sql.includes('INSERT INTO radreply') && c.params && c.params[1] === 'Session-Timeout',
    );
    expect(timeoutRow).toBeDefined();
    expect(timeoutRow.params[3]).toBe('3600');
    // Should be in radreply (per-user), not radgroupreply
    expect(timeoutRow.sql).toContain('radreply');
  });

  test('emits Idle-Timeout from profile per-user when profile sets it', async () => {
    const sub = makeSubscriber({ account_profile_id: 10 });
    const profile = { ...baseProfile, idle_timeout_seconds: 300 };
    const calls = setupMockDb({ subscribers: [sub], profiles: [profile] });

    await syncFreeradiusTables(10);

    const idleRow = calls.find(
      c => c.sql.includes('INSERT INTO radreply') && c.params && c.params[1] === 'Idle-Timeout',
    );
    expect(idleRow).toBeDefined();
    expect(idleRow.params[3]).toBe('300');
  });

  test('does not emit profile attributes when no profile is assigned', async () => {
    const sub = makeSubscriber({ account_profile_id: null, pool_profile_id: null });
    const calls = setupMockDb({ subscribers: [sub], profiles: [baseProfile] });

    await syncFreeradiusTables(10);

    const mtuRow = calls.find(
      c => c.sql.includes('INSERT INTO radreply') && c.params && c.params[1] === 'Framed-MTU',
    );
    expect(mtuRow).toBeUndefined();
  });

  test('does not overwrite walled garden address-list with profile address-list', async () => {
    const sub = makeSubscriber({ account_profile_id: 10, username: 'walled@isp.net' });
    const profile = { ...baseProfile, address_list: 'premium' };
    const calls = setupMockDb({
      subscribers: [sub],
      profiles: [profile],
      walledUsernames: ['walled@isp.net'],
    });

    await syncFreeradiusTables(10);

    const addressListRows = calls.filter(
      c => c.sql.includes('INSERT INTO radreply') && c.params && c.params[1] === 'Mikrotik-Address-List',
    );
    // Should only have the walled_garden address list, not the profile one
    expect(addressListRows).toHaveLength(1);
    // Value should be 'walled_garden' (the default from the mock setup)
    expect(addressListRows[0].params[3]).toBe('walled_garden');
  });

  test('emits Filter-Id when profile has filter_id set', async () => {
    const sub = makeSubscriber({ account_profile_id: 10 });
    const profile = { ...baseProfile, filter_id: 'POLICY_PREMIUM' };
    const calls = setupMockDb({ subscribers: [sub], profiles: [profile] });

    await syncFreeradiusTables(10);

    const filterRow = calls.find(
      c => c.sql.includes('INSERT INTO radreply') && c.params && c.params[1] === 'Filter-Id',
    );
    expect(filterRow).toBeDefined();
    expect(filterRow.params[3]).toBe('POLICY_PREMIUM');
  });
});
