// =============================================================================
// FireISP 5.0 — FreeRADIUS SQL Sync Tests (§3.1)
// =============================================================================
// Tests syncFreeradiusTables: verifies correct radcheck/radreply/radusergroup/
// radgroupreply rows are generated per auth_method and certificate state.
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

// radiusAttributeService is a pure function — no mock needed; use real impl.

const db = require('../src/config/database');
const { syncFreeradiusTables } = require('../src/services/radiusService');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function settingQueryReply(mode) {
  // Called for mab_password_mode setting (global settings table: setting_key/setting_value)
  return [[{ setting_value: mode }]];
}

function noSettingReply() {
  return [[]];
}

/**
 * Build a mock db.query that dispatches based on SQL keywords.
 * Call sequence for syncFreeradiusTables:
 *   1. settings query (mab_password_mode)
 *   2. subscriber list query
 *   3. subscriber_certificates query
 *   4. plan_access_windows query (Phase B)
 *   5. radius_account_routes query (Phase B)
 *   6. organization_walled_garden_settings query (Phase B)
 *   7. suspension_logs / walled usernames query (Phase B)
 *   8+ DELETE / INSERT per subscriber + plan
 */
function setupMockDb({ mabMode, subscribers, certs, planId, planVendor }) {
  const calls = [];
  db.query.mockImplementation((sql, params) => {
    calls.push({ sql, params });

    // 1. Settings
    if (sql.includes('mab_password_mode')) {
      return Promise.resolve(mabMode ? settingQueryReply(mabMode) : noSettingReply());
    }
    // 2. Subscribers
    if (sql.includes('FROM radius r') && sql.includes('LEFT JOIN contracts')) {
      return Promise.resolve([subscribers]);
    }
    // 3. Certificates
    if (sql.includes('FROM subscriber_certificates')) {
      return Promise.resolve([certs || []]);
    }
    // 4. Phase B: plan_access_windows
    if (sql.includes('FROM plan_access_windows')) {
      return Promise.resolve([[]]);
    }
    // 5. Phase B: radius_account_routes
    if (sql.includes('FROM radius_account_routes')) {
      return Promise.resolve([[]]);
    }
    // 6. Phase B: walled garden settings
    if (sql.includes('FROM organization_walled_garden_settings')) {
      return Promise.resolve([[]]);
    }
    // 7. Phase B: walled usernames (suspension_logs join)
    if (sql.includes('suspension_logs') && sql.includes('walled_garden')) {
      return Promise.resolve([[]]);
    }
    // 8. Phase B: pppoe_service_profiles
    if (sql.includes('FROM pppoe_service_profiles')) {
      return Promise.resolve([[]]);
    }
    // DELETE / INSERT — return success
    return Promise.resolve([{ affectedRows: 1 }]);
  });
  return calls;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => jest.clearAllMocks());

describe('syncFreeradiusTables — PPPoE subscriber', () => {
  const subscriber = {
    id: 1,
    username: 'user1@isp.net',
    cleartext_password: 's3cr3t',
    mac_address: null,
    auth_method: 'pppoe',
    organization_id: 10,
    plan_id: 5,
    download_speed_mbps: 20,
    upload_speed_mbps: 10,
    burst_download_mbps: null,
    burst_upload_mbps: null,
    radius_vendor: null,
    plan_name: 'Basic 20M',
  };

  test('inserts Cleartext-Password check row and radusergroup membership', async () => {
    const calls = setupMockDb({ subscribers: [subscriber] });

    await syncFreeradiusTables(10);

    // Find the radcheck INSERT
    const checkInsert = calls.find(
      c => c.sql.includes('INSERT INTO radcheck') && c.params[1] === 'Cleartext-Password',
    );
    expect(checkInsert).toBeDefined();
    expect(checkInsert.params[0]).toBe('user1@isp.net');
    expect(checkInsert.params[2]).toBe(':=');
    expect(checkInsert.params[3]).toBe('s3cr3t');

    // Find radusergroup INSERT
    const groupInsert = calls.find(c => c.sql.includes('INSERT INTO radusergroup'));
    expect(groupInsert).toBeDefined();
    expect(groupInsert.params[0]).toBe('user1@isp.net');
    expect(groupInsert.params[1]).toBe('plan_5');
  });

  test('inserts radgroupreply rows with WISPr generic attributes (no vendor)', async () => {
    const calls = setupMockDb({ subscribers: [subscriber] });

    await syncFreeradiusTables(10);

    // Find radgroupreply INSERTs
    const groupReplyInserts = calls.filter(c => c.sql.includes('INSERT INTO radgroupreply'));
    expect(groupReplyInserts.length).toBeGreaterThan(0);

    const groupNames = groupReplyInserts.map(c => c.params[0]);
    expect(groupNames.every(g => g === 'plan_5')).toBe(true);

    const attrs = groupReplyInserts.map(c => c.params[1]);
    // WISPr generic: WISPr-Bandwidth-Max-Down and WISPr-Bandwidth-Max-Up
    expect(attrs).toContain('WISPr-Bandwidth-Max-Down');
    expect(attrs).toContain('WISPr-Bandwidth-Max-Up');
  });

  test('returns synced count', async () => {
    setupMockDb({ subscribers: [subscriber] });
    const result = await syncFreeradiusTables(10);
    expect(result.synced).toBe(1);
    expect(result.errors).toBe(0);
    expect(result.plans_synced).toBe(1);
  });
});

describe('syncFreeradiusTables — MAB subscriber (auth_type_accept mode)', () => {
  const subscriber = {
    id: 2,
    username: 'aabbccddeeff',
    cleartext_password: 'ignored',
    mac_address: 'AA:BB:CC:DD:EE:FF',
    auth_method: 'mac',
    organization_id: 10,
    plan_id: 6,
    download_speed_mbps: 10,
    upload_speed_mbps: 5,
    burst_download_mbps: null,
    burst_upload_mbps: null,
    radius_vendor: null,
    plan_name: 'Basic 10M',
  };

  test('inserts Auth-Type := Accept for MAB (auth_type_accept mode)', async () => {
    const calls = setupMockDb({ subscribers: [subscriber], mabMode: 'auth_type_accept' });

    await syncFreeradiusTables(10);

    const checkInsert = calls.find(
      c => c.sql.includes('INSERT INTO radcheck') && c.params[1] === 'Auth-Type',
    );
    expect(checkInsert).toBeDefined();
    expect(checkInsert.params[2]).toBe(':=');
    expect(checkInsert.params[3]).toBe('Accept');
  });

  test('inserts Cleartext-Password = normalized MAC for cleartext mode', async () => {
    const calls = setupMockDb({ subscribers: [subscriber], mabMode: 'cleartext' });

    await syncFreeradiusTables(10);

    const checkInsert = calls.find(
      c => c.sql.includes('INSERT INTO radcheck') && c.params[1] === 'Cleartext-Password',
    );
    expect(checkInsert).toBeDefined();
    // Normalized MAC: aabbccddeeff
    expect(checkInsert.params[3]).toBe('aabbccddeeff');
  });

  test('errors out and skips subscriber when mac_address is missing in MAB mode', async () => {
    const badSub = { ...subscriber, mac_address: null };
    setupMockDb({ subscribers: [badSub] });

    const result = await syncFreeradiusTables(10);
    expect(result.errors).toBe(1);
    expect(result.synced).toBe(0);
  });
});

describe('syncFreeradiusTables — EAP-TLS subscriber with certificate', () => {
  const subscriber = {
    id: 3,
    username: 'client3@isp.net',
    cleartext_password: 'pass',
    mac_address: null,
    auth_method: 'eap_tls',
    organization_id: 10,
    plan_id: 7,
    download_speed_mbps: 100,
    upload_speed_mbps: 50,
    burst_download_mbps: null,
    burst_upload_mbps: null,
    radius_vendor: 'mikrotik',
    plan_name: 'Pro 100M',
  };

  const cert = { radius_account_id: 3, serial_number: '0ABCDEF1234567890' };

  test('inserts TLS-Cert-Serial check row when active certificate found', async () => {
    const calls = setupMockDb({ subscribers: [subscriber], certs: [cert] });

    await syncFreeradiusTables(10);

    const tlsRow = calls.find(
      c => c.sql.includes('INSERT INTO radcheck') && c.params && c.params[1] === 'TLS-Cert-Serial',
    );
    expect(tlsRow).toBeDefined();
    expect(tlsRow.params[0]).toBe('client3@isp.net');
    expect(tlsRow.params[2]).toBe('==');
    expect(tlsRow.params[3]).toBe('0ABCDEF1234567890');
  });

  test('inserts Cleartext-Password alongside TLS-Cert-Serial', async () => {
    const calls = setupMockDb({ subscribers: [subscriber], certs: [cert] });

    await syncFreeradiusTables(10);

    const passRow = calls.find(
      c => c.sql.includes('INSERT INTO radcheck') && c.params && c.params[1] === 'Cleartext-Password',
    );
    expect(passRow).toBeDefined();
    expect(passRow.params[0]).toBe('client3@isp.net');
  });

  test('inserts MikroTik rate-limit attribute for MikroTik vendor plan', async () => {
    const calls = setupMockDb({ subscribers: [subscriber], certs: [cert] });

    await syncFreeradiusTables(10);

    const mikrotikRow = calls.find(
      c => c.sql.includes('INSERT INTO radgroupreply') && c.params && c.params[1] === 'Mikrotik-Rate-Limit',
    );
    expect(mikrotikRow).toBeDefined();
    expect(mikrotikRow.params[0]).toBe('plan_7');
  });

  test('appends the plan priority as the 5th rate-limit field via the FreeRADIUS SQL backend', async () => {
    // Regression guard: syncFreeradiusTables must carry p.priority into the plan
    // object, or the new priority field only reaches the embedded RADIUS server.
    const prioritized = { ...subscriber, plan_priority: 2 };
    const calls = setupMockDb({ subscribers: [prioritized], certs: [] });

    await syncFreeradiusTables(10);

    const mikrotikRow = calls.find(
      c => c.sql.includes('INSERT INTO radgroupreply') && c.params && c.params[1] === 'Mikrotik-Rate-Limit',
    );
    expect(mikrotikRow).toBeDefined();
    // dl100/ul50, burst→2x, threshold→CIR, burst-time 8, priority 2
    expect(mikrotikRow.params[3]).toBe('100M/50M 200M/100M 100M/50M 8 2');
  });
});

describe('syncFreeradiusTables — Cisco vendor', () => {
  const subscriber = {
    id: 4,
    username: 'cisco_user@isp.net',
    cleartext_password: 'pass',
    mac_address: null,
    auth_method: 'pppoe',
    organization_id: 10,
    plan_id: 8,
    download_speed_mbps: 50,
    upload_speed_mbps: 25,
    burst_download_mbps: null,
    burst_upload_mbps: null,
    radius_vendor: 'cisco',
    plan_name: 'Cisco 50M',
  };

  test('inserts Cisco-AVPair rows (array attribute → multiple rows)', async () => {
    const calls = setupMockDb({ subscribers: [subscriber] });

    await syncFreeradiusTables(10);

    const ciscoRows = calls.filter(
      c => c.sql.includes('INSERT INTO radgroupreply') && c.params && c.params[1] === 'Cisco-AVPair',
    );
    // Cisco returns array of 2 AVPair values
    expect(ciscoRows.length).toBe(2);
  });
});

describe('syncFreeradiusTables — delete+rewrite is idempotent', () => {
  const subscriber = {
    id: 5,
    username: 'idempotent@isp.net',
    cleartext_password: 'pass',
    mac_address: null,
    auth_method: 'pppoe',
    organization_id: 10,
    plan_id: 9,
    download_speed_mbps: 30,
    upload_speed_mbps: 15,
    burst_download_mbps: null,
    burst_upload_mbps: null,
    radius_vendor: null,
    plan_name: 'Standard 30M',
  };

  test('executes DELETE before INSERT for radcheck', async () => {
    const calls = setupMockDb({ subscribers: [subscriber] });

    await syncFreeradiusTables(10);

    const deleteIdx = calls.findIndex(c => c.sql.includes('DELETE FROM radcheck'));
    const insertIdx = calls.findIndex(c => c.sql.includes('INSERT INTO radcheck'));
    expect(deleteIdx).toBeGreaterThan(-1);
    expect(insertIdx).toBeGreaterThan(deleteIdx);
  });
});
