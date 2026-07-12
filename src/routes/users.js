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
const { createUser, updateUser, patchUser, setArchivedGroup } = require('../middleware/schemas/users');
const { hashPasswordField } = require('../middleware/hashPassword');
const userTunnelService = require('../services/userTunnelService');
const auditLog = require('../services/auditLog');
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

// Archive guards (delete has no before-hook): no self-archive — the actor
// would lock themselves out instantly with nobody guaranteed able to restore
// them — and no archiving the org's last active admin.
async function guardArchive(req, res, next) {
  try {
    if (Number(req.params.id) === Number(req.user?.id)) {
      throw new ValidationError('You cannot archive your own account');
    }
    const target = await User.findById(req.params.id, req.orgId);
    if (target && target.role === 'admin' && target.status === 'active'
        && (await User.countOtherAdminKindUsers(req.orgId, target.id)) === 0) {
      throw new ValidationError('Cannot archive the last administrator of the organization');
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
router.delete('/:id', requirePermission('users.delete'), guardArchive, ctrl.destroy);
router.post('/:id/restore', requirePermission('users.update'), ctrl.restore);

// Reassign an ARCHIVED user's group without restoring them — the path the
// group-delete guard points admins at ("restore-and-reassign" is no longer
// required). Deliberately restricted to archived rows: live users must go
// through the normal edit (which carries the last-admin/status guards), and
// archived users are inactive by definition, so a group change here can never
// affect the last-admin invariant. The normal update path can't reach
// archived rows (BaseModel.update filters deleted_at IS NULL), hence the raw
// UPDATE below.
router.patch('/:id/group',
  requirePermission('users.update'),
  restrictRoleAssignment,
  validate(setArchivedGroup, { strip: true }),
  async (req, res, next) => {
    try {
      const target = await User.findByIdIncludingDeleted(req.params.id, req.orgId);
      if (!target) {
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'User not found' } });
      }
      if (!target.deleted_at) {
        throw new ValidationError('This endpoint reassigns ARCHIVED users only — edit active users through the user form');
      }

      const data = { group_id: req.body.group_id };
      await User.resolveGroupMirror(data); // validates the group, derives the role mirror

      const db = require('../config/database');
      // Re-assert deleted_at IS NOT NULL in the WRITE (not just the earlier
      // read): a concurrent restore between the check above and here must not
      // let this archived-only endpoint mutate a now-active account. Zero
      // affected rows means the row stopped being archived — treat as 404.
      const [result] = await db.query(
        'UPDATE users SET group_id = ?, role = ? WHERE id = ? AND deleted_at IS NOT NULL',
        [data.group_id, data.role, target.id],
      );
      if (result.affectedRows === 0) {
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Archived user not found' } });
      }
      await User.refreshMembershipRoles(target.id, data.role);

      await auditLog.log({
        userId: req.user?.id,
        organizationId: req.orgId,
        action: 'update',
        tableName: 'users',
        recordId: target.id,
        oldValues: { group_id: target.group_id, role: target.role },
        newValues: data,
      });

      const updated = await User.findByIdIncludingDeleted(target.id, req.orgId);
      res.json({ data: sanitizeUser(updated) });
    } catch (err) {
      next(err);
    }
  });

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
