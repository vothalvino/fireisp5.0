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
const eventBus = require('../src/services/eventBus');

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
      db.query
        .mockResolvedValueOnce([[]]) // existing-open-ticket check: none found
        .mockResolvedValueOnce([{ insertId: 42 }]);

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
      db.query
        .mockResolvedValueOnce([[]]) // existing-open-ticket check: none found
        .mockResolvedValueOnce([{ insertId: 43 }]);

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

    test('skips creating a duplicate ticket when one is already open for the same rule', async () => {
      db.query.mockResolvedValueOnce([[{ id: 999 }]]); // existing open ticket found

      const rule = { id: 1, organization_id: 1, name: 'High Bandwidth', severity: 'critical' };
      const breach = { device_id: 5, metric: 'if_in_octets', operator: '>', threshold: 100000000, current_value: 120000000 };

      await alertService.autoCreateTicket(1, rule, breach);

      expect(db.query).toHaveBeenCalledTimes(1); // only the existence check — no INSERT
      expect(db.query.mock.calls.some(([sql]) => /INSERT INTO tickets/.test(sql))).toBe(false);
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

      // maintenance-window check
      db.query.mockResolvedValueOnce([[]]);

      // recordAlert INSERT
      db.query.mockResolvedValueOnce([{ insertId: 10 }]);

      // dedup check (hasRecentAlertEpisode) — no prior episode, emit proceeds
      db.query.mockResolvedValueOnce([[]]);

      // autoCreateTicket: existing-open-ticket check (none), then INSERT
      db.query.mockResolvedValueOnce([[]]);
      db.query.mockResolvedValueOnce([{ insertId: 42 }]);

      const result = await alertService.evaluateAlerts(1);
      expect(result.triggered).toBe(1);
      // rules + metric + maintenance-window check + alert insert + dedup
      // check + ticket-existence check + ticket insert
      expect(db.query).toHaveBeenCalledTimes(7);
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

      // maintenance-window check
      db.query.mockResolvedValueOnce([[]]);

      // recordAlert INSERT
      db.query.mockResolvedValueOnce([{ insertId: 1 }]);

      // dedup check (hasRecentAlertEpisode) — no prior episode, emit proceeds
      db.query.mockResolvedValueOnce([[]]);

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

  // =========================================================================
  // Alert dedup — one notification per breach "episode" (evaluateAlerts v1)
  // =========================================================================
  describe('evaluateAlerts() — alert dedup', () => {
    const rule = {
      id: 1, organization_id: 1, name: 'High CPU',
      metric: 'cpu_usage', operator: '>', threshold: 90,
      device_id: null, duration_minutes: 5, severity: 'critical',
      auto_create_outage: false, auto_create_ticket: false, is_enabled: true,
    };
    const metricRow = { device_id: 5, avg_value: 95.0, max_value: 99.0 };

    test('still writes the alert_events history row but skips the emit when a prior non-suppressed event exists within 60 minutes', async () => {
      db.query.mockResolvedValueOnce([[rule]]); // rules
      db.query.mockResolvedValueOnce([[metricRow]]); // checkRule
      db.query.mockResolvedValueOnce([[]]); // maintenance-window check: none
      db.query.mockResolvedValueOnce([{ insertId: 100 }]); // recordAlert INSERT (history — unconditional)
      db.query.mockResolvedValueOnce([[{ id: 99 }]]); // dedup check: a prior event exists

      const result = await alertService.evaluateAlerts(1);

      // History is still recorded and reflected in the return value...
      expect(result.triggered).toBe(1);
      const insert = db.query.mock.calls.find(([sql]) => /INSERT INTO alert_events/.test(sql));
      expect(insert).toBeDefined();
      // ...but the notification emit is suppressed.
      expect(eventBus.emit).not.toHaveBeenCalledWith('alert.triggered', expect.anything());
    });

    test('emits alert.triggered when no prior non-suppressed event exists in the last 60 minutes', async () => {
      db.query.mockResolvedValueOnce([[rule]]);
      db.query.mockResolvedValueOnce([[metricRow]]);
      db.query.mockResolvedValueOnce([[]]); // no maintenance window
      db.query.mockResolvedValueOnce([{ insertId: 101 }]); // recordAlert INSERT
      db.query.mockResolvedValueOnce([[]]); // dedup check: no prior episode

      const result = await alertService.evaluateAlerts(1);

      expect(result.triggered).toBe(1);
      expect(eventBus.emit).toHaveBeenCalledWith('alert.triggered', expect.objectContaining({
        organizationId: 1,
        rule,
      }));
    });
  });

  // =========================================================================
  // autoCreateOutage() per-tick duplication guard (review fix)
  // =========================================================================
  describe('autoCreateOutage() — per-tick duplication guard', () => {
    const rule = {
      id: 1, organization_id: 1, name: 'High CPU',
      metric: 'cpu_usage', operator: '>', threshold: 90,
      device_id: null, duration_minutes: 5, severity: 'critical',
      auto_create_outage: true, auto_create_ticket: false, is_enabled: true,
    };
    const metricRow = { device_id: 5, avg_value: 95.0, max_value: 99.0 };

    test('a sustained breach across 3 evaluation cycles inserts exactly 1 outage and emits outage.reported exactly once', async () => {
      let outageInserted = false;

      db.query.mockImplementation((sql) => {
        if (/FROM alert_rules/.test(sql)) return Promise.resolve([[rule]]);
        if (/FROM snmp_metrics/.test(sql)) return Promise.resolve([[metricRow]]);
        if (/FROM maintenance_windows/.test(sql)) return Promise.resolve([[]]);
        if (/INSERT INTO alert_events/.test(sql)) return Promise.resolve([{ insertId: Math.floor(Math.random() * 100000) }]);
        // hasRecentAlertEpisode's dedup check — kept "no prior episode" every
        // cycle so this test stays isolated to the outage guard, not the
        // separate alert.triggered dedup (covered elsewhere).
        if (/SELECT id FROM alert_events/.test(sql)) return Promise.resolve([[]]);
        if (/SELECT id FROM outages/.test(sql)) return Promise.resolve(outageInserted ? [[{ id: 500 }]] : [[]]);
        if (/INSERT INTO outages/.test(sql)) {
          outageInserted = true;
          return Promise.resolve([{ insertId: 500 }]);
        }
        return Promise.resolve([[]]);
      });

      await alertService.evaluateAlerts(1);
      await alertService.evaluateAlerts(1);
      await alertService.evaluateAlerts(1);

      const outageInserts = db.query.mock.calls.filter(([sql]) => /INSERT INTO outages/.test(sql));
      expect(outageInserts.length).toBe(1);

      const outageEmits = eventBus.emit.mock.calls.filter(([event]) => event === 'outage.reported');
      expect(outageEmits.length).toBe(1);
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
