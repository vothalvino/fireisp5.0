// =============================================================================
// FireISP 5.0 — Poller Engine Service Unit Tests (§6.4)
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

jest.mock('net-snmp', () => ({
  Version1: 0,
  Version2c: 1,
  createSession: jest.fn(),
  isVarbindError: jest.fn(),
}), { virtual: true });

jest.mock('../src/services/snmpPoller', () => ({
  pollDevice: jest.fn(),
  poll: jest.fn(),
}));

jest.mock('../src/services/deviceStatusService', () => ({
  recordPollResult: jest.fn(),
}));

const db = require('../src/config/database');
const { pollDevice } = require('../src/services/snmpPoller');
const deviceStatusService = require('../src/services/deviceStatusService');
const pollerEngine = require('../src/services/pollerEngine');

describe('pollerEngine', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  // =========================================================================
  // getPollingConfig
  // =========================================================================
  describe('getPollingConfig()', () => {
    test('returns device-specific override when one exists', async () => {
      const override = {
        id: 1,
        device_id: 42,
        poll_interval_sec: 60,
        bulk_get_enabled: 1,
        timeout_ms: 3000,
        retries: 2,
        adaptive_polling_enabled: 0,
        adaptive_min_interval_sec: 60,
        is_enabled: 1,
      };
      db.query.mockResolvedValueOnce([[override]]);

      const cfg = await pollerEngine.getPollingConfig(42);
      expect(cfg).toEqual(override);
      expect(db.query).toHaveBeenCalledTimes(1);
      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('device_polling_configs'),
        [42],
      );
    });

    test('falls through to device_type match when no device-specific override', async () => {
      const typeOverride = {
        id: 2,
        device_id: null,
        device_type: 'router',
        poll_interval_sec: 120,
        bulk_get_enabled: 1,
        timeout_ms: 5000,
        retries: 1,
        adaptive_polling_enabled: 0,
      };
      db.query
        .mockResolvedValueOnce([[]])                    // no device-specific
        .mockResolvedValueOnce([[{ type: 'router', snmp_profile_id: null }]])  // device row
        .mockResolvedValueOnce([[typeOverride]]);       // type match

      const cfg = await pollerEngine.getPollingConfig(99);
      expect(cfg).toEqual(typeOverride);
    });

    test('falls through to snmp_profile poll_interval_sec', async () => {
      db.query
        .mockResolvedValueOnce([[]])                   // no device-specific
        .mockResolvedValueOnce([[{ type: 'switch', snmp_profile_id: 5 }]]) // device row
        .mockResolvedValueOnce([[]])                   // no type match
        .mockResolvedValueOnce([[{ poll_interval_sec: 180 }]]); // profile

      const cfg = await pollerEngine.getPollingConfig(50);
      expect(cfg.poll_interval_sec).toBe(180);
    });

    test('returns default config when no overrides and no profile', async () => {
      db.query
        .mockResolvedValueOnce([[]])                   // no device-specific
        .mockResolvedValueOnce([[{ type: null, snmp_profile_id: null }]]) // device row
        .mockResolvedValueOnce([[]])                   // no type match (skipped because type is null)
        ;

      const cfg = await pollerEngine.getPollingConfig(1);
      expect(cfg.poll_interval_sec).toBe(300);
      expect(cfg.bulk_get_enabled).toBe(1);
    });

    test('returns default config when device not found', async () => {
      db.query
        .mockResolvedValueOnce([[]])   // no device-specific
        .mockResolvedValueOnce([[]]); // device not found

      const cfg = await pollerEngine.getPollingConfig(999);
      expect(cfg.poll_interval_sec).toBe(300);
    });
  });

  // =========================================================================
  // adaptivePollCheck
  // =========================================================================
  describe('adaptivePollCheck()', () => {
    test("queries outages by 'ongoing' — the real enum member — not 'active' (regression)", async () => {
      // outages.status is ENUM('ongoing','resolved','post_mortem'); the old
      // literal 'active' is not a member, so the query matched zero rows and
      // adaptive polling could never engage. Found live on the demo.
      db.query.mockResolvedValueOnce([[]]);
      await pollerEngine.adaptivePollCheck();
      const [sql] = db.query.mock.calls[0];
      expect(sql).toMatch(/FROM outages/);
      expect(sql).toMatch(/status = 'ongoing'/);
      expect(sql).not.toMatch(/status = 'active'/);
    });

    test('sets adaptive overrides for devices in active outages', async () => {
      db.query
        .mockResolvedValueOnce([[{ device_id: 10 }, { device_id: 20 }]]) // active outages
        .mockResolvedValueOnce([[
          { device_id: 10, adaptive_min_interval_sec: 30 },
          { device_id: 20, adaptive_min_interval_sec: 45 },
        ]]); // polling configs

      const result = await pollerEngine.adaptivePollCheck();
      expect(result.activeOutageDevices).toBe(2);
      expect(result.adaptiveOverridesActive).toBe(2);
    });

    test('returns zero counts when no active outages', async () => {
      db.query.mockResolvedValueOnce([[]]); // no active outages

      const result = await pollerEngine.adaptivePollCheck();
      expect(result.activeOutageDevices).toBe(0);
    });

    test('does not query polling configs when outage device list is empty', async () => {
      db.query.mockResolvedValueOnce([[]]); // no active outage devices

      await pollerEngine.adaptivePollCheck();
      expect(db.query).toHaveBeenCalledTimes(1);
    });
  });

  // =========================================================================
  // recordPerformanceSnapshot
  // =========================================================================
  // =========================================================================
  // pollWithConfig
  // =========================================================================
  describe('pollWithConfig()', () => {
    const dueDevice = {
      id: 1, ip_address: '10.0.0.1', snmp_community: 'public', snmp_version: '2c',
      snmp_port: 161, snmp_profile_id: 1, last_polled_at: null,
    };
    const freshDevice = {
      id: 2, ip_address: '10.0.0.2', snmp_community: 'public', snmp_version: '2c',
      snmp_port: 161, snmp_profile_id: 1, last_polled_at: new Date().toISOString(),
    };
    const cfgRow = {
      device_id: 1, poll_interval_sec: 300, bulk_get_enabled: 1, timeout_ms: 5000,
      retries: 1, adaptive_polling_enabled: 0, adaptive_min_interval_sec: 60,
    };

    test('selects SNMPv3 credential columns so v3 devices can actually poll (regression)', async () => {
      db.query.mockResolvedValueOnce([[]]); // no devices
      await pollerEngine.pollWithConfig();
      const [sql] = db.query.mock.calls[0];
      expect(sql).toContain('snmp_v3_security_name');
      expect(sql).toContain('snmp_v3_auth_key_encrypted');
      expect(sql).toContain('snmp_v3_priv_key_encrypted');
      expect(sql).toContain('snmp_v3_context_name');
    });

    test('skips devices not yet due and polls the due ones', async () => {
      pollDevice.mockResolvedValue({});
      deviceStatusService.recordPollResult.mockResolvedValue();
      db.query
        .mockResolvedValueOnce([[dueDevice, freshDevice]]) // device list
        .mockResolvedValueOnce([[cfgRow]]) // config for device 1
        .mockResolvedValueOnce([[{ ...cfgRow, device_id: 2 }]]); // config for device 2

      const result = await pollerEngine.pollWithConfig();
      expect(result).toEqual({ polled: 1, skipped: 1, errors: 0, total: 2 });
      expect(pollDevice).toHaveBeenCalledTimes(1);
      expect(pollDevice).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }));
      expect(deviceStatusService.recordPollResult).toHaveBeenCalledWith(1, true);
    });

    test('records a failure and keeps counting when a device poll rejects', async () => {
      pollDevice.mockRejectedValue(new Error('snmp timeout'));
      deviceStatusService.recordPollResult.mockResolvedValue();
      db.query
        .mockResolvedValueOnce([[dueDevice]])
        .mockResolvedValueOnce([[cfgRow]]);

      const result = await pollerEngine.pollWithConfig();
      expect(result).toEqual({ polled: 0, skipped: 0, errors: 1, total: 1 });
      expect(deviceStatusService.recordPollResult).toHaveBeenCalledWith(1, false, expect.stringContaining('snmp timeout'));
    });

    test('refuses to stack a second cycle while one is still in flight', async () => {
      deviceStatusService.recordPollResult.mockResolvedValue();
      let releasePoll;
      pollDevice.mockReturnValue(new Promise(resolve => { releasePoll = resolve; }));
      db.query
        .mockResolvedValueOnce([[dueDevice]])
        .mockResolvedValueOnce([[cfgRow]]);

      const first = pollerEngine.pollWithConfig();
      // Give the first cycle time to reach the in-flight poll
      await new Promise(resolve => setImmediate(resolve));
      const second = await pollerEngine.pollWithConfig();
      expect(second.overlap_skipped).toBe(true);

      releasePoll({});
      const result = await first;
      expect(result.polled).toBe(1);

      // And a fresh cycle runs again after the first completes
      db.query.mockResolvedValueOnce([[]]);
      const third = await pollerEngine.pollWithConfig();
      expect(third.overlap_skipped).toBeUndefined();
    });
  });

  describe('recordPerformanceSnapshot()', () => {
    test('inserts one row per active poller node', async () => {
      db.query
        .mockResolvedValueOnce([[
          { id: 1, current_queue_depth: 3, avg_poll_duration_ms: 250, total_polls_today: 100, failed_polls_today: 2 },
          { id: 2, current_queue_depth: 0, avg_poll_duration_ms: 180, total_polls_today: 50, failed_polls_today: 0 },
        ]]) // 2 active nodes
        .mockResolvedValueOnce([[{ devices_polled: 15, devices_failed: 1 }]]) // poll counts
        .mockResolvedValueOnce([{ affectedRows: 1 }]) // insert node 1
        .mockResolvedValueOnce([{ affectedRows: 1 }]); // insert node 2

      const result = await pollerEngine.recordPerformanceSnapshot();
      expect(result.snapshots).toBe(2);
      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO poller_performance_snapshots'),
        expect.any(Array),
      );
    });

    test('returns zero snapshots when no active nodes', async () => {
      db.query.mockResolvedValueOnce([[]]); // no active nodes

      const result = await pollerEngine.recordPerformanceSnapshot();
      expect(result.snapshots).toBe(0);
    });

    test('computes timeout rate against total polled (failed rows are already inside the COUNT)', async () => {
      db.query
        .mockResolvedValueOnce([[{ id: 1, current_queue_depth: 0, avg_poll_duration_ms: 100 }]])
        .mockResolvedValueOnce([[{ devices_polled: 10, devices_failed: 2 }]])
        .mockResolvedValueOnce([{ affectedRows: 1 }]);

      await pollerEngine.recordPerformanceSnapshot();
      const insertCall = db.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO poller_performance_snapshots'));
      // params: [node_id, devices_polled, devices_failed, avg_ms, queue_depth, timeout_rate_pct]
      expect(insertCall[1][1]).toBe(10);
      expect(insertCall[1][2]).toBe(2);
      expect(insertCall[1][5]).toBe(20); // 2/10, not 2/12
    });
  });

  // =========================================================================
  // getPerformanceDashboard
  // =========================================================================
  describe('getPerformanceDashboard()', () => {
    test('returns rows from query for a specific node', async () => {
      const rows = [
        { id: 1, poller_node_id: 5, node_name: 'Node-A', snapshot_at: '2026-06-11T00:00:00Z', devices_polled: 20, devices_failed: 0 },
        { id: 2, poller_node_id: 5, node_name: 'Node-A', snapshot_at: '2026-06-11T00:05:00Z', devices_polled: 22, devices_failed: 1 },
      ];
      db.query.mockResolvedValueOnce([rows]);

      const result = await pollerEngine.getPerformanceDashboard(5, 24);
      expect(result).toEqual(rows);
      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('poller_node_id = ?'),
        expect.arrayContaining([5]),
      );
    });

    test('returns rows across all nodes when nodeId is null', async () => {
      const rows = [{ id: 3, poller_node_id: 1, snapshot_at: '2026-06-11T00:00:00Z', devices_polled: 10, devices_failed: 0 }];
      db.query.mockResolvedValueOnce([rows]);

      const result = await pollerEngine.getPerformanceDashboard(null, 6);
      expect(result).toEqual(rows);
      // Should NOT filter by poller_node_id when null
      const call = db.query.mock.calls[0];
      expect(call[0]).not.toContain('poller_node_id = ?');
    });

    test('defaults to 24 hours for invalid hours argument', async () => {
      db.query.mockResolvedValueOnce([[]]);
      await pollerEngine.getPerformanceDashboard(null, 'invalid');
      const call = db.query.mock.calls[0];
      expect(call[1]).toContain(24);
    });
  });
});
