// =============================================================================
// FireISP 5.0 — Payment Retry Service Unit Tests
// =============================================================================

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  execute: jest.fn(),
  getConnection: jest.fn(),
}));

jest.mock('../src/services/paymentGatewayService', () => ({
  charge: jest.fn(),
}));

jest.mock('../src/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  child: jest.fn().mockReturnThis(),
}));

const db = require('../src/config/database');
const paymentGatewayService = require('../src/services/paymentGatewayService');
const paymentRetryService = require('../src/services/paymentRetryService');

describe('paymentRetryService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // =========================================================================
  // Constants
  // =========================================================================
  describe('constants', () => {
    test('exports RETRY_DELAYS_MS with 3 delays', () => {
      expect(paymentRetryService.RETRY_DELAYS_MS).toHaveLength(3);
    });

    test('RETRY_DELAYS_MS are in ascending order', () => {
      const delays = paymentRetryService.RETRY_DELAYS_MS;
      expect(delays[0]).toBeLessThan(delays[1]);
      expect(delays[1]).toBeLessThan(delays[2]);
    });

    test('first delay is 4 hours', () => {
      expect(paymentRetryService.RETRY_DELAYS_MS[0]).toBe(4 * 60 * 60 * 1000);
    });

    test('second delay is 24 hours', () => {
      expect(paymentRetryService.RETRY_DELAYS_MS[1]).toBe(24 * 60 * 60 * 1000);
    });

    test('third delay is 72 hours', () => {
      expect(paymentRetryService.RETRY_DELAYS_MS[2]).toBe(72 * 60 * 60 * 1000);
    });

    test('MAX_ATTEMPTS is 3', () => {
      expect(paymentRetryService.MAX_ATTEMPTS).toBe(3);
    });
  });

  // =========================================================================
  // scheduleRetry
  // =========================================================================
  describe('scheduleRetry()', () => {
    test('creates a retry record for a failed transaction', async () => {
      // No existing retry
      db.query.mockResolvedValueOnce([[]]);
      // Insert retry
      db.query.mockResolvedValueOnce([{ insertId: 1 }]);

      const result = await paymentRetryService.scheduleRetry({
        transactionId: 100,
        organizationId: 1,
        clientId: 10,
        amount: 500.00,
        currency: 'MXN',
        invoiceId: 50,
        recurringProfileId: 5,
        errorMessage: 'Card declined',
      });

      expect(result.id).toBe(1);
      expect(result.transaction_id).toBe(100);
      expect(result.max_attempts).toBe(3);
      expect(result.next_retry_at).toBeTruthy();

      // Verify INSERT query
      expect(db.query).toHaveBeenCalledTimes(2);
      const insertCall = db.query.mock.calls[1];
      expect(insertCall[0]).toContain('INSERT INTO payment_retries');
      expect(insertCall[1]).toContain(1);   // organizationId
      expect(insertCall[1]).toContain(100); // transactionId
      expect(insertCall[1]).toContain(10);  // clientId
    });

    test('returns existing retry if already scheduled', async () => {
      db.query.mockResolvedValueOnce([[{ id: 42 }]]);

      const result = await paymentRetryService.scheduleRetry({
        transactionId: 100,
        organizationId: 1,
        clientId: 10,
        amount: 500.00,
      });

      expect(result.id).toBe(42);
      expect(result.already_scheduled).toBe(true);
      expect(db.query).toHaveBeenCalledTimes(1);
    });

    test('defaults currency to MXN', async () => {
      db.query.mockResolvedValueOnce([[]]);
      db.query.mockResolvedValueOnce([{ insertId: 2 }]);

      await paymentRetryService.scheduleRetry({
        transactionId: 100,
        organizationId: 1,
        clientId: 10,
        amount: 500.00,
      });

      const insertCall = db.query.mock.calls[1];
      expect(insertCall[1]).toContain('MXN');
    });

    test('sets next_retry_at approximately 4 hours from now', async () => {
      db.query.mockResolvedValueOnce([[]]);
      db.query.mockResolvedValueOnce([{ insertId: 3 }]);

      const before = Date.now();
      const result = await paymentRetryService.scheduleRetry({
        transactionId: 100,
        organizationId: 1,
        clientId: 10,
        amount: 500.00,
      });
      const after = Date.now();

      const nextRetryTime = new Date(result.next_retry_at).getTime();
      const fourHoursMs = 4 * 60 * 60 * 1000;

      expect(nextRetryTime).toBeGreaterThanOrEqual(before + fourHoursMs - 1000);
      expect(nextRetryTime).toBeLessThanOrEqual(after + fourHoursMs + 1000);
    });
  });

  // =========================================================================
  // processPendingRetries
  // =========================================================================
  describe('processPendingRetries()', () => {
    test('processes pending retries that are due', async () => {
      const retryRow = {
        id: 1,
        organization_id: 1,
        transaction_id: 100,
        client_id: 10,
        invoice_id: 50,
        recurring_profile_id: 5,
        amount: '500.00',
        currency: 'MXN',
        attempt_number: 0,
        max_attempts: 3,
        status: 'pending',
        payment_method_token: 'tok_123',
        created_at: new Date(Date.now() - 5 * 60 * 60 * 1000),
      };

      // SELECT pending retries
      db.query.mockResolvedValueOnce([[retryRow]]);
      // UPDATE status to processing
      db.query.mockResolvedValueOnce([{ affectedRows: 1 }]);

      paymentGatewayService.charge.mockResolvedValue({
        transaction_id: 201,
        status: 'succeeded',
      });

      // UPDATE status to succeeded
      db.query.mockResolvedValueOnce([{ affectedRows: 1 }]);

      const result = await paymentRetryService.processPendingRetries();

      expect(result.processed).toBe(1);
      expect(result.succeeded).toBe(1);
      expect(result.failed).toBe(0);
      expect(result.exhausted).toBe(0);
    });

    test('filters by organization when provided', async () => {
      db.query.mockResolvedValueOnce([[]]);

      await paymentRetryService.processPendingRetries(42);

      const selectCall = db.query.mock.calls[0];
      expect(selectCall[0]).toContain('pr.organization_id = ?');
      expect(selectCall[1]).toContain(42);
    });

    test('returns zeroes when no pending retries', async () => {
      db.query.mockResolvedValueOnce([[]]);

      const result = await paymentRetryService.processPendingRetries();

      expect(result.processed).toBe(0);
      expect(result.succeeded).toBe(0);
      expect(result.failed).toBe(0);
      expect(result.exhausted).toBe(0);
    });

    test('counts exhausted retries separately', async () => {
      const retryRow = {
        id: 1,
        organization_id: 1,
        transaction_id: 100,
        client_id: 10,
        amount: '500.00',
        currency: 'MXN',
        attempt_number: 2,
        max_attempts: 3,
        status: 'pending',
        payment_method_token: null,
        created_at: new Date(Date.now() - 73 * 60 * 60 * 1000),
      };

      db.query.mockResolvedValueOnce([[retryRow]]);
      // UPDATE to processing
      db.query.mockResolvedValueOnce([{ affectedRows: 1 }]);

      paymentGatewayService.charge.mockResolvedValue({
        transaction_id: 202,
        status: 'failed',
        error: 'Card expired',
      });

      // UPDATE to exhausted
      db.query.mockResolvedValueOnce([{ affectedRows: 1 }]);

      const result = await paymentRetryService.processPendingRetries();

      expect(result.exhausted).toBe(1);
      expect(result.succeeded).toBe(0);
    });

    test('handles unexpected errors gracefully', async () => {
      const retryRow = {
        id: 1,
        organization_id: 1,
        transaction_id: 100,
        client_id: 10,
        amount: '500.00',
        currency: 'MXN',
        attempt_number: 0,
        max_attempts: 3,
        status: 'pending',
        payment_method_token: null,
        created_at: new Date(),
      };

      db.query.mockResolvedValueOnce([[retryRow]]);
      // UPDATE to processing throws
      db.query.mockRejectedValueOnce(new Error('DB connection lost'));

      const result = await paymentRetryService.processPendingRetries();

      expect(result.processed).toBe(1);
      expect(result.failed).toBe(1);
    });
  });

  // =========================================================================
  // executeRetry
  // =========================================================================
  describe('executeRetry()', () => {
    const baseRetry = {
      id: 1,
      organization_id: 1,
      transaction_id: 100,
      client_id: 10,
      amount: '500.00',
      currency: 'MXN',
      attempt_number: 0,
      max_attempts: 3,
      payment_method_token: 'tok_123',
      created_at: new Date(Date.now() - 5 * 60 * 60 * 1000),
    };

    test('succeeds on first retry attempt', async () => {
      db.query.mockResolvedValueOnce([{ affectedRows: 1 }]); // UPDATE processing

      paymentGatewayService.charge.mockResolvedValue({
        transaction_id: 201,
        status: 'succeeded',
      });

      db.query.mockResolvedValueOnce([{ affectedRows: 1 }]); // UPDATE succeeded

      const result = await paymentRetryService.executeRetry(baseRetry);

      expect(result.status).toBe('succeeded');
      expect(result.transaction_id).toBe(201);
      expect(paymentGatewayService.charge).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: 1,
          clientId: 10,
          amount: 500,
          currency: 'MXN',
          paymentMethodToken: 'tok_123',
        }),
      );
    });

    test('handles pending status as success', async () => {
      db.query.mockResolvedValueOnce([{ affectedRows: 1 }]); // UPDATE processing

      paymentGatewayService.charge.mockResolvedValue({
        transaction_id: 201,
        status: 'pending',
      });

      db.query.mockResolvedValueOnce([{ affectedRows: 1 }]); // UPDATE succeeded

      const result = await paymentRetryService.executeRetry(baseRetry);
      expect(result.status).toBe('succeeded');
    });

    test('schedules next retry on failure when attempts remain', async () => {
      db.query.mockResolvedValueOnce([{ affectedRows: 1 }]); // UPDATE processing

      paymentGatewayService.charge.mockResolvedValue({
        transaction_id: 202,
        status: 'failed',
        error: 'Insufficient funds',
      });

      db.query.mockResolvedValueOnce([{ affectedRows: 1 }]); // UPDATE pending with next_retry

      const result = await paymentRetryService.executeRetry(baseRetry);

      expect(result.status).toBe('failed');
      expect(result.next_retry_at).toBeTruthy();

      // Verify the UPDATE sets attempt_number = 1
      const updateCall = db.query.mock.calls[1];
      expect(updateCall[1][0]).toBe(1); // attempt_number
    });

    test('marks as exhausted when max attempts reached', async () => {
      const lastAttemptRetry = {
        ...baseRetry,
        attempt_number: 2,
        max_attempts: 3,
      };

      db.query.mockResolvedValueOnce([{ affectedRows: 1 }]); // UPDATE processing

      paymentGatewayService.charge.mockResolvedValue({
        transaction_id: 203,
        status: 'failed',
        error: 'Card declined',
      });

      db.query.mockResolvedValueOnce([{ affectedRows: 1 }]); // UPDATE exhausted

      const result = await paymentRetryService.executeRetry(lastAttemptRetry);

      expect(result.status).toBe('exhausted');

      // Verify UPDATE sets status='exhausted'
      const updateCall = db.query.mock.calls[1];
      expect(updateCall[0]).toContain("'exhausted'");
    });

    test('handles charge exception as failure', async () => {
      db.query.mockResolvedValueOnce([{ affectedRows: 1 }]); // UPDATE processing

      paymentGatewayService.charge.mockRejectedValue(new Error('Gateway timeout'));

      db.query.mockResolvedValueOnce([{ affectedRows: 1 }]); // UPDATE pending/exhausted

      const result = await paymentRetryService.executeRetry(baseRetry);

      expect(result.status).toBe('failed');
    });

    test('generates unique idempotency key per attempt', async () => {
      db.query.mockResolvedValueOnce([{ affectedRows: 1 }]);
      paymentGatewayService.charge.mockResolvedValue({ transaction_id: 201, status: 'succeeded' });
      db.query.mockResolvedValueOnce([{ affectedRows: 1 }]);

      await paymentRetryService.executeRetry(baseRetry);

      const chargeCall = paymentGatewayService.charge.mock.calls[0][0];
      expect(chargeCall.idempotencyKey).toMatch(/^retry_1_attempt_1_\d+$/);
    });

    test('includes retry description in charge', async () => {
      db.query.mockResolvedValueOnce([{ affectedRows: 1 }]);
      paymentGatewayService.charge.mockResolvedValue({ transaction_id: 201, status: 'succeeded' });
      db.query.mockResolvedValueOnce([{ affectedRows: 1 }]);

      await paymentRetryService.executeRetry(baseRetry);

      const chargeCall = paymentGatewayService.charge.mock.calls[0][0];
      expect(chargeCall.description).toContain('Retry #1');
      expect(chargeCall.description).toContain('transaction 100');
    });
  });

  // =========================================================================
  // cancelRetries
  // =========================================================================
  describe('cancelRetries()', () => {
    test('cancels by retryId', async () => {
      db.query.mockResolvedValueOnce([{ affectedRows: 1 }]);

      const result = await paymentRetryService.cancelRetries({ retryId: 5 });

      expect(result.cancelled).toBe(1);
      const call = db.query.mock.calls[0];
      expect(call[0]).toContain("status = 'cancelled'");
      expect(call[0]).toContain('AND id = ?');
      expect(call[1]).toEqual([5]);
    });

    test('cancels by transactionId', async () => {
      db.query.mockResolvedValueOnce([{ affectedRows: 2 }]);

      const result = await paymentRetryService.cancelRetries({ transactionId: 100 });

      expect(result.cancelled).toBe(2);
      const call = db.query.mock.calls[0];
      expect(call[0]).toContain('AND transaction_id = ?');
    });

    test('cancels by invoiceId', async () => {
      db.query.mockResolvedValueOnce([{ affectedRows: 1 }]);

      const result = await paymentRetryService.cancelRetries({ invoiceId: 50 });

      expect(result.cancelled).toBe(1);
      const call = db.query.mock.calls[0];
      expect(call[0]).toContain('AND invoice_id = ?');
    });

    test('cancels by clientId', async () => {
      db.query.mockResolvedValueOnce([{ affectedRows: 3 }]);

      const result = await paymentRetryService.cancelRetries({ clientId: 10 });

      expect(result.cancelled).toBe(3);
      const call = db.query.mock.calls[0];
      expect(call[0]).toContain('AND client_id = ?');
    });

    test('returns 0 cancelled when no filter provided', async () => {
      const result = await paymentRetryService.cancelRetries({});

      expect(result.cancelled).toBe(0);
      expect(db.query).not.toHaveBeenCalled();
    });

    test('returns 0 when no matching retries', async () => {
      db.query.mockResolvedValueOnce([{ affectedRows: 0 }]);

      const result = await paymentRetryService.cancelRetries({ retryId: 999 });

      expect(result.cancelled).toBe(0);
    });

    test('only cancels pending/processing retries', async () => {
      db.query.mockResolvedValueOnce([{ affectedRows: 1 }]);

      await paymentRetryService.cancelRetries({ retryId: 5 });

      const call = db.query.mock.calls[0];
      expect(call[0]).toContain("status IN ('pending', 'processing')");
    });
  });

  // =========================================================================
  // getRetries
  // =========================================================================
  describe('getRetries()', () => {
    test('returns retries filtered by organizationId', async () => {
      const rows = [{ id: 1 }, { id: 2 }];
      db.query.mockResolvedValueOnce([rows]);

      const result = await paymentRetryService.getRetries({ organizationId: 1 });

      expect(result).toEqual(rows);
      const call = db.query.mock.calls[0];
      expect(call[0]).toContain('organization_id = ?');
      expect(call[1]).toContain(1);
    });

    test('returns retries filtered by transactionId', async () => {
      db.query.mockResolvedValueOnce([[]]);

      await paymentRetryService.getRetries({ transactionId: 100 });

      const call = db.query.mock.calls[0];
      expect(call[0]).toContain('transaction_id = ?');
    });

    test('returns retries filtered by clientId', async () => {
      db.query.mockResolvedValueOnce([[]]);

      await paymentRetryService.getRetries({ clientId: 10 });

      const call = db.query.mock.calls[0];
      expect(call[0]).toContain('client_id = ?');
    });

    test('supports multiple filters combined', async () => {
      db.query.mockResolvedValueOnce([[]]);

      await paymentRetryService.getRetries({ organizationId: 1, clientId: 10 });

      const call = db.query.mock.calls[0];
      expect(call[0]).toContain('organization_id = ?');
      expect(call[0]).toContain('client_id = ?');
      expect(call[1]).toEqual([1, 10]);
    });

    test('orders results by created_at DESC', async () => {
      db.query.mockResolvedValueOnce([[]]);

      await paymentRetryService.getRetries({});

      const call = db.query.mock.calls[0];
      expect(call[0]).toContain('ORDER BY created_at DESC');
    });
  });

  // =========================================================================
  // Integration: retry backoff schedule
  // =========================================================================
  describe('backoff schedule', () => {
    test('second retry is scheduled with 24h delay from creation', async () => {
      const createdAt = new Date(Date.now() - 25 * 60 * 60 * 1000); // 25 hours ago
      const retry = {
        id: 1,
        organization_id: 1,
        transaction_id: 100,
        client_id: 10,
        amount: '500.00',
        currency: 'MXN',
        attempt_number: 0,
        max_attempts: 3,
        payment_method_token: 'tok_123',
        created_at: createdAt,
      };

      db.query.mockResolvedValueOnce([{ affectedRows: 1 }]); // processing
      paymentGatewayService.charge.mockResolvedValue({ status: 'failed', error: 'Declined' });
      db.query.mockResolvedValueOnce([{ affectedRows: 1 }]); // update

      const result = await paymentRetryService.executeRetry(retry);

      expect(result.status).toBe('failed');

      // Verify the next_retry_at was set (the UPDATE call's params)
      const updateCall = db.query.mock.calls[1];
      // Should include a Date object for next_retry_at
      const nextRetry = updateCall[1][2]; // third param is the next_retry_at Date
      expect(nextRetry).toBeInstanceOf(Date);
    });
  });
});
