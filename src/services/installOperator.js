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
  return isInstallOperatorUser(req.user);
}

/**
 * The same question asked about a user record rather than a request — for
 * callers outside the request pipeline (authService.switchOrganization).
 *
 * Accepts either shape: req.user or a row from User.findById. Both carry the
 * id and role this needs; a row may also already carry is_install_operator,
 * which is used when present to save a query.
 *
 * @param {{id?: number, role?: string, is_install_operator?: number|boolean}} user
 * @returns {Promise<boolean>}
 */
async function isInstallOperatorUser(user) {
  const userId = Number(user?.id);
  if (!Number.isInteger(userId)) return false;

  // The environment is the highest authority and stands ALONE — it does not
  // also require users.role='admin'. It is the recovery hatch for an install
  // whose flag is on the wrong account, and a hatch that silently does nothing
  // unless the named account happens to hold a particular legacy role is not a
  // hatch.
  const allowlist = config.installOperatorUserIds;
  if (allowlist.length > 0) return allowlist.includes(userId);

  // Otherwise: legacy admin is necessary (the flag decides WHICH admin, it does
  // not hand the role's powers to anyone else) plus the stored flag.
  if (user.role !== 'admin') return false;

  if (user.is_install_operator !== undefined) {
    return Number(user.is_install_operator) === 1;
  }

  try {
    const [rows] = await db.query(
      'SELECT is_install_operator FROM users WHERE id = ? AND deleted_at IS NULL LIMIT 1',
      [userId],
    );
    return rows.length > 0 && Number(rows[0].is_install_operator) === 1;
  } catch (_err) {
    // Includes the un-migrated / rolled-back case where the column does not
    // exist. Fail CLOSED and quietly: install-wide UI hides, install-wide
    // writes refuse, and the app keeps serving everything else.
    return false;
  }
}

/** Why a write was refused — written for the operator, not for a tenant. */
const OPERATOR_ONLY_MESSAGE =
  'This applies to the whole installation, so only the install operator can change it. If that should be you, set INSTALL_OPERATOR_USER_IDS in the environment (see docs/deployment.md).';

module.exports = { isInstallOperator, isInstallOperatorUser, OPERATOR_ONLY_MESSAGE };
