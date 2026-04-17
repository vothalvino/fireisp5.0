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
