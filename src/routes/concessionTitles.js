// =============================================================================
// FireISP 5.0 — Concession Title Routes
// =============================================================================

const { Router } = require('express');
const ConcessionTitle = require('../models/ConcessionTitle');
const { crudController } = require('../controllers/crudController');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requireMxLocale } = require('../middleware/orgLocale');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { createConcessionTitle, updateConcessionTitle } = require('../middleware/schemas/concessionTitles');

const router = Router();
const ctrl = crudController(ConcessionTitle);

router.use(authenticate);
router.use(orgScope);
router.use(requireMxLocale);

router.get('/', requirePermission('concession_titles.view'), ctrl.list);
router.get('/:id', requirePermission('concession_titles.view'), ctrl.get);
router.post('/', requirePermission('concession_titles.create'), validate(createConcessionTitle), ctrl.create);
router.put('/:id', requirePermission('concession_titles.update'), validate(updateConcessionTitle), ctrl.update);
router.delete('/:id', requirePermission('concession_titles.delete'), ctrl.destroy);
router.post('/:id/restore', requirePermission('concession_titles.update'), ctrl.restore);

module.exports = router;
