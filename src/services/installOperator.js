// =============================================================================
// FireISP 5.0 — who is the INSTALL OPERATOR? (j56)
// =============================================================================
// Some settings belong to the deployment, not to a tenant: where the install's
// infrastructure alerts go (ops_alert_email), which tile server every map
// loads. Writing those needs "the person who runs this box" — and FireISP had
// no way to say that.
//
// THE TRAP THIS MODULE EXISTS TO AVOID: `users.role === 'admin'` looks like an
// install-operator check and is not one. `roles` is a GLOBAL table (no
// organization_id), migration 378 marks both the `admin` and `super_admin`
// groups with kind='admin', and User.resolveGroupMirror copies group.kind into
// users.role — so EVERY organisation's admin has users.role='admin'. The repo
// relies on that per-org meaning elsewhere (countOtherAdminKindUsers refuses to
// demote "the org's final active admin-kind user"). Gating install writes on it
// would have admitted the exact caller the gate is meant to exclude: a tenant
// admin redirecting the whole install's alerts to themselves.
//
// So the operator is resolved from something a tenant cannot forge:
//
//   1. INSTALL_OPERATOR_EMAILS — an explicit allowlist in the environment,
//      which only whoever edits .env can set. When present it is authoritative.
//   2. Otherwise: a legacy admin counts as the operator ONLY while the install
//      has at most ONE active organisation. On a single-ISP self-hosted box —
//      the common case — the admin demonstrably IS the operator, and nothing
//      about their experience changes. The moment a second organisation
//      exists, "any admin" stops being a safe answer and the allowlist becomes
//      required; the write 403s with a message naming the variable to set.
//
// Fails CLOSED: no allowlist plus more than one org means nobody writes
// install settings through the API until the operator opts in by name.
// =============================================================================

const db = require('../config/database');
const config = require('../config');

/** Active, non-deleted organisations on this install. */
async function activeOrganizationCount() {
  const [rows] = await db.query(
    "SELECT COUNT(*) AS total FROM organizations WHERE deleted_at IS NULL AND status = 'active'",
  );
  return Number(rows[0]?.total ?? 0);
}

/**
 * Is this request the install operator?
 *
 * Deliberately not cached: creating a second organisation must tighten the
 * gate immediately, and install-setting writes are rare enough that one COUNT
 * is irrelevant next to a cross-tenant write.
 *
 * @param {import('express').Request} req
 * @returns {Promise<boolean>}
 */
async function isInstallOperator(req) {
  // Necessary but NOT sufficient — see the header.
  if (req.user?.role !== 'admin') return false;

  const allowlist = config.installOperatorEmails;
  if (allowlist.length > 0) {
    const email = String(req.user.email || '').trim().toLowerCase();
    return email.length > 0 && allowlist.includes(email);
  }

  return (await activeOrganizationCount()) <= 1;
}

/** Why a write was refused — surfaced to the operator, not to a tenant. */
const OPERATOR_ONLY_MESSAGE =
  'This setting applies to the whole installation. On an install with more than one organisation it can only be changed by an account listed in INSTALL_OPERATOR_EMAILS.';

module.exports = { isInstallOperator, activeOrganizationCount, OPERATOR_ONLY_MESSAGE };
