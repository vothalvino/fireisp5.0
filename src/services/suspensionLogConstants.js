// =============================================================================
// FireISP 5.0 — suspension_logs contract (shared constants)
// =============================================================================
// `suspension_logs.action` is an ENUM with EXACTLY four values (migration 105 /
// database/schema.sql):
//
//     ENUM('suspended','unsuspended','disconnected','reconnected')
//
// Everything that writes to the table must use one of these. The service layer
// historically wrote 'suspend' / 'unsuspend' / 'soft_suspend' / 'walled_garden'
// — none of which exist in the ENUM — so every INSERT threw and every
// suspension path 500'd. This module is the single place that maps FireISP's
// suspension *flavours* onto the ENUM, so the mapping can't drift again.
//
// Flavour → (action, reason prefix):
//   hard suspend      → 'suspended'   reason: 'rule #N …' / 'manual …'
//   soft suspend      → 'suspended'   reason: 'soft_suspend: …'
//   walled garden     → 'suspended'   reason: 'walled_garden: …'
//   reconnect         → 'unsuspended' reason: free text
//
// Soft-suspend and walled-garden are both mapped to 'suspended' (NOT
// 'disconnected'): the subscriber keeps authenticating and keeps a degraded /
// redirected service — nothing is cut — and the ENUM has no dedicated value for
// them. We deliberately do NOT extend the ENUM; the distinguishing detail lives
// in `reason`, which is the operator-facing audit trail anyway.
//
// Because the flavour lives in `reason`, the "is this contract currently in the
// walled garden?" lookups match on the reason prefix. The underscore is escaped
// in the LIKE pattern (`\_`) so it matches a literal '_' rather than acting as
// a single-character wildcard.
// =============================================================================

/** The four legal values of suspension_logs.action. */
const SUSPENSION_ACTIONS = Object.freeze({
  SUSPENDED: 'suspended',
  UNSUSPENDED: 'unsuspended',
  DISCONNECTED: 'disconnected',
  RECONNECTED: 'reconnected',
});

/** Reason prefix marking a row as a walled-garden (payment-redirect) restriction. */
const WALLED_GARDEN_REASON_PREFIX = 'walled_garden:';

/** Reason prefix marking a row as a soft (rate-limited) suspension. */
const SOFT_SUSPEND_REASON_PREFIX = 'soft_suspend:';

/**
 * SQL predicate (no table alias) selecting rows that are an OPEN walled-garden
 * restriction — i.e. applied and not yet lifted.
 */
const OPEN_WALLED_GARDEN_PREDICATE =
  "action = 'suspended' AND reason LIKE 'walled\\_garden:%' AND restored_at IS NULL";

/**
 * Same predicate, qualified with a table alias (for joined queries).
 * @param {string} alias
 */
function openWalledGardenPredicate(alias) {
  return `${alias}.action = 'suspended' AND ${alias}.reason LIKE 'walled\\_garden:%' AND ${alias}.restored_at IS NULL`;
}

/**
 * suspension_logs.triggered_by is NOT NULL ENUM('system','manual'): an action
 * carried out by a signed-in user is 'manual', a rule/scheduler-driven one
 * (no user id) is 'system'.
 * @param {number|null|undefined} userId
 * @returns {'manual'|'system'}
 */
function triggeredBy(userId) {
  return userId ? 'manual' : 'system';
}

/**
 * Build a human-readable `reason` for the operator audit trail.
 * @param {string} what        - e.g. 'suspension', 'reconnect'
 * @param {number|null} ruleId
 * @param {number|null} userId
 * @param {number|null} invoiceId
 */
function describeTrigger(what, ruleId, userId, invoiceId) {
  const parts = [];
  parts.push(ruleId ? `${what} by rule #${ruleId}` : `${triggeredBy(userId)} ${what}`);
  if (userId) parts.push(`user #${userId}`);
  if (invoiceId) parts.push(`invoice #${invoiceId}`);
  return parts.join(' — ');
}

module.exports = {
  SUSPENSION_ACTIONS,
  WALLED_GARDEN_REASON_PREFIX,
  SOFT_SUSPEND_REASON_PREFIX,
  OPEN_WALLED_GARDEN_PREDICATE,
  openWalledGardenPredicate,
  triggeredBy,
  describeTrigger,
};
