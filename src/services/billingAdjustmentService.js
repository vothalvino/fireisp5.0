// =============================================================================
// FireISP 5.0 — Billing Adjustment Service
// =============================================================================
// Records billing adjustments and mirrors them into the audit log.
// =============================================================================

const BillingAdjustment = require('../models/BillingAdjustment');
const auditLog = require('./auditLog');

/**
 * Record a billing adjustment.
 *
 * @param {object} params
 * @param {number} params.organizationId
 * @param {number} params.clientId
 * @param {string} params.entityType   - 'invoice'|'payment'|'credit_note'|'balance'
 * @param {number} params.entityId
 * @param {string} params.adjustmentType - 'late_fee_waiver'|'discount'|'correction'|'write_off'|'other'
 * @param {number} params.amountDelta  - Positive = credit to client, negative = debit
 * @param {string} params.reason
 * @param {number} [params.approvedBy]
 * @param {number} [params.createdBy]
 * @returns {Promise<object>} The inserted billing_adjustment row
 */
async function record({
  organizationId,
  clientId,
  entityType,
  entityId,
  adjustmentType,
  amountDelta,
  reason,
  approvedBy,
  createdBy,
}) {
  const adjustment = await BillingAdjustment.create({
    organization_id: organizationId || null,
    client_id: clientId,
    entity_type: entityType,
    entity_id: entityId,
    adjustment_type: adjustmentType,
    amount_delta: amountDelta,
    reason,
    approved_by: approvedBy || null,
    created_by: createdBy || null,
  });

  await auditLog.log({
    userId: createdBy || null,
    organizationId: organizationId || null,
    action: 'create',
    tableName: 'billing_adjustments',
    recordId: adjustment.id,
    newValues: {
      client_id: clientId,
      entity_type: entityType,
      entity_id: entityId,
      adjustment_type: adjustmentType,
      amount_delta: amountDelta,
      reason,
    },
  });

  return adjustment;
}

module.exports = { record };
