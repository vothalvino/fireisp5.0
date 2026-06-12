'use strict';

jest.mock('../src/config/database');
const db = require('../src/config/database');
const fupNotificationService = require('../src/services/fupNotificationService');

describe('fupNotificationService', () => {
  beforeEach(() => jest.clearAllMocks());

  it('notifies at 80% threshold', async () => {
    db.query
      .mockResolvedValueOnce([[{
        id: 1, organization_id: 1, client_id: 5,
        data_cap_gb: '100.000', fup_threshold_gb: null,
      }]])
      // usage: 85% — triggers 80% threshold only
      .mockResolvedValueOnce([[{ used_gb: '85.000' }]])
      // dedup check for 80% — not found
      .mockResolvedValueOnce([[null]])
      // insert notification
      .mockResolvedValueOnce([{ insertId: 1 }])
      // dedup check for 90% — 85 < 90, loop exits
    ;

    const result = await fupNotificationService.checkAndNotifyThresholds(1);
    expect(result.notified).toBe(1);
    expect(result.checked).toBe(1);
  });

  it('deduplicates notifications already sent this month', async () => {
    db.query
      .mockResolvedValueOnce([[{
        id: 1, organization_id: 1, client_id: 5,
        data_cap_gb: '100.000', fup_threshold_gb: null,
      }]])
      .mockResolvedValueOnce([[{ used_gb: '85.000' }]])
      // dedup check for 80% — ALREADY exists
      .mockResolvedValueOnce([[{ id: 10 }]])
    ;

    const result = await fupNotificationService.checkAndNotifyThresholds(1);
    expect(result.notified).toBe(0);
  });

  it('returns zero when no contracts with caps', async () => {
    db.query.mockResolvedValueOnce([[]]); // no contracts
    const result = await fupNotificationService.checkAndNotifyThresholds(1);
    expect(result.checked).toBe(0);
    expect(result.notified).toBe(0);
  });

  describe('listNotifications', () => {
    it('returns notifications for an org', async () => {
      db.query.mockResolvedValueOnce([[
        { id: 1, contract_id: 5, billing_month: '2026-06-01', threshold_pct: 80 },
      ]]);
      const rows = await fupNotificationService.listNotifications(1);
      expect(rows).toHaveLength(1);
    });
  });
});
