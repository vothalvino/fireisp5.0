// =============================================================================
// FireISP 5.0 — Payment Plan Service
// =============================================================================

const db = require('../config/database');
const logger = require('../utils/logger').child({ service: 'paymentPlan' });
const { NotFoundError, ValidationError } = require('../utils/errors');

/**
 * Compute installment due dates starting from the day after creation.
 * @param {number} count
 * @param {'weekly'|'biweekly'|'monthly'} frequency
 * @returns {string[]} ISO date strings (YYYY-MM-DD)
 */
function computeDueDates(count, frequency) {
  // First due date = midnight tomorrow
  const base = new Date(Date.now());
  base.setDate(base.getDate() + 1);
  base.setHours(0, 0, 0, 0);

  const dates = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(base);
    if (frequency === 'weekly') {
      d.setDate(base.getDate() + i * 7);
    } else if (frequency === 'biweekly') {
      d.setDate(base.getDate() + i * 14);
    } else {
      // monthly
      d.setMonth(base.getMonth() + i);
    }
    dates.push(d.toISOString().slice(0, 10));
  }
  return dates;
}

/**
 * Split a total amount into N installment amounts.
 * Each installment = floor(total / n * 100) / 100.
 * The last installment absorbs the rounding remainder.
 * @param {number} total
 * @param {number} count
 * @returns {number[]}
 */
function splitAmounts(total, count) {
  const unit = Math.floor((total / count) * 100) / 100;
  const amounts = Array(count).fill(unit);
  // Last installment gets the remainder to ensure exact sum
  const sumOfOthers = unit * (count - 1);
  amounts[count - 1] = Math.round((total - sumOfOthers) * 100) / 100;
  return amounts;
}

/**
 * Create a payment plan from an unpaid invoice.
 * Splits the invoice total into N installments based on frequency.
 */
async function createPlan({
  organizationId,
  clientId,
  invoiceId,
  totalAmount,
  installmentCount,
  frequency,
  notes,
  createdBy,
}) {
  // If an invoice is provided, use its total
  let resolvedTotal = totalAmount;
  if (invoiceId) {
    const [invRows] = await db.query(
      'SELECT * FROM invoices WHERE id = ? AND organization_id = ? AND deleted_at IS NULL',
      [invoiceId, organizationId],
    );
    const invoice = invRows[0];
    if (!invoice) throw new NotFoundError('invoices');
    resolvedTotal = parseFloat(invoice.total);
  }

  if (!resolvedTotal || resolvedTotal <= 0) {
    throw new ValidationError('total_amount must be greater than zero');
  }

  if (installmentCount < 1 || installmentCount > 60) {
    throw new ValidationError('installment_count must be between 1 and 60');
  }

  const dueDates = computeDueDates(installmentCount, frequency);
  const amounts = splitAmounts(resolvedTotal, installmentCount);

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [planResult] = await conn.execute(
      `INSERT INTO payment_plans
         (organization_id, client_id, total_amount, installment_count, frequency, status, notes, created_by)
       VALUES (?, ?, ?, ?, ?, 'active', ?, ?)`,
      [organizationId, clientId, resolvedTotal, installmentCount, frequency, notes || null, createdBy],
    );
    const planId = planResult.insertId;

    const installments = [];
    for (let i = 0; i < installmentCount; i++) {
      const [instResult] = await conn.execute(
        `INSERT INTO payment_plan_installments
           (plan_id, sequence, amount, due_date, status)
         VALUES (?, ?, ?, ?, 'pending')`,
        [planId, i + 1, amounts[i], dueDates[i]],
      );
      installments.push({
        id: instResult.insertId,
        plan_id: planId,
        sequence: i + 1,
        amount: amounts[i],
        due_date: dueDates[i],
        status: 'pending',
      });
    }

    await conn.commit();

    const [planRows] = await db.query('SELECT * FROM payment_plans WHERE id = ?', [planId]);
    return { plan: planRows[0], installments };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * Record payment for an installment.
 * Creates a payment_allocations entry linking the payment to the installment's invoice.
 * Marks installment as paid. If all installments paid → mark plan completed.
 */
async function payInstallment(planId, sequence, paymentId, orgId) {
  // Verify plan belongs to org
  const [planRows] = await db.query(
    'SELECT * FROM payment_plans WHERE id = ? AND organization_id = ? AND deleted_at IS NULL',
    [planId, orgId],
  );
  const plan = planRows[0];
  if (!plan) throw new NotFoundError('payment_plans');

  // Fetch installment
  const [instRows] = await db.query(
    'SELECT * FROM payment_plan_installments WHERE plan_id = ? AND sequence = ?',
    [planId, sequence],
  );
  const installment = instRows[0];
  if (!installment) throw new NotFoundError('payment_plan_installments');

  if (installment.status === 'paid') {
    throw new ValidationError('Installment is already paid');
  }

  // Verify payment exists and belongs to org
  const [payRows] = await db.query(
    'SELECT * FROM payments WHERE id = ? AND organization_id = ? AND deleted_at IS NULL',
    [paymentId, orgId],
  );
  const payment = payRows[0];
  if (!payment) throw new NotFoundError('payments');

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // Create payment allocation if invoice is linked to this installment
    if (installment.invoice_id) {
      await conn.execute(
        'INSERT INTO payment_allocations (payment_id, invoice_id, amount) VALUES (?, ?, ?)',
        [paymentId, installment.invoice_id, installment.amount],
      );
    }

    // Mark installment as paid
    await conn.execute(
      `UPDATE payment_plan_installments
         SET status = 'paid', paid_payment_id = ?, paid_at = NOW()
       WHERE plan_id = ? AND sequence = ?`,
      [paymentId, planId, sequence],
    );

    // Check if all installments are now paid
    const [remainRows] = await conn.execute(
      `SELECT COUNT(*) AS remaining
       FROM payment_plan_installments
       WHERE plan_id = ? AND status != 'paid'`,
      [planId],
    );
    const remaining = remainRows[0].remaining;

    if (remaining === 0) {
      await conn.execute(
        "UPDATE payment_plans SET status = 'completed' WHERE id = ?",
        [planId],
      );
    }

    await conn.commit();

    const [updatedInst] = await db.query(
      'SELECT * FROM payment_plan_installments WHERE plan_id = ? AND sequence = ?',
      [planId, sequence],
    );
    return updatedInst[0];
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * Check for overdue installments across all orgs.
 * Marks any pending installments with past due_date as overdue.
 * Emits a notification event if the notification_events table exists.
 */
async function checkInstallmentsDue() {
  logger.info('Checking for overdue installments');

  try {
    // Mark overdue installments
    const [result] = await db.query(
      `UPDATE payment_plan_installments
         SET status = 'overdue'
       WHERE status = 'pending' AND due_date < CURDATE()`,
    );

    const affectedCount = result.affectedRows;
    logger.info({ affectedCount }, 'Marked installments as overdue');

    if (affectedCount === 0) return;

    // Fetch newly overdue installments to emit notifications
    const [overdueRows] = await db.query(
      `SELECT ppi.*, pp.organization_id, pp.client_id
       FROM payment_plan_installments ppi
       JOIN payment_plans pp ON pp.id = ppi.plan_id
       WHERE ppi.status = 'overdue' AND ppi.due_date < CURDATE()
       LIMIT 500`,
    );

    // There is no `notification_events` table in the schema and never has been
    // (database/schema.sql), so the INSERT that used to be here threw for every
    // row and the catch below swallowed it — the log line was the only thing that
    // ever ran. Log honestly instead of pretending to enqueue an event.
    // TODO: emit a real notification once overdue installments have a channel.
    for (const inst of overdueRows) {
      logger.info(
        {
          organization_id: inst.organization_id,
          client_id: inst.client_id,
          plan_id: inst.plan_id,
          installment_id: inst.id,
          sequence: inst.sequence,
          amount: inst.amount,
          due_date: inst.due_date,
        },
        'Overdue installment detected (no notification channel wired yet)',
      );
    }
  } catch (err) {
    logger.error({ err }, 'Error checking installments due');
    throw err;
  }
}

/**
 * Get a plan with its installments.
 */
async function getPlanWithInstallments(planId, orgId) {
  const [planRows] = await db.query(
    'SELECT * FROM payment_plans WHERE id = ? AND organization_id = ? AND deleted_at IS NULL',
    [planId, orgId],
  );
  const plan = planRows[0];
  if (!plan) throw new NotFoundError('payment_plans');

  const [installments] = await db.query(
    'SELECT * FROM payment_plan_installments WHERE plan_id = ? ORDER BY sequence ASC',
    [planId],
  );

  return { plan, installments };
}

module.exports = { createPlan, payInstallment, checkInstallmentsDue, getPlanWithInstallments };
