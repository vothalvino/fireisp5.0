// =============================================================================
// FireISP 5.0 — Payment Gateway Routes
// =============================================================================

const { Router } = require('express');
const PaymentGateway = require('../models/PaymentGateway');
const { crudController } = require('../controllers/crudController');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { createPaymentGateway, updatePaymentGateway } = require('../middleware/schemas/paymentGateways');

const router = Router();
const ctrl = crudController(PaymentGateway);

router.use(authenticate);
router.use(orgScope);

router.get('/', requirePermission('payment_gateways.view'), ctrl.list);
router.get('/:id', requirePermission('payment_gateways.view'), ctrl.get);
router.post('/', requirePermission('payment_gateways.create'), validate(createPaymentGateway), ctrl.create);
router.put('/:id', requirePermission('payment_gateways.update'), validate(updatePaymentGateway), ctrl.update);
router.delete('/:id', requirePermission('payment_gateways.delete'), ctrl.destroy);

module.exports = router;
