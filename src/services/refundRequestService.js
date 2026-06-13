// =============================================================================
// FireISP 5.0 — Refund Request Service
// =============================================================================
// Manages the refund request lifecycle: create → review → process.
// Emits `refund.requested` and `refund.processed` events.
// =============================================================================

const db = require('../config/database');
const RefundRequest = require('../models/RefundRequest');
const eventBus = require('./eventBus');
const billingAdjustmentService = require('./billingAdjustmentService');
const { ValidationError } = require('../utils/errors');
const logger = require('../utils/logger').child({ service: 'refundRequest' });
const paymentGatewayService = require('./paymentGatewayService');

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

/**
 * Create a new refund request and emit `refund.requested`.
 *
 * @param {number|null} orgId
 * @param {object} data  - Validated request body
 * @param {number} requestedByUserId
 * @returns {Promise<object>} The new refund_requests row
 */
async function createRequest(orgId, data, requestedByUserId) {
  const refundRequest = await RefundRequest.create({
    organization_id: orgId || null,
    client_id: data.client_id,
    payment_id: data.payment_id || null,
    invoice_id: data.invoice_id || null,
    amount: data.amount,
    reason: data.reason,
    status: 'requested',
    requested_by: requestedByUserId || null,
  });

  logger.info({ refundRequestId: refundRequest.id, orgId }, 'Refund request created');

  eventBus.emit('refund.requested', {
    organizationId: orgId,
    refundRequest,
  });

  return refundRequest;
}

// ---------------------------------------------------------------------------
// Review
// ---------------------------------------------------------------------------

/**
 * Approve or reject a refund request.
 *
 * @param {number|null} orgId
 * @param {number} id
 * @param {object} params
 * @param {string} params.status        - 'approved' or 'rejected'
 * @param {string} [params.review_notes]
 * @param {number} reviewedByUserId
 * @returns {Promise<object>} Updated row
 */
async function reviewRequest(orgId, id, { status, review_notes }, reviewedByUserId) {
  const existing = await RefundRequest.findByIdOrFail(id, orgId);

  if (!['requested', 'under_review'].includes(existing.status)) {
    throw new ValidationError(
      `Cannot review a refund request with status '${existing.status}'. Must be 'requested' or 'under_review'.`,
    );
  }

  if (!['approved', 'rejected'].includes(status)) {
    throw new ValidationError("Review status must be 'approved' or 'rejected'.");
  }

  const updated = await RefundRequest.update(id, {
    status,
    reviewed_by: reviewedByUserId || null,
    review_notes: review_notes || null,
  }, orgId);

  logger.info({ refundRequestId: id, status, orgId }, 'Refund request reviewed');

  return updated;
}

// ---------------------------------------------------------------------------
// Process
// ---------------------------------------------------------------------------

/**
 * Process an approved refund request.
 *
 * When refund_method='credit_balance': inserts into client_balance_ledger and
 * optionally marks the payment_transaction as refunded.
 * When refund_method='credit_note': creates a credit_note row.
 * Always records a billing_adjustment.
 * Emits `refund.processed`.
 *
 * @param {number|null} orgId
 * @param {number} id
 * @param {object} params
 * @param {string} params.refund_method
 * @param {string} [params.gateway_refund_reference]
 * @param {number} processedByUserId
 * @returns {Promise<object>} Updated row
 */
async function processRequest(orgId, id, { refund_method, gateway_refund_reference: callerGatewayRef }, processedByUserId) {
  // Allow the gateway refund path to overwrite the caller-supplied reference
  let gateway_refund_reference = callerGatewayRef || null;
  const existing = await RefundRequest.findByIdOrFail(id, orgId);

  if (existing.status !== 'approved') {
    throw new ValidationError(
      `Cannot process a refund request with status '${existing.status}'. Must be 'approved'.`,
    );
  }

  // Fetch client for notification
  let client = null;
  try {
    const [clientRows] = await db.query(
      'SELECT id, email, first_name, last_name FROM clients WHERE id = ? LIMIT 1',
      [existing.client_id],
    );
    client = clientRows[0] || null;
  } catch (err) {
    logger.warn({ err, clientId: existing.client_id }, 'Could not fetch client for refund processing');
  }

  // --- refund_method: original_method (gateway refund) ---
  // For payments made through a payment gateway (Stripe, Conekta, etc.) the
  // funds must be returned via the same processor before we update our DB.
  if (refund_method === 'original_method') {
    if (!existing.payment_id) {
      throw new ValidationError(
        'Cannot use original_method refund: no payment transaction linked to this refund request.',
      );
    }

    let gatewayResult;
    try {
      gatewayResult = await paymentGatewayService.refund(existing.payment_id);
    } catch (err) {
      logger.error({ err, paymentId: existing.payment_id, refundRequestId: id }, 'Gateway refund failed');
      throw err;
    }

    // gateway_refund_reference is returned by paymentGatewayService.refund()
    gateway_refund_reference = gatewayResult.gateway_refund_reference || gateway_refund_reference || null;

    logger.info(
      { refundRequestId: id, paymentId: existing.payment_id, gateway_refund_reference },
      'Gateway refund confirmed',
    );
  }

  // --- refund_method: credit_balance ---
  if (refund_method === 'credit_balance') {
    await db.query(
      `INSERT INTO client_balance_ledger
         (organization_id, client_id, balance_type, entry_type, credit, debit, running_balance,
          reference_id, description, entry_date, created_by)
       VALUES (?, ?, 'postpaid', 'adjustment', ?, 0, 0, ?, ?, CURDATE(), ?)`,
      [
        orgId || null,
        existing.client_id,
        existing.amount,
        existing.id,
        `Refund for request #${existing.id}`,
        processedByUserId || null,
      ],
    );

    // Mark payment as refunded if the refund amount covers the full payment
    if (existing.payment_id) {
      try {
        const [pmtRows] = await db.query(
          'SELECT amount, gateway_status FROM payment_transactions WHERE id = ? LIMIT 1',
          [existing.payment_id],
        );
        const pmt = pmtRows[0];
        if (pmt && parseFloat(existing.amount) >= parseFloat(pmt.amount)) {
          await db.query(
            "UPDATE payment_transactions SET gateway_status = 'refunded' WHERE id = ?",
            [existing.payment_id],
          );
        }
      } catch (err) {
        logger.warn({ err, paymentId: existing.payment_id }, 'Could not mark payment as refunded');
      }
    }
  }

  // --- refund_method: credit_note ---
  if (refund_method === 'credit_note') {
    try {
      const cnNumber = `RCN-${existing.id}-${Date.now()}`;
      const [cnResult] = await db.query(
        `INSERT INTO credit_notes
           (client_id, invoice_id, credit_note_number, issue_date, reason,
            subtotal, tax_amount, total, status, created_by)
         VALUES (?, ?, ?, CURDATE(), 'other', ?, 0, ?, 'issued', ?)`,
        [
          existing.client_id,
          existing.invoice_id || null,
          cnNumber,
          existing.amount,
          existing.amount,
          processedByUserId || null,
        ],
      );

      // Link the credit note back to the refund request
      await db.query(
        'UPDATE refund_requests SET resulting_credit_note_id = ? WHERE id = ?',
        [cnResult.insertId, existing.id],
      );
    } catch (err) {
      logger.warn({ err }, 'Could not create credit note for refund');
    }
  }

  // Always record a billing adjustment
  await billingAdjustmentService.record({
    organizationId: orgId,
    clientId: existing.client_id,
    entityType: existing.payment_id ? 'payment' : 'invoice',
    entityId: existing.payment_id || existing.invoice_id || existing.id,
    adjustmentType: 'correction',
    amountDelta: parseFloat(existing.amount),
    reason: `Refund processed — request #${existing.id} (method: ${refund_method})`,
    approvedBy: processedByUserId || null,
    createdBy: processedByUserId || null,
  });

  // Mark as processed
  const updated = await RefundRequest.update(id, {
    status: 'processed',
    processed_at: new Date(),
    refund_method,
    gateway_refund_reference: gateway_refund_reference || null,
  }, orgId);

  logger.info({ refundRequestId: id, refund_method, orgId }, 'Refund request processed');

  eventBus.emit('refund.processed', {
    organizationId: orgId,
    refundRequest: updated,
    client,
  });

  return updated;
}

module.exports = { createRequest, reviewRequest, processRequest };
