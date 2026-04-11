// =============================================================================
// FireISP 5.0 — Expense Routes
// =============================================================================

const { Router } = require('express');
const Expense = require('../models/Expense');
const { crudController } = require('../controllers/crudController');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');

const router = Router();
const ctrl = crudController(Expense);

router.use(authenticate);
router.use(orgScope);

router.get('/', requirePermission('expenses.view'), ctrl.list);
router.get('/:id', requirePermission('expenses.view'), ctrl.get);
router.post('/', requirePermission('expenses.create'), ctrl.create);
router.put('/:id', requirePermission('expenses.update'), ctrl.update);
router.delete('/:id', requirePermission('expenses.delete'), ctrl.destroy);

module.exports = router;
