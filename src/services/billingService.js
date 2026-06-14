// =============================================================================
// FireISP 5.0 — Billing Service
// =============================================================================
// Handles billing period generation, invoice creation, tax calculation,
// and client balance ledger updates.
// =============================================================================

const db = require('../config/database');
const Invoice = require('../models/Invoice');
const logger = require('../utils/logger').child({ service: 'billing' });
const { InvoiceGenerationError } = require('../utils/errors');

/**
 * Check if a contract is currently within its free trial period.
 *
 * @param {object} contract - Contract row with start_date
 * @param {object} plan - Plan row with trial_days
 * @returns {boolean}
 */
function isContractInTrial(contract, plan) {
  if (!plan.trial_days || plan.trial_days <= 0) return false;
  const startDate = new Date(contract.start_date);
  const trialEnd = new Date(startDate);
  trialEnd.setDate(trialEnd.getDate() + plan.trial_days);
  return new Date() < trialEnd;
}

/**
 * Calculate overage charges for a contract within a billing period.
 *
 * @param {number} contractId
 * @param {string|Date} periodStart
 * @param {string|Date} periodEnd
 * @returns {{ overage_gb: number, amount: number }}
 */
async function calculateOverageCharges(contractId, periodStart, periodEnd) {
  const [rows] = await db.query(`
    SELECT
      p.data_cap_gb,
      p.overage_mode,
      p.overage_price_per_gb,
      COALESCE(SUM(cl.bytes_in + cl.bytes_out), 0) AS bytes_used
    FROM contracts c
    JOIN plans p ON p.id = c.plan_id
    LEFT JOIN connection_logs cl ON cl.contract_id = c.id
      AND cl.event_type IN ('stop', 'interim-update')
      AND cl.event_at >= ?
      AND cl.event_at <= ?
    WHERE c.id = ?
    GROUP BY p.data_cap_gb, p.overage_mode, p.overage_price_per_gb
  `, [periodStart, periodEnd, contractId]);

  if (rows.length === 0) return { overage_gb: 0, amount: 0 };

  const r = rows[0];
  if (r.overage_mode !== 'per_gb' || !r.data_cap_gb || !r.overage_price_per_gb) {
    return { overage_gb: 0, amount: 0 };
  }

  const BYTES_PER_GB = 1073741824;
  const usedGb = r.bytes_used / BYTES_PER_GB;
  const overageGb = Math.max(0, usedGb - parseFloat(r.data_cap_gb));

  if (overageGb <= 0) return { overage_gb: 0, amount: 0 };

  const amount = Math.round(overageGb * parseFloat(r.overage_price_per_gb) * 100) / 100;
  return { overage_gb: parseFloat(overageGb.toFixed(3)), amount };
}

/**
 * Generate billing periods for a contract.
 * Creates the next billing period if one doesn't already exist.
 */
async function generateBillingPeriod(contract) {
  logger.info({ contractId: contract.id }, 'Generating billing period');

  // Skip trial contracts — no billing period during trial
  if (contract._plan && isContractInTrial(contract, contract._plan)) {
    logger.info({ contractId: contract.id }, 'Contract is in trial period, skipping billing period generation');
    return null;
  }

  // Check if there's already a pending period
  const [existing] = await db.query(
    `SELECT * FROM billing_periods
     WHERE contract_id = ? AND status = 'pending'
     ORDER BY period_end DESC LIMIT 1`,
    [contract.id],
  );

  if (existing.length > 0) {
    logger.debug({ contractId: contract.id, periodId: existing[0].id }, 'Pending period already exists');
    return existing[0]; // Already has a pending period
  }

  // Find the last invoiced period to determine next window
  const [lastPeriod] = await db.query(
    `SELECT * FROM billing_periods
     WHERE contract_id = ? AND status = 'invoiced'
     ORDER BY period_end DESC LIMIT 1`,
    [contract.id],
  );

  let periodStart;
  if (lastPeriod.length > 0) {
    periodStart = new Date(lastPeriod[0].period_end);
    periodStart.setDate(periodStart.getDate() + 1);
  } else {
    periodStart = new Date(contract.start_date);
  }

  const periodEnd = new Date(periodStart);
  periodEnd.setMonth(periodEnd.getMonth() + 1);
  periodEnd.setDate(periodEnd.getDate() - 1);

  const scheduledAt = new Date(periodStart);
  scheduledAt.setDate(contract.billing_day || 1);

  const [result] = await db.query(
    `INSERT INTO billing_periods (contract_id, period_start, period_end, status, scheduled_at)
     VALUES (?, ?, ?, 'pending', ?)`,
    [contract.id, periodStart, periodEnd, scheduledAt],
  );

  const [rows] = await db.query('SELECT * FROM billing_periods WHERE id = ?', [result.insertId]);
  logger.info({ contractId: contract.id, periodId: result.insertId }, 'Billing period created');
  return rows[0];
}

/**
 * Generate an invoice from a billing period.
 */
async function generateInvoice(billingPeriod, contract, plan, orgId) {
  logger.info({ contractId: contract.id, periodId: billingPeriod.id, orgId }, 'Generating invoice');

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // Lock the billing period row to prevent duplicate invoice generation
    const [lockedPeriods] = await conn.execute(
      'SELECT * FROM billing_periods WHERE id = ? FOR UPDATE',
      [billingPeriod.id],
    );
    if (lockedPeriods.length > 0 && lockedPeriods[0].status !== 'pending') {
      await conn.rollback();
      conn.release();
      return Invoice.findById(lockedPeriods[0].invoice_id);
    }

    // Get the effective price (override or plan price; use trial_price if in trial)
    const inTrial = isContractInTrial(contract, plan);
    const price = inTrial ? parseFloat(plan.trial_price || 0) : (contract.price_override || plan.price);
    const currency = plan.currency || 'USD';

    // Get applicable tax rate
    const [taxRates] = await conn.execute(
      `SELECT * FROM tax_rates WHERE id = ? OR (organization_id = ? AND is_default = TRUE)
       ORDER BY id = ? DESC LIMIT 1`,
      [contract.tax_rate_id || 0, orgId, contract.tax_rate_id || 0],
    );
    const taxRate = taxRates[0];
    const taxPct = taxRate ? parseFloat(taxRate.rate) : 0;

    const subtotal = parseFloat(price);
    const taxAmount = Math.round(subtotal * taxPct) / 100;
    const total = subtotal + taxAmount;

    // Generate invoice number
    const [countResult] = await conn.execute(
      'SELECT COUNT(*) AS cnt FROM invoices WHERE organization_id = ?',
      [orgId],
    );
    const invoiceNumber = `INV-${String(countResult[0].cnt + 1).padStart(6, '0')}`;

    // Due date = period end + 15 days
    const dueDate = new Date(billingPeriod.period_end);
    dueDate.setDate(dueDate.getDate() + 15);

    // Create invoice
    const [invResult] = await conn.execute(
      `INSERT INTO invoices (organization_id, client_id, contract_id, invoice_number,
       subtotal, tax_amount, total, currency, tax_rate, tax_rate_id, due_date, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'issued')`,
      [orgId, contract.client_id, contract.id, invoiceNumber,
        subtotal, taxAmount, total, currency, taxPct,
        taxRate?.id || null, dueDate],
    );
    const invoiceId = invResult.insertId;

    // Add line item for the plan
    await conn.execute(
      `INSERT INTO invoice_items (invoice_id, description, quantity, unit_price, amount)
       VALUES (?, ?, 1, ?, ?)`,
      [invoiceId, `${plan.name} — ${billingPeriod.period_start} to ${billingPeriod.period_end}`, price, price],
    );

    // Add overage line item if applicable
    if (!inTrial && plan.overage_mode === 'per_gb') {
      const overage = await calculateOverageCharges(contract.id, billingPeriod.period_start, billingPeriod.period_end);
      if (overage.overage_gb > 0) {
        await conn.execute(
          `INSERT INTO invoice_items (invoice_id, description, quantity, unit_price, amount)
           VALUES (?, ?, ?, ?, ?)`,
          [invoiceId, `Data overage — ${overage.overage_gb} GB @ ${plan.currency || 'USD'} ${plan.overage_price_per_gb}/GB`,
            overage.overage_gb, parseFloat(plan.overage_price_per_gb), overage.amount],
        );
        // Update invoice totals for overage
        const newSubtotal = subtotal + overage.amount;
        const newTaxAmount = Math.round(newSubtotal * taxPct) / 100;
        const newTotal = newSubtotal + newTaxAmount;
        await conn.execute(
          'UPDATE invoices SET subtotal = ?, tax_amount = ?, total = ? WHERE id = ?',
          [newSubtotal, newTaxAmount, newTotal, invoiceId],
        );
      }
    }

    // Add line items for contract add-ons
    const [addons] = await conn.execute(
      `SELECT ca.*, pa.name AS addon_name, pa.price AS addon_price
       FROM contract_addons ca
       JOIN plan_addons pa ON pa.id = ca.plan_addon_id
       WHERE ca.contract_id = ? AND ca.status = 'active'`,
      [contract.id],
    );

    for (const addon of addons) {
      const addonPrice = addon.unit_price || addon.addon_price;
      const addonTotal = addonPrice * (addon.quantity || 1);
      await conn.execute(
        `INSERT INTO invoice_items (invoice_id, description, quantity, unit_price, amount)
         VALUES (?, ?, ?, ?, ?)`,
        [invoiceId, addon.addon_name, addon.quantity || 1, addonPrice, addonTotal],
      );
    }

    // Update billing period
    await conn.execute(
      'UPDATE billing_periods SET status = \'invoiced\', invoice_id = ? WHERE id = ?',
      [invoiceId, billingPeriod.id],
    );

    // Debit client balance ledger
    await conn.execute(
      `INSERT INTO client_balance_ledger (client_id, organization_id, entry_type, amount, currency, reference_type, reference_id, description)
       VALUES (?, ?, 'debit', ?, ?, 'invoice', ?, ?)`,
      [contract.client_id, orgId, total, currency, invoiceId, `Invoice ${invoiceNumber}`],
    );

    await conn.commit();

    logger.info({ contractId: contract.id, invoiceId, invoiceNumber, total, currency }, 'Invoice generated');
    return Invoice.findById(invoiceId);
  } catch (err) {
    await conn.rollback();
    throw new InvoiceGenerationError(
      `Failed to generate invoice for contract ${contract.id}: ${err.message}`,
      { contractId: contract.id, periodId: billingPeriod.id, cause: err.message },
    );
  } finally {
    conn.release();
  }
}

/**
 * Calculate a prorated amount for a mid-cycle plan change.
 *
 * @param {object} params
 * @param {number} params.oldPrice - Price of the old plan
 * @param {number} params.newPrice - Price of the new plan
 * @param {Date|string} params.changeDate - Date the plan change takes effect
 * @param {Date|string} params.periodStart - Start of the current billing period
 * @param {Date|string} params.periodEnd - End of the current billing period
 * @returns {{ credit: number, charge: number, net: number, daysRemaining: number, totalDays: number }}
 */
function calculateProration({ oldPrice, newPrice, changeDate, periodStart, periodEnd }) {
  const start = new Date(periodStart);
  const end = new Date(periodEnd);
  const change = new Date(changeDate);

  // Total days in the billing period (inclusive)
  const totalDays = Math.round((end - start) / (1000 * 60 * 60 * 24)) + 1;
  // Days remaining from change date to period end (inclusive)
  const daysRemaining = Math.max(0, Math.round((end - change) / (1000 * 60 * 60 * 24)) + 1);

  if (totalDays <= 0 || daysRemaining <= 0) {
    return { credit: 0, charge: 0, net: 0, daysRemaining: 0, totalDays };
  }

  const dailyOld = parseFloat(oldPrice) / totalDays;
  const dailyNew = parseFloat(newPrice) / totalDays;

  // Credit for unused days of old plan
  const credit = Math.round(dailyOld * daysRemaining * 100) / 100;
  // Charge for remaining days on new plan
  const charge = Math.round(dailyNew * daysRemaining * 100) / 100;
  // Net adjustment (positive = customer owes more, negative = credit)
  const net = Math.round((charge - credit) * 100) / 100;

  return { credit, charge, net, daysRemaining, totalDays };
}

/**
 * Record a payment and update client balance.
 */
async function recordPaymentCredit(payment, orgId) {
  logger.info({ paymentId: payment.id, clientId: payment.client_id, amount: payment.amount }, 'Recording payment credit');
  await db.query(
    `INSERT INTO client_balance_ledger (client_id, organization_id, entry_type, amount, currency, reference_type, reference_id, description)
     VALUES (?, ?, 'credit', ?, ?, 'payment', ?, ?)`,
    [payment.client_id, orgId, payment.amount, payment.currency || 'USD', payment.id, 'Payment ' + (payment.reference_number || payment.id)],
  );
}

module.exports = { generateBillingPeriod, generateInvoice, calculateProration, recordPaymentCredit, isContractInTrial, calculateOverageCharges };
