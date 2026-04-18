// =============================================================================
// FireISP 5.0 — Payment Retry Service
// =============================================================================
// Handles automatic retry scheduling for failed payment charges.
// When a charge fails, a retry record is created with exponential backoff:
//   Attempt 1: 4 hours after failure
//   Attempt 2: 24 hours after failure
//   Attempt 3: 72 hours after failure
// A cron job (retry_failed_charges) processes pending retries every hour.
// =============================================================================

const db = require('../config/database');
const paymentGatewayService = require('./paymentGatewayService');
const logger = require('../utils/logger');

// Retry delay schedule in milliseconds (from the time of the original failure)
// Attempt 1: 4 hours, Attempt 2: 24 hours, Attempt 3: 72 hours
const RETRY_DELAYS_MS = [
  4 * 60 * 60 * 1000,   // 4 hours
  24 * 60 * 60 * 1000,  // 24 hours
  72 * 60 * 60 * 1000,  // 72 hours
];

const MAX_ATTEMPTS = 3;

// Fallback delay (1 hour) when the computed next_retry_at is already in the past
const FALLBACK_RETRY_DELAY_MS = 60 * 60 * 1000;

/**
 * Schedule a failed charge for automatic retries.
 *
 * @param {object} params
 * @param {number} params.transactionId      - Original failed payment_transactions.id
 * @param {number} params.organizationId     - Organization ID
 * @param {number} params.clientId           - Client ID
 * @param {number} params.amount             - Charge amount
 * @param {string} [params.currency='MXN']   - Currency code
 * @param {number} [params.invoiceId]        - Invoice ID if known
 * @param {number} [params.recurringProfileId] - Recurring payment profile ID
 * @param {string} [params.errorMessage]     - Error message from the failed charge
 * @returns {object} The created payment_retries record
 */
async function scheduleRetry({
  transactionId,
  organizationId,
  clientId,
  amount,
  currency = 'MXN',
  invoiceId = null,
  recurringProfileId = null,
  errorMessage = null,
}) {
  // Check if a retry schedule already exists for this transaction
  const [existing] = await db.query(
    `SELECT id FROM payment_retries
     WHERE transaction_id = ? AND status IN ('pending', 'processing')`,
    [transactionId],
  );

  if (existing.length > 0) {
    logger.info({ transactionId, retryId: existing[0].id }, 'Retry already scheduled for transaction');
    return { id: existing[0].id, already_scheduled: true };
  }

  const nextRetryAt = new Date(Date.now() + RETRY_DELAYS_MS[0]);

  const [result] = await db.query(
    `INSERT INTO payment_retries
     (organization_id, transaction_id, client_id, invoice_id, recurring_profile_id,
      amount, currency, attempt_number, max_attempts, status, last_error, next_retry_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, 'pending', ?, ?)`,
    [organizationId, transactionId, clientId, invoiceId, recurringProfileId,
      amount, currency, MAX_ATTEMPTS, errorMessage, nextRetryAt],
  );

  logger.info(
    { retryId: result.insertId, transactionId, nextRetryAt: nextRetryAt.toISOString() },
    'Payment retry scheduled',
  );

  return {
    id: result.insertId,
    transaction_id: transactionId,
    next_retry_at: nextRetryAt.toISOString(),
    max_attempts: MAX_ATTEMPTS,
  };
}

/**
 * Process all pending retries whose next_retry_at has passed.
 * Called by the scheduler (cron: every hour).
 *
 * @param {number} [organizationId] - Optionally filter by organization
 * @returns {object} Summary of processed retries
 */
async function processPendingRetries(organizationId = null) {
  const orgFilter = organizationId ? 'AND pr.organization_id = ?' : '';
  const params = organizationId ? [organizationId] : [];

  const [retries] = await db.query(`
    SELECT pr.*, rp.token_reference AS payment_method_token
    FROM payment_retries pr
    LEFT JOIN recurring_payment_profiles rp ON rp.id = pr.recurring_profile_id AND rp.status = 'active'
    WHERE pr.status = 'pending'
      AND pr.next_retry_at <= NOW()
      ${orgFilter}
    ORDER BY pr.next_retry_at ASC
    LIMIT 100
  `, params);

  let succeeded = 0;
  let failed = 0;
  let exhausted = 0;

  for (const retry of retries) {
    try {
      const result = await executeRetry(retry);
      if (result.status === 'succeeded') succeeded++;
      else if (result.status === 'exhausted') exhausted++;
      else failed++;
    } catch (err) {
      failed++;
      logger.error({ err, retryId: retry.id }, 'Unexpected error processing payment retry');
    }
  }

  logger.info(
    { total: retries.length, succeeded, failed, exhausted },
    'Payment retry batch processed',
  );

  return { processed: retries.length, succeeded, failed, exhausted };
}

/**
 * Execute a single retry attempt.
 *
 * @param {object} retry - The payment_retries row
 * @returns {object} { status: 'succeeded' | 'failed' | 'exhausted' }
 */
async function executeRetry(retry) {
  const attemptNumber = retry.attempt_number + 1;

  // Mark as processing
  await db.query(
    'UPDATE payment_retries SET status = \'processing\', last_attempt_at = NOW() WHERE id = ?',
    [retry.id],
  );

  // Generate a unique idempotency key for this retry attempt
  const idempotencyKey = `retry_${retry.id}_attempt_${attemptNumber}_${Date.now()}`;

  try {
    const chargeResult = await paymentGatewayService.charge({
      organizationId: retry.organization_id,
      clientId: retry.client_id,
      amount: parseFloat(retry.amount),
      currency: retry.currency,
      description: `Retry #${attemptNumber} for transaction ${retry.transaction_id}`,
      paymentMethodToken: retry.payment_method_token || null,
      idempotencyKey,
    });

    if (chargeResult.status === 'succeeded' || chargeResult.status === 'pending') {
      // Success — mark retry as completed
      await db.query(
        `UPDATE payment_retries
         SET status = 'succeeded', attempt_number = ?, completed_at = NOW(), last_error = NULL
         WHERE id = ?`,
        [attemptNumber, retry.id],
      );

      logger.info(
        { retryId: retry.id, attempt: attemptNumber, transactionId: chargeResult.transaction_id },
        'Payment retry succeeded',
      );

      return { status: 'succeeded', transaction_id: chargeResult.transaction_id };
    }

    // Charge returned failed status
    return handleRetryFailure(retry, attemptNumber, chargeResult.error || 'Charge failed');
  } catch (err) {
    return handleRetryFailure(retry, attemptNumber, err.message);
  }
}

/**
 * Handle a failed retry attempt — schedule next retry or mark as exhausted.
 *
 * @param {object} retry          - The payment_retries row
 * @param {number} attemptNumber  - Current attempt number (1-indexed)
 * @param {string} errorMessage   - Error description
 * @returns {object} { status: 'failed' | 'exhausted' }
 */
async function handleRetryFailure(retry, attemptNumber, errorMessage) {
  if (attemptNumber >= retry.max_attempts) {
    // All retries exhausted
    await db.query(
      `UPDATE payment_retries
       SET status = 'exhausted', attempt_number = ?, last_error = ?, completed_at = NOW(), next_retry_at = NULL
       WHERE id = ?`,
      [attemptNumber, errorMessage, retry.id],
    );

    logger.warn(
      { retryId: retry.id, attempt: attemptNumber, error: errorMessage },
      'Payment retry exhausted — all attempts failed',
    );

    return { status: 'exhausted' };
  }

  // Schedule next retry with exponential backoff
  const nextDelayMs = RETRY_DELAYS_MS[attemptNumber] || RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1];
  const createdAtMs = retry.created_at instanceof Date
    ? retry.created_at.getTime()
    : new Date(retry.created_at).getTime();
  const nextRetryAt = new Date(createdAtMs + nextDelayMs);

  // Ensure next_retry_at is in the future (in case created_at + delay is already past)
  const now = new Date();
  if (nextRetryAt <= now) {
    nextRetryAt.setTime(now.getTime() + FALLBACK_RETRY_DELAY_MS);
  }

  await db.query(
    `UPDATE payment_retries
     SET status = 'pending', attempt_number = ?, last_error = ?, next_retry_at = ?
     WHERE id = ?`,
    [attemptNumber, errorMessage, nextRetryAt, retry.id],
  );

  logger.info(
    { retryId: retry.id, attempt: attemptNumber, nextRetryAt: nextRetryAt.toISOString() },
    'Payment retry failed — next attempt scheduled',
  );

  return { status: 'failed', next_retry_at: nextRetryAt.toISOString() };
}

/**
 * Cancel a pending retry schedule (e.g., when payment succeeds via webhook
 * or manual payment is recorded).
 *
 * @param {object} params
 * @param {number} [params.retryId]        - Cancel a specific retry by ID
 * @param {number} [params.transactionId]  - Cancel by original transaction ID
 * @param {number} [params.clientId]       - Cancel all retries for a client
 * @param {number} [params.invoiceId]      - Cancel all retries for an invoice
 * @returns {object} { cancelled: number }
 */
async function cancelRetries({ retryId, transactionId, clientId, invoiceId } = {}) {
  let sql = 'UPDATE payment_retries SET status = \'cancelled\', completed_at = NOW(), next_retry_at = NULL WHERE status IN (\'pending\', \'processing\')';
  const params = [];

  if (retryId) {
    sql += ' AND id = ?';
    params.push(retryId);
  } else if (transactionId) {
    sql += ' AND transaction_id = ?';
    params.push(transactionId);
  } else if (invoiceId) {
    sql += ' AND invoice_id = ?';
    params.push(invoiceId);
  } else if (clientId) {
    sql += ' AND client_id = ?';
    params.push(clientId);
  } else {
    return { cancelled: 0 };
  }

  const [result] = await db.query(sql, params);
  const cancelled = result.affectedRows || 0;

  if (cancelled > 0) {
    logger.info({ retryId, transactionId, clientId, invoiceId, cancelled }, 'Payment retries cancelled');
  }

  return { cancelled };
}

/**
 * Get retry history for a transaction or client.
 *
 * @param {object} params
 * @param {number} [params.transactionId] - Filter by transaction
 * @param {number} [params.clientId]      - Filter by client
 * @param {number} [params.organizationId] - Filter by organization
 * @returns {Array} Retry records
 */
async function getRetries({ transactionId, clientId, organizationId } = {}) {
  let sql = 'SELECT * FROM payment_retries WHERE 1=1';
  const params = [];

  if (organizationId) {
    sql += ' AND organization_id = ?';
    params.push(organizationId);
  }
  if (transactionId) {
    sql += ' AND transaction_id = ?';
    params.push(transactionId);
  }
  if (clientId) {
    sql += ' AND client_id = ?';
    params.push(clientId);
  }

  sql += ' ORDER BY created_at DESC';

  const [rows] = await db.query(sql, params);
  return rows;
}

module.exports = {
  scheduleRetry,
  processPendingRetries,
  executeRetry,
  cancelRetries,
  getRetries,
  RETRY_DELAYS_MS,
  MAX_ATTEMPTS,
};
