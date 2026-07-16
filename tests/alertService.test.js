// =============================================================================
// FireISP 5.0 — Alert Service Tests
// =============================================================================

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  execute: jest.fn(),
  getConnection: jest.fn(),
  close: jest.fn(),
  pool: { end: jest.fn() },
}));

jest.mock('../src/services/eventBus', () => ({
  on: jest.fn(),
  emit: jest.fn(),
  removeAllListeners: jest.fn(),
}));

const db = require('../src/config/database');
const alertService = require('../src/services/alertService');

describe('alertService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('checkRule()', () => {
    test('detects CPU usage threshold breach', async () => {
      db.query.mockResolvedValueOnce([[{
        device_id: 5,
        avg_value: 95.5,
        max_value: 99.0,
      }]]);

      const rule = {
        metric: 'cpu_usage',
        operator: '>',
        threshold: 90,
        device_id: null,
        duration_minutes: 5,
      };

      const result = await alertService.checkRule(rule);
      expect(result).not.toBeNull();
      expect(result.device_id).toBe(5);
      expect(result.current_value).toBe(95.5);
      expect(result.metric).toBe('cpu_usage');
    });

    test('returns null when no breach', async () => {
      db.query.mockResolvedValueOnce([[{
        device_id: 5,
        avg_value: 50.0,
        max_value: 60.0,
      }]]);

      const rule = {
        metric: 'cpu_usage',
        operator: '>',
        threshold: 90,
        device_id: null,
        duration_minutes: 5,
      };

      const result = await alertService.checkRule(rule);
      expect(result).toBeNull();
    });

    test('handles less-than operator', async () => {
      db.query.mockResolvedValueOnce([[{
        device_id: 3,
        avg_value: 80.0,
        max_value: 85.0,
      }]]);

      const rule = {
        metric: 'uptime',
        operator: '<',
        threshold: 95,
        device_id: null,
        duration_minutes: 5,
      };

      const result = await alertService.checkRule(rule);
      expect(result).not.toBeNull();
      expect(result.current_value).toBe(80.0);
    });

    test('returns null for unknown metric', async () => {
      const rule = { metric: 'unknown_metric', operator: '>', threshold: 50, duration_minutes: 5 };
      const result = await alertService.checkRule(rule);
      expect(result).toBeNull();
    });

    test('handles device-specific rule', async () => {
      db.query.mockResolvedValueOnce([[{
        device_id: 7,
        avg_value: 200.0,
        max_value: 250.0,
      }]]);

      const rule = {
        metric: 'latency_ms',
        operator: '>=',
        threshold: 150,
        device_id: 7,
        duration_minutes: 10,
      };

      const result = await alertService.checkRule(rule);
      expect(result).not.toBeNull();
      expect(result.device_id).toBe(7);
    });
  });

  describe('checkRule() — bandwidth metrics', () => {
    test('detects if_in_octets threshold breach', async () => {
      db.query.mockResolvedValueOnce([[{
        device_id: 10,
        avg_value: 120000000,
        max_value: 130000000,
      }]]);

      const rule = {
        metric: 'if_in_octets',
        operator: '>',
        threshold: 100000000,
        device_id: null,
        duration_minutes: 5,
      };

      const result = await alertService.checkRule(rule);
      expect(result).not.toBeNull();
      expect(result.device_id).toBe(10);
      expect(result.metric).toBe('if_in_octets');
      expect(result.current_value).toBe(120000000);
    });

    test('detects if_out_octets threshold breach on specific device', async () => {
      db.query.mockResolvedValueOnce([[{
        device_id: 11,
        avg_value: 95000000,
        max_value: 100000000,
      }]]);

      const rule = {
        metric: 'if_out_octets',
        operator: '>=',
        threshold: 90000000,
        device_id: 11,
        duration_minutes: 10,
      };

      const result = await alertService.checkRule(rule);
      expect(result).not.toBeNull();
      expect(result.device_id).toBe(11);
      expect(result.metric).toBe('if_out_octets');
    });

    test('returns null when bandwidth is below threshold', async () => {
      db.query.mockResolvedValueOnce([[{
        device_id: 12,
        avg_value: 50000000,
        max_value: 60000000,
      }]]);

      const rule = {
        metric: 'if_in_octets',
        operator: '>',
        threshold: 100000000,
        device_id: null,
        duration_minutes: 5,
      };

      const result = await alertService.checkRule(rule);
      expect(result).toBeNull();
    });
  });

  describe('autoCreateTicket()', () => {
    test('inserts a ticket for a breached rule', async () => {
      db.query.mockResolvedValueOnce([{ insertId: 42 }]);

      const rule = {
        id: 1,
        organization_id: 1,
        name: 'High Bandwidth',
        severity: 'critical',
      };
      const breach = {
        device_id: 5,
        metric: 'if_in_octets',
        operator: '>',
        threshold: 100000000,
        current_value: 120000000,
      };

      await alertService.autoCreateTicket(1, rule, breach);

      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO tickets'),
        expect.arrayContaining([1, expect.stringContaining('High Bandwidth'), expect.any(String), 'high']),
      );
    });

    test('uses medium priority for non-critical rules', async () => {
      db.query.mockResolvedValueOnce([{ insertId: 43 }]);

      const rule = { id: 2, organization_id: 1, name: 'Elevated Latency', severity: 'warning' };
      const breach = { device_id: 6, metric: 'latency_ms', operator: '>', threshold: 200, current_value: 250 };

      await alertService.autoCreateTicket(1, rule, breach);

      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO tickets'),
        expect.arrayContaining([1, expect.any(String), expect.any(String), 'medium']),
      );
    });

    test('does not throw when DB insert fails (best-effort)', async () => {
      db.query.mockRejectedValueOnce(new Error('DB error'));

      const rule = { id: 3, organization_id: 1, name: 'Test', severity: 'major' };
      const breach = { device_id: 7, metric: 'cpu_usage', operator: '>', threshold: 90, current_value: 95 };

      await expect(alertService.autoCreateTicket(1, rule, breach)).resolves.toBeUndefined();
    });
  });

  describe('evaluateAlerts() — auto_create_ticket', () => {
    test('creates ticket when auto_create_ticket is true and breach occurs', async () => {
      // list rules
      db.query.mockResolvedValueOnce([[{
        id: 1, organization_id: 1, name: 'Bandwidth Saturation',
        metric: 'if_in_octets', operator: '>', threshold: 100000000,
        device_id: 5, duration_minutes: 5, severity: 'critical',
        auto_create_outage: false, auto_create_ticket: true, is_enabled: true,
      }]]);

      // checkRule query
      db.query.mockResolvedValueOnce([[{
        device_id: 5, avg_value: 120000000, max_value: 130000000,
      }]]);

      // recordAlert INSERT
      db.query.mockResolvedValueOnce([{ insertId: 10 }]);

      // autoCreateTicket INSERT
      db.query.mockResolvedValueOnce([{ insertId: 42 }]);

      const result = await alertService.evaluateAlerts(1);
      expect(result.triggered).toBe(1);
      // Ticket insert should have been called (4th query total)
      expect(db.query).toHaveBeenCalledTimes(5); // rules + metric + maintenance-window check + alert insert + ticket insert
    });
  });


  describe('evaluateAlerts()', () => {
    test('evaluates rules and returns triggered alerts', async () => {
      // list rules
      db.query.mockResolvedValueOnce([[{
        id: 1, organization_id: 1, name: 'High CPU',
        metric: 'cpu_usage', operator: '>', threshold: 90,
        device_id: null, duration_minutes: 5, severity: 'critical',
        auto_create_outage: false, is_enabled: true,
      }]]);

      // checkRule query
      db.query.mockResolvedValueOnce([[{
        device_id: 5, avg_value: 95.0, max_value: 99.0,
      }]]);

      // recordAlert INSERT
      db.query.mockResolvedValueOnce([{ insertId: 1 }]);

      const result = await alertService.evaluateAlerts(1);
      expect(result.evaluated).toBe(1);
      expect(result.triggered).toBe(1);
      expect(result.alerts[0].metric).toBe('cpu_usage');
    });

    test('handles no rules', async () => {
      db.query.mockResolvedValueOnce([[]]);
      const result = await alertService.evaluateAlerts(1);
      expect(result.evaluated).toBe(0);
      expect(result.triggered).toBe(0);
    });
  });

  describe('getAlertHistory()', () => {
    test('returns paginated alert event history', async () => {
      db.query
        .mockResolvedValueOnce([[
          { id: 1, rule_name: 'High CPU', metric: 'cpu_usage', current_value: 95, status: 'triggered' },
          { id: 2, rule_name: 'Low Uptime', metric: 'uptime', current_value: 88, status: 'acknowledged' },
        ]])
        .mockResolvedValueOnce([[{ total: 2 }]]);

      const result = await alertService.getAlertHistory(1);
      expect(result.data).toHaveLength(2);
      expect(result.meta).toEqual({ total: 2, page: 1, limit: 50, totalPages: 1 });
    });
  });

  describe('acknowledgeAlert()', () => {
    test('updates alert status', async () => {
      db.query.mockResolvedValueOnce([{ affectedRows: 1 }]);
      await alertService.acknowledgeAlert(1, 5);
      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('acknowledged'),
        ['acknowledged', 5, 1],
      );
    });
  });
});
