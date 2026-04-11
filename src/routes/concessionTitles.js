// =============================================================================
// FireISP 5.0 — Concession Title Routes
// =============================================================================

const { Router } = require('express');
const ConcessionTitle = require('../models/ConcessionTitle');
const { crudController } = require('../controllers/crudController');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');

const router = Router();
const ctrl = crudController(ConcessionTitle);

router.use(authenticate);
router.use(orgScope);

router.get('/', requirePermission('concession_titles.view'), ctrl.list);
router.get('/:id', requirePermission('concession_titles.view'), ctrl.get);
router.post('/', requirePermission('concession_titles.create'), ctrl.create);
router.put('/:id', requirePermission('concession_titles.update'), ctrl.update);
router.delete('/:id', requirePermission('concession_titles.delete'), ctrl.destroy);

module.exports = router;
