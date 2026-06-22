// =============================================================================
// FireISP 5.0 — User Routes
// =============================================================================

const { Router } = require('express');
const User = require('../models/User');
const { sanitizeUser } = require('../utils/userSanitize');
const { crudController } = require('../controllers/crudController');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const { restrictRoleAssignment } = require('../middleware/restrictRoleAssignment');
const { validate } = require('../middleware/validate');
const { createUser, updateUser, patchUser } = require('../middleware/schemas/users');

const router = Router();
// Strip password hash + 2FA secrets from every user record in responses.
const ctrl = crudController(User, { serialize: sanitizeUser });

router.use(authenticate);
router.use(orgScope);

router.get('/', requirePermission('users.view'), ctrl.list);
router.get('/:id', requirePermission('users.view'), ctrl.get);
router.post('/', requirePermission('users.create'), restrictRoleAssignment, validate(createUser, { strip: true }), ctrl.create);
router.put('/:id', requirePermission('users.update'), restrictRoleAssignment, validate(updateUser, { strip: true }), ctrl.update);
router.patch('/:id', requirePermission('users.update'), restrictRoleAssignment, validate(patchUser, { strip: true }), ctrl.partialUpdate);
router.delete('/:id', requirePermission('users.delete'), ctrl.destroy);
router.post('/:id/restore', requirePermission('users.update'), ctrl.restore);

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
