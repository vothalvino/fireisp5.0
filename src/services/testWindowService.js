// =============================================================================
// FireISP 5.0 — bounded installation commissioning (migrations 448 + 450)
// =============================================================================

const db = require('../config/database');
const logger = require('../utils/logger').child({ service: 'testWindow' });
const {
  ForbiddenError, ValidationError, NotFoundError,
} = require('../utils/errors');
const { ORG_SETTING_DEFS } = require('./settingsCatalog');

const PPPOE_TYPES = new Set(['pppoe', 'pppoe_dual']);
const NON_RADIUS_TYPES = new Set(['static', 'dual']);
const OPERABLE_WORK_ORDER_STATUSES = new Set(['assigned', 'in_progress']);

async function windowMinutes(orgId, runner = db) {
  if (orgId === null || orgId === undefined) {
    return Number(ORG_SETTING_DEFS.install_test_window_minutes.default);
  }
  const [rows] = await runner.query(
    `SELECT setting_value FROM organization_settings
     WHERE organization_id = ? AND setting_key = 'install_test_window_minutes'`,
    [orgId],
  );
  const stored = Number(rows[0]?.setting_value);
  return Number.isInteger(stored) && stored > 0
    ? stored
    : Number(ORG_SETTING_DEFS.install_test_window_minutes.default);
}

function contractOrgPredicate(orgId, alias = '') {
  if (orgId === null || orgId === undefined) return { sql: '', params: [] };
  const prefix = alias ? `${alias}.` : '';
  return {
    sql: `AND (${prefix}organization_id = ? OR ${prefix}organization_id IS NULL)`,
    params: [orgId],
  };
}

function assertPendingPppoeContract(contract) {
  if (contract.status !== 'pending') {
    throw new ValidationError(
      `The test window applies to pending contracts only (this one is ${contract.status}) — an active contract is already online`,
    );
  }
  if (!PPPOE_TYPES.has(contract.connection_type)) {
    throw new ValidationError('The test window requires a PPPoE contract with a RADIUS account');
  }
  if (Number(contract.test_window_cleanup_pending) === 1) {
    throw new ValidationError('Previous test-window network cleanup is still pending — wait for cleanup before reopening');
  }
}

/** Lock the line state in a consistent contract -> RADIUS order. */
async function lockLine(conn, contractId, orgId) {
  const scope = contractOrgPredicate(orgId);
  const [contractRows] = await conn.query(
    `SELECT *,
            (test_window_expires_at IS NOT NULL AND test_window_expires_at > NOW()) AS test_window_open
       FROM contracts
      WHERE id = ? ${scope.sql} AND deleted_at IS NULL
      FOR UPDATE`,
    [contractId, ...scope.params],
  );
  const contract = contractRows[0];
  if (!contract) throw new NotFoundError('Contract');

  const [radiusRows] = await conn.query(
    `SELECT * FROM radius
      WHERE contract_id = ? AND deleted_at IS NULL
      ORDER BY id
      FOR UPDATE`,
    [contractId],
  );

  assertPendingPppoeContract(contract);
  if (!radiusRows.length) {
    throw new ValidationError('This contract has no RADIUS account to enable — provision it first');
  }
  if (radiusRows.length !== 1) {
    throw new ValidationError('This contract has multiple live RADIUS accounts; resolve the duplicate accounts before opening a test window');
  }
  return { contract, radius: radiusRows[0] };
}

async function disconnectBestEffort(contractId) {
  try {
    const suspensionService = require('./suspensionService');
    const result = await suspensionService.sendRadiusDisconnect(contractId);
    const response = String(result?.response || '');
    // sendRadiusDisconnect.sent means ANY resolved target ACKed. A mixed
    // multi-NAS result can therefore be sent=true while another possible
    // session host timed out. Only an ACK with no unresolved target, or an
    // authoritative all-NAK (no matching session), confirms shutdown.
    const hasUnresolvedTarget = /timeout|no response|socket error|no secret|not configured|unexpected|failed|primary:/i
      .test(response);
    let confirmed = result?.outcome === 'nak' || result?.outcome === 'no_account'
      || (result?.sent === true && result?.outcome === 'ack' && !hasUnresolvedTarget);
    let confirmedOutcome = result?.outcome;
    if (!confirmed && result?.outcome === 'no_target') {
      // No home/session NAS exists to address. The Access-Accept still carried
      // Session-Timeout, so this becomes conclusively safe once the original
      // (preserved) window bound elapses; until then sweep keeps retrying.
      const [bounds] = await db.query(
        `SELECT (test_window_expires_at IS NOT NULL
                 AND test_window_expires_at <= NOW()) AS session_bound_elapsed
           FROM contracts WHERE id = ? LIMIT 1`,
        [contractId],
      );
      confirmed = Number(bounds[0]?.session_bound_elapsed) === 1;
      if (confirmed) confirmedOutcome = 'bounded_expiry';
    }
    if (confirmed) {
      return {
        disconnect_confirmed: true,
        disconnect_outcome: confirmedOutcome,
        disconnect_warning: null,
      };
    }
    const warning = 'The authentication rows are disabled, but the live RADIUS session was not conclusively disconnected; automatic retry is scheduled';
    logger.warn(
      { contractId, outcome: result?.outcome, response: result?.response },
      'test window: disconnect cleanup deferred',
    );
    return {
      disconnect_confirmed: false,
      disconnect_outcome: result?.outcome || 'unknown',
      disconnect_warning: warning,
    };
  } catch (err) {
    logger.warn({ err: err.message, contractId }, 'test window: disconnect failed (best-effort)');
    return {
      disconnect_confirmed: false,
      disconnect_outcome: 'error',
      disconnect_warning: 'The authentication rows are disabled, but the live RADIUS session disconnect failed; automatic retry is scheduled',
    };
  }
}

async function disableOneNasBestEffort(contractId, radius, orgId) {
  if (!radius?.nas_id) return { nas_disabled: null, nas_disable_warning: null };
  try {
    const Nas = require('../models/Nas');
    const routerProvisioningService = require('./routerProvisioningService');
    const routerosService = require('./routerosService');
    const nas = await Nas.findByIdOrFail(radius.nas_id, orgId);
    await routerosService.pppoeDelete(
      routerProvisioningService.nasToConn(nas),
      { name: radius.username },
    );
    return { nas_disabled: true, nas_disable_warning: null };
  } catch (err) {
    if (/^PPPoE secret .* not found$/i.test(err.message || '')) {
      return { nas_disabled: true, nas_disable_warning: null };
    }
    const warning = 'The database and FreeRADIUS line are disabled, but the RouterOS local PPP secret still needs cleanup; automatic retry is scheduled';
    logger.warn({ err: err.message, contractId, nasId: radius.nas_id }, 'test window: NAS cleanup deferred');
    return { nas_disabled: false, nas_disable_warning: warning };
  }
}

async function disableNasBestEffort(contractId, radius, orgId) {
  const accounts = (Array.isArray(radius) ? radius : [radius]).filter(Boolean);
  if (!accounts.length) return { nas_disabled: null, nas_disable_warning: null };
  const results = [];
  for (const account of accounts) {
    results.push(await disableOneNasBestEffort(contractId, account, orgId));
  }
  const failed = results.filter(result => result.nas_disabled === false);
  return {
    nas_disabled: failed.length
      ? false
      : results.some(result => result.nas_disabled === true) ? true : null,
    nas_disable_warning: failed.length
      ? [...new Set(failed.map(result => result.nas_disable_warning).filter(Boolean))].join('; ')
      : null,
  };
}

async function setCleanupMarker(contractId, orgId) {
  const scope = contractOrgPredicate(orgId);
  await db.query(
    `UPDATE contracts
        SET test_window_cleanup_pending = 1,
            test_window_cleanup_attempted_at = NOW(6)
      WHERE id = ? ${scope.sql} AND status <> 'active'`,
    [contractId, ...scope.params],
  );
}

async function releaseCleanupMarker(contractId, { orgId = null } = {}) {
  const scope = contractOrgPredicate(orgId);
  const [result] = await db.query(
    `UPDATE contracts
        SET test_window_cleanup_pending = 0,
            test_window_expires_at = NULL,
            test_window_cleanup_attempted_at = NULL
      WHERE id = ? ${scope.sql} AND status <> 'active'
        AND test_window_cleanup_pending = 1`,
    [contractId, ...scope.params],
  );
  return result.affectedRows > 0;
}

/**
 * Finish the external half of an already-committed shutdown. A failed NAS or
 * session cleanup restores/retains the durable marker, so sweep retries across
 * process restarts and even after cancellation/type-change/soft-delete. The
 * original expiry stays intact; NULL continues to mean legacy/unbounded.
 */
async function finalizeMarkedCleanup(contractId, {
  orgId = null,
  radius = null,
  reason = 'manual',
  retainMarker = false,
} = {}) {
  const nasState = await disableNasBestEffort(contractId, radius, orgId);
  const disconnectState = await disconnectBestEffort(contractId);
  if (nasState.nas_disabled === false || !disconnectState.disconnect_confirmed) {
    await setCleanupMarker(contractId, orgId);
  } else if (!retainMarker) {
    await releaseCleanupMarker(contractId, { orgId });
  }
  logger.info({ contractId, reason, nasDisabled: nasState.nas_disabled }, 'Test-window network cleanup processed');
  return { ...nasState, ...disconnectState };
}

async function syncFreeradius(contractId, orgId, enabled, runner) {
  const radiusService = require('./radiusService');
  return radiusService.syncFreeradiusContract(contractId, {
    organizationId: orgId,
    enabled,
    runner,
  });
}

async function startWindow(contractId, {
  orgId, performedBy = null, isAdmin = false, workOrderId = null,
} = {}) {
  const conn = await db.getConnection();
  let result;
  let radius;
  let nasState;
  try {
    await conn.beginTransaction();
    const locked = await lockLine(conn, contractId, orgId);
    ({ radius } = locked);
    if (workOrderId !== null && workOrderId !== undefined) {
      const workOrder = await lockEligibleWorkOrder(conn, workOrderId, orgId);
      if (Number(workOrder.contract_id) !== Number(contractId)) {
        throw new ValidationError('The installation work order is no longer linked to this contract');
      }
      assertEligibleWorkOrder(workOrder, { performedBy, isAdmin });
      await assertArrivalAuthorization(workOrder, conn);
      await advanceWorkOrderInProgress(conn, workOrder);
    }

    // RouterOS /ppp secret has no per-secret time bound. Its absence is a
    // precondition of exposing bounded RADIUS credentials, so perform the
    // idempotent delete while the contract/RADIUS locks are held and before
    // stamping or enabling the window. A failure rolls the transaction back.
    nasState = await disableNasBestEffort(contractId, radius, orgId);
    if (nasState.nas_disabled === false) {
      throw new ValidationError(
        'Unable to guarantee a bounded test window because the RouterOS local PPP secret could not be disabled',
      );
    }
    const effectiveOrgId = locked.contract.organization_id ?? orgId ?? null;
    const minutes = await windowMinutes(effectiveOrgId, conn);

    if (locked.contract.test_window_open) {
      result = {
        contract_id: Number(contractId),
        expires_at: locked.contract.test_window_expires_at,
        minutes,
        nas_pushed: false,
        already_open: true,
      };
    } else {
      const [stamp] = await conn.query(
        `UPDATE contracts
            SET test_window_expires_at = DATE_ADD(NOW(), INTERVAL ? MINUTE),
                test_window_cleanup_pending = 0,
                test_window_cleanup_attempted_at = NULL
          WHERE id = ? AND status = 'pending'
            AND test_window_cleanup_pending = 0
            AND (test_window_expires_at IS NULL OR test_window_expires_at <= NOW())`,
        [minutes, contractId],
      );
      if (stamp.affectedRows !== 1) {
        throw new ValidationError('The contract changed while the test window was opening — reload and retry');
      }
      await conn.query(
        "UPDATE radius SET status = 'active' WHERE id = ? AND contract_id = ? AND deleted_at IS NULL",
        [radius.id, contractId],
      );
      const [freshRows] = await conn.query(
        'SELECT test_window_expires_at FROM contracts WHERE id = ?',
        [contractId],
      );
      result = {
        contract_id: Number(contractId),
        expires_at: freshRows[0].test_window_expires_at,
        minutes,
        nas_pushed: false,
        already_open: false,
      };
    }

    // Standard FreeRADIUS SQL credentials are part of the same transaction as
    // the window/RADIUS status; a technician can authenticate immediately.
    const freeradius = await syncFreeradius(contractId, effectiveOrgId, true, conn);
    if (!freeradius.enabled) {
      throw new ValidationError('Unable to materialize FreeRADIUS credentials for this test window');
    }
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }

  // Commissioning authenticates through bounded RADIUS only. Repeat start has
  // already re-run the local-secret delete without extending this expiry.
  result.nas_pushed = false;
  result.nas_disabled = nasState.nas_disabled;
  result.nas_disable_warning = nasState.nas_disable_warning;
  logger.info({ contractId, minutes: result.minutes, alreadyOpen: result.already_open }, 'Test window opened');
  return result;
}

/** Mark a locked pending PPPoE window down, retaining its real expiry bound. */
async function markPendingCleanup(conn, contract, orgId) {
  const [marked] = await conn.query(
    `UPDATE contracts
        SET test_window_cleanup_pending = 1,
            test_window_cleanup_attempted_at = NOW(6),
            test_window_expires_at = COALESCE(
              test_window_expires_at, DATE_SUB(NOW(), INTERVAL 1 SECOND)
            )
      WHERE id = ? AND status = 'pending'`,
    [contract.id],
  );
  if (marked.affectedRows !== 1) {
    throw new ValidationError('The contract changed while the test window was closing — reload and retry');
  }
  await conn.query(
    `UPDATE radius r
     JOIN contracts c ON c.id = r.contract_id
        SET r.status = 'inactive'
      WHERE r.contract_id = ? AND r.deleted_at IS NULL
        AND c.status = 'pending'`,
    [contract.id],
  );
  await syncFreeradius(contract.id, contract.organization_id ?? orgId ?? null, false, conn);
}

async function endWindow(contractId, { orgId, reason = 'manual' } = {}) {
  // Manual End is also the operator retry for a previously failed RouterOS
  // delete. It therefore uses the permissive cleanup path rather than the
  // start-only pending/PPPoE assertion. cleanupMarkedWindow locks the contract
  // and explicitly refuses to disable a formally active line.
  return cleanupMarkedWindow(contractId, {
    orgId,
    reason,
    requireMarker: true,
  });
}

function assertEligibleWorkOrder(row, { performedBy, isAdmin }) {
  if (row.work_type !== 'installation' || !row.contract_id || !row.linked_contract_id) {
    throw new ValidationError('Commissioning applies to installation work orders linked to a contract');
  }
  if (!row.service_order_id || !row.linked_service_order_id
      || row.service_order_type !== 'new_install'
      || row.service_order_status !== 'in_process') {
    throw new ValidationError('The installation must be linked to an in-process new-install service order');
  }
  if (Number(row.service_order_contract_id) !== Number(row.contract_id)
      || Number(row.service_order_client_id) !== Number(row.client_id)
      || Number(row.linked_contract_client_id) !== Number(row.client_id)) {
    throw new ValidationError(
      'The installation work order, service order, contract, and client links do not match',
    );
  }
  if (!OPERABLE_WORK_ORDER_STATUSES.has(row.work_order_status) || !row.assigned_to) {
    throw new ValidationError('The installation work order must be assigned and in assigned or in-progress status');
  }
  if (!isAdmin && Number(row.assigned_to) !== Number(performedBy)) {
    throw new ForbiddenError('Only the assigned technician or a contract supervisor may record commissioning evidence');
  }
}

/**
 * Legal arrival authorization is part of commissioning eligibility, not just
 * a route preflight. Check it through the transaction connection after the WO
 * and exact service-order chain are locked so missing/cancelled instances
 * cannot race a speed-test insert or temporary network access.
 */
async function assertArrivalAuthorization(row, conn) {
  // Arrival consent is a handoff gate. Once the exact-template-gated visit has
  // reached in_progress, templates activated later are prospective and must
  // not retroactively strand an on-site technician or an open test window.
  if (row.work_order_status === 'in_progress') return;
  const legalDocumentService = require('./legalDocumentService');
  const gateError = await legalDocumentService.pendingGateError({
    work_type: row.work_type,
    service_order_id: row.service_order_id,
  }, 'in_progress', { runner: conn, lock: true });
  if (gateError) throw new ValidationError(gateError);
}

/** Starting either kind of on-site commissioning is the visit start boundary. */
async function advanceWorkOrderInProgress(conn, row) {
  if (row.work_order_status !== 'assigned') return false;
  const [result] = await conn.query(
    `UPDATE work_orders
        SET status = 'in_progress', started_at = COALESCE(started_at, NOW())
      WHERE id = ? AND organization_id = ? AND status = 'assigned'
        AND assigned_to = ? AND deleted_at IS NULL`,
    [row.work_order_id, row.organization_id, row.assigned_to],
  );
  if (result.affectedRows !== 1) {
    throw new ValidationError(
      'The installation work order changed while commissioning began — reload and retry',
    );
  }
  row.work_order_status = 'in_progress';
  return true;
}

async function lockEligibleWorkOrder(conn, workOrderId, orgId) {
  const [rows] = await conn.query(
    `SELECT wo.id AS work_order_id, wo.organization_id, wo.client_id,
            wo.contract_id, wo.service_order_id, wo.work_type,
            wo.status AS work_order_status, wo.assigned_to,
            so.id AS linked_service_order_id, so.status AS service_order_status,
            so.order_type AS service_order_type,
            so.contract_id AS service_order_contract_id,
            so.client_id AS service_order_client_id,
            c.id AS linked_contract_id, c.client_id AS linked_contract_client_id,
            c.status AS contract_status,
            c.connection_type, c.test_window_expires_at,
            c.test_window_cleanup_pending,
            (c.test_window_expires_at IS NOT NULL
             AND c.test_window_expires_at > NOW()) AS test_window_open
       FROM work_orders wo
       LEFT JOIN service_orders so
         ON so.id = wo.service_order_id
        AND (so.organization_id = ? OR so.organization_id IS NULL)
        AND so.deleted_at IS NULL
       LEFT JOIN contracts c
         ON c.id = wo.contract_id
        AND (c.organization_id = ? OR c.organization_id IS NULL)
        AND c.deleted_at IS NULL
      WHERE wo.id = ? AND wo.organization_id = ? AND wo.deleted_at IS NULL
      FOR UPDATE`,
    [orgId, orgId, workOrderId, orgId],
  );
  if (!rows[0]) throw new NotFoundError('Work order');
  return rows[0];
}

async function insertCommissioningSpeed(conn, row, measurement, orgId) {
  const [insert] = await conn.query(
    `INSERT INTO speed_tests
       (organization_id, client_id, contract_id, work_order_id, test_source,
        server_location, download_mbps, upload_mbps, latency_ms, jitter_ms,
        packet_loss_pct, notes, tested_at)
     VALUES (?, ?, ?, ?, 'technician', ?, ?, ?, ?, ?, ?, ?, NOW())`,
    [
      orgId,
      row.client_id,
      row.contract_id,
      row.work_order_id,
      measurement.server_location ?? null,
      measurement.download_mbps,
      measurement.upload_mbps,
      measurement.latency_ms ?? null,
      measurement.jitter_ms ?? null,
      measurement.packet_loss_pct ?? null,
      measurement.notes ?? null,
    ],
  );
  const [freshRows] = await conn.query(
    'SELECT * FROM speed_tests WHERE id = ? AND organization_id = ?',
    [insert.insertId, orgId],
  );
  return freshRows[0];
}

async function completeWindow(workOrderId, measurement, {
  orgId, performedBy = null, isAdmin = false,
} = {}) {
  const conn = await db.getConnection();
  let speedTest;
  let contractId;
  let radius;
  try {
    await conn.beginTransaction();
    const row = await lockEligibleWorkOrder(conn, workOrderId, orgId);
    assertEligibleWorkOrder(row, { performedBy, isAdmin });
    await assertArrivalAuthorization(row, conn);

    const [radiusRows] = await conn.query(
      `SELECT * FROM radius
        WHERE contract_id = ? AND deleted_at IS NULL
        ORDER BY id FOR UPDATE`,
      [row.contract_id],
    );
    radius = radiusRows;
    assertPendingPppoeContract({
      status: row.contract_status,
      connection_type: row.connection_type,
      test_window_cleanup_pending: row.test_window_cleanup_pending,
    });
    if (!radius.length) throw new ValidationError('This contract has no RADIUS account to disable — provision it first');
    if (!row.test_window_open) {
      throw new ValidationError('The test window is not open or has expired — open a new window before recording the result');
    }

    await advanceWorkOrderInProgress(conn, row);
    speedTest = await insertCommissioningSpeed(conn, row, measurement, orgId);
    await markPendingCleanup(conn, {
      id: row.contract_id,
      organization_id: row.organization_id,
    }, orgId);
    contractId = row.contract_id;
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }

  const nasState = await finalizeMarkedCleanup(contractId, {
    orgId, radius, reason: 'speed_test_complete',
  });
  logger.info({ contractId, workOrderId, speedTestId: speedTest.id }, 'Technician speed test recorded; window closed');
  return { speed_test: speedTest, closed: true, ...nasState };
}

/** Record bound commissioning evidence for static/dual service (line stays off). */
async function recordOfflineCommissioningTest(workOrderId, measurement, {
  orgId, performedBy = null, isAdmin = false,
} = {}) {
  const conn = await db.getConnection();
  let speedTest;
  try {
    await conn.beginTransaction();
    const row = await lockEligibleWorkOrder(conn, workOrderId, orgId);
    assertEligibleWorkOrder(row, { performedBy, isAdmin });
    await assertArrivalAuthorization(row, conn);
    if (row.contract_status !== 'pending') {
      throw new ValidationError('Commissioning evidence may only be recorded while the contract is pending');
    }
    if (!NON_RADIUS_TYPES.has(row.connection_type)) {
      throw new ValidationError('PPPoE commissioning must be recorded by completing an open test window');
    }
    if (row.test_window_expires_at || Number(row.test_window_cleanup_pending) === 1) {
      throw new ValidationError('Previous PPPoE test-window cleanup must finish before offline commissioning');
    }
    await advanceWorkOrderInProgress(conn, row);
    speedTest = await insertCommissioningSpeed(conn, row, measurement, orgId);
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
  return { speed_test: speedTest, recorded: true, line_state: 'offline' };
}

/**
 * Cleanup path used by sweep and mutation guards. Unlike endWindow it admits
 * cancelled/type-changed/soft-deleted contracts, but it never touches active
 * service. `retainMarker` blocks a concurrent start until the caller's state
 * mutation finishes.
 */
async function cleanupMarkedWindow(contractId, {
  orgId = null,
  reason = 'expired',
  retainMarker = false,
  requireMarker = true,
  onlyIfExpired = false,
} = {}) {
  const conn = await db.getConnection();
  let radius;
  let prepared;
  try {
    await conn.beginTransaction();
    const scope = contractOrgPredicate(orgId);
    const [contracts] = await conn.query(
      `SELECT *,
              (test_window_expires_at IS NOT NULL
               AND test_window_expires_at > NOW()) AS test_window_open
         FROM contracts WHERE id = ? ${scope.sql} FOR UPDATE`,
      [contractId, ...scope.params],
    );
    const contract = contracts[0];
    if (!contract) throw new NotFoundError('Contract');
    if (contract.status === 'active') {
      // Activation owns an active line. Repair only an impossible stale marker.
      await conn.query(
        `UPDATE contracts
            SET test_window_cleanup_pending = 0,
                test_window_expires_at = NULL,
                test_window_cleanup_attempted_at = NULL
          WHERE id = ? AND status = 'active'`,
        [contract.id],
      );
      await conn.commit();
      return { contract_id: Number(contractId), closed: false, active: true };
    }
    const hasMarker = Number(contract.test_window_cleanup_pending) === 1
      || contract.test_window_expires_at !== null;
    if (requireMarker && !hasMarker) {
      await conn.commit();
      return { contract_id: Number(contractId), closed: false, prepared: false };
    }
    if (onlyIfExpired
        && Number(contract.test_window_cleanup_pending) !== 1
        && Number(contract.test_window_open) === 1) {
      // The sweep selected an expired row, but a technician reopened it before
      // this lock was acquired. The fresh bound wins; never close it stale.
      await conn.commit();
      return {
        contract_id: Number(contractId), closed: false, prepared: false, reopened: true,
      };
    }

    const [radiusRows] = await conn.query(
      `SELECT * FROM radius WHERE contract_id = ?
        ORDER BY (deleted_at IS NULL) DESC, id DESC FOR UPDATE`,
      [contract.id],
    );
    radius = radiusRows;
    await conn.query(
      `UPDATE contracts
          SET test_window_cleanup_pending = 1,
              test_window_cleanup_attempted_at = NOW(6)
        WHERE id = ? AND status <> 'active'`,
      [contract.id],
    );
    await conn.query(
      `UPDATE radius r
       JOIN contracts c ON c.id = r.contract_id
          SET r.status = 'inactive'
        WHERE r.contract_id = ? AND r.deleted_at IS NULL
          AND c.status <> 'active'`,
      [contract.id],
    );
    await syncFreeradius(
      contract.id,
      contract.organization_id ?? orgId ?? null,
      false,
      conn,
    );
    prepared = true;
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }

  const nasState = await finalizeMarkedCleanup(contractId, {
    orgId, radius, reason, retainMarker,
  });
  return {
    contract_id: Number(contractId), closed: true, prepared, ...nasState,
  };
}

async function closeForContractMutation(contractId, { orgId = null, reason = 'contract_mutation' } = {}) {
  return cleanupMarkedWindow(contractId, {
    orgId, reason, retainMarker: true, requireMarker: false,
  });
}

/** Scheduled sweep retries both natural expiry and durable cleanup failures. */
async function sweep() {
  const [rows] = await db.query(
    `SELECT id, organization_id FROM contracts
      WHERE test_window_cleanup_pending = 1
         OR (test_window_expires_at IS NOT NULL AND test_window_expires_at < NOW())
      ORDER BY (test_window_cleanup_attempted_at IS NULL) DESC,
               test_window_cleanup_attempted_at ASC,
               test_window_expires_at ASC, id ASC
      LIMIT 200`,
  );
  let closed = 0;
  for (const row of rows) {
    try {
      const result = await cleanupMarkedWindow(row.id, {
        orgId: row.organization_id, reason: 'expired', onlyIfExpired: true,
      });
      if (result.closed) closed += 1;
    } catch (err) {
      logger.warn({ err: err.message, contractId: row.id }, 'test window sweep: cleanup failed');
    }
  }
  if (rows.length) logger.info({ examined: rows.length, closed }, 'Test window sweep complete');
  return { examined: rows.length, closed };
}

module.exports = {
  startWindow,
  endWindow,
  completeWindow,
  recordOfflineCommissioningTest,
  cleanupMarkedWindow,
  closeForContractMutation,
  finalizeMarkedCleanup,
  releaseCleanupMarker,
  sweep,
  windowMinutes,
};
