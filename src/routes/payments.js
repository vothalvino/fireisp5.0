// =============================================================================
// FireISP 5.0 — Payment Routes
// =============================================================================

const { Router } = require('express');
const Payment = require('../models/Payment');
const { crudController } = require('../controllers/crudController');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { createPayment, updatePayment, patchPayment, allocatePayment } = require('../middleware/schemas/payments');
const billingService = require('../services/billingService');
const suspensionService = require('../services/suspensionService');
const db = require('../config/database');

const router = Router();
// Keep the client balance ledger in sync with the payment lifecycle. Creating a
// payment writes a 'payment' credit (see the POST handler below); deleting one
// must remove that credit, otherwise the ledger and the computed balance keep
// showing a payment that has vanished from the Payments tab. Restoring re-adds it.
const ctrl = crudController(Payment, {
  afterDelete: async (payment) => {
    await billingService.reversePaymentCredit(payment.id);
    // Also undo its invoice allocations so an invoice isn't left flagged 'paid'
    // while the balance now shows it owed again.
    await billingService.reversePaymentAllocations(payment.id);
  },
  afterRestore: async (payment, req) => {
    await billingService.reversePaymentCredit(payment.id); // idempotent — avoid a double credit
    await billingService.recordPaymentCredit(payment, req.orgId);
    await billingService.restorePaymentAllocations(payment.id);
  },
});

router.use(authenticate);
router.use(orgScope);

router.get('/', requirePermission('payments.view'), ctrl.list);
router.get('/:id', requirePermission('payments.view'), ctrl.get);

// Create a payment and optionally allocate + reconnect
router.post('/', requirePermission('payments.create'), validate(createPayment), async (req, res, next) => {
  try {
    req.body.organization_id = req.orgId;
    const payment = await Payment.create(req.body);

    // Update client balance ledger
    await billingService.recordPaymentCredit(payment, req.orgId);

    res.status(201).json({ data: payment });
  } catch (err) {
    next(err);
  }
});

router.put('/:id', requirePermission('payments.update'), validate(updatePayment), ctrl.update);
router.patch('/:id', requirePermission('payments.update'), validate(patchPayment), ctrl.partialUpdate);
router.delete('/:id', requirePermission('payments.delete'), ctrl.destroy);
router.post('/:id/restore', requirePermission('payments.update'), ctrl.restore);

// Allocate payment to invoice
router.post('/:id/allocate', requirePermission('payments.create'), validate(allocatePayment), async (req, res, next) => {
  try {
    const { invoice_id, amount } = req.body;

    // Validate invoice exists and is not void BEFORE inserting the allocation.
    // A voided invoice's total is NOT zeroed on void (only its ledger entries are),
    // so the over-allocation trigger would otherwise still let the apply through.
    const [invoiceRows] = await db.query('SELECT * FROM invoices WHERE id = ? AND deleted_at IS NULL', [invoice_id]);
    const invoice = invoiceRows[0];
    if (!invoice) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Invoice not found.' } });
    }
    if (invoice.status === 'void' || invoice.status === 'cancelled') {
      return res.status(422).json({ error: { code: 'INVOICE_NOT_PAYABLE', message: `Cannot apply a payment to a ${invoice.status} invoice.` } });
    }

    let allocation;
    try {
      allocation = await Payment.allocate(req.params.id, invoice_id, amount);
    } catch (allocErr) {
      // Over-allocation guard trigger (SQLSTATE 45000) fires when the amount
      // would exceed the invoice or payment total. Mirror the reallocate handler.
      if (allocErr.sqlState === '45000' || allocErr.errno === 1644) {
        return res.status(422).json({
          error: { code: 'OVER_ALLOCATION', message: 'Allocation would exceed the invoice or payment total.' },
        });
      }
      throw allocErr;
    }

    // Check if invoice is now fully paid (reuse the already-fetched invoice for total)
    const [allocRows] = await db.query(
      'SELECT SUM(amount) AS total_allocated FROM payment_allocations WHERE invoice_id = ? AND deleted_at IS NULL',
      [invoice_id],
    );
    const totalAllocated = parseFloat(allocRows[0].total_allocated || 0);
    if (totalAllocated >= parseFloat(invoice.total)) {
      await db.query(
        'UPDATE invoices SET status = ?, paid_at = NOW() WHERE id = ?',
        ['paid', invoice_id],
      );

      // Check if contract was suspended → reconnect
      if (invoice.contract_id) {
        const [contractRows] = await db.query(
          'SELECT * FROM contracts WHERE id = ? AND status = ? AND deleted_at IS NULL',
          [invoice.contract_id, 'suspended'],
        );
        if (contractRows[0]) {
          await suspensionService.reconnectContract(
            invoice.contract_id, req.user.id, invoice_id,
          );
        }
      }
    }

    res.status(201).json({ data: allocation });
  } catch (err) {
    next(err);
  }
});

// Get payment allocations
router.get('/:id/allocations', requirePermission('payments.view'), async (req, res, next) => {
  try {
    const allocations = await Payment.getAllocations(req.params.id);
    res.json({ data: allocations });
  } catch (err) {
    next(err);
  }
});

// Thermal receipt — plain-text monospaced format for 58mm or 80mm printers
router.get('/:id/receipt', requirePermission('payments.view'), async (req, res, next) => {
  try {
    const thermalReceiptService = require('../services/thermalReceiptService');
    const widthStr = req.query.width;
    const width = widthStr === '58' ? 32 : 48;
    const text = await thermalReceiptService.generatePaymentThermalReceipt(
      parseInt(req.params.id, 10),
      { width },
    );
    res.set('Content-Type', 'text/plain; charset=utf-8');
    res.send(text);
  } catch (err) {
    next(err);
  }
});

// Reallocate a payment from one invoice to another (SAME CLIENT ONLY).
// Body: { from_invoice_id, to_invoice_id, amount? }
// amount defaults to the existing allocation's amount if omitted.
// Both invoices must belong to the same client as the payment.
// The DB over-allocation trigger fires on the new INSERT — surfaces as 422.
router.post('/:id/reallocate', requirePermission('payments.update'), async (req, res, next) => {
  const conn = await db.getConnection();
  try {
    const paymentId = parseInt(req.params.id, 10);
    const { from_invoice_id, to_invoice_id, amount: amountParam } = req.body;

    if (!from_invoice_id || !to_invoice_id) {
      return res.status(422).json({
        error: { code: 'VALIDATION_ERROR', message: 'from_invoice_id and to_invoice_id are required.' },
      });
    }
    if (Number(from_invoice_id) === Number(to_invoice_id)) {
      return res.status(422).json({
        error: { code: 'VALIDATION_ERROR', message: 'from_invoice_id and to_invoice_id must differ.' },
      });
    }

    await conn.beginTransaction();

    // Load payment (org-scoped)
    const [payRows] = await conn.execute(
      'SELECT * FROM payments WHERE id = ? AND organization_id = ? AND deleted_at IS NULL',
      [paymentId, req.orgId],
    );
    if (!payRows[0]) {
      await conn.rollback();
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Payment not found.' } });
    }
    const payment = payRows[0];

    // Load the live allocation from → invoice
    const [allocRows] = await conn.execute(
      'SELECT * FROM payment_allocations WHERE payment_id = ? AND invoice_id = ? AND deleted_at IS NULL LIMIT 1',
      [paymentId, from_invoice_id],
    );
    if (!allocRows[0]) {
      await conn.rollback();
      return res.status(422).json({
        error: { code: 'ALLOCATION_NOT_FOUND', message: 'This payment has no live allocation to from_invoice_id.' },
      });
    }
    const existingAlloc = allocRows[0];
    const moveAmount = amountParam !== null && amountParam !== undefined ? parseFloat(amountParam) : parseFloat(existingAlloc.amount);

    // Validate both invoices belong to the payment's client
    const [invRows] = await conn.execute(
      'SELECT id, client_id, status FROM invoices WHERE id IN (?, ?) AND deleted_at IS NULL',
      [from_invoice_id, to_invoice_id],
    );
    const fromInv = invRows.find(r => r.id === from_invoice_id || r.id === Number(from_invoice_id));
    const toInv   = invRows.find(r => r.id === to_invoice_id   || r.id === Number(to_invoice_id));

    if (!fromInv) {
      await conn.rollback();
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'from_invoice_id not found.' } });
    }
    if (!toInv) {
      await conn.rollback();
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'to_invoice_id not found.' } });
    }
    // Reallocating TO a void/cancelled invoice makes no sense — it owes nothing.
    // Reallocating AWAY from such an invoice (from_invoice) is allowed.
    if (toInv.status === 'void' || toInv.status === 'cancelled') {
      await conn.rollback();
      return res.status(422).json({
        error: { code: 'INVOICE_NOT_PAYABLE', message: `Cannot reallocate a payment to a ${toInv.status} invoice.` },
      });
    }
    if (Number(toInv.client_id) !== Number(payment.client_id)) {
      await conn.rollback();
      return res.status(422).json({
        error: {
          code: 'CROSS_CLIENT_REALLOCATION',
          message: 'to_invoice_id belongs to a different client. Reassign the payment to that client first.',
        },
      });
    }
    if (Number(fromInv.client_id) !== Number(payment.client_id)) {
      await conn.rollback();
      return res.status(422).json({
        error: {
          code: 'CROSS_CLIENT_REALLOCATION',
          message: 'from_invoice_id belongs to a different client than this payment.',
        },
      });
    }

    // Soft-delete the old allocation
    await conn.execute(
      'UPDATE payment_allocations SET deleted_at = NOW() WHERE id = ? AND deleted_at IS NULL',
      [existingAlloc.id],
    );

    // Insert the new allocation — DB trigger enforces over-allocation caps
    let newAllocId;
    try {
      const [insertResult] = await conn.execute(
        'INSERT INTO payment_allocations (payment_id, invoice_id, amount) VALUES (?, ?, ?)',
        [paymentId, to_invoice_id, moveAmount],
      );
      newAllocId = insertResult.insertId;
    } catch (allocErr) {
      // Over-allocation guard trigger (migration 126/370) raises SQLSTATE 45000.
      if (allocErr.sqlState === '45000' || allocErr.errno === 1644) {
        await conn.rollback();
        return res.status(422).json({
          error: { code: 'OVER_ALLOCATION', message: 'Allocation would exceed the invoice or payment total.' },
        });
      }
      // The soft-delete-aware UNIQUE (migration 361) rejects a SECOND live
      // allocation of this payment to the same invoice.
      if (allocErr.code === 'ER_DUP_ENTRY' || allocErr.errno === 1062) {
        await conn.rollback();
        return res.status(422).json({
          error: { code: 'ALLOCATION_EXISTS', message: 'This payment is already applied to that invoice.' },
        });
      }
      throw allocErr; // unexpected/infra error — outer catch rolls back + 500s
    }

    await conn.commit();

    // Re-derive paid status for both invoices (outside the transaction — reads committed state)
    await billingService.refreshInvoicePaidStatus(from_invoice_id);
    await billingService.refreshInvoicePaidStatus(to_invoice_id);

    const [newAllocRows] = await db.query('SELECT * FROM payment_allocations WHERE id = ?', [newAllocId]);
    res.status(201).json({ data: newAllocRows[0] });
  } catch (err) {
    await conn.rollback().catch(() => {});
    next(err);
  } finally {
    conn.release();
  }
});

// Reassign a payment to a different client (ONLY IF UNALLOCATED).
// Body: { new_client_id }
// The payment must have NO live payment_allocations. Callers must un-apply first.
// Moves the ledger credit from the old client to the new client atomically.
router.post('/:id/reassign', requirePermission('payments.update'), async (req, res, next) => {
  const conn = await db.getConnection();
  try {
    const paymentId = parseInt(req.params.id, 10);
    const { new_client_id } = req.body;

    if (!new_client_id) {
      return res.status(422).json({
        error: { code: 'VALIDATION_ERROR', message: 'new_client_id is required.' },
      });
    }

    await conn.beginTransaction();

    // Load payment (org-scoped)
    const [payRows] = await conn.execute(
      'SELECT * FROM payments WHERE id = ? AND organization_id = ? AND deleted_at IS NULL',
      [paymentId, req.orgId],
    );
    if (!payRows[0]) {
      await conn.rollback();
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Payment not found.' } });
    }
    const payment = payRows[0];

    // Validate new client exists in this org
    const [clientRows] = await conn.execute(
      'SELECT id FROM clients WHERE id = ? AND organization_id = ? AND deleted_at IS NULL',
      [new_client_id, req.orgId],
    );
    if (!clientRows[0]) {
      await conn.rollback();
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'new_client_id not found in this organization.' } });
    }

    // Reject if there are live allocations. NOTE: this read is not FOR UPDATE and
    // the apply path (POST /:id/allocate) is non-transactional, so a precisely
    // concurrent allocate could slip in between this check and the commit. That is
    // an accepted limitation for this single-tenant admin tool (two simultaneous
    // admin actions on the same unallocated payment; manually recoverable).
    const [allocCheck] = await conn.execute(
      'SELECT COUNT(*) AS cnt FROM payment_allocations WHERE payment_id = ? AND deleted_at IS NULL',
      [paymentId],
    );
    if (Number(allocCheck[0].cnt) > 0) {
      await conn.rollback();
      return res.status(422).json({
        error: {
          code: 'PAYMENT_ALLOCATED',
          message: 'Un-apply this payment from its invoice(s) before reassigning it to another client.',
        },
      });
    }

    // Reverse the old client's ledger credit
    await conn.execute(
      'DELETE FROM client_balance_ledger WHERE reference_type = ? AND reference_id = ?',
      ['payment', paymentId],
    );

    // Move the payment to the new client
    await conn.execute(
      'UPDATE payments SET client_id = ? WHERE id = ?',
      [new_client_id, paymentId],
    );

    // Record the credit for the new client
    await conn.execute(
      `INSERT INTO client_balance_ledger
         (client_id, organization_id, entry_type, amount, currency, reference_type, reference_id, description)
       VALUES (?, ?, 'credit', ?, ?, 'payment', ?, ?)`,
      [
        new_client_id, req.orgId,
        payment.amount, payment.currency || 'USD',
        paymentId, 'Payment ' + (payment.reference_number || paymentId),
      ],
    );

    await conn.commit();

    // Return the updated payment
    const [updatedRows] = await db.query(
      'SELECT * FROM payments WHERE id = ? AND deleted_at IS NULL',
      [paymentId],
    );
    res.json({ data: updatedRows[0] });
  } catch (err) {
    await conn.rollback().catch(() => {});
    next(err);
  } finally {
    conn.release();
  }
});

// Un-apply (de-allocate) a payment from a specific invoice.
// Body: { invoice_id }
// Soft-deletes the live payment_allocation so the payment becomes an
// unallocated credit on the same client. The payment's ledger 'payment'
// credit is NOT touched — only the invoice link is removed.
// billingService.refreshInvoicePaidStatus reverts the invoice paid→issued
// if no other allocations still cover it.
router.post('/:id/unapply', requirePermission('payments.update'), async (req, res, next) => {
  const conn = await db.getConnection();
  try {
    const paymentId = parseInt(req.params.id, 10);
    const { invoice_id } = req.body;

    if (!invoice_id) {
      return res.status(422).json({
        error: { code: 'VALIDATION_ERROR', message: 'invoice_id is required.' },
      });
    }

    await conn.beginTransaction();

    // Load payment (org-scoped)
    const [payRows] = await conn.execute(
      'SELECT * FROM payments WHERE id = ? AND organization_id = ? AND deleted_at IS NULL',
      [paymentId, req.orgId],
    );
    if (!payRows[0]) {
      await conn.rollback();
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Payment not found.' } });
    }

    // Find the live allocation for this payment + invoice pair
    const [allocRows] = await conn.execute(
      'SELECT * FROM payment_allocations WHERE payment_id = ? AND invoice_id = ? AND deleted_at IS NULL LIMIT 1',
      [paymentId, invoice_id],
    );
    if (!allocRows[0]) {
      await conn.rollback();
      return res.status(422).json({
        error: { code: 'ALLOCATION_NOT_FOUND', message: 'This payment is not applied to that invoice.' },
      });
    }

    // Soft-delete the allocation
    await conn.execute(
      'UPDATE payment_allocations SET deleted_at = NOW() WHERE id = ?',
      [allocRows[0].id],
    );

    await conn.commit();

    // Re-derive paid status for the invoice (outside the transaction — reads committed state).
    // This reverts the invoice paid→issued if no longer fully covered.
    await billingService.refreshInvoicePaidStatus(invoice_id);

    res.json({ data: { payment_id: paymentId, invoice_id: Number(invoice_id), unapplied: true } });
  } catch (err) {
    await conn.rollback().catch(() => {});
    next(err);
  } finally {
    conn.release();
  }
});

// Send payment receipt PDF via email
router.post('/:id/send-receipt', requirePermission('payments.view'), async (req, res, next) => {
  try {
    const paymentId = parseInt(req.params.id, 10);
    const pdfService = require('../services/pdfService');
    const emailTransport = require('../services/emailTransport');

    // Fetch payment with client info
    const [rows] = await db.query(
      `SELECT p.*, cl.name, cl.email AS client_email,
              o.name AS org_name
       FROM payments p
       LEFT JOIN clients cl ON cl.id = p.client_id
       LEFT JOIN organizations o ON o.id = cl.organization_id
       WHERE p.id = ? AND p.deleted_at IS NULL`,
      [paymentId],
    );
    const payment = rows[0];
    if (!payment) return res.status(404).json({ error: 'Payment not found' });
    if (!payment.client_email) return res.status(422).json({ error: 'Client has no email address' });

    const locale = req.query.locale || 'en';
    const buffer = await pdfService.generatePaymentReceiptPdf(paymentId, { locale });

    const templates = require('../views/emailTemplates');
    const template = templates.paymentReceiptEmail({
      clientName: payment.name || '',
      orgName: payment.org_name,
      amount: payment.amount,
      currency: payment.currency,
      paymentMethod: payment.payment_method,
      reference: payment.reference_number || payment.reference,
      paymentDate: payment.payment_date
        ? new Date(payment.payment_date).toISOString().slice(0, 10)
        : undefined,
    });

    await emailTransport.sendEmail({
      organizationId: req.orgId,
      to: payment.client_email,
      subject: template.subject,
      html: template.html,
      attachments: [{ filename: `receipt-${paymentId}.pdf`, content: buffer }],
    });

    res.json({ message: 'Receipt sent', to: payment.client_email });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
