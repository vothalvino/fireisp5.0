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
  afterDelete: (payment) => billingService.reversePaymentCredit(payment.id),
  afterRestore: async (payment, req) => {
    await billingService.reversePaymentCredit(payment.id); // idempotent — avoid a double credit
    await billingService.recordPaymentCredit(payment, req.orgId);
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
    const allocation = await Payment.allocate(req.params.id, invoice_id, amount);

    // Check if invoice is now fully paid
    const [invoiceRows] = await db.query('SELECT * FROM invoices WHERE id = ? AND deleted_at IS NULL', [invoice_id]);
    const invoice = invoiceRows[0];
    if (invoice) {
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
