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

const db = require('../src/config/database');
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
