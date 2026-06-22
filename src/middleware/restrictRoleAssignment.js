// =============================================================================
// FireISP 5.0 — Role-assignment guard
// =============================================================================
// Only an administrator may set or change a user's `role`. Without this, any
// holder of the users.create / users.update permission could create or PATCH a
// user row with role:'admin' — which the RBAC layer treats as a blanket
// permission bypass (see requirePermission in src/middleware/rbac.js), i.e. a
// self-elevation / privilege-escalation path. The route already gates on the
// users.* permission; this additionally restricts the privileged `role` field.
// =============================================================================

const { ForbiddenError } = require('../utils/errors');

function restrictRoleAssignment(req, _res, next) {
  const body = req.body || {};
  const setsRole = Object.prototype.hasOwnProperty.call(body, 'role')
    && body.role !== undefined && body.role !== null;
  if (setsRole && (!req.user || req.user.role !== 'admin')) {
    return next(new ForbiddenError('Only an administrator may assign or change a user role'));
  }
  next();
}

module.exports = { restrictRoleAssignment };
