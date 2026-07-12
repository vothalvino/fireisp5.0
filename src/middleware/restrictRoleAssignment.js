// =============================================================================
// FireISP 5.0 — Role/group-assignment guard
// =============================================================================
// Only an administrator may set or change a user's privilege-bearing fields:
// `role` (legacy), `group_id` (the user group, migration 378), and
// `organization_ids` (organization access). Without this, any holder of the
// users.create / users.update permission could create or PATCH a user with an
// admin-kind group — which mirrors role:'admin' and the RBAC layer treats as a
// blanket permission bypass (see requirePermission in src/middleware/rbac.js),
// i.e. a self-elevation / privilege-escalation path. The route already gates
// on the users.* permission; this additionally restricts the privileged fields.
// =============================================================================

const { ForbiddenError } = require('../utils/errors');

const PRIVILEGED_FIELDS = ['role', 'group_id', 'organization_ids'];

function restrictRoleAssignment(req, _res, next) {
  const body = req.body || {};
  const setsPrivileged = PRIVILEGED_FIELDS.some((field) =>
    Object.prototype.hasOwnProperty.call(body, field)
    && body[field] !== undefined && body[field] !== null);
  if (setsPrivileged && (!req.user || req.user.role !== 'admin')) {
    return next(new ForbiddenError('Only an administrator may assign or change a user\'s group, role, or organization access'));
  }
  next();
}

module.exports = { restrictRoleAssignment };
