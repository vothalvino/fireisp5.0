// =============================================================================
// FireISP 5.0 — User Routes
// =============================================================================

const { Router } = require('express');
const User = require('../models/User');
const { crudController } = require('../controllers/crudController');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');

const router = Router();
const ctrl = crudController(User);

router.use(authenticate);
router.use(orgScope);

router.get('/', requirePermission('users.view'), ctrl.list);
router.get('/:id', requirePermission('users.view'), ctrl.get);
router.post('/', requirePermission('users.create'), ctrl.create);
router.put('/:id', requirePermission('users.update'), ctrl.update);
router.delete('/:id', requirePermission('users.delete'), ctrl.destroy);

// Get user's permissions
router.get('/:id/permissions', requirePermission('users.view'), async (req, res, next) => {
  try {
    const permissions = await User.getPermissions(req.params.id, req.orgId);
    res.json({ data: permissions });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
