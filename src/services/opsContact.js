// =============================================================================
// FireISP 5.0 — where INFRASTRUCTURE alerts go
// =============================================================================
// Host-level problems (TLS expiry today; disk, daemon or backup failures later)
// are not a tenant's business. They fanned out to the admins and managers of
// every active organization, which on a multi-tenant install means every tenant
// admin receives instructions for a machine they have no shell on — noise they
// cannot act on, plus a small disclosure about how the platform is hosted.
//
// The person who fixes host infrastructure is a property of the INSTALL. That
// is what `ops_alert_email` (migration 436) records, and `settings` is
// install-level, so the scope matches.
//
// One place, deliberately: this exists so the NEXT infrastructure alert has an
// obvious home rather than inventing its own recipient rule. Route anything
// host-level through here.
// =============================================================================

const db = require('../config/database');
const logger = require('../utils/logger').child({ service: 'opsContact' });

/**
 * Addresses configured to receive infrastructure alerts.
 *
 * Returns [] when unset, which callers MUST treat as "fall back to the old
 * per-organization fan-out" rather than "send nothing". An upgrade must never
 * silently stop delivering alerts to the only people currently receiving them:
 * an operator who never reads the migration keeps exactly what they had, and
 * opts in by filling the field.
 */
async function opsAlertRecipients() {
  let raw;
  try {
    const [rows] = await db.query(
      "SELECT setting_value FROM settings WHERE setting_key = 'ops_alert_email' LIMIT 1",
    );
    raw = rows[0]?.setting_value || '';
  } catch (err) {
    // A settings read that fails must not swallow the alert. Fall back.
    logger.warn({ err: err.message }, 'Could not read ops_alert_email — falling back to org staff');
    return [];
  }

  return String(raw)
    .split(',')
    .map(s => s.trim())
    // Deliberately loose: this is a delivery hint an operator typed, not user
    // input to validate. A malformed entry should drop out here rather than
    // throw and take the whole alert with it.
    .filter(s => s.length > 0 && s.includes('@'));
}

/**
 * True when a dedicated contact is configured, i.e. infra alerts should NOT be
 * fanned out per organization.
 */
async function hasOpsContact() {
  return (await opsAlertRecipients()).length > 0;
}

module.exports = { opsAlertRecipients, hasOpsContact };
