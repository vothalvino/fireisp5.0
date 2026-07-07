// =============================================================================
// FireISP 5.0 — Expense Routes
// =============================================================================

const { Router } = require('express');
const Expense = require('../models/Expense');
const { crudController } = require('../controllers/crudController');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { createExpense, updateExpense } = require('../middleware/schemas/expenses');

const router = Router();
const ctrl = crudController(Expense);

router.use(authenticate);
router.use(orgScope);

router.get('/', requirePermission('expenses.view'), ctrl.list);
router.get('/:id', requirePermission('expenses.view'), ctrl.get);
router.post('/', requirePermission('expenses.create'), validate(createExpense), (req, res, next) => {
  // Default the incurring employee to the logged-in staff member (expenses.user_id is NOT NULL).
  if (req.body.user_id === undefined && req.user?.id) req.body.user_id = req.user.id;
  return ctrl.create(req, res, next);
});
router.put('/:id', requirePermission('expenses.update'), validate(updateExpense), ctrl.update);
router.delete('/:id', requirePermission('expenses.delete'), ctrl.destroy);
router.post('/:id/restore', requirePermission('expenses.update'), ctrl.restore);

module.exports = router;
