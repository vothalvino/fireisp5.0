// =============================================================================
// FireISP 5.0 — Payment Gateway Service Unit Tests
// =============================================================================

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
}));

const db = require('../src/config/database');
const paymentGatewayService = require('../src/services/paymentGatewayService');

describe('paymentGatewayService', () => {
  beforeEach(() => jest.clearAllMocks());

  // =========================================================================
  // getActiveGateway
  // =========================================================================
  describe('getActiveGateway()', () => {
    test('returns active gateway for organization', async () => {
      const gw = { id: 1, provider: 'stripe', status: 'active' };
      db.query.mockResolvedValueOnce([[gw]]);

      const result = await paymentGatewayService.getActiveGateway(42);
      expect(result).toEqual(gw);
    });

    test('returns null when no gateway configured', async () => {
      db.query.mockResolvedValueOnce([[]]);
      const result = await paymentGatewayService.getActiveGateway(42);
      expect(result).toBeNull();
    });
  });

  // =========================================================================
  // charge
  // =========================================================================
  describe('charge()', () => {
    test('creates transaction and returns success', async () => {
      const gw = { id: 1, provider: 'manual', status: 'active' };
      db.query
        .mockResolvedValueOnce([[gw]])           // getActiveGateway
        .mockResolvedValueOnce([{ insertId: 100 }])  // INSERT transaction
        .mockResolvedValueOnce([{ affectedRows: 1 }]);  // UPDATE succeeded

      const result = await paymentGatewayService.charge({
        organizationId: 42, clientId: 10, amount: 500, currency: 'MXN',
        description: 'Invoice #1', paymentMethodToken: 'tok_123',
      });

      expect(result.status).toBe('succeeded');
      expect(result.transaction_id).toBe(100);
      expect(result.provider).toBe('manual');
    });

    test('throws when no active gateway', async () => {
      db.query.mockResolvedValueOnce([[]]);

      await expect(
        paymentGatewayService.charge({
          organizationId: 99, clientId: 1, amount: 100,
        }),
      ).rejects.toThrow('No active payment gateway configured');
    });

    test('uses MXN as default currency', async () => {
      const gw = { id: 1, provider: 'manual', status: 'active' };
      db.query
        .mockResolvedValueOnce([[gw]])
        .mockResolvedValueOnce([{ insertId: 101 }])
        .mockResolvedValueOnce([{ affectedRows: 1 }]);

      await paymentGatewayService.charge({
        organizationId: 42, clientId: 10, amount: 200, description: 'Test',
      });

      const insertCall = db.query.mock.calls[1];
      expect(insertCall[1]).toContain('MXN');
    });
  });

  // =========================================================================
  // refund
  // =========================================================================
  describe('refund()', () => {
    test('refunds a succeeded transaction', async () => {
      const tx = { id: 50, gateway_status: 'succeeded' };
      db.query
        .mockResolvedValueOnce([[tx]])
        .mockResolvedValueOnce([{ affectedRows: 1 }]);

      const result = await paymentGatewayService.refund(50);
      expect(result).toEqual({ transaction_id: 50, status: 'refunded' });
    });

    test('throws when transaction not found', async () => {
      db.query.mockResolvedValueOnce([[]]);
      await expect(paymentGatewayService.refund(999)).rejects.toThrow('Transaction not found');
    });

    test('throws when transaction is not succeeded', async () => {
      const tx = { id: 51, gateway_status: 'failed' };
      db.query.mockResolvedValueOnce([[tx]]);
      await expect(paymentGatewayService.refund(51)).rejects.toThrow('Can only refund succeeded transactions');
    });
  });

  // =========================================================================
  // getClientTransactions
  // =========================================================================
  describe('getClientTransactions()', () => {
    test('returns transaction history', async () => {
      const txs = [{ id: 1 }, { id: 2 }];
      db.query.mockResolvedValueOnce([txs]);

      const result = await paymentGatewayService.getClientTransactions(10, 42);
      expect(result).toEqual(txs);
    });
  });
});
