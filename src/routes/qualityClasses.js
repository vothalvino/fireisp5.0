// =============================================================================
// FireISP 5.0 — Quality Class Routes (§10.1)
// =============================================================================

const { Router } = require('express');
const QualityClass = require('../models/QualityClass');
const { crudController } = require('../controllers/crudController');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { createQualityClass, updateQualityClass } = require('../middleware/schemas/qualityClasses');

const router = Router();
const ctrl = crudController(QualityClass);

router.use(authenticate);
router.use(orgScope);

router.get('/', requirePermission('quality_classes.view'), ctrl.list);
router.get('/:id', requirePermission('quality_classes.view'), ctrl.get);
router.post('/', requirePermission('quality_classes.create'), validate(createQualityClass), ctrl.create);
router.put('/:id', requirePermission('quality_classes.update'), validate(updateQualityClass), ctrl.update);
router.delete('/:id', requirePermission('quality_classes.delete'), ctrl.destroy);
router.post('/:id/restore', requirePermission('quality_classes.update'), ctrl.restore);

module.exports = router;
