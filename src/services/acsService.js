// =============================================================================
// FireISP 5.0 — ACS (Auto Configuration Server) Service (§8.1/§8.3)
// =============================================================================
// Handles incoming CWMP/TR-069 HTTP requests from CPE devices.
// Endpoint: POST /acs/cwmp — mounted OUTSIDE the authenticated /api/v1 surface.
// CPE authentication: HTTP Basic with per-CPE acs_username/acs_password_hash.
// §8.3: session events and errors are logged to cpe_session_logs.
// §8.3: DiagnosticsComplete Inform events route to cpeDiagnosticsService.
// §8.4: On Inform, tryAutoLinkSubscriber is called to match serial → subscriber.
// =============================================================================
'use strict';

const bcrypt = require('bcryptjs');
const db = require('../config/database');
const CpeDevice = require('../models/CpeDevice');
const { parseCwmpEnvelope, buildCwmpResponse } = require('./cwmpXml');
const cwmpSessionService = require('./cwmpSessionService');
const cpeDiagnosticsService = require('./cpeDiagnosticsService');
const cpeSessionLogService = require('./cpeSessionLogService');
const cpeInventoryService = require('./cpeInventoryService');
const logger = require('../utils/logger').child({ service: 'acsService' });

// ---------------------------------------------------------------------------
// verifyAcsCredentials
// ---------------------------------------------------------------------------

/**
 * Look up a CPE device by acs_username and verify the plaintext password.
 * @param {string} username
 * @param {string} passwordPlaintext
 * @returns {object|null} cpe_devices row or null
 */
async function verifyAcsCredentials(username, passwordPlaintext) {
  if (!username || !passwordPlaintext) return null;
  const [rows] = await db.query(
    'SELECT * FROM cpe_devices WHERE acs_username = ? AND deleted_at IS NULL LIMIT 1',
    [username],
  );
  if (!rows.length) return null;
  const device = rows[0];
  if (!device.acs_password_hash) return null;
  const ok = await bcrypt.compare(passwordPlaintext, device.acs_password_hash);
  return ok ? device : null;
}

// ---------------------------------------------------------------------------
// handleCwmpRequest
// ---------------------------------------------------------------------------

/**
 * Entry point for POST /acs/cwmp.
 */
async function handleCwmpRequest(req, res) {
  try {
    // 1. Connection-request check: empty body, no auth → 200 OK
    const body = req.body;
    if (!body || (typeof body === 'string' && body.trim() === '')) {
      return res.status(200).send('');
    }

    // 2. Normalize body to XML string early (needed for logging)
    const xmlString = typeof body === 'string' ? body : JSON.stringify(body);

    // 3. HTTP Basic authentication
    let cpeDevice = null;
    const authHeader = req.headers['authorization'] || '';
    if (authHeader.startsWith('Basic ')) {
      const encoded = authHeader.slice(6);
      const decoded = Buffer.from(encoded, 'base64').toString('utf8');
      const colonIdx = decoded.indexOf(':');
      if (colonIdx !== -1) {
        const username = decoded.slice(0, colonIdx);
        const password = decoded.slice(colonIdx + 1);
        cpeDevice = await verifyAcsCredentials(username, password);
        if (!cpeDevice) {
          // §8.3: log auth failure
          cpeSessionLogService.logSessionEvent({
            eventType: 'auth_failure',
            remoteIp: req.ip || null,
            rawBody: xmlString,
          }).catch(() => {});
        }
      }
    }

    // 4. Parse CWMP envelope
    const { messageType, id: msgId, payload } = parseCwmpEnvelope(xmlString);

    logger.debug({ messageType, msgId }, 'CWMP message received');

    // 5. Handle Inform and DiagnosticsComplete (device may not be authenticated yet — auto-register)
    if (messageType === 'Inform' || messageType === 'DiagnosticsComplete') {
      const { deviceId: cwmpDeviceId } = payload;
      const serialNumber = cwmpDeviceId.serialNumber || '';
      const oui = cwmpDeviceId.oui || '';

      // Auto-register or fetch existing device
      if (!cpeDevice && serialNumber && oui) {
        const [existing] = await db.query(
          'SELECT * FROM cpe_devices WHERE serial_number = ? AND oui = ? AND deleted_at IS NULL LIMIT 1',
          [serialNumber, oui],
        );
        if (existing.length) {
          cpeDevice = existing[0];
        } else {
          // Auto-register
          const created = await CpeDevice.create({
            serial_number: serialNumber,
            oui,
            manufacturer: cwmpDeviceId.manufacturer || null,
            product_class: cwmpDeviceId.productClass || null,
            hardware_version: cwmpDeviceId.hwVersion || null,
            software_version: cwmpDeviceId.swVersion || null,
            last_inform_ip: req.ip || null,
            status: 'new',
          });
          cpeDevice = created;
          logger.info({ cpeDeviceId: created.id, serialNumber, oui }, 'CPE auto-registered');
        }
      }

      if (!cpeDevice) {
        return res.status(401).set('Content-Type', 'text/xml').send(
          buildCwmpResponse(msgId, 'Empty'),
        );
      }

      // Update last_inform_ip
      await db.query(
        'UPDATE cpe_devices SET last_inform_ip = ? WHERE id = ?',
        [req.ip || null, cpeDevice.id],
      );

      // §8.3: handle diagnostics complete event
      if (messageType === 'DiagnosticsComplete') {
        cpeDiagnosticsService.handleDiagnosticsComplete(cpeDevice, payload).catch(err =>
          logger.warn({ err: err.message, cpeDeviceId: cpeDevice.id }, 'handleDiagnosticsComplete failed'),
        );
        // Log inform event
        cpeSessionLogService.logSessionEvent({
          orgId: cpeDevice.organization_id,
          cpeDeviceId: cpeDevice.id,
          eventType: 'inform',
          messageType: 'DiagnosticsComplete',
          remoteIp: req.ip || null,
        }).catch(() => {});
      } else {
        // §8.4: attempt auto-link subscriber on each Inform
        cpeInventoryService.tryAutoLinkSubscriber(cpeDevice).catch(err =>
          logger.debug({ err: err.message, cpeDeviceId: cpeDevice.id }, 'tryAutoLinkSubscriber skipped'),
        );
        // §8.3: log inform event
        cpeSessionLogService.logSessionEvent({
          orgId: cpeDevice.organization_id,
          cpeDeviceId: cpeDevice.id,
          eventType: 'inform',
          messageType: 'Inform',
          remoteIp: req.ip || null,
        }).catch(() => {});
      }

      await cwmpSessionService.handleInform(cpeDevice, payload, cpeDevice.organization_id);

      // Check for queued tasks
      const nextTask = await cwmpSessionService.getNextTask(cpeDevice.id);
      if (nextTask) {
        await db.query(
          "UPDATE cpe_tasks SET status = 'in_progress', started_at = NOW() WHERE id = ?",
          [nextTask.id],
        );
        // §8.3: log task dispatched
        cpeSessionLogService.logSessionEvent({
          orgId: cpeDevice.organization_id,
          cpeDeviceId: cpeDevice.id,
          eventType: 'task_dispatched',
          taskType: nextTask.task_type,
          remoteIp: req.ip || null,
        }).catch(() => {});
        const taskXml = cwmpSessionService.buildResponseForTask(nextTask);
        return res
          .status(200)
          .set('Content-Type', 'text/xml; charset=utf-8')
          .send(taskXml);
      }

      return res
        .status(200)
        .set('Content-Type', 'text/xml; charset=utf-8')
        .send(buildCwmpResponse(msgId, 'InformResponse'));
    }

    // 6. Handle task responses — need authenticated device
    if (!cpeDevice) {
      return res.status(401).set('Content-Type', 'text/xml').send('');
    }

    // Find in-progress task for this device
    const [inProgress] = await db.query(
      "SELECT * FROM cpe_tasks WHERE cpe_device_id = ? AND status = 'in_progress' ORDER BY started_at DESC LIMIT 1",
      [cpeDevice.id],
    );
    const activeTask = inProgress[0] || null;

    if (activeTask) {
      if (messageType === 'Fault') {
        const faultMsg = `${payload.faultCode}: ${payload.faultString}`;
        await db.query(
          'UPDATE cpe_tasks SET status = ?, error_message = ?, completed_at = NOW() WHERE id = ?',
          ['failed', faultMsg, activeTask.id],
        );
        // §8.3: log fault
        cpeSessionLogService.logSessionEvent({
          orgId: cpeDevice.organization_id,
          cpeDeviceId: cpeDevice.id,
          eventType: 'fault',
          messageType: 'Fault',
          taskType: activeTask.task_type,
          faultCode: payload.faultCode,
          faultString: payload.faultString,
          remoteIp: req.ip || null,
          rawBody: xmlString,
        }).catch(() => {});
      } else {
        // §8.3: check if this is a diagnostic result response
        const taskParams = activeTask.parameters
          ? (typeof activeTask.parameters === 'string' ? JSON.parse(activeTask.parameters) : activeTask.parameters)
          : {};
        if (taskParams && taskParams._diagId && messageType === 'GetParameterValuesResponse') {
          await cpeDiagnosticsService.storeDiagnosticResults(
            cpeDevice.id,
            payload.parameterList || [],
            taskParams,
          );
        }
        await cwmpSessionService.processTaskResponse(activeTask, payload);
        // §8.3: log task response
        cpeSessionLogService.logSessionEvent({
          orgId: cpeDevice.organization_id,
          cpeDeviceId: cpeDevice.id,
          eventType: 'task_response',
          messageType,
          taskType: activeTask.task_type,
          remoteIp: req.ip || null,
        }).catch(() => {});
      }
    }

    // Check for next queued task
    const nextTask = await cwmpSessionService.getNextTask(cpeDevice.id);
    if (nextTask) {
      await db.query(
        "UPDATE cpe_tasks SET status = 'in_progress', started_at = NOW() WHERE id = ?",
        [nextTask.id],
      );
      const taskXml = cwmpSessionService.buildResponseForTask(nextTask);
      return res
        .status(200)
        .set('Content-Type', 'text/xml; charset=utf-8')
        .send(taskXml);
    }

    // No more tasks — close session
    return res.status(200).send('');

  } catch (err) {
    logger.error({ err: err.message }, 'CWMP request error');
    res.status(500).send('');
  }
}

module.exports = { handleCwmpRequest, verifyAcsCredentials };
