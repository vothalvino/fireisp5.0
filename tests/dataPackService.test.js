'use strict';

jest.mock('../src/config/database');
jest.mock('../src/services/rolloverService');
const db = require('../src/config/database');
const rolloverService = require('../src/services/rolloverService');
const dataPackService = require('../src/services/dataPackService');

describe('dataPackService', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('listPacks', () => {
    it('returns active packs for org and global', async () => {
      db.query.mockResolvedValueOnce([[{ id: 1, name: 'Basic 10GB', data_gb: '10.000' }]]);
      const packs = await dataPackService.listPacks(1);
      expect(packs).toHaveLength(1);
    });
  });

  describe('purchasePack', () => {
    it('creates a purchase for an active pack', async () => {
      db.query
        .mockResolvedValueOnce([[{ id: 1, name: '10GB Pack', data_gb: '10.000', validity_days: 30 }]])
        .mockResolvedValueOnce([{ insertId: 5 }])
        .mockResolvedValueOnce([[{ id: 5, gb_applied: '10.000', pack_name: '10GB Pack' }]]);

      const purchase = await dataPackService.purchasePack(1, 10, 1, { purchasedBy: 'admin' });
      expect(purchase.id).toBe(5);
    });

    it('throws 404 when pack not found', async () => {
      db.query.mockResolvedValueOnce([[]]); // empty pack result

      await expect(dataPackService.purchasePack(1, 10, 999, {}))
        .rejects.toMatchObject({ status: 404 });
    });
  });

  describe('getEffectiveAllowance', () => {
    it('sums base cap + packs + rollover', async () => {
      db.query
        .mockResolvedValueOnce([[{ id: 10, organization_id: 1, data_cap_gb: '100.000' }]])
        .mockResolvedValueOnce([[{ pack_gb: '20.000' }]]);
      rolloverService.getRolloverBalance.mockResolvedValueOnce({ total_available_gb: 5.5, history: [] });

      const allowance = await dataPackService.getEffectiveAllowance(10);
      expect(allowance.total_gb).toBeCloseTo(125.5, 1);
      expect(allowance.base_cap_gb).toBe(100);
      expect(allowance.pack_gb).toBe(20);
    });

    it('returns null for non-existent contract', async () => {
      db.query.mockResolvedValueOnce([[]]); // no contract

      const allowance = await dataPackService.getEffectiveAllowance(999);
      expect(allowance).toBeNull();
    });
  });

  describe('cancelPurchase', () => {
    it('cancels an active purchase', async () => {
      db.query
        .mockResolvedValueOnce([{ affectedRows: 1 }])
        .mockResolvedValueOnce([[{ id: 3, status: 'cancelled' }]]);

      const result = await dataPackService.cancelPurchase(3, 1);
      expect(result.status).toBe('cancelled');
    });
  });
});
