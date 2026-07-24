// =============================================================================
// FireISP 5.0 — Late Fee Service
// =============================================================================
// Applies configured late fee rules to overdue invoices.
// Emits invoice.late_fee_applied event for notification hooks.
// =============================================================================

const db = require('../config/database');
const eventBus = require('./eventBus');
const logger = require('../utils/logger');

/**
 * List active late fee rules for an organization.
 * @param {number} organizationId
 * @returns {Promise<object[]>}
 */
async function getLateFeeRules(organizationId) {
  const [rows] = await db.query(
    'SELECT * FROM late_fee_rules WHERE organization_id = ? ORDER BY id',
    [organizationId],
  );
  return rows;
}

/**
 * Create a late fee rule.
 * @param {number} organizationId
 * @param {object} data
 * @returns {Promise<object>}
 */
async function createLateFeeRule(organizationId, data) {
  const { name, fee_type = 'flat', fee_amount = 0, grace_period_days = 0, max_applications = null, is_active = 1 } = data;
  const [result] = await db.query(
    `INSERT INTO late_fee_rules (organization_id, name, fee_type, fee_amount, grace_period_days, max_applications, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [organizationId, name, fee_type, fee_amount, grace_period_days, max_applications, is_active ? 1 : 0],
  );
  const [rows] = await db.query('SELECT * FROM late_fee_rules WHERE id = ?', [result.insertId]);
  return rows[0];
}

/**
 * Update a late fee rule.
 * @param {number} organizationId
 * @param {number} ruleId
 * @param {object} data
 * @returns {Promise<object|null>}
 */
async function updateLateFeeRule(organizationId, ruleId, data) {
  const fields = [];
  const vals = [];

  const allowed = ['name', 'fee_type', 'fee_amount', 'grace_period_days', 'max_applications', 'is_active'];
  for (const key of allowed) {
    if (key in data) {
      fields.push(`${key} = ?`);
      vals.push(data[key]);
    }
  }
  if (fields.length === 0) return getLateFeeRuleById(organizationId, ruleId);

  vals.push(ruleId, organizationId);
  await db.query(
    `UPDATE late_fee_rules SET ${fields.join(', ')} WHERE id = ? AND organization_id = ?`,
    vals,
  );
  return getLateFeeRuleById(organizationId, ruleId);
}

/**
 * Get a single rule by id.
 * @param {number} organizationId
 * @param {number} ruleId
 * @returns {Promise<object|null>}
 */
async function getLateFeeRuleById(organizationId, ruleId) {
  const [rows] = await db.query(
    'SELECT * FROM late_fee_rules WHERE id = ? AND organization_id = ?',
    [ruleId, organizationId],
  );
  return rows[0] || null;
}

/**
 * Delete a late fee rule.
 * @param {number} organizationId
 * @param {number} ruleId
 * @returns {Promise<boolean>}
 */
async function deleteLateFeeRule(organizationId, ruleId) {
  const [result] = await db.query(
    'DELETE FROM late_fee_rules WHERE id = ? AND organization_id = ?',
    [ruleId, organizationId],
  );
  return result.affectedRows > 0;
}

/**
 * Apply late fees to all eligible overdue invoices for an organization.
 * Idempotent: skips invoices already processed by a given rule
 * (unless max_applications > 1).
 *
 * @param {number} organizationId
 * @returns {Promise<{ fees_applied: number, invoices_checked: number }>}
 */
async function applyLateFees(organizationId) {
  // Fetch active rules for this org
  const [rules] = await db.query(
    'SELECT * FROM late_fee_rules WHERE organization_id = ? AND is_active = 1',
    [organizationId],
  );
  if (rules.length === 0) return { fees_applied: 0, invoices_checked: 0 };

  // Find overdue invoices (status 'issued' or 'overdue') with a due_date in the past
  const [invoices] = await db.query(
    `SELECT i.id, i.invoice_number, i.total, i.subtotal, i.tax_amount, i.tax_rate,
            i.currency, i.due_date, i.client_id, i.contract_id,
            DATEDIFF(NOW(), i.due_date) AS days_overdue,
            cl.name AS client_name,
            cl.email AS client_email, cl.phone AS client_phone
     FROM invoices i
     LEFT JOIN clients cl ON cl.id = i.client_id
     WHERE i.organization_id = ?
       AND i.status IN ('issued', 'overdue')
       AND i.due_date < CURDATE()
       AND i.deleted_at IS NULL
       -- Never mutate an invoice that already carries a live CFDI: adding a
       -- line item + changing totals would desync it from the stamped, filed
       -- document. Such invoices need a separate charge (nota de cargo), not
       -- an in-place edit.
       AND NOT EXISTS (
         SELECT 1 FROM cfdi_documents cd
         WHERE cd.invoice_id = i.id
           AND cd.sat_status IN ('vigente', 'cancel_pending')
       )`,
    [organizationId],
  );

  let feesApplied = 0;

  for (const invoice of invoices) {
    for (const rule of rules) {
      // Check grace period: invoice must be overdue beyond rule's grace period
      if (invoice.days_overdue <= rule.grace_period_days) continue;

      // Count how many times this rule has already been applied to this invoice
      const [existing] = await db.query(
        'SELECT COUNT(*) AS cnt FROM invoice_late_fees WHERE invoice_id = ? AND late_fee_rule_id = ?',
        [invoice.id, rule.id],
      );
      const alreadyApplied = existing[0].cnt;

      if (rule.max_applications !== null && alreadyApplied >= rule.max_applications) continue;

      // Calculate fee amount
      let feeAmount;
      if (rule.fee_type === 'percent') {
        feeAmount = parseFloat(invoice.total) * (parseFloat(rule.fee_amount) / 100);
      } else {
        feeAmount = parseFloat(rule.fee_amount);
      }
      feeAmount = Math.round(feeAmount * 100) / 100;
      if (feeAmount <= 0) continue;

      try {
        // Insert invoice_items line
        const [itemResult] = await db.query(
          `INSERT INTO invoice_items (invoice_id, description, quantity, unit_price, amount)
           VALUES (?, ?, 1, ?, ?)`,
          [invoice.id, `Late fee: ${rule.name}`, feeAmount, feeAmount],
        );
        const invoiceItemId = itemResult.insertId;

        // Record the late fee application
        await db.query(
          `INSERT INTO invoice_late_fees
             (invoice_id, late_fee_rule_id, organization_id, amount, applied_by, invoice_item_id)
           VALUES (?, ?, ?, ?, NULL, ?)`,
          [invoice.id, rule.id, organizationId, feeAmount, invoiceItemId],
        );

        // Update invoice totals CONSISTENTLY: the fee is a new taxable line, so
        // it goes into the subtotal, tax is recomputed at the invoice's rate,
        // and total = subtotal + tax. The old code bumped only `total`, which
        // left total ≠ subtotal + tax (breaks stamping/reporting) and let the
        // fee escape IVA on a MX invoice. Compute in JS and update the in-memory
        // invoice too, so a second rule in this loop accumulates correctly.
        const rate = parseFloat(invoice.tax_rate) || 0;
        const newSubtotal = Math.round((parseFloat(invoice.subtotal) + feeAmount) * 100) / 100;
        const newTax = Math.round(newSubtotal * rate * 100) / 100;
        const newTotal = Math.round((newSubtotal + newTax) * 100) / 100;
        await db.query(
          `UPDATE invoices
           SET subtotal = ?, tax_amount = ?, total = ?, updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
          [newSubtotal, newTax, newTotal, invoice.id],
        );
        invoice.subtotal = newSubtotal;
        invoice.tax_amount = newTax;
        invoice.total = newTotal;

        feesApplied++;

        // Emit event for notification hooks
        eventBus.emit('invoice.late_fee_applied', {
          organizationId,
          invoice: {
            id: invoice.id,
            invoice_number: invoice.invoice_number,
            client_id: invoice.client_id,
          },
          client: {
            id: invoice.client_id,
            name: invoice.client_name,
            email: invoice.client_email,
            phone: invoice.client_phone,
          },
          rule: { id: rule.id, name: rule.name, fee_type: rule.fee_type },
          fee_amount: feeAmount,
          currency: invoice.currency,
        });
      } catch (err) {
        logger.error({ err, invoiceId: invoice.id, ruleId: rule.id }, 'lateFeeService: error applying fee');
      }
    }
  }

  return { fees_applied: feesApplied, invoices_checked: invoices.length };
}

module.exports = {
  getLateFeeRules,
  createLateFeeRule,
  updateLateFeeRule,
  getLateFeeRuleById,
  deleteLateFeeRule,
  applyLateFees,
};
