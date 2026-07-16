'use strict';
const alertService = require('../src/services/alertService');
jest.mock('../src/config/database');
const db = require('../src/config/database');

describe('alertService extended', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('isInMaintenanceWindow', () => {
    it('returns true when window overlaps now', async () => {
      db.query.mockResolvedValueOnce([[{ id: 1 }]]);
      const result = await alertService.isInMaintenanceWindow(1, 5);
      expect(result).toBe(true);
    });
    it('returns false when no window found', async () => {
      db.query.mockResolvedValueOnce([[]]);
      const result = await alertService.isInMaintenanceWindow(1, 5);
      expect(result).toBe(false);
    });
  });

  describe('activeMaintenanceWindowId — site/device scoping', () => {
    it('joins the device row so a site-scoped window only matches devices at that site', async () => {
      db.query.mockResolvedValueOnce([[{ id: 3 }]]);
      const id = await alertService.activeMaintenanceWindowId(1, 5);
      expect(id).toBe(3);
      const [sql, params] = db.query.mock.calls[0];
      // site-scoped windows must be constrained to the device's site — the old
      // query treated any device_id-less window as org-wide
      expect(sql).toMatch(/mw\.site_id = d\.site_id/);
      expect(sql).toMatch(/mw\.device_id IS NULL AND mw\.site_id IS NULL/);
      expect(params).toEqual([5, 1, 5]);
    });
    it('returns null when nothing covers the device', async () => {
      db.query.mockResolvedValueOnce([[]]);
      expect(await alertService.activeMaintenanceWindowId(1, 5)).toBeNull();
    });
  });

  describe('maintenance suppression on the scheduled path (evaluateAlerts v1)', () => {
    it('suppresses a breach inside a window: records history, no triggered alert', async () => {
      db.query.mockImplementation((sql) => {
        if (/FROM alert_rules/.test(sql)) {
          return Promise.resolve([[{ id: 7, organization_id: 1, name: 'CPU high', metric: 'cpu_usage', operator: '>', threshold: 90, is_enabled: 1, duration_minutes: 5 }]]);
        }
        if (/FROM snmp_metrics/.test(sql)) {
          return Promise.resolve([[{ device_id: 5, avg_value: 99, max_value: 99 }]]);
        }
        if (/FROM maintenance_windows/.test(sql)) {
          return Promise.resolve([[{ id: 11 }]]);
        }
        return Promise.resolve([[]]);
      });

      const result = await alertService.evaluateAlerts(1);
      expect(result.suppressed).toBe(1);
      expect(result.triggered).toBe(0);

      // history row: resolved + suppressed + window id, never a live alarm
      const insert = db.query.mock.calls.find(([sql]) => /INSERT INTO alert_events/.test(sql));
      expect(insert).toBeDefined();
      expect(insert[0]).toMatch(/'resolved', 1/);
      expect(insert[0]).toMatch(/maintenance_window_id/);
      expect(insert[1]).toContain(11);
    });

    it('records the triggered alert normally when no window covers the device', async () => {
      db.query.mockImplementation((sql) => {
        if (/FROM alert_rules/.test(sql)) {
          return Promise.resolve([[{ id: 7, organization_id: 1, name: 'CPU high', metric: 'cpu_usage', operator: '>', threshold: 90, is_enabled: 1, duration_minutes: 5 }]]);
        }
        if (/FROM snmp_metrics/.test(sql)) {
          return Promise.resolve([[{ device_id: 5, avg_value: 99, max_value: 99 }]]);
        }
        if (/FROM maintenance_windows/.test(sql)) {
          return Promise.resolve([[]]);
        }
        return Promise.resolve([[]]);
      });

      const result = await alertService.evaluateAlerts(1);
      expect(result.triggered).toBe(1);
      expect(result.suppressed).toBe(0);
      const insert = db.query.mock.calls.find(([sql]) => /INSERT INTO alert_events/.test(sql));
      expect(insert[0]).toMatch(/'triggered'/);
    });
  });

  describe('isSuppressedByCorrelation', () => {
    it('returns true when upstream has triggered event', async () => {
      db.query.mockResolvedValueOnce([[{ id: 1 }]]);
      const result = await alertService.isSuppressedByCorrelation(1, 5);
      expect(result).toBe(true);
    });
    it('returns false when no suppression', async () => {
      db.query.mockResolvedValueOnce([[]]);
      const result = await alertService.isSuppressedByCorrelation(1, 5);
      expect(result).toBe(false);
    });
  });

  describe('checkFlapping', () => {
    it('returns true when enough state changes', async () => {
      db.query
        .mockResolvedValueOnce([[{ flap_detection_enabled: 1, flap_count_threshold: 3, flap_window_minutes: 15 }]])
        .mockResolvedValueOnce([[{ cnt: '5' }]]);
      const result = await alertService.checkFlapping(1);
      expect(result).toBe(true);
    });
    it('returns false when flap_detection_enabled is 0', async () => {
      db.query.mockResolvedValueOnce([[{ flap_detection_enabled: 0 }]]);
      const result = await alertService.checkFlapping(1);
      expect(result).toBe(false);
    });
  });

  describe('evaluateAlertsV2', () => {
    it('suppresses alert in maintenance window', async () => {
      db.query
        .mockResolvedValueOnce([[{ id: 1, name: 'test', metric: 'cpu_usage', operator: '>', threshold: 80, device_id: 5, duration_minutes: 5, is_enabled: true, flap_detection_enabled: 0, auto_create_outage: false, auto_create_ticket: false, escalation_chain_id: null }]])
        .mockResolvedValueOnce([[{ device_id: 5, avg_value: '90', max_value: '95' }]])
        .mockResolvedValueOnce([[{ id: 1 }]]); // maintenance window found
      const result = await alertService.evaluateAlertsV2(1);
      expect(result.suppressed).toBe(1);
      expect(result.triggered).toBe(0);
    });

    it('triggers alert normally when no suppression', async () => {
      db.query
        .mockResolvedValueOnce([[{ id: 1, name: 'test', metric: 'cpu_usage', operator: '>', threshold: 80, device_id: 5, duration_minutes: 5, is_enabled: true, flap_detection_enabled: 0, auto_create_outage: false, auto_create_ticket: false, escalation_chain_id: null }]])
        .mockResolvedValueOnce([[{ device_id: 5, avg_value: '90', max_value: '95' }]])
        .mockResolvedValueOnce([[]])  // no maintenance window
        .mockResolvedValueOnce([[]])  // no suppression
        .mockResolvedValueOnce([[{ flap_detection_enabled: 0 }]])  // no flapping
        .mockResolvedValueOnce([{ insertId: 10 }]); // insert result
      const result = await alertService.evaluateAlertsV2(1);
      expect(result.triggered).toBe(1);
    });
  });
});
