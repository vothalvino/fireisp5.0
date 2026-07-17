'use strict';

jest.mock('../src/config/database');
const db = require('../src/config/database');
const rolloverService = require('../src/services/rolloverService');

describe('rolloverService', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('accrueRollover', () => {
    it('accrues rollover for contracts with unused capacity', async () => {
      db.query
        .mockResolvedValueOnce([[{ id: 1, organization_id: 1, data_cap_gb: '100.000' }]]) // contracts
        .mockResolvedValueOnce([[{ used_gb: '70.000' }]])                                  // usage
        .mockResolvedValueOnce([{ affectedRows: 1 }]);                                     // insert

      const result = await rolloverService.accrueRollover(1);
      expect(result.processed).toBe(1);
      expect(result.rolled_over_contracts).toBe(1);
    });

    it('does not accrue when usage exceeds cap', async () => {
      db.query
        .mockResolvedValueOnce([[{ id: 1, organization_id: 1, data_cap_gb: '100.000' }]])
        .mockResolvedValueOnce([[{ used_gb: '110.000' }]]);

      const result = await rolloverService.accrueRollover(1);
      expect(result.processed).toBe(1);
      expect(result.rolled_over_contracts).toBe(0);
    });

    it('returns empty results when no contracts have caps', async () => {
      db.query.mockResolvedValueOnce([[]]); // no contracts

      const result = await rolloverService.accrueRollover(1);
      expect(result.processed).toBe(0);
      expect(result.rolled_over_contracts).toBe(0);
    });

    it('measures usage over the PREVIOUS month and keys the balance to the current month', async () => {
      // Regression: the scheduled task fires at 00:00 on the 1st. Measuring
      // the just-started month reads ~0 usage and grants every capped
      // contract the maximum 25% rollover. The usage window must be the
      // completed previous month; the balance row stays keyed to the month
      // it is available in.
      jest.useFakeTimers();
      jest.setSystemTime(new Date(2026, 2, 1, 0, 0, 0)); // 2026-03-01 00:00 local
      try {
        db.query
          .mockResolvedValueOnce([[{ id: 7, organization_id: 1, data_cap_gb: '100.000' }]])
          .mockResolvedValueOnce([[{ used_gb: '90.000' }]])
          .mockResolvedValueOnce([{ affectedRows: 1 }]);

        await rolloverService.accrueRollover(1);

        const usageCall = db.query.mock.calls.find(([sql]) => sql.includes('FROM connection_logs'));
        expect(usageCall[1]).toEqual([7, '2026-02-01', '2026-02-28 23:59:59']);

        const insertCall = db.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO data_rollover_balances'));
        // (org, contract, billing_month, rollover_gb) — 10 GB unused, under the 25-GB cap ceiling
        expect(insertCall[1]).toEqual([1, 7, '2026-03-01', '10.000']);
      } finally {
        jest.useRealTimers();
      }
    });
  });

  describe('getRolloverBalance', () => {
    it('returns rollover balance rows', async () => {
      const mockDate = new Date('2026-06-01');
      db.query.mockResolvedValueOnce([[
        { billing_month: mockDate, rollover_gb: '25.000', consumed_rollover_gb: '5.000', available_gb: '20.000' },
      ]]);

      const result = await rolloverService.getRolloverBalance(1);
      expect(result.history).toHaveLength(1);
      expect(result.total_available_gb).toBeCloseTo(20, 2);
    });

    it('returns empty when no rollover exists', async () => {
      db.query.mockResolvedValueOnce([[]]);
      const result = await rolloverService.getRolloverBalance(999);
      expect(result.current_month).toBeNull();
      expect(result.total_available_gb).toBe(0);
    });
  });

  describe('consumeRollover', () => {
    it('consumes rollover up to available amount', async () => {
      db.query
        .mockResolvedValueOnce([[{ id: 1, rollover_gb: '25.000', consumed_rollover_gb: '5.000' }]])
        .mockResolvedValueOnce([{ affectedRows: 1 }]);

      const result = await rolloverService.consumeRollover(1, 10);
      expect(result.consumed).toBeCloseTo(10, 2);
      expect(result.remaining).toBeCloseTo(10, 2);
    });

    it('caps consumption at available amount', async () => {
      db.query
        .mockResolvedValueOnce([[{ id: 1, rollover_gb: '5.000', consumed_rollover_gb: '0.000' }]])
        .mockResolvedValueOnce([{ affectedRows: 1 }]);

      const result = await rolloverService.consumeRollover(1, 100);
      expect(result.consumed).toBeCloseTo(5, 2);
    });

    it('returns zeros when no rollover row exists', async () => {
      db.query.mockResolvedValueOnce([[]]); // no row

      const result = await rolloverService.consumeRollover(1, 10);
      expect(result.consumed).toBe(0);
      expect(result.remaining).toBe(0);
    });
  });
});
