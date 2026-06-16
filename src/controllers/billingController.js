// =============================================================================
// FireISP 5.0 — Billing Controller
// =============================================================================
// Domain-specific endpoints for the billing workflow:
//   generate billing period → create invoice → allocate payment → ledger.
// =============================================================================

const db = require('../config/database');
const billingService = require('../services/billingService');

/**
 * POST /api/billing/generate-period
 * Generate the next billing period for a contract.
 */
async function generatePeriod(req, res, next) {
  try {
    const { contract_id } = req.body;

    const [contracts] = await db.query(
      'SELECT * FROM contracts WHERE id = ? AND organization_id = ?',
      [contract_id, req.orgId],
    );
    if (!contracts[0]) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Contract not found' } });
    }

    const period = await billingService.generateBillingPeriod(contracts[0]);
    res.status(201).json({ data: period });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/billing/generate-invoice
 * Generate a billing period then immediately produce an invoice.
 */
async function generateInvoice(req, res, next) {
  try {
    const { contract_id } = req.body;

    const [contracts] = await db.query(
      'SELECT * FROM contracts WHERE id = ? AND organization_id = ?',
      [contract_id, req.orgId],
    );
    if (!contracts[0]) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Contract not found' } });
    }
    const contract = contracts[0];

    const [plans] = await db.query('SELECT * FROM plans WHERE id = ?', [contract.plan_id]);
    if (!plans[0]) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Plan not found' } });
    }

    const period = await billingService.generateBillingPeriod(contract);
    const invoice = await billingService.generateInvoice(period, contract, plans[0], req.orgId);
    res.status(201).json({ data: invoice });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/billing/allocate-payment
 * Allocate a payment to one or more invoices.
 */
async function allocatePayment(req, res, next) {
  try {
    const { payment_id, allocations } = req.body;

    // Validate payment exists and belongs to org
    const [payments] = await db.query(
      'SELECT * FROM payments WHERE id = ? AND organization_id = ?',
      [payment_id, req.orgId],
    );
    if (!payments[0]) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Payment not found' } });
    }
    const payment = payments[0];

    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();

      const results = [];
      for (const alloc of allocations) {
        const [result] = await conn.execute(
          `INSERT INTO payment_allocations (payment_id, invoice_id, amount, currency)
           VALUES (?, ?, ?, ?)`,
          [payment_id, alloc.invoice_id, alloc.amount, payment.currency || 'USD'],
        );
        results.push({ id: result.insertId, invoice_id: alloc.invoice_id, amount: alloc.amount });

        // Check if invoice is fully paid and update status
        const [totals] = await conn.execute(
          'SELECT COALESCE(SUM(amount), 0) AS paid FROM payment_allocations WHERE invoice_id = ? AND deleted_at IS NULL',
          [alloc.invoice_id],
        );
        const [inv] = await conn.execute(
          'SELECT total FROM invoices WHERE id = ?',
          [alloc.invoice_id],
        );

        if (inv[0] && parseFloat(totals[0].paid) >= parseFloat(inv[0].total)) {
          await conn.execute(
            'UPDATE invoices SET status = ? WHERE id = ?',
            ['paid', alloc.invoice_id],
          );
        }
      }

      // Record credit on client balance ledger
      await billingService.recordPaymentCredit(payment, req.orgId);

      await conn.commit();
      res.status(201).json({ data: { payment_id, allocations: results } });
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/billing/bulk-generate
 * Generate invoices for all active contracts in the organization.
 */
async function bulkGenerate(req, res, next) {
  try {
    const [contracts] = await db.query(
      `SELECT c.*, p.name AS plan_name, p.price AS plan_price, p.currency AS plan_currency
       FROM contracts c
       JOIN plans p ON p.id = c.plan_id
       WHERE c.status = 'active' AND c.organization_id = ?`,
      [req.orgId],
    );

    let generated = 0;
    const errors = [];

    for (const contract of contracts) {
      try {
        const period = await billingService.generateBillingPeriod(contract);
        if (period.status === 'pending') {
          const plan = { name: contract.plan_name, price: contract.plan_price, currency: contract.plan_currency };
          await billingService.generateInvoice(period, contract, plan, req.orgId);
          generated++;
        }
      } catch (err) {
        errors.push({ contract_id: contract.id, error: err.message });
      }
    }

    res.json({ data: { generated, total_contracts: contracts.length, errors } });
  } catch (err) {
    next(err);
  }
}

module.exports = { generatePeriod, generateInvoice, allocatePayment, bulkGenerate };
