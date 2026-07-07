// =============================================================================
// FireISP 5.0 — Checkout Service Tests
// =============================================================================

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  execute: jest.fn(),
  getConnection: jest.fn(),
  close: jest.fn(),
  pool: { end: jest.fn() },
}));

jest.mock('../src/services/paymentGatewayService', () => ({
  charge: jest.fn(),
}));

const db = require('../src/config/database');
const paymentGatewayService = require('../src/services/paymentGatewayService');
const checkoutService = require('../src/services/checkoutService');

describe('checkoutService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('createCheckoutSession()', () => {
    test('creates a checkout session for an invoice', async () => {
      const invoice = {
        id: 1, invoice_number: 'INV-000001', total: '500.00',
        currency: 'MXN', status: 'issued', client_id: 10,
      };

      db.query
        .mockResolvedValueOnce([[invoice]])  // SELECT invoice
        .mockResolvedValueOnce([[{ id: 5 }]])  // SELECT payment gateway
        .mockResolvedValueOnce([{ insertId: 100 }]);  // INSERT transaction

      const result = await checkoutService.createCheckoutSession({
        organizationId: 1,
        invoiceId: 1,
      });

      expect(result.checkout_id).toBe(100);
      expect(result.token).toBeTruthy();
      expect(result.amount).toBe('500.00');
      expect(result.payment_url).toContain('/pay/');

      // The INSERT must use only real payment_transactions columns and supply
      // the NOT NULL payment_gateway_id + gateway_reference_id.
      const insertSql = db.query.mock.calls[2][0];
      const insertParams = db.query.mock.calls[2][1];
      expect(insertSql).not.toMatch(/description/);
      expect(insertSql).toMatch(/payment_gateway_id/);
      expect(insertSql).toMatch(/gateway_reference_id/);
      expect(insertParams).toContain(5); // resolved payment_gateway_id
    });

    test('throws a validation error when no active gateway is configured', async () => {
      const invoice = {
        id: 1, invoice_number: 'INV-000001', total: '500.00',
        currency: 'MXN', status: 'issued', client_id: 10,
      };

      db.query
        .mockResolvedValueOnce([[invoice]])  // SELECT invoice
        .mockResolvedValueOnce([[]]);  // SELECT payment gateway — none

      await expect(
        checkoutService.createCheckoutSession({ organizationId: 1, invoiceId: 1 }),
      ).rejects.toMatchObject({ statusCode: 422, code: 'VALIDATION_ERROR' });
    });

    test('throws when invoice not found', async () => {
      db.query.mockResolvedValueOnce([[]]);
      await expect(
        checkoutService.createCheckoutSession({ organizationId: 1, invoiceId: 999 }),
      ).rejects.toThrow('Invoice not found');
    });

    test('throws when invoice already paid', async () => {
      db.query.mockResolvedValueOnce([[{ id: 1, status: 'paid' }]]);
      await expect(
        checkoutService.createCheckoutSession({ organizationId: 1, invoiceId: 1 }),
      ).rejects.toThrow('Invoice already paid');
    });
  });

  describe('generatePaymentLink()', () => {
    test('generates payment link with client info', async () => {
      const invoice = {
        id: 1, invoice_number: 'INV-000001', total: '500.00',
        currency: 'MXN', status: 'issued', client_id: 10,
        name: 'John Doe', email: 'john@test.com',
      };

      db.query
        .mockResolvedValueOnce([[invoice]])  // generatePaymentLink SELECT
        .mockResolvedValueOnce([[invoice]])  // createCheckoutSession SELECT
        .mockResolvedValueOnce([[{ id: 5 }]])  // SELECT payment gateway
        .mockResolvedValueOnce([{ insertId: 100 }]);  // INSERT transaction

      const result = await checkoutService.generatePaymentLink({
        organizationId: 1,
        invoiceId: 1,
      });

      expect(result.client_name).toBe('John Doe');
      expect(result.client_email).toBe('john@test.com');
      expect(result.payment_url).toContain('/pay/');
    });
  });

  describe('chargeRecurringProfile()', () => {
    test('charges a recurring profile against pending invoice', async () => {
      db.query
        .mockResolvedValueOnce([[{
          id: 1, client_id: 10, payment_gateway_id: 5,
          gateway_token: 'tok_123', status: 'active',
          provider: 'stripe', organization_id: 1, gateway_id: 5,
        }]])
        .mockResolvedValueOnce([[{
          id: 50, invoice_number: 'INV-000050', total: '300.00',
          currency: 'MXN', client_id: 10, organization_id: 1, status: 'issued',
        }]])
        .mockResolvedValueOnce([{ affectedRows: 1 }]);  // UPDATE last_charged_at

      paymentGatewayService.charge.mockResolvedValue({
        transaction_id: 200,
        status: 'succeeded',
      });

      const result = await checkoutService.chargeRecurringProfile(1);
      expect(result.charged).toBe(true);
      expect(result.invoice_id).toBe(50);
      expect(paymentGatewayService.charge).toHaveBeenCalled();
    });

    test('returns not charged when no pending invoices', async () => {
      db.query
        .mockResolvedValueOnce([[{
          id: 1, client_id: 10, payment_gateway_id: 5,
          gateway_token: 'tok_123', status: 'active',
          provider: 'stripe', organization_id: 1, gateway_id: 5,
        }]])
        .mockResolvedValueOnce([[]]);  // no pending invoices

      const result = await checkoutService.chargeRecurringProfile(1);
      expect(result.charged).toBe(false);
    });

    test('throws when profile not found', async () => {
      db.query.mockResolvedValueOnce([[]]);
      await expect(checkoutService.chargeRecurringProfile(999)).rejects.toThrow('Active recurring profile not found');
    });
  });

  describe('processRecurringCharges()', () => {
    test('processes all active recurring profiles', async () => {
      db.query
        .mockResolvedValueOnce([[{ id: 1 }, { id: 2 }]])  // list profiles
        // chargeRecurringProfile(1)
        .mockResolvedValueOnce([[{ id: 1, client_id: 10, payment_gateway_id: 5, gateway_token: 'tok_1', status: 'active', provider: 'stripe', organization_id: 1, gateway_id: 5 }]])
        .mockResolvedValueOnce([[{ id: 50, invoice_number: 'INV-050', total: '300.00', currency: 'MXN', client_id: 10, organization_id: 1, status: 'issued' }]])
        .mockResolvedValueOnce([{ affectedRows: 1 }])
        // chargeRecurringProfile(2)
        .mockResolvedValueOnce([[{ id: 2, client_id: 20, payment_gateway_id: 5, gateway_token: 'tok_2', status: 'active', provider: 'stripe', organization_id: 1, gateway_id: 5 }]])
        .mockResolvedValueOnce([[]]);  // no invoices for profile 2

      paymentGatewayService.charge.mockResolvedValue({ transaction_id: 200, status: 'succeeded' });

      const result = await checkoutService.processRecurringCharges(1);
      expect(result.charged).toBe(1);
      expect(result.skipped).toBe(1);
      expect(result.total).toBe(2);
    });
  });
});
