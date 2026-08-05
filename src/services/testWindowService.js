// =============================================================================
// FireISP 5.0 — Install test window (migration 448)
// =============================================================================
// A pending contract's line is DOWN by default (provisioning now creates the
// RADIUS account inactive). On site, the technician opens a bounded test
// window — full internet, speed test included — which closes by hand, by the
// 5-minute sweep, or is superseded by formal activation:
//
//   startWindow — contract must be PENDING with a RADIUS account; flips the
//                 account active, stamps contracts.test_window_expires_at
//                 (NOW() + install_test_window_minutes org setting, default
//                 60), best-effort NAS push for RouterOS direct-API installs.
//   endWindow   — pending contracts only (activation owns active ones): flips
//                 the account back to inactive, clears the bound, best-effort
//                 Disconnect so the live session actually drops.
//   sweep       — the scheduled task: endWindow for every pending contract
//                 whose bound has passed. Never touches activated contracts
//                 or grandfathered pending lines with no bound set.
// =============================================================================

const db = require('../config/database');
const logger = require('../utils/logger').child({ service: 'testWindow' });
const { ValidationError, NotFoundError } = require('../utils/errors');
const { ORG_SETTING_DEFS } = require('./settingsCatalog');

async function windowMinutes(orgId) {
  if (orgId === null || orgId === undefined) {
    return Number(ORG_SETTING_DEFS.install_test_window_minutes.default);
  }
  const [rows] = await db.query(
    `SELECT setting_value FROM organization_settings
     WHERE organization_id = ? AND setting_key = 'install_test_window_minutes'`,
    [orgId],
  );
  const stored = Number(rows[0]?.setting_value);
  return Number.isInteger(stored) && stored > 0
    ? stored
    : Number(ORG_SETTING_DEFS.install_test_window_minutes.default);
}

async function loadPendingContract(contractId, orgId) {
  const params = [contractId];
  let orgCond = '';
  if (orgId !== null && orgId !== undefined) {
    orgCond = 'AND (organization_id = ? OR organization_id IS NULL)';
    params.push(orgId);
  }
  const [rows] = await db.query(
    `SELECT * FROM contracts WHERE id = ? ${orgCond} AND deleted_at IS NULL`,
    params,
  );
  const contract = rows[0];
  if (!contract) throw new NotFoundError('Contract');
  if (contract.status !== 'pending') {
    throw new ValidationError(
      `The test window applies to pending contracts only (this one is ${contract.status}) — an active contract is already online`,
    );
  }
  return contract;
}

async function startWindow(contractId, { orgId, performedBy: _performedBy = null } = {}) {
  const contract = await loadPendingContract(contractId, orgId);

  const [radRows] = await db.query(
    'SELECT * FROM radius WHERE contract_id = ? AND deleted_at IS NULL LIMIT 1',
    [contractId],
  );
  const radius = radRows[0];
  if (!radius) {
    throw new ValidationError('This contract has no RADIUS account to enable — provision it first');
  }

  const minutes = await windowMinutes(orgId ?? contract.organization_id ?? null);
  await db.query("UPDATE radius SET status = 'active' WHERE id = ?", [radius.id]);
  await db.query(
    'UPDATE contracts SET test_window_expires_at = DATE_ADD(NOW(), INTERVAL ? MINUTE) WHERE id = ?',
    [minutes, contractId],
  );

  // RouterOS direct-API installs get the secret pushed immediately; the
  // FreeRADIUS-SQL path picks the account up on its next sync. Best-effort,
  // same as the regenerate-PPPoE route.
  let pushed = false;
  if (radius.nas_id) {
    try {
      const Nas = require('../models/Nas');
      const routerProvisioningService = require('./routerProvisioningService');
      const nas = await Nas.findByIdOrFail(radius.nas_id, orgId);
      await routerProvisioningService.pushSubscriber(nas, {
        username: radius.username,
        password: radius.password,
        profile: radius.profile,
        comment: `FireISP test window contract#${contractId}`,
      });
      pushed = true;
    } catch (err) {
      logger.warn({ err: err.message, contractId }, 'test window: NAS push failed (best-effort)');
    }
  }

  const [fresh] = await db.query('SELECT test_window_expires_at FROM contracts WHERE id = ?', [contractId]);
  logger.info({ contractId, minutes }, 'Test window opened');
  return { contract_id: contractId, expires_at: fresh[0].test_window_expires_at, minutes, nas_pushed: pushed };
}

async function endWindow(contractId, { orgId, reason = 'manual' } = {}) {
  const contract = await loadPendingContract(contractId, orgId);

  await db.query(
    "UPDATE radius SET status = 'inactive' WHERE contract_id = ? AND deleted_at IS NULL",
    [contractId],
  );
  await db.query(
    'UPDATE contracts SET test_window_expires_at = NULL WHERE id = ?',
    [contract.id],
  );

  // Kick the live PPPoE session so "down" means down, not down-at-next-reauth.
  try {
    const suspensionService = require('./suspensionService');
    await suspensionService.sendRadiusDisconnect(contractId);
  } catch (err) {
    logger.warn({ err: err.message, contractId }, 'test window: disconnect failed (best-effort)');
  }

  logger.info({ contractId, reason }, 'Test window closed');
  return { contract_id: contractId, closed: true, reason };
}

/** Scheduled sweep: close every expired window on a still-pending contract. */
async function sweep() {
  const [rows] = await db.query(
    `SELECT id, organization_id FROM contracts
     WHERE status = 'pending' AND deleted_at IS NULL
       AND test_window_expires_at IS NOT NULL AND test_window_expires_at < NOW()
     LIMIT 200`,
  );
  let closed = 0;
  for (const row of rows) {
    try {
      await endWindow(row.id, { orgId: row.organization_id, reason: 'expired' });
      closed += 1;
    } catch (err) {
      logger.warn({ err: err.message, contractId: row.id }, 'test window sweep: close failed');
    }
  }
  if (rows.length) logger.info({ examined: rows.length, closed }, 'Test window sweep complete');
  return { examined: rows.length, closed };
}

module.exports = { startWindow, endWindow, sweep, windowMinutes };
