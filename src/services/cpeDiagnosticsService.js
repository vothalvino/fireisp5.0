// =============================================================================
// FireISP 5.0 — CPE Diagnostics Service (§8.3)
// =============================================================================
// Orchestrates TR-069 diagnostic task dispatching and result storage.
// Diagnostic flow:
//   1. API caller POSTs to /cpe-management/devices/:id/diagnostics
//   2. Service creates a cpe_tasks row (ping_diagnostic / traceroute_diagnostic /
//      wifi_diagnostics / wan_diagnostics) → CPE picks up via session
//   3. cwmpSessionService.buildResponseForTask dispatches the SetParameterValues
//   4. CPE responds, eventually sends Inform with '8 DIAGNOSTICS COMPLETE'
//   5. acsService handles DiagnosticsComplete and calls handleDiagnosticsComplete()
//   6. Results are read back via GetParameterValues and stored in cpe_diagnostics
// =============================================================================

'use strict';

const db = require('../config/database');
const CpeTask = require('../models/CpeTask');
const logger = require('../utils/logger').child({ service: 'cpeDiagnosticsService' });

// ---------------------------------------------------------------------------
// TR-069 standard parameter paths by diagnostic type
// ---------------------------------------------------------------------------

// IGD (TR-098) paths — most ISP CPE uses this namespace
const IGD_PING_BASE  = 'InternetGatewayDevice.IPPingDiagnostics.';
const IGD_TRACE_BASE = 'InternetGatewayDevice.TraceRouteDiagnostics.';
const IGD_WIFI_BASE  = 'InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.';
const IGD_WAN_BASE   = 'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANIPConnection.1.';

// Device:2 (TR-181) paths — newer devices (reserved for future use)
const _DEV2_PING_BASE  = 'Device.IP.Diagnostics.IPPing.';
const _DEV2_TRACE_BASE = 'Device.IP.Diagnostics.TraceRoute.';
const _DEV2_WIFI_BASE  = 'Device.WiFi.Radio.1.';
const _DEV2_WAN_BASE   = 'Device.IP.Interface.1.';

// Wi-Fi and Ethernet are read-only parameter reads (no DiagnosticsState).
const WIFI_READ_PARAMS_IGD = [
  `${IGD_WIFI_BASE}Channel`,
  `${IGD_WIFI_BASE}TotalAssociations`,
  `${IGD_WIFI_BASE}TransmitPower`,
  // Signal quality via AssociatedDevice subtree
  `${IGD_WIFI_BASE}AssociatedDeviceNumberOfEntries`,
];
const ETH_READ_PARAMS_IGD = [
  'InternetGatewayDevice.LANDevice.1.LANEthernetInterfaceConfig.1.Stats.BytesSent',
  'InternetGatewayDevice.LANDevice.1.LANEthernetInterfaceConfig.1.Stats.BytesReceived',
  'InternetGatewayDevice.LANDevice.1.LANEthernetInterfaceConfig.1.Status',
];
const WAN_READ_PARAMS_IGD = [
  `${IGD_WAN_BASE}ConnectionStatus`,
  `${IGD_WAN_BASE}ExternalIPAddress`,
  `${IGD_WAN_BASE}Uptime`,
  `${IGD_WAN_BASE}BytesSent`,
  `${IGD_WAN_BASE}BytesReceived`,
  `${IGD_WAN_BASE}PacketsSent`,
  `${IGD_WAN_BASE}PacketsReceived`,
];

// ---------------------------------------------------------------------------
// queueDiagnosticTask
// ---------------------------------------------------------------------------

/**
 * Create a cpe_tasks row and a pending cpe_diagnostics row for a diagnostic.
 * @param {object} opts
 * @param {number} opts.cpeDeviceId
 * @param {number|null} opts.orgId
 * @param {'ping'|'traceroute'|'wifi_snapshot'|'ethernet_status'|'wan_diagnostics'} opts.diagType
 * @param {string} [opts.targetHost]
 * @param {number|null} [opts.createdBy]
 * @returns {{ task: object, diagnostic: object }}
 */
async function queueDiagnosticTask({ cpeDeviceId, orgId, diagType, targetHost, createdBy }) {
  // Map diagType → task_type
  const taskTypeMap = {
    ping:             'ping_diagnostic',
    traceroute:       'traceroute_diagnostic',
    wifi_snapshot:    'wifi_diagnostics',
    ethernet_status:  'wifi_diagnostics',  // reuses get_parameter_values path
    wan_diagnostics:  'wan_diagnostics',
  };

  const taskType = taskTypeMap[diagType] || 'ping_diagnostic';

  // Build task parameters
  let taskParams = {};
  if (diagType === 'ping') {
    taskParams = { host: targetHost || '8.8.8.8', numberOfRepetitions: 3, timeout: 1000 };
  } else if (diagType === 'traceroute') {
    taskParams = { host: targetHost || '8.8.8.8', maxHopCount: 30 };
  } else if (diagType === 'wifi_snapshot') {
    taskParams = { paths: WIFI_READ_PARAMS_IGD };
  } else if (diagType === 'ethernet_status') {
    taskParams = { paths: ETH_READ_PARAMS_IGD };
  } else if (diagType === 'wan_diagnostics') {
    taskParams = { paths: WAN_READ_PARAMS_IGD };
  }

  // Create cpe_tasks row
  const task = await CpeTask.create({
    organization_id: orgId,
    cpe_device_id: cpeDeviceId,
    task_type: taskType,
    parameters: JSON.stringify(taskParams),
    priority: 3,
    status: 'queued',
    created_by: createdBy || null,
  });

  // Create pending cpe_diagnostics row
  const [result] = await db.query(
    `INSERT INTO cpe_diagnostics
       (organization_id, cpe_device_id, cpe_task_id, diag_type, status, target_host)
     VALUES (?, ?, ?, ?, 'pending', ?)`,
    [orgId, cpeDeviceId, task.id, diagType, targetHost || null],
  );
  const diagId = result.insertId;

  const [rows] = await db.query('SELECT * FROM cpe_diagnostics WHERE id = ?', [diagId]);
  return { task, diagnostic: rows[0] };
}

// ---------------------------------------------------------------------------
// handleDiagnosticsComplete — called by acsService on '8 DIAGNOSTICS COMPLETE'
// ---------------------------------------------------------------------------

/**
 * After the CPE reports diagnostics complete, we need to read results.
 * This queues a GetParameterValues task for the result subtree.
 * @param {object} cpeDevice
 * @param {object} informPayload
 */
async function handleDiagnosticsComplete(cpeDevice, informPayload) {
  try {
    // Find the in-progress diagnostic task for this device
    const [diagRows] = await db.query(
      `SELECT cd.*, ct.parameters AS task_params, ct.task_type
       FROM cpe_diagnostics cd
       JOIN cpe_tasks ct ON ct.id = cd.cpe_task_id
       WHERE cd.cpe_device_id = ? AND cd.status IN ('pending','running')
       ORDER BY cd.created_at DESC LIMIT 1`,
      [cpeDevice.id],
    );

    if (!diagRows.length) {
      // Update any ping/traceroute diagnostics that sent params in the Inform
      await _processInformParameters(cpeDevice, informPayload);
      return;
    }

    const diag = diagRows[0];

    // Mark diagnostic as running
    await db.query(
      'UPDATE cpe_diagnostics SET status = ?, started_at = NOW() WHERE id = ?',
      ['running', diag.id],
    );

    // Determine result paths to fetch
    let resultPaths = [];
    if (diag.diag_type === 'ping') {
      resultPaths = [
        `${IGD_PING_BASE}DiagnosticsState`,
        `${IGD_PING_BASE}AverageResponseTime`,
        `${IGD_PING_BASE}MinimumResponseTime`,
        `${IGD_PING_BASE}MaximumResponseTime`,
        `${IGD_PING_BASE}SuccessCount`,
        `${IGD_PING_BASE}FailureCount`,
      ];
    } else if (diag.diag_type === 'traceroute') {
      resultPaths = [
        `${IGD_TRACE_BASE}DiagnosticsState`,
        `${IGD_TRACE_BASE}ResponseTime`,
        `${IGD_TRACE_BASE}NumberOfRouteHops`,
        `${IGD_TRACE_BASE}RouteHops.`,
      ];
    }

    if (resultPaths.length > 0) {
      // Queue a follow-up GetParameterValues to read results
      await CpeTask.create({
        organization_id: cpeDevice.organization_id,
        cpe_device_id: cpeDevice.id,
        task_type: 'get_parameter_values',
        parameters: JSON.stringify({ paths: resultPaths, _diagId: diag.id }),
        priority: 2,
        status: 'queued',
        created_by: null,
      });
    } else {
      // Wi-Fi/WAN/Ethernet — results are already in the Inform parameters
      await _processInformParameters(cpeDevice, informPayload, diag);
    }
  } catch (err) {
    logger.warn({ err: err.message, cpeDeviceId: cpeDevice.id }, 'handleDiagnosticsComplete failed');
  }
}

// ---------------------------------------------------------------------------
// storeDiagnosticResults — called by cwmpSessionService after get_parameter_values
// ---------------------------------------------------------------------------

/**
 * When a GetParameterValues response arrives for a diagnostic read-back, parse and store.
 * @param {number} cpeDeviceId
 * @param {Array} parameterList
 * @param {object|null} taskParams - parsed parameters from the task, may have _diagId
 */
async function storeDiagnosticResults(cpeDeviceId, parameterList, taskParams) {
  const diagId = taskParams && taskParams._diagId ? taskParams._diagId : null;
  if (!diagId) return;

  const result = {};
  for (const p of parameterList) {
    const shortKey = p.name.split('.').pop();
    result[shortKey] = p.value;
  }

  await db.query(
    `UPDATE cpe_diagnostics
     SET status = 'complete', result = ?, completed_at = NOW()
     WHERE id = ?`,
    [JSON.stringify(result), diagId],
  );
}

// ---------------------------------------------------------------------------
// Private: process params that arrive inline in the Inform
// ---------------------------------------------------------------------------

async function _processInformParameters(cpeDevice, informPayload, diag) {
  if (!diag) return;
  const paramMap = {};
  for (const p of (informPayload.parameters || [])) {
    paramMap[p.name] = p.value;
  }
  const result = {};
  for (const [key, val] of Object.entries(paramMap)) {
    const short = key.split('.').pop();
    result[short] = val;
  }
  if (Object.keys(result).length) {
    await db.query(
      `UPDATE cpe_diagnostics
       SET status = 'complete', result = ?, completed_at = NOW()
       WHERE id = ?`,
      [JSON.stringify(result), diag.id],
    );
  }
}

// ---------------------------------------------------------------------------
// getDiagnosticList
// ---------------------------------------------------------------------------

async function getDiagnosticList({ cpeDeviceId, orgId, page = 1, limit = 25 }) {
  const offset = (page - 1) * limit;
  const conditions = ['cpe_device_id = ?', 'deleted_at IS NULL'];
  const params = [cpeDeviceId];
  if (orgId) {
    conditions.push('organization_id = ?');
    params.push(orgId);
  }
  const where = `WHERE ${conditions.join(' AND ')}`;
  const [rows] = await db.query(
    `SELECT * FROM cpe_diagnostics ${where} ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`,
    params,
  );
  const [[{ total }]] = await db.query(
    `SELECT COUNT(*) AS total FROM cpe_diagnostics ${where}`,
    params,
  );
  return { data: rows, meta: { total, page, limit } };
}

async function deleteDiagnostic(diagId, orgId) {
  const conditions = ['id = ?', 'deleted_at IS NULL'];
  const params = [diagId];
  if (orgId) { conditions.push('organization_id = ?'); params.push(orgId); }
  await db.query(
    `UPDATE cpe_diagnostics SET deleted_at = NOW() WHERE ${conditions.join(' AND ')}`,
    params,
  );
}

module.exports = {
  queueDiagnosticTask,
  handleDiagnosticsComplete,
  storeDiagnosticResults,
  getDiagnosticList,
  deleteDiagnostic,
  // Export for tests
  IGD_PING_BASE,
  IGD_TRACE_BASE,
};
