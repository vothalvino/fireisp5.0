// =============================================================================
// FireISP 5.0 — Billing Workflow Routes
// =============================================================================

const { Router } = require('express');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const billingController = require('../controllers/billingController');

const router = Router();
router.use(authenticate);
router.use(orgScope);

router.post('/generate-period',
  requirePermission('invoices.create'),
  validate({ contract_id: { type: 'number', required: true, min: 1 } }),
  billingController.generatePeriod,
);

router.post('/generate-invoice',
  requirePermission('invoices.create'),
  validate({ contract_id: { type: 'number', required: true, min: 1 } }),
  billingController.generateInvoice,
);

router.post('/allocate-payment',
  requirePermission('payments.create'),
  validate({
    payment_id: { type: 'number', required: true, min: 1 },
    allocations: { type: 'array', required: true },
  }),
  billingController.allocatePayment,
);

router.post('/bulk-generate',
  requirePermission('invoices.create'),
  billingController.bulkGenerate,
);

module.exports = router;
