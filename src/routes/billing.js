// =============================================================================
// FireISP 5.0 — Billing Workflow Routes
// =============================================================================

const { Router } = require('express');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const billingSchemas = require('../middleware/schemas/billing');
const billingController = require('../controllers/billingController');

const router = Router();
router.use(authenticate);
router.use(orgScope);

router.post('/generate-period',
  requirePermission('invoices.create'),
  validate(billingSchemas.generatePeriod),
  billingController.generatePeriod,
);

router.post('/generate-invoice',
  requirePermission('invoices.create'),
  validate(billingSchemas.generateInvoice),
  billingController.generateInvoice,
);

router.post('/allocate-payment',
  requirePermission('payments.create'),
  validate(billingSchemas.allocatePayment),
  billingController.allocatePayment,
);

router.post('/bulk-generate',
  requirePermission('invoices.create'),
  billingController.bulkGenerate,
);

module.exports = router;
