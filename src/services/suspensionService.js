// =============================================================================
// FireISP 5.0 — Suspension Service
// =============================================================================
// Evaluates suspension rules, suspends/reconnects contracts, logs events.
// Sends RADIUS Disconnect-Request / CoA-Request to NAS devices.
// =============================================================================

const crypto = require('crypto');
const dgram = require('dgram');
const db = require('../config/database');
const logger = require('../utils/logger').child({ service: 'suspension' });
// NOTE: the action values below are written as SQL literals ('suspended',
// 'unsuspended') rather than interpolated from SUSPENSION_ACTIONS on purpose —
// the new `node src/scripts/sql-column-check.js` gate can only validate an ENUM
// value it can see statically in the statement.
const {
  SOFT_SUSPEND_REASON_PREFIX,
  OPEN_WALLED_GARDEN_PREDICATE,
  triggeredBy,
  describeTrigger,
} = require('./suspensionLogConstants');

/**
 * Evaluate suspension rules for an organization and return contracts to act on.
 */
async function evaluateRules(organizationId) {
  const [rules] = await db.query(
    'SELECT * FROM suspension_rules WHERE organization_id = ? AND is_enabled = TRUE ORDER BY days_past_due ASC',
    [organizationId],
  );

  const results = [];

  for (const rule of rules) {
    // Find contracts with past-due invoices exceeding the rule's threshold.
    // Exclude contracts whose client has suspension_exempt set.
    const [contracts] = await db.query(`
      SELECT c.*, i.id AS invoice_id, i.due_date, i.total,
             DATEDIFF(NOW(), i.due_date) AS days_overdue
      FROM contracts c
      JOIN invoices i ON i.contract_id = c.id AND i.organization_id = ?
      JOIN clients cl ON cl.id = c.client_id
      WHERE c.organization_id = ?
        AND c.status = 'active'
        AND i.status = 'issued'
        AND DATEDIFF(NOW(), i.due_date) >= ?
        AND DATEDIFF(NOW(), i.due_date) < ? + ?
        AND COALESCE(cl.suspension_exempt, 0) = 0
    `, [organizationId, organizationId, rule.days_past_due,
      rule.days_past_due, rule.grace_period_days || 0]);

    for (const contract of contracts) {
      results.push({ rule, contract });
    }
  }

  return results;
}

/**
 * Suspend a contract. Changes status, logs the event, and sends RADIUS Disconnect-Request.
 */
async function suspendContract(contractId, ruleId, userId, invoiceId) {
  const exemptCheck = await isClientSuspensionExempt(contractId);
  if (exemptCheck.exempt) {
    logger.info({ contractId, reason: exemptCheck.reason }, 'Skipping suspension — client is suspension-exempt');
    return { skipped: true, reason: exemptCheck.reason };
  }

  logger.info({ contractId, ruleId, invoiceId }, 'Suspending contract');
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    await conn.execute(
      'UPDATE contracts SET status = ? WHERE id = ?',
      ['suspended', contractId],
    );

    // Deactivate the RADIUS account so it stops authenticating NEW PPPoE
    // sessions — radiusServerService.findSubscriber only authenticates
    // status='active' rows, so without this a suspended subscriber could
    // simply re-dial and be back online. Only flips a currently-active row
    // (never touches an already-'inactive' — i.e. terminated/cancelled —
    // account, and is a no-op if there is no RADIUS account at all).
    await conn.execute(
      "UPDATE radius SET status = 'suspended' WHERE contract_id = ? AND deleted_at IS NULL AND status = 'active'",
      [contractId],
    );

    // Send RADIUS CoA to disconnect the subscriber
    let coaSent = false;
    let coaResponse = null;
    try {
      const coaResult = await sendRadiusDisconnect(contractId);
      coaSent = coaResult.sent;
      coaResponse = coaResult.response;
    } catch (_coaErr) {
      // CoA failure should not block the suspension
      coaResponse = 'CoA send failed';
    }

    // suspension_logs.client_id is NOT NULL, so the row is built with an
    // INSERT ... SELECT off `contracts` on the same connection/transaction:
    // one round trip, and client_id can never disagree with the contract.
    await conn.execute(
      `INSERT INTO suspension_logs
         (contract_id, client_id, suspension_rule_id, action, reason, triggered_by,
          performed_by_user_id, radius_coa_sent, radius_coa_response, related_invoice_id, suspended_at)
       SELECT c.id, c.client_id, ?, 'suspended', ?, ?, ?, ?, ?, ?, NOW()
       FROM contracts c
       WHERE c.id = ?`,
      [
        ruleId,
        describeTrigger('suspension', ruleId, userId, invoiceId),
        triggeredBy(userId),
        userId,
        coaSent,
        coaResponse,
        invoiceId,
        contractId,
      ],
    );

    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * Reconnect a suspended contract. Changes status, logs the event, and sends RADIUS CoA.
 */
async function reconnectContract(contractId, userId, invoiceId) {
  logger.info({ contractId, invoiceId }, 'Reconnecting contract');
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    await conn.execute(
      'UPDATE contracts SET status = ? WHERE id = ?',
      ['active', contractId],
    );

    // Restore the RADIUS account so it can authenticate again. Guarded to
    // ONLY flip an account that is currently 'suspended' — this function is
    // billing/rule-driven (called by suspension_rules evaluation and the
    // /unsuspend route) and must NEVER resurrect an 'inactive' (terminated or
    // cancelled) account; reinstating a fully terminated/cancelled contract
    // is a deliberate staff action handled separately by POST /:id/renew. If
    // the account is already 'active' (e.g. reconnecting after a
    // softSuspendContract walled-garden restriction, which never touches
    // radius.status), this UPDATE simply matches 0 rows — harmless.
    await conn.execute(
      "UPDATE radius SET status = 'active' WHERE contract_id = ? AND deleted_at IS NULL AND status = 'suspended'",
      [contractId],
    );

    // Send RADIUS CoA to re-enable the subscriber
    let coaSent = false;
    let coaResponse = null;
    try {
      const coaResult = await sendRadiusCoA(contractId, 'reconnect');
      coaSent = coaResult.sent;
      coaResponse = coaResult.response;
    } catch (_coaErr) {
      coaResponse = 'CoA send failed';
    }

    // suspended_at is NOT NULL on EVERY row, including this 'unsuspended' one.
    // Recover the moment the outage actually started from the most recent
    // 'suspended' row for the contract so the reconnect row carries the real
    // downtime window (suspended_at → restored_at) instead of a meaningless
    // "suspended and restored at the same instant". Falls back to NOW() when
    // there is no prior suspension row (e.g. a contract suspended by hand in
    // the DB, or logs pruned) — COALESCE(?, NOW()) keeps that in one statement.
    const [priorRows] = await conn.execute(
      `SELECT suspended_at FROM suspension_logs
       WHERE contract_id = ? AND action = 'suspended' AND restored_at IS NULL
       ORDER BY suspended_at DESC, id DESC LIMIT 1`,
      [contractId],
    );
    const suspendedAt = (Array.isArray(priorRows) && priorRows[0]) ? priorRows[0].suspended_at : null;

    await conn.execute(
      `INSERT INTO suspension_logs
         (contract_id, client_id, action, reason, triggered_by,
          performed_by_user_id, radius_coa_sent, radius_coa_response, related_invoice_id,
          suspended_at, restored_at)
       SELECT c.id, c.client_id, 'unsuspended', ?, ?, ?, ?, ?, ?, COALESCE(?, NOW()), NOW()
       FROM contracts c
       WHERE c.id = ?`,
      [
        describeTrigger('reconnect', null, userId, invoiceId),
        triggeredBy(userId),
        userId,
        coaSent,
        coaResponse,
        invoiceId,
        suspendedAt,
        contractId,
      ],
    );

    // Close the open suspension rows for this contract so `restored_at IS NULL`
    // keeps meaning "still suspended". Walled-garden rows are deliberately left
    // open here — walledGardenReconnect (below) closes those once the CoA and
    // the FreeRADIUS re-sync that actually lift the restriction have run.
    await conn.execute(
      `UPDATE suspension_logs SET restored_at = NOW()
       WHERE contract_id = ? AND action = 'suspended' AND restored_at IS NULL
         AND (reason IS NULL OR reason NOT LIKE 'walled\\_garden:%')`,
      [contractId],
    );

    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }

  // Lift any open walled-garden restriction so the next re-auth leaves the
  // address list (lazy require — radiusService requires this module too)
  const [walled] = await db.query(
    `SELECT id FROM suspension_logs
     WHERE contract_id = ? AND ${OPEN_WALLED_GARDEN_PREDICATE} LIMIT 1`,
    [contractId],
  );
  if (walled.length > 0) {
    const radiusService = require('./radiusService');
    await radiusService.walledGardenReconnect(contractId, userId);
  }
}

/**
 * Soft-suspend a contract: send RADIUS CoA with throttled speeds but leave the
 * contract status as 'active'. Records a 'soft_suspend' entry in suspension_logs.
 *
 * Deliberately does NOT touch contracts.status or radius.status (unlike
 * suspendContract/reconnectContract above): a walled-garden / rate-limited
 * subscriber must KEEP authenticating — that's the whole point of the walled
 * garden (restricted address list / payment-redirect) — so radius.status
 * stays 'active' throughout. Consequently, reconnectContract's guarded
 * 'suspended'->'active' UPDATE simply matches 0 rows when lifting a soft
 * suspension (the account was never flipped away from 'active'), which is
 * harmless — see the comment on that UPDATE.
 */
async function softSuspendContract(contractId, ruleId, userId, invoiceId, downloadKbps, uploadKbps) {
  const exemptCheck = await isClientSuspensionExempt(contractId);
  if (exemptCheck.exempt) {
    logger.info({ contractId, reason: exemptCheck.reason }, 'Skipping soft suspension — client is suspension-exempt');
    return { skipped: true, reason: exemptCheck.reason };
  }

  logger.info({ contractId, ruleId, invoiceId, downloadKbps, uploadKbps }, 'Soft-suspending contract');

  let coaSent = false;
  let coaResponse;
  try {
    const coaResult = await sendRadiusCoA(contractId, 'soft_suspend');
    coaSent = coaResult.sent;
    coaResponse = JSON.stringify({
      action: 'soft_suspend',
      download_kbps: downloadKbps,
      upload_kbps: uploadKbps,
      result: coaResult.response,
    });
  } catch (_coaErr) {
    coaResponse = JSON.stringify({ action: 'soft_suspend', download_kbps: downloadKbps, upload_kbps: uploadKbps, result: 'CoA send failed' });
  }

  // action = 'suspended' (NOT 'disconnected'): a soft suspension throttles the
  // subscriber but never cuts the service — they keep authenticating and stay
  // online at a degraded rate. 'disconnected' would misreport an outage that
  // did not happen. The ENUM has no dedicated soft-suspend value and we do not
  // extend it; the flavour lives in `reason` (see suspensionLogConstants).
  await db.query(
    `INSERT INTO suspension_logs
       (contract_id, client_id, suspension_rule_id, action, reason, triggered_by,
        performed_by_user_id, radius_coa_sent, radius_coa_response, related_invoice_id, suspended_at)
     SELECT c.id, c.client_id, ?, 'suspended', ?, ?, ?, ?, ?, ?, NOW()
     FROM contracts c
     WHERE c.id = ?`,
    [
      ruleId,
      `${SOFT_SUSPEND_REASON_PREFIX} ${describeTrigger('soft suspension', ruleId, userId, invoiceId)}`
      + ` (throttled to ${downloadKbps || '?'}/${uploadKbps || '?'} kbps)`,
      triggeredBy(userId),
      userId,
      coaSent,
      coaResponse,
      invoiceId,
      contractId,
    ],
  );
}

/**
 * Check whether the client associated with a contract has suspension_exempt set.
 * Returns { exempt: boolean, reason: string|null }.
 */
async function isClientSuspensionExempt(contractId) {
  const [rows] = await db.query(
    `SELECT cl.suspension_exempt, cl.suspension_exempt_reason
     FROM contracts ct
     JOIN clients cl ON cl.id = ct.client_id
     WHERE ct.id = ?
     LIMIT 1`,
    [contractId],
  );

  if (rows.length === 0) {
    return { exempt: false, reason: null };
  }

  return {
    exempt: !!rows[0].suspension_exempt,
    reason: rows[0].suspension_exempt_reason || null,
  };
}

/**
 * Send a RADIUS Disconnect-Request (RFC 3576 / RFC 5176) to the NAS
 * serving the given contract's subscriber.
 *
 * Packet format (simplified):
 *   Code: 40 (Disconnect-Request)
 *   Identifier: random
 *   Attributes: User-Name, NAS-IP-Address, Acct-Session-Id
 *
 * Returns { sent: boolean, response: string }.
 */
async function sendRadiusDisconnect(contractId) {
  // Look up the RADIUS account and NAS for this contract
  const [radiusRows] = await db.query(
    `SELECT r.username, r.nas_id, n.ip_address AS nas_ip, n.coa_port, n.secret, n.secondary_nas_id
     FROM radius r
     JOIN nas n ON n.id = r.nas_id
     WHERE r.contract_id = ?
     LIMIT 1`,
    [contractId],
  );

  if (radiusRows.length === 0) {
    return { sent: false, response: 'No RADIUS account found for contract' };
  }

  const nas = radiusRows[0];

  if (!nas.secret) {
    logger.error({ contractId }, 'NAS RADIUS secret is not configured — cannot send Disconnect-Request');
    return { sent: false, response: 'NAS RADIUS secret not configured' };
  }

  return sendWithFailover(nas, 40, nas.username);
}

/**
 * Send a RADIUS CoA-Request (Code 43) for reconnection or attribute change.
 */
async function sendRadiusCoA(contractId, _action) {
  const [radiusRows] = await db.query(
    `SELECT r.username, r.nas_id, n.ip_address AS nas_ip, n.coa_port, n.secret, n.secondary_nas_id
     FROM radius r
     JOIN nas n ON n.id = r.nas_id
     WHERE r.contract_id = ?
     LIMIT 1`,
    [contractId],
  );

  if (radiusRows.length === 0) {
    return { sent: false, response: 'No RADIUS account found for contract' };
  }

  const nas = radiusRows[0];

  if (!nas.secret) {
    logger.error({ contractId }, 'NAS RADIUS secret is not configured — cannot send CoA-Request');
    return { sent: false, response: 'NAS RADIUS secret not configured' };
  }

  // TODO: for 'soft_suspend' action, encode Mikrotik-Rate-Limit or similar VSA
  // based on the suspension rule's soft_suspend_download_kbps / upload_kbps.
  // The radiusCoaEncoder module supports encodeMikrotikRateLimit() for this.
  // Requires the caller to pass ruleId / kbps values into this function.

  return sendWithFailover(nas, 43, nas.username);
}

/**
 * Low-level RADIUS packet sender using UDP.
 * @param {string} nasIp - NAS IP address
 * @param {number} port - CoA port (default 3799)
 * @param {string} secret - RADIUS shared secret
 * @param {number} code - RADIUS code (40=Disconnect, 43=CoA)
 * @param {string} username - User-Name attribute
 * @param {Array<{name: string, value: string}>} [extraAttributes=[]] - additional named attributes
 */
function sendRadiusPacket(nasIp, port, secret, code, username, extraAttributes = []) {
  const {
    encodeNamedAttributes,
    buildRadiusPacket,
    computeRequestAuthenticator,
  } = require('./radiusCoaEncoder');

  return new Promise((resolve) => {
    const socket = dgram.createSocket('udp4');
    const identifier = crypto.randomInt(0, 256);
    const timeout = setTimeout(() => {
      socket.close();
      resolve({ sent: true, response: 'Timeout — no response from NAS' });
    }, 5000);

    // Build attributes: User-Name first, then any caller-supplied extras
    const userNameBuf = encodeNamedAttributes([{ name: 'User-Name', value: username }]);
    const extraBuf = extraAttributes.length > 0
      ? encodeNamedAttributes(extraAttributes)
      : Buffer.alloc(0);
    const attributesBuffer = Buffer.concat([userNameBuf, extraBuf]);

    // Build packet with a zero authenticator placeholder, then compute the real one
    const zeroAuth = Buffer.alloc(16);
    const packet = buildRadiusPacket(code, identifier, zeroAuth, attributesBuffer);

    // Compute Request Authenticator per RFC 2865 §3:
    // MD5(Code + ID + Length + 16-zero-bytes + Attributes + Secret)
    // Note: MD5 is mandated by the RADIUS protocol spec — not a free algorithmic choice.
    const authenticator = computeRequestAuthenticator(packet, secret);
    authenticator.copy(packet, 4);

    socket.on('message', (msg) => {
      clearTimeout(timeout);
      socket.close();
      const responseCode = msg[0];
      const codeNames = { 41: 'Disconnect-ACK', 42: 'Disconnect-NAK', 44: 'CoA-ACK', 45: 'CoA-NAK' };
      resolve({ sent: true, response: codeNames[responseCode] || `Code ${responseCode}` });
    });

    socket.on('error', () => {
      clearTimeout(timeout);
      socket.close();
      resolve({ sent: false, response: 'Socket error' });
    });

    socket.send(packet, port, nasIp);
  });
}

/**
 * Send a RADIUS packet with automatic failover to a secondary NAS.
 *
 * @param {object} nas - NAS row with ip_address, coa_port, secret, secondary_nas_id
 * @param {number} code - RADIUS code (40=Disconnect, 43=CoA)
 * @param {string} username - User-Name attribute value
 * @param {Array<{name: string, value: string}>} [extraAttributes=[]]
 * @returns {Promise<{sent: boolean, response: string}>}
 */
async function sendWithFailover(nas, code, username, extraAttributes = []) {
  const port = nas.coa_port || 3799;
  const result = await sendRadiusPacket(nas.ip_address, port, nas.secret, code, username, extraAttributes);

  if (!result.sent && nas.secondary_nas_id) {
    logger.warn(
      { primaryNasIp: nas.ip_address, secondaryNasId: nas.secondary_nas_id },
      'Primary NAS send failed — attempting failover to secondary NAS',
    );

    const [secondaryRows] = await db.query(
      'SELECT ip_address, coa_port, secret FROM nas WHERE id = ? LIMIT 1',
      [nas.secondary_nas_id],
    );

    if (secondaryRows.length > 0) {
      const secondary = secondaryRows[0];
      const secondaryPort = secondary.coa_port || 3799;
      logger.info(
        { secondaryNasIp: secondary.ip_address, secondaryPort },
        'Sending RADIUS packet via secondary NAS',
      );
      return sendRadiusPacket(secondary.ip_address, secondaryPort, secondary.secret, code, username, extraAttributes);
    }

    logger.error({ secondaryNasId: nas.secondary_nas_id }, 'Secondary NAS not found — failover aborted');
  }

  return result;
}

module.exports = { evaluateRules, suspendContract, softSuspendContract, reconnectContract, isClientSuspensionExempt, sendRadiusDisconnect, sendRadiusCoA, sendRadiusPacket };
