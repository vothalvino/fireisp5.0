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
