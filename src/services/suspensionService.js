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

    await conn.execute(
      `INSERT INTO suspension_logs (contract_id, suspension_rule_id, action, performed_by, invoice_id, coa_sent, coa_response, suspended_at)
       VALUES (?, ?, 'suspend', ?, ?, ?, ?, NOW())`,
      [contractId, ruleId, userId, invoiceId, coaSent, coaResponse],
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

    await conn.execute(
      `INSERT INTO suspension_logs (contract_id, action, performed_by, invoice_id, coa_sent, coa_response, restored_at)
       VALUES (?, 'unsuspend', ?, ?, ?, ?, NOW())`,
      [contractId, userId, invoiceId, coaSent, coaResponse],
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
     WHERE contract_id = ? AND action = 'walled_garden' AND restored_at IS NULL LIMIT 1`,
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

  await db.query(
    `INSERT INTO suspension_logs (contract_id, suspension_rule_id, action, performed_by, invoice_id, coa_sent, coa_response, suspended_at)
     VALUES (?, ?, 'soft_suspend', ?, ?, ?, ?, NOW())`,
    [contractId, ruleId, userId, invoiceId, coaSent, coaResponse],
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
    `SELECT r.username, r.nas_id, n.ip_address AS nas_ip, n.coa_port, n.secret
     FROM radius r
     JOIN nas n ON n.id = r.nas_id
     WHERE r.contract_id = ?
     LIMIT 1`,
    [contractId],
  );

  if (radiusRows.length === 0) {
    return { sent: false, response: 'No RADIUS account found for contract' };
  }

  const { username, nas_ip, coa_port, secret } = radiusRows[0];
  const port = coa_port || 3799;

  if (!secret) {
    logger.error({ contractId }, 'NAS RADIUS secret is not configured — cannot send Disconnect-Request');
    return { sent: false, response: 'NAS RADIUS secret not configured' };
  }

  return sendRadiusPacket(nas_ip, port, secret, 40, username);
}

/**
 * Send a RADIUS CoA-Request (Code 43) for reconnection or attribute change.
 */
async function sendRadiusCoA(contractId, _action) {
  const [radiusRows] = await db.query(
    `SELECT r.username, r.nas_id, n.ip_address AS nas_ip, n.coa_port, n.secret
     FROM radius r
     JOIN nas n ON n.id = r.nas_id
     WHERE r.contract_id = ?
     LIMIT 1`,
    [contractId],
  );

  if (radiusRows.length === 0) {
    return { sent: false, response: 'No RADIUS account found for contract' };
  }

  const { username, nas_ip, coa_port, secret } = radiusRows[0];
  const port = coa_port || 3799;

  if (!secret) {
    logger.error({ contractId }, 'NAS RADIUS secret is not configured — cannot send CoA-Request');
    return { sent: false, response: 'NAS RADIUS secret not configured' };
  }

  return sendRadiusPacket(nas_ip, port, secret, 43, username);
}

/**
 * Low-level RADIUS packet sender using UDP.
 * @param {string} nasIp - NAS IP address
 * @param {number} port - CoA port (default 3799)
 * @param {string} secret - RADIUS shared secret
 * @param {number} code - RADIUS code (40=Disconnect, 43=CoA)
 * @param {string} username - User-Name attribute
 */
function sendRadiusPacket(nasIp, port, secret, code, username) {
  return new Promise((resolve) => {
    const socket = dgram.createSocket('udp4');
    const identifier = crypto.randomInt(0, 256);
    const timeout = setTimeout(() => {
      socket.close();
      resolve({ sent: true, response: 'Timeout — no response from NAS' });
    }, 5000);

    // Build a minimal RADIUS packet
    // User-Name attribute (type 1)
    const usernameAttr = Buffer.alloc(2 + username.length);
    usernameAttr[0] = 1; // User-Name type
    usernameAttr[1] = 2 + username.length;
    usernameAttr.write(username, 2);

    // RADIUS packet header (20 bytes) + attributes
    const attrLen = usernameAttr.length;
    const packet = Buffer.alloc(20 + attrLen);
    packet[0] = code;          // Code
    packet[1] = identifier;    // Identifier
    packet.writeUInt16BE(20 + attrLen, 2); // Length
    // Authenticator (16 bytes at offset 4) — filled with random, then HMAC'd
    const authenticatorRandom = crypto.randomBytes(16);
    authenticatorRandom.copy(packet, 4);
    usernameAttr.copy(packet, 20);

    // Compute Request Authenticator per RFC 2865 §3:
    // MD5(Code + ID + Length + 16 zero bytes + Attributes + Secret)
    // Note: MD5 is mandated by the RADIUS protocol spec — not a free choice.
    const authBuf = Buffer.alloc(20 + attrLen);
    packet.copy(authBuf, 0, 0, 20 + attrLen);
    authBuf.fill(0, 4, 20); // Zero out authenticator
    const md5 = crypto.createHash('md5');
    md5.update(authBuf);
    md5.update(Buffer.from(secret));
    const authenticator = md5.digest();
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

module.exports = { evaluateRules, suspendContract, softSuspendContract, reconnectContract, isClientSuspensionExempt, sendRadiusDisconnect, sendRadiusCoA, sendRadiusPacket };
