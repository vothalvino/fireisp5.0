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
const { hashPasswordField } = require('../middleware/hashPassword');
const userTunnelService = require('../services/userTunnelService');
const { ValidationError } = require('../utils/errors');

const router = Router();

/**
 * Sync a staff user's organization access + membership-role mirror after a
 * create/update. `organization_ids` is not a users column (fillable drops it);
 * it drives organization_users rows instead. When only the group changed, the
 * existing membership rows get re-stamped with the new group's kind so
 * getOrgRole()/requireRole()/WG scoping agree with the new group.
 */
async function syncUserOrgAccess(user, req) {
  const ids = req.body?.organization_ids;
  if (Array.isArray(ids) && ids.length > 0) {
    await User.setUserOrganizations(user.id, ids, user.role);
  } else if (req.body?.group_id !== undefined || req.body?.role !== undefined) {
    await User.refreshMembershipRoles(user.id, user.role);
  }
}

// Strip password hash + 2FA secrets from every user record in responses.
const ctrl = crudController(User, {
  serialize: sanitizeUser,
  // Org-access sync maintains authorization-bearing state — surface its
  // failures instead of returning 200 with stale privileged memberships.
  fatalAfterHooks: true,
  // Revoke the deleted user's WireGuard peers (kernel + nft + DB) so a removed
  // user can't keep a live tunnel. Advisory — caught + logged, never fails the
  // delete. req.user?.id stamps revoked_by.
  afterDelete: (user, req) => userTunnelService.revokeAllForUser(user.id, req.user?.id ?? null),
  beforeUpdate: async (old, req) => {
    // Resolve the group_id ↔ legacy-role mirror on the incoming body (throws
    // 422 for a missing/deleted group or one without a kind).
    await User.resolveGroupMirror(req.body);
    // Last-admin lockout guard: refuse demoting or deactivating the org's
    // final active admin-kind user.
    const demotes = old.role === 'admin' && req.body.role && req.body.role !== 'admin';
    const deactivates = old.role === 'admin' && old.status === 'active'
      && req.body.status && req.body.status !== 'active';
    if ((demotes || deactivates) && (await User.countOtherAdminKindUsers(req.orgId, old.id)) === 0) {
      throw new ValidationError('Cannot demote or deactivate the last administrator of the organization');
    }
  },
  afterCreate: syncUserOrgAccess,
  afterUpdate: syncUserOrgAccess,
});

router.use(authenticate);
router.use(orgScope);

// Last-admin lockout guard for hard removal (delete has no before-hook).
async function guardLastAdminDelete(req, res, next) {
  try {
    const target = await User.findById(req.params.id, req.orgId);
    if (target && target.role === 'admin' && target.status === 'active'
        && (await User.countOtherAdminKindUsers(req.orgId, target.id)) === 0) {
      throw new ValidationError('Cannot delete the last administrator of the organization');
    }
    next();
  } catch (err) {
    next(err);
  }
}

router.get('/', requirePermission('users.view'), ctrl.list);
router.get('/:id', requirePermission('users.view'), ctrl.get);
router.post('/', requirePermission('users.create'), restrictRoleAssignment, validate(createUser, { strip: true }), hashPasswordField, ctrl.create);
router.put('/:id', requirePermission('users.update'), restrictRoleAssignment, validate(updateUser, { strip: true }), hashPasswordField, ctrl.update);
router.patch('/:id', requirePermission('users.update'), restrictRoleAssignment, validate(patchUser, { strip: true }), hashPasswordField, ctrl.partialUpdate);
router.delete('/:id', requirePermission('users.delete'), guardLastAdminDelete, ctrl.destroy);
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

// Get the organizations a user can access (memberships) — powers the org
// multi-select prefill in the user form.
router.get('/:id/organizations', requirePermission('users.view'), async (req, res, next) => {
  try {
    const organizations = await User.getOrganizations(req.params.id);
    res.json({ data: organizations.map((o) => ({ id: o.id, name: o.name, membership_role: o.membership_role })) });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
