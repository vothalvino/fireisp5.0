// =============================================================================
// Installation-wide organization access
// =============================================================================
// Two identities may enter every live tenant without an organization_users
// row:
//   * the stored/configured install operator; and
//   * a user assigned to the exact seeded system group `super_admin`.
//
// `users.role === 'admin'` is deliberately insufficient. Both the ordinary
// tenant-admin group and super_admin mirror to that legacy persona, so treating
// the mirror as global would erase tenant isolation.

const db = require('../config/database');
const { isInstallOperatorUser } = require('./installOperator');
const { runInPrimaryContext } = require('../utils/primaryContext');

async function isSuperAdminUser(user) {
  const userId = Number(user?.id);
  if (!Number.isSafeInteger(userId) || userId <= 0) return false;
  // Every real super_admin group mirrors kind='admin' into users.role. This
  // cheap discriminator avoids a control-plane lookup for all other personas.
  if (user?.role && user.role !== 'admin') return false;

  if (Object.prototype.hasOwnProperty.call(user, 'group_name')
      && Object.prototype.hasOwnProperty.call(user, 'group_is_system')) {
    return user.group_name === 'super_admin' && Number(user.group_is_system) === 1;
  }

  const [rows] = await runInPrimaryContext(() => db.query(
    `SELECT r.name AS group_name, r.is_system AS group_is_system
       FROM users u
       JOIN roles r ON r.id = u.group_id AND r.deleted_at IS NULL
      WHERE u.id = ?
      LIMIT 1`,
    [userId],
  ));
  return rows[0]?.group_name === 'super_admin'
    && Number(rows[0]?.group_is_system) === 1;
}

async function hasGlobalOrganizationAccessUser(user) {
  if (await isInstallOperatorUser(user)) return true;
  return isSuperAdminUser(user);
}

async function hasGlobalOrganizationAccess(req) {
  // API tokens remain bound to the organization they were issued for, even
  // when their owning browser account is global.
  if (req?.user?.apiTokenId) return false;
  if (req?.user?.hasGlobalOrganizationAccess === true) return true;
  if (req?.user?.hasGlobalOrganizationAccess === false && process.env.NODE_ENV !== 'test') {
    return false;
  }
  return hasGlobalOrganizationAccessUser(req?.user);
}

module.exports = {
  isSuperAdminUser,
  hasGlobalOrganizationAccess,
  hasGlobalOrganizationAccessUser,
};
