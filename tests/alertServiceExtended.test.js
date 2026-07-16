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

  // ===========================================================================
  // Migration 400 — 'active' no longer bypasses the time-bound check. Before
  // this fix, `mw.status = 'active' OR (mw.status = 'scheduled' AND ...)` let
  // an 'active' window suppress alerts forever, regardless of ends_at, since
  // nothing ever transitioned it out of 'active' automatically.
  // ===========================================================================
  describe("activeMaintenanceWindowId — 'active' is time-bounded (migration 400)", () => {
    it("a status='active' window whose ends_at has already passed no longer suppresses", async () => {
      // The (mocked) DB stands in for what a real MySQL WHERE clause would
      // return: an 'active' window past its ends_at fails `ends_at >= NOW()`.
      db.query.mockResolvedValueOnce([[]]);
      const id = await alertService.activeMaintenanceWindowId(1, 5);
      expect(id).toBeNull();

      const [sql] = db.query.mock.calls[0];
      // The regression: 'active' must never bypass the time bound.
      expect(sql).not.toMatch(/status = 'active' OR/);
      expect(sql).toMatch(/mw\.status IN \('active', 'scheduled'\)/);
      expect(sql).toMatch(/mw\.starts_at <= NOW\(\) AND mw\.ends_at >= NOW\(\)/);
    });

    it("a status='active' window whose starts_at is still in the future does not suppress yet", async () => {
      db.query.mockResolvedValueOnce([[]]); // starts_at <= NOW() fails
      const id = await alertService.activeMaintenanceWindowId(1, 5);
      expect(id).toBeNull();
    });

    it("a status='active' window currently inside [starts_at, ends_at] still suppresses", async () => {
      db.query.mockResolvedValueOnce([[{ id: 9 }]]);
      const id = await alertService.activeMaintenanceWindowId(1, 5);
      expect(id).toBe(9);
    });
  });

  describe('expireMaintenanceWindows (migration 400 scheduled task)', () => {
    it('completes scheduled/active windows whose ends_at has passed, org-scoped when an organizationId is given', async () => {
      db.query.mockResolvedValueOnce([{ affectedRows: 3 }]);
      const result = await alertService.expireMaintenanceWindows(7);
      expect(result).toEqual({ expired: 3 });

      const [sql, params] = db.query.mock.calls[0];
      expect(sql).toMatch(/UPDATE maintenance_windows/);
      expect(sql).toMatch(/SET status = 'completed'/);
      expect(sql).toMatch(/status IN \('scheduled', 'active'\)/);
      expect(sql).toMatch(/ends_at < NOW\(\)/);
      expect(sql).toMatch(/AND organization_id = \?/);
      expect(params).toEqual([7]);
    });

    it('sweeps every organization when called with no organizationId (the seeded global task)', async () => {
      db.query.mockResolvedValueOnce([{ affectedRows: 0 }]);
      const result = await alertService.expireMaintenanceWindows();
      expect(result).toEqual({ expired: 0 });

      const [sql, params] = db.query.mock.calls[0];
      expect(sql).not.toMatch(/organization_id = \?/);
      expect(params).toEqual([]);
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
        .mockResolvedValueOnce([{ insertId: 10 }]) // insert result
        .mockResolvedValueOnce([[]]); // dedup check: no prior episode
      const result = await alertService.evaluateAlertsV2(1);
      expect(result.triggered).toBe(1);
    });
  });

  // ===========================================================================
  // Alert dedup — evaluateAlertsV2 (same gating as v1, see alertService.test.js)
  // ===========================================================================
  describe('evaluateAlertsV2 — alert dedup', () => {
    const eventBus = require('../src/services/eventBus');

    beforeEach(() => eventBus.removeAllListeners());
    afterEach(() => eventBus.removeAllListeners());

    it('skips the alert.triggered emit when a prior non-suppressed event exists within 60 minutes', async () => {
      const received = [];
      eventBus.on('alert.triggered', (data) => received.push(data));

      db.query
        .mockResolvedValueOnce([[{ id: 1, name: 'test', metric: 'cpu_usage', operator: '>', threshold: 80, device_id: 5, duration_minutes: 5, is_enabled: true, flap_detection_enabled: 0, auto_create_outage: false, auto_create_ticket: false, escalation_chain_id: null }]])
        .mockResolvedValueOnce([[{ device_id: 5, avg_value: '90', max_value: '95' }]])
        .mockResolvedValueOnce([[]])  // no maintenance window
        .mockResolvedValueOnce([[]])  // no correlation suppression
        .mockResolvedValueOnce([[{ flap_detection_enabled: 0 }]])  // no flapping
        .mockResolvedValueOnce([{ insertId: 11 }]) // insert result
        .mockResolvedValueOnce([[{ id: 5 }]]); // dedup check: a prior event exists

      const result = await alertService.evaluateAlertsV2(1);

      expect(result.triggered).toBe(1); // history/return value unaffected
      expect(received.length).toBe(0); // notification emit suppressed
    });

    it('emits alert.triggered normally when no prior episode exists', async () => {
      const received = [];
      eventBus.on('alert.triggered', (data) => received.push(data));

      db.query
        .mockResolvedValueOnce([[{ id: 1, name: 'test', metric: 'cpu_usage', operator: '>', threshold: 80, device_id: 5, duration_minutes: 5, is_enabled: true, flap_detection_enabled: 0, auto_create_outage: false, auto_create_ticket: false, escalation_chain_id: null }]])
        .mockResolvedValueOnce([[{ device_id: 5, avg_value: '90', max_value: '95' }]])
        .mockResolvedValueOnce([[]])  // no maintenance window
        .mockResolvedValueOnce([[]])  // no correlation suppression
        .mockResolvedValueOnce([[{ flap_detection_enabled: 0 }]])  // no flapping
        .mockResolvedValueOnce([{ insertId: 12 }]) // insert result
        .mockResolvedValueOnce([[]]); // dedup check: no prior episode

      const result = await alertService.evaluateAlertsV2(1);

      expect(result.triggered).toBe(1);
      expect(received.length).toBe(1);
      expect(received[0].organizationId).toBe(1);
    });
  });
});
