// =============================================================================
// FireISP 5.0 — Payment Gateway Service Unit Tests
// =============================================================================

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  execute: jest.fn(),
  getConnection: jest.fn(),
}));

const crypto = require('crypto');
const db = require('../src/config/database');
const paymentGatewayService = require('../src/services/paymentGatewayService');

describe('paymentGatewayService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    paymentGatewayService.paymentCircuitBreaker.reset();
  });

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

    test('queries with correct organization_id parameter', async () => {
      db.query.mockResolvedValueOnce([[]]);
      await paymentGatewayService.getActiveGateway(99);
      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('organization_id = ?'),
        [99],
      );
    });
  });

  // =========================================================================
  // Idempotency
  // =========================================================================
  describe('checkIdempotencyKey()', () => {
    test('returns cached response when key exists', async () => {
      const cached = { idempotency_key: 'key-1', status: 'completed', response_body: '{"tx": 1}' };
      db.query.mockResolvedValueOnce([[cached]]);

      const result = await paymentGatewayService.checkIdempotencyKey(42, 'key-1');
      expect(result).toEqual(cached);
    });

    test('returns null when key not found', async () => {
      db.query.mockResolvedValueOnce([[]]);
      const result = await paymentGatewayService.checkIdempotencyKey(42, 'unknown-key');
      expect(result).toBeNull();
    });

    test('queries with correct parameters', async () => {
      db.query.mockResolvedValueOnce([[]]);
      await paymentGatewayService.checkIdempotencyKey(42, 'my-key');
      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('idempotency_key = ?'),
        [42, 'my-key'],
      );
    });
  });

  describe('storeIdempotencyKey()', () => {
    test('stores idempotency key with response', async () => {
      db.query.mockResolvedValueOnce([{ affectedRows: 1 }]);

      await paymentGatewayService.storeIdempotencyKey(42, 'key-1', 200, { tx: 1 });

      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO idempotency_keys'),
        expect.arrayContaining([42, 'key-1', 200]),
      );
    });

    test('uses ON DUPLICATE KEY UPDATE for upsert', async () => {
      db.query.mockResolvedValueOnce([{ affectedRows: 1 }]);
      await paymentGatewayService.storeIdempotencyKey(42, 'key-1', 200, {});
      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('ON DUPLICATE KEY UPDATE'),
        expect.any(Array),
      );
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

    test('returns idempotent replay when cached response exists', async () => {
      const cached = {
        idempotency_key: 'idem-1',
        status: 'completed',
        response_body: JSON.stringify({ transaction_id: 50, status: 'succeeded' }),
      };
      db.query.mockResolvedValueOnce([[cached]]); // checkIdempotencyKey

      const result = await paymentGatewayService.charge({
        organizationId: 42, clientId: 10, amount: 500,
        idempotencyKey: 'idem-1',
      });

      expect(result.idempotent_replay).toBe(true);
      expect(result.transaction_id).toBe(50);
    });

    test('stores idempotency key on successful charge', async () => {
      const gw = { id: 1, provider: 'manual', status: 'active' };
      db.query
        .mockResolvedValueOnce([[]])              // checkIdempotencyKey — no cache
        .mockResolvedValueOnce([[gw]])            // getActiveGateway
        .mockResolvedValueOnce([{ insertId: 102 }]) // INSERT transaction
        .mockResolvedValueOnce([{ affectedRows: 1 }])  // UPDATE succeeded
        .mockResolvedValueOnce([{ affectedRows: 1 }]); // storeIdempotencyKey

      await paymentGatewayService.charge({
        organizationId: 42, clientId: 10, amount: 300, idempotencyKey: 'idem-2',
      });

      // Last call should be storeIdempotencyKey INSERT
      const lastCall = db.query.mock.calls[db.query.mock.calls.length - 1];
      expect(lastCall[0]).toContain('INSERT INTO idempotency_keys');
    });

    test('records failure in transaction and stores idempotency key on error', async () => {
      const gw = { id: 1, provider: 'stripe', status: 'active', secret_key_encrypted: 'enc' };
      db.query
        .mockResolvedValueOnce([[]])              // checkIdempotencyKey — no cache
        .mockResolvedValueOnce([[gw]])            // getActiveGateway
        .mockResolvedValueOnce([{ insertId: 200 }]) // INSERT transaction
        .mockResolvedValueOnce([{ affectedRows: 1 }])  // UPDATE failed
        .mockResolvedValueOnce([{ affectedRows: 1 }]); // storeIdempotencyKey

      // Mock the circuit breaker to throw (simulating Stripe failure)
      const origCall = paymentGatewayService.paymentCircuitBreaker.call;
      paymentGatewayService.paymentCircuitBreaker.call = jest.fn().mockRejectedValueOnce(new Error('Stripe timeout'));

      const result = await paymentGatewayService.charge({
        organizationId: 42, clientId: 10, amount: 100, idempotencyKey: 'idem-fail',
      });

      expect(result.status).toBe('failed');
      expect(result.error).toBe('Stripe timeout');
      expect(result.transaction_id).toBe(200);

      paymentGatewayService.paymentCircuitBreaker.call = origCall;
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

    test('throws when transaction is already refunded', async () => {
      const tx = { id: 52, gateway_status: 'refunded' };
      db.query.mockResolvedValueOnce([[tx]]);
      await expect(paymentGatewayService.refund(52)).rejects.toThrow('Can only refund succeeded transactions');
    });

    test('updates transaction status to refunded in database', async () => {
      const tx = { id: 53, gateway_status: 'succeeded' };
      db.query
        .mockResolvedValueOnce([[tx]])
        .mockResolvedValueOnce([{ affectedRows: 1 }]);

      await paymentGatewayService.refund(53);

      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE payment_transactions SET gateway_status'),
        ['refunded', 53],
      );
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

    test('returns empty array when no transactions', async () => {
      db.query.mockResolvedValueOnce([[]]);
      const result = await paymentGatewayService.getClientTransactions(10, 42);
      expect(result).toEqual([]);
    });

    test('queries by client_id and organization_id', async () => {
      db.query.mockResolvedValueOnce([[]]);
      await paymentGatewayService.getClientTransactions(15, 99);
      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('client_id = ?'),
        [15, 99],
      );
    });
  });

  // =========================================================================
  // Webhook Signature Verification — Stripe
  // =========================================================================
  describe('verifyStripeSignature()', () => {
    const secret = 'whsec_test_secret';

    function makeStripeSignature(payload, timestamp, secret) {
      const signedPayload = `${timestamp}.${payload}`;
      const sig = crypto.createHmac('sha256', secret).update(signedPayload, 'utf8').digest('hex');
      return `t=${timestamp},v1=${sig}`;
    }

    test('returns true for valid signature', () => {
      const body = '{"id":"evt_1"}';
      const ts = Math.floor(Date.now() / 1000);
      const header = makeStripeSignature(body, ts, secret);
      expect(paymentGatewayService.verifyStripeSignature(body, header, secret)).toBe(true);
    });

    test('returns false for invalid signature', () => {
      const body = '{"id":"evt_1"}';
      const ts = Math.floor(Date.now() / 1000);
      const header = `t=${ts},v1=invalidsignature0000000000000000000000000000000000000000000000000`;
      expect(paymentGatewayService.verifyStripeSignature(body, header, secret)).toBe(false);
    });

    test('returns false for expired timestamp', () => {
      const body = '{"id":"evt_1"}';
      const ts = Math.floor(Date.now() / 1000) - 600; // 10 min old
      const header = makeStripeSignature(body, ts, secret);
      expect(paymentGatewayService.verifyStripeSignature(body, header, secret, 300)).toBe(false);
    });

    test('returns false for missing sigHeader', () => {
      expect(paymentGatewayService.verifyStripeSignature('body', null, secret)).toBe(false);
    });

    test('returns false for missing secret', () => {
      expect(paymentGatewayService.verifyStripeSignature('body', 't=123,v1=abc', null)).toBe(false);
    });

    test('returns false for malformed header', () => {
      expect(paymentGatewayService.verifyStripeSignature('body', 'garbage', secret)).toBe(false);
    });

    test('returns false for tampered body', () => {
      const body = '{"id":"evt_1"}';
      const ts = Math.floor(Date.now() / 1000);
      const header = makeStripeSignature(body, ts, secret);
      expect(paymentGatewayService.verifyStripeSignature('{"id":"evt_2"}', header, secret)).toBe(false);
    });

    test('returns false for future timestamp beyond skew allowance', () => {
      const body = '{"id":"evt_1"}';
      const ts = Math.floor(Date.now() / 1000) + 60; // 60s in future
      const header = makeStripeSignature(body, ts, secret);
      expect(paymentGatewayService.verifyStripeSignature(body, header, secret)).toBe(false);
    });

    test('accepts timestamp slightly in the future (within 5s skew)', () => {
      const body = '{"id":"evt_1"}';
      const ts = Math.floor(Date.now() / 1000) + 3; // 3s in future
      const header = makeStripeSignature(body, ts, secret);
      expect(paymentGatewayService.verifyStripeSignature(body, header, secret)).toBe(true);
    });
  });

  // =========================================================================
  // Webhook Signature Verification — Conekta
  // =========================================================================
  describe('verifyConektaSignature()', () => {
    const secret = 'conekta_webhook_key';

    test('returns true for valid signature', () => {
      const body = '{"id":"ord_1"}';
      const expected = crypto.createHmac('sha256', secret).update(body, 'utf8').digest('hex');
      expect(paymentGatewayService.verifyConektaSignature(body, expected, secret)).toBe(true);
    });

    test('returns false for invalid signature', () => {
      const body = '{"id":"ord_1"}';
      const badSig = crypto.createHmac('sha256', 'wrong-key').update(body, 'utf8').digest('hex');
      expect(paymentGatewayService.verifyConektaSignature(body, badSig, secret)).toBe(false);
    });

    test('returns false for missing digest header', () => {
      expect(paymentGatewayService.verifyConektaSignature('body', null, secret)).toBe(false);
    });

    test('returns false for missing secret', () => {
      expect(paymentGatewayService.verifyConektaSignature('body', 'abc', null)).toBe(false);
    });

    test('returns false for non-hex digest', () => {
      // Non-hex strings cause Buffer.from to produce unexpected output
      expect(paymentGatewayService.verifyConektaSignature('body', 'not-hex-at-all!', secret)).toBe(false);
    });
  });

  // =========================================================================
  // handleWebhookEvent
  // =========================================================================
  describe('handleWebhookEvent()', () => {
    test('returns duplicate for already-processed event', async () => {
      db.query.mockResolvedValueOnce([[{ id: 10, status: 'processed' }]]);

      const result = await paymentGatewayService.handleWebhookEvent({
        provider: 'stripe', providerEventId: 'evt_123',
        eventType: 'payment_intent.succeeded', payload: {},
      });

      expect(result.status).toBe('duplicate');
      expect(result.webhookEventId).toBe(10);
    });

    test('marks unhandled event types as ignored', async () => {
      db.query
        .mockResolvedValueOnce([[]])             // no existing
        .mockResolvedValueOnce([{ insertId: 20 }]) // INSERT webhook_events
        .mockResolvedValueOnce([{ affectedRows: 1 }]); // UPDATE ignored

      const result = await paymentGatewayService.handleWebhookEvent({
        provider: 'stripe', providerEventId: 'evt_456',
        eventType: 'customer.created', // not in statusMap
        payload: { data: { object: { id: 'cus_1' } } },
      });

      expect(result.status).toBe('ignored');
    });

    test('returns no_match when transaction not found', async () => {
      db.query
        .mockResolvedValueOnce([[]])             // no existing event
        .mockResolvedValueOnce([{ insertId: 30 }]) // INSERT webhook_events
        .mockResolvedValueOnce([[]])             // no matching transaction
        .mockResolvedValueOnce([{ affectedRows: 1 }]); // UPDATE failed

      const result = await paymentGatewayService.handleWebhookEvent({
        provider: 'stripe', providerEventId: 'evt_789',
        eventType: 'payment_intent.succeeded',
        payload: { data: { object: { id: 'pi_missing' } } },
      });

      expect(result.status).toBe('no_match');
    });

    test('processes Stripe payment_intent.succeeded event', async () => {
      const tx = { id: 100, organization_id: 42, client_id: 10, amount: '500.00', currency: 'MXN', gateway_reference_id: 'pi_test' };

      db.query
        .mockResolvedValueOnce([[]])               // no existing event
        .mockResolvedValueOnce([{ insertId: 40 }]) // INSERT webhook_events
        .mockResolvedValueOnce([[tx]])             // find transaction
        .mockResolvedValueOnce([{ affectedRows: 1 }]) // UPDATE transaction status
        .mockResolvedValueOnce([{ affectedRows: 1 }]); // UPDATE webhook_events

      // Mock getConnection for reconcilePayment
      const mockConn = {
        beginTransaction: jest.fn(),
        execute: jest.fn(),
        commit: jest.fn(),
        rollback: jest.fn(),
        release: jest.fn(),
      };
      mockConn.execute
        .mockResolvedValueOnce([[tx]])   // SELECT FOR UPDATE
        .mockResolvedValueOnce([[]]);    // no matching invoices
      db.getConnection.mockResolvedValueOnce(mockConn);

      const result = await paymentGatewayService.handleWebhookEvent({
        provider: 'stripe', providerEventId: 'evt_success',
        eventType: 'payment_intent.succeeded',
        payload: { data: { object: { id: 'pi_test' } } },
      });

      expect(result.status).toBe('processed');
      expect(result.newStatus).toBe('succeeded');
      expect(result.transactionId).toBe(100);
    });

    test('processes Conekta order.paid event', async () => {
      const tx = { id: 200, organization_id: 42, client_id: 10, amount: '300.00', currency: 'MXN', gateway_reference_id: 'ord_test' };

      db.query
        .mockResolvedValueOnce([[]])               // no existing event
        .mockResolvedValueOnce([{ insertId: 50 }]) // INSERT webhook_events
        .mockResolvedValueOnce([[tx]])             // find transaction
        .mockResolvedValueOnce([{ affectedRows: 1 }]) // UPDATE transaction status
        .mockResolvedValueOnce([{ affectedRows: 1 }]); // UPDATE webhook_events

      const mockConn = {
        beginTransaction: jest.fn(),
        execute: jest.fn(),
        commit: jest.fn(),
        rollback: jest.fn(),
        release: jest.fn(),
      };
      mockConn.execute
        .mockResolvedValueOnce([[tx]])
        .mockResolvedValueOnce([[]]);
      db.getConnection.mockResolvedValueOnce(mockConn);

      const result = await paymentGatewayService.handleWebhookEvent({
        provider: 'conekta', providerEventId: 'evt_conekta_1',
        eventType: 'order.paid',
        payload: { data: { object: { id: 'ord_test' } } },
      });

      expect(result.status).toBe('processed');
      expect(result.newStatus).toBe('succeeded');
    });

    test('records error and rethrows on processing failure', async () => {
      db.query
        .mockResolvedValueOnce([[]])               // no existing event
        .mockResolvedValueOnce([{ insertId: 60 }]) // INSERT webhook_events
        .mockRejectedValueOnce(new Error('DB error')) // transaction lookup fails
        .mockResolvedValueOnce([{ affectedRows: 1 }]); // UPDATE error

      await expect(paymentGatewayService.handleWebhookEvent({
        provider: 'stripe', providerEventId: 'evt_err',
        eventType: 'payment_intent.succeeded',
        payload: { data: { object: { id: 'pi_err' } } },
      })).rejects.toThrow('DB error');
    });
  });

  // =========================================================================
  // reconcilePayment
  // =========================================================================
  describe('reconcilePayment()', () => {
    test('reconciles payment with matching invoice', async () => {
      const tx = { id: 1, client_id: 10, organization_id: 42, amount: '500.00', currency: 'MXN', gateway_reference_id: 'pi_1' };
      const invoice = { id: 100, total: '500.00' };

      const mockConn = {
        beginTransaction: jest.fn(),
        execute: jest.fn(),
        commit: jest.fn(),
        rollback: jest.fn(),
        release: jest.fn(),
      };
      mockConn.execute
        .mockResolvedValueOnce([[tx]])       // SELECT transaction FOR UPDATE
        .mockResolvedValueOnce([[invoice]])   // SELECT invoice FOR UPDATE
        .mockResolvedValueOnce([{ affectedRows: 1 }]) // UPDATE invoice
        .mockResolvedValueOnce([{ insertId: 1 }]);    // INSERT ledger

      db.getConnection.mockResolvedValueOnce(mockConn);

      await paymentGatewayService.reconcilePayment(1);

      expect(mockConn.commit).toHaveBeenCalled();
      expect(mockConn.release).toHaveBeenCalled();
    });

    test('rolls back when no matching invoice', async () => {
      const tx = { id: 2, client_id: 10, organization_id: 42, amount: '500.00', currency: 'MXN' };

      const mockConn = {
        beginTransaction: jest.fn(),
        execute: jest.fn(),
        commit: jest.fn(),
        rollback: jest.fn(),
        release: jest.fn(),
      };
      mockConn.execute
        .mockResolvedValueOnce([[tx]])
        .mockResolvedValueOnce([[]]);  // no invoices

      db.getConnection.mockResolvedValueOnce(mockConn);

      await paymentGatewayService.reconcilePayment(2);

      expect(mockConn.rollback).toHaveBeenCalled();
      expect(mockConn.commit).not.toHaveBeenCalled();
    });

    test('rolls back when amount does not match', async () => {
      const tx = { id: 3, client_id: 10, organization_id: 42, amount: '500.00', currency: 'MXN' };
      const invoice = { id: 101, total: '600.00' }; // different amount

      const mockConn = {
        beginTransaction: jest.fn(),
        execute: jest.fn(),
        commit: jest.fn(),
        rollback: jest.fn(),
        release: jest.fn(),
      };
      mockConn.execute
        .mockResolvedValueOnce([[tx]])
        .mockResolvedValueOnce([[invoice]]);

      db.getConnection.mockResolvedValueOnce(mockConn);

      await paymentGatewayService.reconcilePayment(3);

      expect(mockConn.rollback).toHaveBeenCalled();
    });

    test('rolls back when transaction not found', async () => {
      const mockConn = {
        beginTransaction: jest.fn(),
        execute: jest.fn(),
        commit: jest.fn(),
        rollback: jest.fn(),
        release: jest.fn(),
      };
      mockConn.execute.mockResolvedValueOnce([[]]); // no transaction

      db.getConnection.mockResolvedValueOnce(mockConn);

      await paymentGatewayService.reconcilePayment(999);

      expect(mockConn.rollback).toHaveBeenCalled();
    });

    test('handles tolerance for small rounding differences', async () => {
      const tx = { id: 4, client_id: 10, organization_id: 42, amount: '500.005', currency: 'MXN', gateway_reference_id: 'pi_4' };
      const invoice = { id: 102, total: '500.00' };

      const mockConn = {
        beginTransaction: jest.fn(),
        execute: jest.fn(),
        commit: jest.fn(),
        rollback: jest.fn(),
        release: jest.fn(),
      };
      mockConn.execute
        .mockResolvedValueOnce([[tx]])
        .mockResolvedValueOnce([[invoice]])
        .mockResolvedValueOnce([{ affectedRows: 1 }])
        .mockResolvedValueOnce([{ insertId: 1 }]);

      db.getConnection.mockResolvedValueOnce(mockConn);

      await paymentGatewayService.reconcilePayment(4);

      expect(mockConn.commit).toHaveBeenCalled();
    });

    test('does not throw on reconciliation error (best-effort)', async () => {
      const mockConn = {
        beginTransaction: jest.fn(),
        execute: jest.fn().mockRejectedValueOnce(new Error('DB failure')),
        commit: jest.fn(),
        rollback: jest.fn(),
        release: jest.fn(),
      };

      db.getConnection.mockResolvedValueOnce(mockConn);

      // Should not throw — reconciliation is best-effort
      await expect(paymentGatewayService.reconcilePayment(5)).resolves.not.toThrow();
      expect(mockConn.rollback).toHaveBeenCalled();
      expect(mockConn.release).toHaveBeenCalled();
    });
  });
});
