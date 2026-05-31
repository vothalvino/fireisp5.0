// =============================================================================
// FireISP 5.0 — Promotion Routes
// =============================================================================

const { Router } = require('express');
const Promotion = require('../models/Promotion');
const { crudController } = require('../controllers/crudController');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { createPromotion, updatePromotion } = require('../middleware/schemas/promotions');

const router = Router();
const ctrl = crudController(Promotion);

router.use(authenticate);
router.use(orgScope);

router.get('/', requirePermission('promotions.view'), ctrl.list);
router.get('/:id', requirePermission('promotions.view'), ctrl.get);
router.post('/', requirePermission('promotions.create'), validate(createPromotion), ctrl.create);
router.put('/:id', requirePermission('promotions.update'), validate(updatePromotion), ctrl.update);
router.delete('/:id', requirePermission('promotions.delete'), ctrl.destroy);
router.post('/:id/restore', requirePermission('promotions.update'), ctrl.restore);

module.exports = router;
