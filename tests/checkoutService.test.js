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

jest.mock('../src/services/paymentRetryService', () => ({
  scheduleRetry: jest.fn(),
}));

const db = require('../src/config/database');
const paymentGatewayService = require('../src/services/paymentGatewayService');
const paymentRetryService = require('../src/services/paymentRetryService');
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
          token_reference: 'tok_123', status: 'active',
          provider: 'stripe', organization_id: 1, gateway_id: 5,
        }]])
        .mockResolvedValueOnce([[{
          id: 50, invoice_number: 'INV-000050', total: '300.00',
          currency: 'MXN', client_id: 10, organization_id: 1, status: 'issued',
        }]]);
      // No third query: the `UPDATE recurring_payment_profiles SET last_charged_at`
      // that used to be here targeted a column that does not exist, so it threw on
      // every run — *after* the card was charged.

      paymentGatewayService.charge.mockResolvedValue({
        transaction_id: 200,
        status: 'succeeded',
      });

      const result = await checkoutService.chargeRecurringProfile(1);
      expect(result.charged).toBe(true);
      expect(result.invoice_id).toBe(50);
      expect(paymentGatewayService.charge).toHaveBeenCalled();
    });

    test('returns not charged (and skipped) when no pending invoices', async () => {
      db.query
        .mockResolvedValueOnce([[{
          id: 1, client_id: 10, payment_gateway_id: 5,
          token_reference: 'tok_123', status: 'active',
          provider: 'stripe', organization_id: 1, gateway_id: 5,
        }]])
        .mockResolvedValueOnce([[]]);  // no pending invoices

      const result = await checkoutService.chargeRecurringProfile(1);
      expect(result.charged).toBe(false);
      expect(result.skipped).toBe(true);
      expect(paymentGatewayService.charge).not.toHaveBeenCalled();
    });

    test('throws when profile not found', async () => {
      db.query.mockResolvedValueOnce([[]]);
      await expect(checkoutService.chargeRecurringProfile(999)).rejects.toThrow('Active recurring profile not found');
    });

    test('missing stored payment token: never calls the gateway, records a failed transaction, schedules a retry, and does not report charged', async () => {
      // recurring_payment_profiles has no `gateway_token` column — real column
      // is `token_reference`. A profile with no token must be a hard failure,
      // not a live API call to the gateway with an empty payment method.
      db.query
        .mockResolvedValueOnce([[{
          id: 1, client_id: 10, payment_gateway_id: 5,
          token_reference: null, status: 'active',
          provider: 'stripe', organization_id: 1, gateway_id: 5,
        }]])
        .mockResolvedValueOnce([[{
          id: 50, invoice_number: 'INV-000050', total: '300.00',
          currency: 'MXN', client_id: 10, organization_id: 1, status: 'issued',
        }]])
        .mockResolvedValueOnce([{ insertId: 777 }]);  // INSERT failed payment_transactions row

      paymentRetryService.scheduleRetry.mockResolvedValueOnce({ id: 1 });

      const result = await checkoutService.chargeRecurringProfile(1);

      expect(paymentGatewayService.charge).not.toHaveBeenCalled();
      expect(result.charged).toBe(false);
      expect(result.skipped).toBeFalsy();

      // The failed attempt was recorded directly (no live gateway call), and only
      // real payment_transactions columns were written.
      const insertCall = db.query.mock.calls.find(([sql]) => /INSERT INTO payment_transactions/i.test(sql));
      expect(insertCall).toBeDefined();
      expect(insertCall[0]).toMatch(/gateway_status/);
      expect(insertCall[0]).toMatch(/'failed'/);  // literal in the VALUES list, not a bound param
      expect(insertCall[1]).toContain(5);   // payment_gateway_id (profile.gateway_id)
      expect(insertCall[1]).toContain(10);  // client_id

      // A retry was scheduled against the transaction we just recorded.
      expect(paymentRetryService.scheduleRetry).toHaveBeenCalledWith(
        expect.objectContaining({
          transactionId: 777,
          recurringProfileId: 1,
          invoiceId: 50,
        }),
      );
    });

    test('blank (whitespace-only) token is treated the same as a missing one', async () => {
      db.query
        .mockResolvedValueOnce([[{
          id: 1, client_id: 10, payment_gateway_id: 5,
          token_reference: '   ', status: 'active',
          provider: 'stripe', organization_id: 1, gateway_id: 5,
        }]])
        .mockResolvedValueOnce([[{
          id: 50, invoice_number: 'INV-000050', total: '300.00',
          currency: 'MXN', client_id: 10, organization_id: 1, status: 'issued',
        }]])
        .mockResolvedValueOnce([{ insertId: 778 }]);

      const result = await checkoutService.chargeRecurringProfile(1);
      expect(paymentGatewayService.charge).not.toHaveBeenCalled();
      expect(result.charged).toBe(false);
    });

    test('a gateway "pending" status is NOT counted as charged, and schedules a retry', async () => {
      // e.g. a Stripe PaymentIntent still awaiting confirmation. Before this fix,
      // `charged: result.status !== 'failed'` reported ANY non-'failed' status —
      // including 'pending' — as a successful charge.
      db.query
        .mockResolvedValueOnce([[{
          id: 1, client_id: 10, payment_gateway_id: 5,
          token_reference: 'tok_123', status: 'active',
          provider: 'stripe', organization_id: 1, gateway_id: 5,
        }]])
        .mockResolvedValueOnce([[{
          id: 50, invoice_number: 'INV-000050', total: '300.00',
          currency: 'MXN', client_id: 10, organization_id: 1, status: 'issued',
        }]]);

      paymentGatewayService.charge.mockResolvedValueOnce({ transaction_id: 201, status: 'pending' });
      paymentRetryService.scheduleRetry.mockResolvedValueOnce({ id: 2 });

      const result = await checkoutService.chargeRecurringProfile(1);

      expect(result.charged).toBe(false);
      expect(paymentRetryService.scheduleRetry).toHaveBeenCalledWith(
        expect.objectContaining({ transactionId: 201, recurringProfileId: 1 }),
      );
    });
  });

  describe('processRecurringCharges()', () => {
    test('processes all active recurring profiles', async () => {
      db.query
        .mockResolvedValueOnce([[{ id: 1 }, { id: 2 }]])  // list profiles
        // chargeRecurringProfile(1)
        .mockResolvedValueOnce([[{ id: 1, client_id: 10, payment_gateway_id: 5, token_reference: 'tok_1', status: 'active', provider: 'stripe', organization_id: 1, gateway_id: 5 }]])
        .mockResolvedValueOnce([[{ id: 50, invoice_number: 'INV-050', total: '300.00', currency: 'MXN', client_id: 10, organization_id: 1, status: 'issued' }]])
        // chargeRecurringProfile(2)
        .mockResolvedValueOnce([[{ id: 2, client_id: 20, payment_gateway_id: 5, token_reference: 'tok_2', status: 'active', provider: 'stripe', organization_id: 1, gateway_id: 5 }]])
        .mockResolvedValueOnce([[]]);  // no invoices for profile 2

      paymentGatewayService.charge.mockResolvedValue({ transaction_id: 200, status: 'succeeded' });

      const result = await checkoutService.processRecurringCharges(1);
      expect(result.charged).toBe(1);
      expect(result.skipped).toBe(1);
      expect(result.total).toBe(2);
    });
  });
});
