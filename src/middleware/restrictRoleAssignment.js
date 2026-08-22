// =============================================================================
// FireISP 5.0 — Privileged-field guard for the users routes
// =============================================================================
// Only an administrator may set a user's privilege- or takeover-bearing fields.
// The route already gates on the users.* permission; this additionally
// restricts individual fields so a non-legacy-admin holder of users.create /
// users.update (only reachable via a custom group an admin granted it to)
// cannot escalate or hijack an account.
//
// Two tiers, because a field's risk depends on create vs. update:
//
//   ALWAYS_PRIVILEGED — creating OR editing these is escalation, since an
//   admin-kind group / role:'admin' trips the RBAC bypass (see rbac.js). A
//   non-admin must never set them, on create or update.
//
//   UPDATE_ONLY_PRIVILEGED — legitimate to set as INITIAL values on a brand-
//   new account (a non-admin with users.create must supply a password, email,
//   and status), but account-TAKEOVER vectors when changed on an EXISTING
//   account:
//     * password — reset another user's credential, then log in as them;
//     * email    — repoint the address that /auth/password-reset delivers to,
//                  then trigger a reset;
//     * status   — reactivate a disabled/archived (e.g. admin) account.
//   Self-service password change has its own endpoint (POST /auth/change-
//   password); there is no self-service email/status route, so guarding these
//   on update removes no legitimate non-admin flow.
// =============================================================================

const { ForbiddenError, ValidationError } = require('../utils/errors');
const User = require('../models/User');
const { isInstallOperator, isInstallOperatorUser } = require('../services/installOperator');
const {
  hasGlobalOrganizationAccess,
  hasGlobalOrganizationAccessUser,
  isSuperAdminUser,
} = require('../services/globalOrganizationAccess');
const db = require('../config/database');
const { runInPrimaryContext } = require('../utils/primaryContext');

const ALWAYS_PRIVILEGED = ['role', 'group_id', 'organization_ids'];
const UPDATE_ONLY_PRIVILEGED = ['password', 'email', 'status'];

async function restrictRoleAssignment(req, _res, next) {
  const body = req.body || {};
  const isUpdate = req.method === 'PUT' || req.method === 'PATCH';
  const guarded = isUpdate
    ? [...ALWAYS_PRIVILEGED, ...UPDATE_ONLY_PRIVILEGED]
    : ALWAYS_PRIVILEGED;

  const setsPrivileged = guarded.some((field) =>
    Object.prototype.hasOwnProperty.call(body, field)
    && body[field] !== undefined && body[field] !== null);

  if (setsPrivileged && (!req.user || req.user.role !== 'admin')) {
    return next(new ForbiddenError(
      'Only an administrator may change a user\'s group, role, organization access, password, email, or status',
    ));
  }

  const assignsOrganizations = Object.prototype.hasOwnProperty.call(body, 'organization_ids')
    && body.organization_ids !== undefined && body.organization_ids !== null;
  let actorHasGlobalAccess;
  let targetUser;
  let targetUserResolved = false;
  const globalAccess = async () => {
    if (actorHasGlobalAccess === undefined) {
      actorHasGlobalAccess = await hasGlobalOrganizationAccess(req);
    }
    return actorHasGlobalAccess;
  };
  const getTargetUser = async () => {
    if (!targetUserResolved) {
      targetUserResolved = true;
      const targetId = Number(req.params?.id);
      targetUser = Number.isInteger(targetId)
        ? await User.findByIdIncludingDeleted(targetId)
        : null;
    }
    return targetUser;
  };

  if (assignsOrganizations && !await globalAccess()) {
    return next(new ForbiddenError(
      'Only the install operator or a super administrator may assign organization access',
    ));
  }

  // Both admin and super_admin mirror to users.role='admin'. Resolve the exact
  // group before accepting an assignment so a tenant admin cannot manufacture
  // a new installation-global account through that lossy legacy mirror.
  let assignsSystemSuperAdmin = false;
  if (body.group_id !== undefined && body.group_id !== null) {
    try {
      const [groups] = await runInPrimaryContext(() => db.query(
        'SELECT name, is_system FROM roles WHERE id = ? AND deleted_at IS NULL LIMIT 1',
        [body.group_id],
      ));
      assignsSystemSuperAdmin = groups[0]?.name === 'super_admin'
        && Number(groups[0]?.is_system) === 1;
      if (assignsSystemSuperAdmin && !await globalAccess()) {
        return next(new ForbiddenError(
          'Only the install operator or a super administrator may assign the super administrator group',
        ));
      }
    } catch (err) { return next(err); }
  }

  // These identities already reach every live organization intrinsically.
  // Accepting organization_ids would manufacture redundant membership rows,
  // make the UI imply their access can be narrowed here, and leave stale
  // assignments behind after organizations change. Reject the invalid field
  // combination before the users row is created/updated.
  if (assignsOrganizations && assignsSystemSuperAdmin) {
    return next(new ValidationError(
      'Install operators and system super administrators have automatic access to every organization; omit organization_ids.',
    ));
  }
  if (assignsOrganizations && isUpdate) {
    try {
      const target = await getTargetUser();
      if (target && await hasGlobalOrganizationAccessUser(target)) {
        return next(new ValidationError(
          'Install operators and system super administrators have automatic access to every organization; omit organization_ids.',
        ));
      }
    } catch (err) { return next(err); }
  }

  // The install-operator flag cannot be granted through the API — but the
  // ACCOUNT that carries it was still takeable. Every one of the fields above
  // is a takeover primitive (set a password, or repoint the email and use the
  // reset flow), and the check that gates them is `role === 'admin'`, which is
  // the per-TENANT admin persona. So a co-org admin could log in AS the
  // operator and reach the deploy trigger. Only the operator may rewrite the
  // operator's credentials.
  if (setsPrivileged && isUpdate) {
    try {
      const targetId = Number(req.params?.id);
      if (Number.isInteger(targetId) && targetId !== Number(req.user?.id)) {
        const target = await getTargetUser();
        if (target && await isInstallOperatorUser(target) && !await isInstallOperator(req)) {
          return next(new ForbiddenError(
            'This account runs the installation; only the install operator can change its credentials.',
          ));
        }
        if (target && await isSuperAdminUser(target) && !await globalAccess()) {
          return next(new ForbiddenError(
            'Only the install operator or a super administrator can change a super administrator account.',
          ));
        }
      }
    } catch (err) { return next(err); }
  }

  return next();
}

module.exports = { restrictRoleAssignment };
