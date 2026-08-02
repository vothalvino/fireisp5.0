// =============================================================================
// FireISP 5.0 — who is the INSTALL OPERATOR? (j56)
// =============================================================================
// Some things belong to the deployment, not to a tenant: where the install's
// infrastructure alerts go (ops_alert_email), which tile server every map
// loads, and whether the box redeploys itself. FireISP had no way to say who
// is allowed to touch them.
//
// THE TRAP THIS MODULE EXISTS TO AVOID: `users.role === 'admin'` looks like an
// install-operator check and is not one. `roles` is a GLOBAL table (no
// organization_id), migration 378 marks both the `admin` and `super_admin`
// groups with kind='admin', and User.resolveGroupMirror copies group.kind into
// users.role — so EVERY organisation's admin has users.role='admin'. The repo
// relies on that per-org meaning elsewhere (countOtherAdminKindUsers refuses to
// demote "the org's final active admin-kind user"). Gating on it admitted the
// exact caller the gate is meant to exclude.
//
// AND WHY IT DOES NOT INFER. A previous attempt derived the answer from the
// number of organisations on the install: one org meant the admin was
// obviously the operator. Adversarial review broke it in the direction I had
// not considered — the count MOVES, in both directions. Counting only live
// organisations let a tenant admin delete the neighbours to promote
// themselves; counting every row instead meant the ordinary onboarding move
// (create your real org, delete the seeded demo one) left a soft-deleted row
// behind and permanently, silently took the update button away from the box
// owner, unrecoverable without shell access. Every inferred signal has some
// version of this. So the fact is STORED, not deduced:
//
//   1. INSTALL_OPERATOR_USER_IDS — user ids in the environment, authoritative
//      when set. Ids, not emails: users.email is in User.fillable and a tenant
//      admin can create an account with any unclaimed address, so an email
//      allowlist would be tenant-writable. A user id is not.
//   2. Otherwise users.is_install_operator (migration 444), which is set by
//      that migration for the oldest active admin, by the seeder on a fresh
//      install, and by nothing else — the column is absent from User.fillable
//      and from every validation schema, so no request can grant it.
//
// Fails CLOSED: an account that is neither listed nor flagged is not the
// operator, whatever its role. Creating or deleting organisations, switching
// orgs, and editing users cannot change the answer.
// =============================================================================

const db = require('../config/database');
const config = require('../config');

/**
 * Is this request the install operator?
 *
 * Legacy admin remains NECESSARY — the flag decides which admin, it does not
 * hand the role's powers to anyone else.
 *
 * @param {import('express').Request} req
 * @returns {Promise<boolean>}
 */
async function isInstallOperator(req) {
  if (req.user?.role !== 'admin') return false;
  const userId = Number(req.user.id);
  if (!Number.isInteger(userId)) return false;

  const allowlist = config.installOperatorUserIds;
  if (allowlist.length > 0) return allowlist.includes(userId);

  const [rows] = await db.query(
    'SELECT is_install_operator FROM users WHERE id = ? AND deleted_at IS NULL LIMIT 1',
    [userId],
  );
  return rows.length > 0 && Number(rows[0].is_install_operator) === 1;
}

/** Why a write was refused — written for the operator, not for a tenant. */
const OPERATOR_ONLY_MESSAGE =
  'This applies to the whole installation, so only the install operator can change it. If that should be you, set INSTALL_OPERATOR_USER_IDS in the environment (see docs/deployment.md).';

module.exports = { isInstallOperator, OPERATOR_ONLY_MESSAGE };
