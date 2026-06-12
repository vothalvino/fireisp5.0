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
