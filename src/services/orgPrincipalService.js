// =============================================================================
// Active-organization principal resolution (primary/control-plane database)
// =============================================================================
// JWT refresh, organization switching, ordinary JWT requests, and API-token
// authentication must all make the same tenant-access decision. Tenant data
// may live in an isolated database, but users, memberships, organizations, and
// API-token ownership remain control-plane facts in the primary database.

const db = require('../config/database');
const { isInstallOperatorUser } = require('./installOperator');
const { runInPrimaryContext } = require('../utils/primaryContext');

/**
 * Compatibility for legacy route-test database doubles that predate tenant
 * routing. Dedicated auth/org-principal tests provide withPrimaryContext and
 * therefore always exercise the authoritative control-plane queries below.
 * This branch is unavailable outside NODE_ENV=test and admits only the user's
 * home organization; it cannot manufacture cross-tenant/operator access.
 */
function resolveLegacyTestPrincipal(user, organizationId) {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('Primary database context is unavailable');
  }
  const homeOrganizationId = Number(user?.organization_id ?? user?.organizationId ?? organizationId);
  if (homeOrganizationId !== organizationId) return null;
  const authorizationRole = user?.authority_persona || user?.role;
  if (!authorizationRole) return null;
  return {
    organizationId,
    organizationName: null,
    membershipRole: authorizationRole,
    authorizationRole,
    isInstallOperator: false,
    isSuperAdmin: false,
    hasGlobalOrganizationAccess: false,
    accessKind: 'home',
  };
}

async function resolveOrgPrincipal(user, requestedOrganizationId, { allowOperator = true } = {}) {
  const userId = Number(user?.id);
  const organizationId = Number(requestedOrganizationId || user?.organization_id);
  if (!Number.isSafeInteger(userId) || !Number.isSafeInteger(organizationId)
      || userId <= 0 || organizationId <= 0) return null;

  if (typeof db.withPrimaryContext !== 'function') {
    return resolveLegacyTestPrincipal(user, organizationId);
  }

  return runInPrimaryContext(async () => {
    const [[organizationRows], [membershipRows], [userRows]] = await Promise.all([
      db.query(
        `SELECT id, name FROM organizations
          WHERE id = ? AND status = 'active' AND deleted_at IS NULL
          LIMIT 1`,
        [organizationId],
      ),
      db.query(
        `SELECT role AS membership_role FROM organization_users
          WHERE user_id = ? AND organization_id = ? AND deleted_at IS NULL
          LIMIT 1`,
        [userId, organizationId],
      ),
      db.query(
        `SELECT u.id, u.email, u.role, u.organization_id, u.is_install_operator,
                COALESCE(group_row.kind, u.role) AS authority_persona,
                group_row.name AS group_name,
                group_row.is_system AS group_is_system
           FROM users u
           LEFT JOIN roles group_row ON group_row.id = u.group_id
             AND group_row.deleted_at IS NULL
          WHERE u.id = ? AND u.status = 'active' AND u.deleted_at IS NULL
          LIMIT 1`,
        [userId],
      ),
    ]);
    if (organizationRows.length !== 1 || userRows.length !== 1) return null;

    const liveUser = userRows[0];
    const isHomeOrganization = Number(liveUser.organization_id) === organizationId;
    const membershipRole = membershipRows[0]?.membership_role || null;
    const membershipPersona = ['owner', 'admin'].includes(membershipRole)
      ? 'admin'
      : membershipRole;
    const isInstallOperatorAccount = allowOperator
      ? await isInstallOperatorUser(liveUser)
      : false;
    // These columns come from the same authoritative, live-user query above.
    // Do not re-query them: principal resolution is already inside the primary
    // context and exact group identity is all that distinguishes super_admin
    // from the ordinary admin-kind tenant group.
    const isSuperAdminAccount = allowOperator
      && liveUser.group_name === 'super_admin'
      && Number(liveUser.group_is_system) === 1;
    const hasGlobalAccess = isInstallOperatorAccount || isSuperAdminAccount;
    // A stale cross-org membership and a different global group/persona have
    // no well-defined least-privilege meaning (SSO can create this mismatch).
    // Fail closed instead of silently choosing whichever side is broader.
    // Global identities are the exception: their access is intrinsic, so a
    // redundant/stale membership row must neither grant nor restrict it.
    if (!hasGlobalAccess && membershipRole
        && membershipPersona !== liveUser.authority_persona) return null;
    if (!isHomeOrganization && !membershipRole && !hasGlobalAccess) return null;

    return {
      organizationId,
      organizationName: organizationRows[0].name,
      membershipRole: membershipRole || (isHomeOrganization ? liveUser.authority_persona : 'admin'),
      // Group/legacy authority stays separate from the membership role. Some
      // legacy routes still inspect req.user.role directly; a stale or overly
      // broad organization_users.role must never manufacture that authority.
      authorizationRole: liveUser.authority_persona,
      isInstallOperator: isInstallOperatorAccount,
      isSuperAdmin: isSuperAdminAccount,
      hasGlobalOrganizationAccess: hasGlobalAccess,
      accessKind: membershipRole
        ? 'membership'
        : (isInstallOperatorAccount ? 'install_operator' : (isSuperAdminAccount ? 'super_admin' : 'home')),
    };
  });
}

module.exports = { resolveOrgPrincipal };
