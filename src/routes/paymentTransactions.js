// =============================================================================
// FireISP 5.0 — Payment Transaction Routes
// =============================================================================

const { Router } = require('express');
const PaymentTransaction = require('../models/PaymentTransaction');
const { crudController } = require('../controllers/crudController');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');

const router = Router();
const ctrl = crudController(PaymentTransaction);

router.use(authenticate);
router.use(orgScope);

router.get('/', requirePermission('payment_transactions.view'), ctrl.list);
router.get('/:id', requirePermission('payment_transactions.view'), ctrl.get);

module.exports = router;
