// =============================================================================
// FireISP 5.0 — RADIUS Service Tests
// =============================================================================

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  execute: jest.fn(),
  getConnection: jest.fn(),
  close: jest.fn(),
  pool: { end: jest.fn() },
}));

jest.mock('../src/services/suspensionService', () => ({
  sendRadiusDisconnect: jest.fn(),
  sendRadiusCoA: jest.fn(),
}));

const db = require('../src/config/database');
const { sendRadiusDisconnect, sendRadiusCoA } = require('../src/services/suspensionService');
const radiusService = require('../src/services/radiusService');
const normalize = sql => String(sql).replace(/\s+/g, ' ').trim();

describe('radiusService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('syncAccount()', () => {
    test('syncs status when contract is active', async () => {
      db.query
        .mockResolvedValueOnce([[{
          contract_id: 1, contract_status: 'active',
          download_speed_mbps: 100, upload_speed_mbps: 50, plan_name: 'Premium',
          radius_id: 10, username: 'user1', radius_status: 'disabled',
        }]])
        .mockResolvedValueOnce([{ affectedRows: 1 }]);

      const result = await radiusService.syncAccount(1);
      expect(result.synced).toBe(true);
      expect(result.status).toBe('active');
      expect(db.query).toHaveBeenCalledWith(
        'UPDATE radius SET status = ? WHERE id = ?',
        ['active', 10],
      );
    });

    test('keeps a pending contract online only during its bounded test window', async () => {
      db.query.mockResolvedValueOnce([[{
        contract_id: 2, contract_status: 'pending',
        test_window_expires_at: new Date(Date.now() + 60_000).toISOString(),
        download_speed_mbps: 100, upload_speed_mbps: 50, plan_name: 'Premium',
        radius_id: 20, username: 'installer', radius_status: 'active',
      }]]);

      const result = await radiusService.syncAccount(2);
      expect(result.status).toBe('active');
      expect(db.query).toHaveBeenCalledTimes(1);
    });

    test('fails a pending contract closed once its test-window bound has passed', async () => {
      db.query
        .mockResolvedValueOnce([[{
          contract_id: 3, contract_status: 'pending',
          test_window_expires_at: new Date(Date.now() - 60_000).toISOString(),
          download_speed_mbps: 100, upload_speed_mbps: 50, plan_name: 'Premium',
          radius_id: 30, username: 'expired-installer', radius_status: 'active',
        }]])
        .mockResolvedValueOnce([{ affectedRows: 1 }]);

      const result = await radiusService.syncAccount(3);
      expect(result.status).toBe('inactive');
      expect(db.query).toHaveBeenCalledWith(
        'UPDATE radius SET status = ? WHERE id = ?',
        ['inactive', 30],
      );
    });

    test('returns not synced when contract not found', async () => {
      db.query.mockResolvedValueOnce([[]]);
      const result = await radiusService.syncAccount(999);
      expect(result.synced).toBe(false);
    });

    test('returns not synced when no RADIUS account', async () => {
      db.query.mockResolvedValueOnce([[{
        contract_id: 1, contract_status: 'active',
        radius_id: null, username: null,
      }]]);

      const result = await radiusService.syncAccount(1);
      expect(result.synced).toBe(false);
    });
  });

  describe('syncAllAccounts()', () => {
    test('syncs all accounts for an organization', async () => {
      db.query
        .mockResolvedValueOnce([[{ id: 1 }, { id: 2 }]])  // list contracts
        // syncAccount for contract 1
        .mockResolvedValueOnce([[{ contract_id: 1, contract_status: 'active', radius_id: 10, username: 'u1', radius_status: 'active', download_speed_mbps: 100, upload_speed_mbps: 50, plan_name: 'P1' }]])
        // syncAccount for contract 2
        .mockResolvedValueOnce([[{ contract_id: 2, contract_status: 'active', radius_id: 20, username: 'u2', radius_status: 'active', download_speed_mbps: 50, upload_speed_mbps: 25, plan_name: 'P2' }]]);

      const result = await radiusService.syncAllAccounts(1);
      expect(result.synced).toBe(2);
      expect(result.errors).toBe(0);
    });
  });

  describe('syncFreeradiusContract()', () => {
    const account = {
      radius_id: 10,
      username: 'install-10',
      password: 'temporary-secret',
      auth_method: 'pppoe',
      simultaneous_use: null,
      radius_ip: '192.0.2.10',
      radius_status: 'active',
      radius_deleted_at: null,
      contract_status: 'pending',
      connection_type: 'pppoe',
      radius_expiration: '10 Aug 2026 11:00:00',
      window_seconds_remaining: 3600,
      test_window_cleanup_pending: 0,
      contract_deleted_at: null,
      plan_id: null,
      may_authenticate: 1,
    };

    test('materializes immediately usable SQL credentials for an org-owned test window', async () => {
      const runner = { query: jest.fn() };
      runner.query.mockResolvedValueOnce([[account]]).mockResolvedValue([{ affectedRows: 1 }]);

      const result = await radiusService.syncFreeradiusContract(33, {
        organizationId: 42, enabled: true, runner,
      });

      expect(result).toEqual({ found: true, enabled: true, username: 'install-10' });
      expect(runner.query.mock.calls[0][0]).toMatch(/c\.organization_id = \? OR c\.organization_id IS NULL/);
      expect(runner.query).toHaveBeenCalledWith(
        'INSERT INTO radcheck (username, attribute, op, value) VALUES (?, ?, ?, ?)',
        ['install-10', 'Cleartext-Password', ':=', 'temporary-secret'],
      );
      expect(runner.query).toHaveBeenCalledWith(
        'INSERT INTO radreply (username, attribute, op, value) VALUES (?, ?, ?, ?)',
        ['install-10', 'Framed-IP-Address', ':=', '192.0.2.10'],
      );
      expect(runner.query).toHaveBeenCalledWith(
        'INSERT INTO radcheck (username, attribute, op, value) VALUES (?, ?, ?, ?)',
        ['install-10', 'Expiration', ':=', '10 Aug 2026 11:00:00'],
      );
      expect(runner.query).toHaveBeenCalledWith(
        'INSERT INTO radreply (username, attribute, op, value) VALUES (?, ?, ?, ?)',
        ['install-10', 'Session-Timeout', ':=', '3600'],
      );
    });

    test('does not attach a pending test account to a plan group that could weaken its bound', async () => {
      const runner = { query: jest.fn() };
      runner.query.mockResolvedValueOnce([[
        {
          ...account,
          plan_id: 5,
          download_speed_mbps: 100,
          upload_speed_mbps: 50,
          radius_vendor: 'mikrotik',
          priority: 4,
        },
      ]]).mockResolvedValue([{ affectedRows: 1 }]);

      await radiusService.syncFreeradiusContract(33, {
        organizationId: 42, enabled: true, runner,
      });

      expect(runner.query.mock.calls.some(([sql]) => /INSERT INTO radusergroup/.test(sql))).toBe(false);
      expect(runner.query).toHaveBeenCalledWith(
        'INSERT INTO radreply (username, attribute, op, value) VALUES (?, ?, ?, ?)',
        ['install-10', 'Session-Timeout', ':=', '3600'],
      );
      expect(runner.query.mock.calls.some(([, params]) =>
        params?.[1] === 'Mikrotik-Rate-Limit')).toBe(true);
    });

    test('removes every stale per-user SQL row even after contract/RADIUS deactivation', async () => {
      const runner = { query: jest.fn() };
      runner.query.mockResolvedValueOnce([[
        {
          ...account,
          radius_status: 'inactive',
          contract_status: 'cancelled',
          test_window_cleanup_pending: 1,
          may_authenticate: 0,
        },
      ]]).mockResolvedValue([{ affectedRows: 1 }]);

      const result = await radiusService.syncFreeradiusContract(33, {
        organizationId: 42, enabled: false, runner,
      });

      expect(result).toEqual({ found: true, enabled: false, username: 'install-10' });
      expect(runner.query).toHaveBeenCalledWith('DELETE FROM radcheck WHERE username = ?', ['install-10']);
      expect(runner.query).toHaveBeenCalledWith('DELETE FROM radreply WHERE username = ?', ['install-10']);
      expect(runner.query).toHaveBeenCalledWith('DELETE FROM radusergroup WHERE username = ?', ['install-10']);
      expect(runner.query.mock.calls.some(([sql]) => /^INSERT INTO rad/.test(sql))).toBe(false);
    });

    test('cleanup deletes SQL credentials for every legacy RADIUS row on the contract', async () => {
      const runner = { query: jest.fn() };
      runner.query.mockResolvedValueOnce([[
        { ...account, username: 'install-old', radius_status: 'inactive', may_authenticate: 0 },
        { ...account, radius_id: 11, username: 'install-new', radius_status: 'inactive', may_authenticate: 0 },
      ]]).mockResolvedValue([{ affectedRows: 1 }]);

      await radiusService.syncFreeradiusContract(33, {
        organizationId: 42, enabled: false, runner,
      });

      for (const username of ['install-old', 'install-new']) {
        expect(runner.query).toHaveBeenCalledWith('DELETE FROM radcheck WHERE username = ?', [username]);
        expect(runner.query).toHaveBeenCalledWith('DELETE FROM radreply WHERE username = ?', [username]);
        expect(runner.query).toHaveBeenCalledWith('DELETE FROM radusergroup WHERE username = ?', [username]);
      }
    });

    test('selects only live identities so archived usernames are never mutated', async () => {
      const runner = { query: jest.fn() };
      runner.query.mockResolvedValueOnce([[
        {
          ...account,
          radius_id: 11,
          username: 'current-contract-account',
          radius_status: 'inactive',
          may_authenticate: 0,
        },
      ]]).mockResolvedValue([{ affectedRows: 1 }]);

      await radiusService.syncFreeradiusContract(33, {
        organizationId: 42, enabled: false, runner,
      });

      expect(normalize(runner.query.mock.calls[0][0])).toMatch(
        /WHERE c\.id = \?.*AND r\.deleted_at IS NULL/,
      );
      expect(runner.query).not.toHaveBeenCalledWith(
        'DELETE FROM radcheck WHERE username = ?', ['archived-and-reused'],
      );
      expect(runner.query).toHaveBeenCalledWith(
        'DELETE FROM radcheck WHERE username = ?', ['current-contract-account'],
      );
    });
  });

  describe('getActiveSession()', () => {
    test('returns most recent active session', async () => {
      const session = { id: 1, session_id: 'sess123', event_type: 'start', event_at: '2026-03-15' };
      db.query.mockResolvedValueOnce([[session]]);

      const result = await radiusService.getActiveSession(1);
      expect(result).toEqual(session);
    });

    test('returns null when no active session', async () => {
      db.query.mockResolvedValueOnce([[]]);
      const result = await radiusService.getActiveSession(1);
      expect(result).toBeNull();
    });
  });

  describe('disconnectSession()', () => {
    test('delegates to suspensionService', async () => {
      sendRadiusDisconnect.mockResolvedValue({ sent: true, response: 'Disconnect-ACK' });
      const result = await radiusService.disconnectSession(1);
      expect(result.sent).toBe(true);
      // Second arg is the optional per-session targeting opts (none here).
      expect(sendRadiusDisconnect).toHaveBeenCalledWith(1, undefined);
    });
  });

  describe('changeOfAuth()', () => {
    test('delegates to suspensionService', async () => {
      sendRadiusCoA.mockResolvedValue({ sent: true, response: 'CoA-ACK' });
      const result = await radiusService.changeOfAuth(1, 'update');
      expect(result.sent).toBe(true);
      expect(sendRadiusCoA).toHaveBeenCalledWith(1, 'update', []);
    });
  });

  describe('getUsageSummary()', () => {
    test('returns aggregated usage data', async () => {
      db.query.mockResolvedValueOnce([[{
        session_count: 10,
        total_bytes_in: 10737418240,  // 10 GB
        total_bytes_out: 5368709120,   // 5 GB
        total_bytes: 16106127360,
        total_duration_seconds: 36000,
        total_packets_in: 1000000,
        total_packets_out: 500000,
      }]]);

      const result = await radiusService.getUsageSummary(1, { from: '2026-03-01', to: '2026-03-31' });
      expect(result.contract_id).toBe(1);
      expect(result.download_gb).toBe(10);
      expect(result.upload_gb).toBe(5);
      expect(result.sessions).toBe(10);
    });
  });
});
