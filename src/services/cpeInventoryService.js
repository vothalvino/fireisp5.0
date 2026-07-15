// =============================================================================
// FireISP 5.0 — CPE Inventory Service (§8.4)
// =============================================================================
// Handles:
//   - CPE ↔ subscriber auto-linking (on Inform, match serial_number vs contracts)
//   - Lifecycle FSM: in_stock → assigned → active → returned → rma (guarded transitions)
//   - Swap workflow (transactional: old → returned, new → assigned + inherit subscriber/profile)
//   - Depreciation tracking (straight-line / declining-balance / none)
// =============================================================================

'use strict';

const db = require('../config/database');
const { resolveOrCreateStockRow } = require('./inventoryDrawdownService');
const logger = require('../utils/logger').child({ service: 'cpeInventoryService' });

// ---------------------------------------------------------------------------
// Lifecycle state machine
// ---------------------------------------------------------------------------

// Valid transitions
const TRANSITIONS = {
  in_stock:  ['assigned'],
  // 'rma' added to 'assigned' (Inventory Phase 3, migration 391): a pickup
  // can find a unit damaged before it was ever activated (installed but
  // never came online / picked back up mid-install) — that unit was never
  // 'active', so completePickupUnit's rma disposition needs a direct
  // assigned -> rma path, not a detour through 'returned'.
  assigned:  ['active', 'returned', 'in_stock', 'rma'],
  active:    ['returned', 'rma'],
  returned:  ['in_stock', 'rma'],
  rma:       ['in_stock'],
};

/**
 * Verify a transition is legal.
 * @throws Error if not allowed.
 */
function assertTransitionAllowed(fromState, toState) {
  const allowed = TRANSITIONS[fromState] || [];
  if (!allowed.includes(toState)) {
    throw Object.assign(
      new Error(`Lifecycle transition ${fromState} → ${toState} is not allowed`),
      { status: 422, code: 'INVALID_LIFECYCLE_TRANSITION' },
    );
  }
}

/**
 * Transition a CPE device to a new lifecycle state (with history record).
 * @param {number} cpeDeviceId
 * @param {string} toState
 * @param {object} opts
 * @param {number|null} [opts.orgId]
 * @param {number|null} [opts.performedBy]
 * @param {string} [opts.reason]
 * @param {number|null} [opts.swapInDeviceId]  - new device (for swap)
 * @param {number|null} [opts.swapOutDeviceId] - old device (for swap)
 * @param {object} [opts.connection] - existing db connection for transaction
 * @returns {object} updated cpe_devices row
 */
async function transitionLifecycleState(cpeDeviceId, toState, opts = {}) {
  const conn = opts.connection || db;
  const { orgId = null, performedBy = null, reason = null, swapInDeviceId = null, swapOutDeviceId = null } = opts;

  // Load current state
  const [rows] = await conn.query(
    'SELECT id, lifecycle_state, organization_id FROM cpe_devices WHERE id = ? AND deleted_at IS NULL',
    [cpeDeviceId],
  );
  if (!rows.length) {
    throw Object.assign(new Error('CPE device not found'), { status: 404, code: 'NOT_FOUND' });
  }
  const device = rows[0];
  const fromState = device.lifecycle_state || 'in_stock';

  assertTransitionAllowed(fromState, toState);

  await conn.query(
    'UPDATE cpe_devices SET lifecycle_state = ? WHERE id = ?',
    [toState, cpeDeviceId],
  );

  // Record in history
  await conn.query(
    `INSERT INTO cpe_lifecycle_history
       (organization_id, cpe_device_id, from_state, to_state, reason, swap_in_device_id, swap_out_device_id, performed_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [orgId || device.organization_id, cpeDeviceId, fromState, toState, reason, swapInDeviceId, swapOutDeviceId, performedBy],
  );

  const [updated] = await conn.query('SELECT * FROM cpe_devices WHERE id = ?', [cpeDeviceId]);
  return updated[0];
}

// ---------------------------------------------------------------------------
// Subscriber auto-link (§8.4)
// ---------------------------------------------------------------------------

/**
 * Attempt to auto-link a CPE device to a subscriber when it sends an Inform.
 * Matching priority:
 *   1. contracts.cpe_serial_number (if the column exists)
 *   2. contracts with same organization where client has matching nas_port/device field
 * Manual link always wins over auto-link (does not overwrite subscriber_id already set).
 * @param {object} cpeDevice - cpe_devices row (already has id, serial_number, oui, organization_id)
 */
async function tryAutoLinkSubscriber(cpeDevice) {
  if (!cpeDevice.serial_number) return;

  // Skip if already linked
  if (cpeDevice.subscriber_id) return;

  const orgCondition = cpeDevice.organization_id
    ? 'AND c.organization_id = ?'
    : '';
  const params = [cpeDevice.serial_number];
  if (cpeDevice.organization_id) params.push(cpeDevice.organization_id);

  // Strategy 1: contracts.cpe_serial_number column (may not exist)
  try {
    const [colCheck] = await db.query(
      `SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'contracts' AND COLUMN_NAME = 'cpe_serial_number'`,
    );
    if (colCheck.length) {
      const [matches] = await db.query(
        `SELECT cl.id AS client_id FROM contracts c
         JOIN clients cl ON cl.id = c.client_id
         WHERE c.cpe_serial_number = ? AND c.deleted_at IS NULL AND cl.deleted_at IS NULL
         ${orgCondition}
         LIMIT 1`,
        params,
      );
      if (matches.length) {
        await _linkSubscriber(cpeDevice.id, matches[0].client_id, cpeDevice.organization_id);
        return;
      }
    }
  } catch (err) {
    logger.debug({ err: err.message }, 'auto-link strategy 1 skipped');
  }

  // Strategy 2: devices.serial_number cross-reference
  // contracts has no `device_id` column — the bridge is
  // cpe_devices.device_id -> devices.id and cpe_devices.contract_id -> contracts.id.
  // This was unguarded (unlike Strategy 1) and threw on every call, so
  // auto-linking via device serial number cross-reference never worked.
  //
  // item 8 of the second adversarial review (flagged, not confirmed this
  // round): matching purely on `d.serial_number` with no cross-check that
  // the matched device and the matched contract actually belong to the same
  // organization could, in principle, bridge a CPE to the wrong client if a
  // serial number were ever reused/stale across orgs. `orgCondition` only
  // constrains the *contract's* org (and only when the new CPE already has
  // one, which is not always true at first TR-069 contact) — it never
  // constrains the matched `devices` row itself. Added as defense in depth;
  // this does not change behavior for the correct/common case where the
  // device and its bridging contract already agree on organization.
  try {
    const [matches] = await db.query(
      `SELECT c.client_id FROM devices d
       JOIN cpe_devices bridge ON bridge.device_id = d.id
       JOIN contracts c ON c.id = bridge.contract_id
       WHERE d.serial_number = ? AND bridge.deleted_at IS NULL AND c.deleted_at IS NULL
         AND d.organization_id = c.organization_id
       ${orgCondition}
       LIMIT 1`,
      params,
    );
    if (matches.length) {
      await _linkSubscriber(cpeDevice.id, matches[0].client_id, cpeDevice.organization_id);
    }
  } catch (err) {
    logger.debug({ err: err.message }, 'auto-link strategy 2 skipped');
  }
}

async function _linkSubscriber(cpeDeviceId, subscriberId, orgId) {
  await db.query(
    'UPDATE cpe_devices SET subscriber_id = ?, subscriber_linked_at = NOW() WHERE id = ?',
    [subscriberId, cpeDeviceId],
  );
  // Record lifecycle transition to assigned (if still in_stock) — silently ignore if not valid
  try {
    const [rows] = await db.query('SELECT lifecycle_state FROM cpe_devices WHERE id = ?', [cpeDeviceId]);
    if (rows.length && rows[0].lifecycle_state === 'in_stock') {
      await transitionLifecycleState(cpeDeviceId, 'assigned', {
        orgId,
        reason: 'auto-linked to subscriber on Inform',
      });
    }
  } catch (_e) { /* transition may already be done */ }
  logger.info({ cpeDeviceId, subscriberId }, 'CPE auto-linked to subscriber');
}

/**
 * Manually link or unlink a CPE to a subscriber.
 * @param {number} cpeDeviceId
 * @param {number|null} subscriberId - null to unlink
 * @param {object} opts
 */
async function linkSubscriber(cpeDeviceId, subscriberId, opts = {}) {
  const { orgId = null, performedBy = null } = opts;

  if (subscriberId) {
    await db.query(
      'UPDATE cpe_devices SET subscriber_id = ?, subscriber_linked_at = NOW() WHERE id = ?',
      [subscriberId, cpeDeviceId],
    );
    // Transition to assigned if in_stock
    const [rows] = await db.query('SELECT lifecycle_state FROM cpe_devices WHERE id = ?', [cpeDeviceId]);
    if (rows.length && rows[0].lifecycle_state === 'in_stock') {
      await transitionLifecycleState(cpeDeviceId, 'assigned', {
        orgId, performedBy, reason: 'manually linked to subscriber',
      });
    }
  } else {
    await db.query(
      'UPDATE cpe_devices SET subscriber_id = NULL, subscriber_linked_at = NULL WHERE id = ?',
      [cpeDeviceId],
    );
  }

  const [updated] = await db.query('SELECT * FROM cpe_devices WHERE id = ?', [cpeDeviceId]);
  return updated[0];
}

// ---------------------------------------------------------------------------
// Swap workflow (§8.4)
// ---------------------------------------------------------------------------

/**
 * Swap an active/assigned CPE with a new one in a single transaction.
 * - Old device: lifecycle_state → returned, subscriber_id cleared
 * - New device: inherits subscriber_id + cpe_profile_id + contract_id from old device
 *               lifecycle_state → assigned
 * @param {object} opts
 * @param {number} opts.oldDeviceId
 * @param {number} opts.newDeviceId
 * @param {number|null} opts.orgId
 * @param {number|null} opts.performedBy
 * @param {string} [opts.reason]
 */
async function swapDevice(opts) {
  const { oldDeviceId, newDeviceId, orgId, performedBy, reason = 'CPE swap' } = opts;

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // Load both devices
    const [[oldDevRows]] = await conn.query(
      'SELECT * FROM cpe_devices WHERE id = ? AND deleted_at IS NULL',
      [oldDeviceId],
    );
    if (!oldDevRows) throw Object.assign(new Error('Old CPE device not found'), { status: 404 });

    const [[newDevRows]] = await conn.query(
      'SELECT * FROM cpe_devices WHERE id = ? AND deleted_at IS NULL',
      [newDeviceId],
    );
    if (!newDevRows) throw Object.assign(new Error('New CPE device not found'), { status: 404 });

    // Old device must be active or assigned
    if (!['active', 'assigned'].includes(oldDevRows.lifecycle_state)) {
      throw Object.assign(
        new Error(`Old CPE lifecycle_state must be active or assigned (currently: ${oldDevRows.lifecycle_state})`),
        { status: 422 },
      );
    }

    // New device must be in_stock
    if (newDevRows.lifecycle_state !== 'in_stock') {
      throw Object.assign(
        new Error('New CPE lifecycle_state must be in_stock (currently: ' + newDevRows.lifecycle_state + ')'),
        { status: 422 },
      );
    }

    // Inherit subscriber/profile/contract/ownership from old device to new
    // device. Ownership must travel too (Inventory Phase 3, migration 391):
    // a rented replacement has to stay ownership='rented' or it silently
    // falls out of ensurePickupWorkOrder/completePickupUnit's filters (both
    // key on `ownership = 'rented'`) and can never be reclaimed when the
    // contract is later cancelled.
    await conn.query(
      `UPDATE cpe_devices
       SET subscriber_id = ?, subscriber_linked_at = NOW(),
           cpe_profile_id = ?, contract_id = ?, ownership = ?
       WHERE id = ?`,
      [oldDevRows.subscriber_id, oldDevRows.cpe_profile_id, oldDevRows.contract_id, oldDevRows.ownership, newDeviceId],
    );

    // Clear old device subscriber link
    await conn.query(
      'UPDATE cpe_devices SET subscriber_id = NULL, subscriber_linked_at = NULL, contract_id = NULL WHERE id = ?',
      [oldDeviceId],
    );

    // Transition old device → returned
    await transitionLifecycleState(oldDeviceId, 'returned', {
      orgId, performedBy, reason,
      swapInDeviceId: newDeviceId,
      swapOutDeviceId: oldDeviceId,
      connection: conn,
    });

    // Transition new device → assigned
    await transitionLifecycleState(newDeviceId, 'assigned', {
      orgId, performedBy, reason,
      swapInDeviceId: newDeviceId,
      swapOutDeviceId: oldDeviceId,
      connection: conn,
    });

    // Stock effect for the NEW device, in the SAME transaction — mirrors
    // installEquipment's rented-path decrement exactly (source-of-stock rule:
    // resolveOrCreateStockRow's org-wide greatest-quantity row for this
    // item). Only tracked units (inventory_item_id set) have any physical
    // stock to move; a legacy/untracked device swapped in leaves stock
    // untouched, same as it always has.
    //
    // The OLD device intentionally gets NO stock write here: it lands in
    // 'returned' above, and per the consistency invariant (module header of
    // inventorySerialService.js) 'returned' is a limbo state that does not
    // re-enter inventory_stock until a pickup/return flow (completePickupUnit)
    // explicitly resolves it — mirroring that a swapped-out unit isn't
    // physically back in the warehouse yet, just off the client's line.
    if (newDevRows.inventory_item_id) {
      const stockId = await resolveOrCreateStockRow(conn.query.bind(conn), { orgId, itemId: newDevRows.inventory_item_id });
      await conn.query('UPDATE inventory_stock SET quantity = quantity - 1 WHERE id = ?', [stockId]);
      await conn.query(
        `INSERT INTO inventory_transactions (stock_id, transaction_type, quantity, client_id, performed_by, reference, notes)
         VALUES (?, 'assign_to_job', 1, ?, ?, ?, ?)`,
        [stockId, oldDevRows.subscriber_id, performedBy, `CPE swap on contract #${oldDevRows.contract_id}`, `Serial ${newDevRows.serial_number} (swap-in)`],
      );
    }

    await conn.commit();

    const [oldUpdated] = await db.query('SELECT * FROM cpe_devices WHERE id = ?', [oldDeviceId]);
    const [newUpdated] = await db.query('SELECT * FROM cpe_devices WHERE id = ?', [newDeviceId]);
    return { oldDevice: oldUpdated[0], newDevice: newUpdated[0] };

  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

// ---------------------------------------------------------------------------
// Lifecycle history
// ---------------------------------------------------------------------------

async function getLifecycleHistory({ cpeDeviceId, orgId, page = 1, limit = 50 }) {
  const offset = (page - 1) * limit;
  const conditions = ['cpe_device_id = ?'];
  const params = [cpeDeviceId];
  if (orgId) { conditions.push('(organization_id = ? OR organization_id IS NULL)'); params.push(orgId); }
  const where = `WHERE ${conditions.join(' AND ')}`;
  const [rows] = await db.query(
    `SELECT h.*, u.first_name, u.last_name
     FROM cpe_lifecycle_history h
     LEFT JOIN users u ON u.id = h.performed_by
     ${where} ORDER BY h.created_at DESC LIMIT ${limit} OFFSET ${offset}`,
    params,
  );
  const [[{ total }]] = await db.query(
    `SELECT COUNT(*) AS total FROM cpe_lifecycle_history ${where}`,
    params,
  );
  return { data: rows, meta: { total, page, limit } };
}

// ---------------------------------------------------------------------------
// Depreciation calculation (§8.4)
// ---------------------------------------------------------------------------

/**
 * Compute current book value for a CPE device.
 * @param {object} device - cpe_devices row with depreciation columns
 * @returns {{ currentValue: number|null, accumulatedDepreciation: number|null, method: string }}
 */
function computeDepreciation(device) {
  const { purchase_cost, purchase_date, depreciation_method, useful_life_months, salvage_value } = device;

  if (!purchase_cost || !purchase_date || depreciation_method === 'none') {
    return { currentValue: null, accumulatedDepreciation: null, method: depreciation_method || 'none' };
  }

  const cost = parseFloat(purchase_cost);
  const salvage = parseFloat(salvage_value || 0);
  const lifeMonths = parseInt(useful_life_months || 60, 10);

  const start = new Date(purchase_date);
  const now = new Date();
  const elapsedMonths = Math.max(0, (now.getFullYear() - start.getFullYear()) * 12
    + (now.getMonth() - start.getMonth()));

  let currentValue;
  let accumulatedDepreciation;

  if (depreciation_method === 'straight_line') {
    const monthlyRate = (cost - salvage) / lifeMonths;
    accumulatedDepreciation = Math.min(cost - salvage, monthlyRate * elapsedMonths);
    currentValue = Math.max(salvage, cost - accumulatedDepreciation);

  } else if (depreciation_method === 'declining_balance') {
    // Double-declining balance
    const annualRate = (2 / (lifeMonths / 12));
    const yearsElapsed = elapsedMonths / 12;
    currentValue = Math.max(salvage, cost * Math.pow(1 - annualRate, yearsElapsed));
    accumulatedDepreciation = cost - currentValue;

  } else {
    return { currentValue: null, accumulatedDepreciation: null, method: depreciation_method };
  }

  return {
    currentValue: Math.round(currentValue * 100) / 100,
    accumulatedDepreciation: Math.round(accumulatedDepreciation * 100) / 100,
    method: depreciation_method,
    elapsedMonths,
    remainingMonths: Math.max(0, lifeMonths - elapsedMonths),
  };
}

module.exports = {
  transitionLifecycleState,
  tryAutoLinkSubscriber,
  linkSubscriber,
  swapDevice,
  getLifecycleHistory,
  computeDepreciation,
  assertTransitionAllowed,
  TRANSITIONS,
};
