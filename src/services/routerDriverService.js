// =============================================================================
// FireISP 5.0 — Router Driver Service (§18.3)
// =============================================================================
// Vendor-agnostic router command dispatch interface.
//
// MikroTik RouterOS: LIVE dispatch via existing routerosService.js.
// All other vendors (Cisco IOS/IOS-XE, Juniper JunOS, ZTE/Huawei, generic REST):
//   STUBBED — records a device_command_executions row with status='stubbed'.
//   No live SSH/NETCONF/REST call is made for non-MikroTik vendors.
//   A vendor driver plugin system would wire real implementations here.
//
// Credentials are stored AES-256-GCM encrypted via src/utils/encryption.js.
// =============================================================================

const db = require('../config/database');
const { encrypt, decrypt } = require('../utils/encryption');
const logger = require('../utils/logger').child({ service: 'routerDriverService' });

// Lazily require routerosService to avoid circular deps at module load
let _routerosService = null;
function getRouterosService() {
  if (!_routerosService) _routerosService = require('./routerosService');
  return _routerosService;
}

/**
 * Create a router driver config, encrypting sensitive credentials.
 */
async function createDriverConfig(organizationId, data, userId) {
  const encPassword = data.password ? encrypt(data.password) : null;
  const encToken    = data.api_token ? encrypt(data.api_token) : null;

  const [result] = await db.query(
    `INSERT INTO router_driver_configs
       (organization_id, device_id, vendor, protocol, host, port, username,
        encrypted_password, api_token, ssl_enabled, ssl_verify, timeout_ms,
        extra_params, is_active, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
    [organizationId, data.device_id || null, data.vendor || 'mikrotik',
      data.protocol || 'routeros_api', data.host || null,
      data.port || 8728, data.username || null,
      encPassword, encToken,
      data.ssl_enabled ? 1 : 0, data.ssl_verify !== false ? 1 : 0,
      data.timeout_ms || 10000,
      data.extra_params ? JSON.stringify(data.extra_params) : null,
      userId || null],
  );
  const [rows] = await db.query(
    'SELECT * FROM router_driver_configs WHERE id = ?', [result.insertId],
  );
  return sanitizeConfig(rows[0]);
}

/**
 * Update a router driver config.
 */
async function updateDriverConfig(configId, organizationId, data) {
  const fields = [];
  const params = [];
  const allowed = ['vendor', 'protocol', 'host', 'port', 'username', 'ssl_enabled', 'ssl_verify', 'timeout_ms', 'extra_params', 'is_active'];
  for (const key of allowed) {
    if (data[key] !== undefined) {
      fields.push(`\`${key}\` = ?`);
      params.push(key === 'extra_params' && typeof data[key] === 'object' ? JSON.stringify(data[key]) : data[key]);
    }
  }
  if (data.password) {
    fields.push('encrypted_password = ?');
    params.push(encrypt(data.password));
  }
  if (data.api_token) {
    fields.push('api_token = ?');
    params.push(encrypt(data.api_token));
  }
  if (!fields.length) {
    const [rows] = await db.query('SELECT * FROM router_driver_configs WHERE id = ? AND organization_id = ? AND deleted_at IS NULL', [configId, organizationId]);
    return rows.length ? sanitizeConfig(rows[0]) : null;
  }
  params.push(configId, organizationId);
  await db.query(
    `UPDATE router_driver_configs SET ${fields.join(', ')}, updated_at = NOW()
     WHERE id = ? AND organization_id = ? AND deleted_at IS NULL`,
    params,
  );
  const [rows] = await db.query('SELECT * FROM router_driver_configs WHERE id = ?', [configId]);
  return rows.length ? sanitizeConfig(rows[0]) : null;
}

/**
 * Test connectivity to a router.
 * For MikroTik: uses routerosService to open a real connection.
 * For others: STUBBED.
 */
async function testDriverConnection(configId, organizationId) {
  const [configs] = await db.query(
    'SELECT * FROM router_driver_configs WHERE id = ? AND organization_id = ? AND deleted_at IS NULL',
    [configId, organizationId],
  );
  if (!configs.length) return null;

  const config = configs[0];
  const password = config.encrypted_password ? decrypt(config.encrypted_password) : null;

  let testStatus = 'failed';
  let testMessage;

  if (config.vendor === 'mikrotik') {
    try {
      const rosService = getRouterosService();
      await rosService.listInterfaces({ host: config.host, port: config.port, user: config.username, password });
      testStatus = 'ok';
      testMessage = 'RouterOS API connection successful';
    } catch (err) {
      testMessage = err.message;
      logger.warn({ configId, err }, 'MikroTik connection test failed');
    }
  } else {
    // Non-MikroTik vendor drivers are not implemented — report honestly as not_tested
    testStatus = 'not_implemented';
    testMessage = `Vendor '${config.vendor}' driver is not implemented — no live connection test available`;
    logger.info({ configId, vendor: config.vendor }, 'Non-MikroTik driver test: not_implemented');
  }

  await db.query(
    'UPDATE router_driver_configs SET last_tested_at = NOW(), last_test_status = ? WHERE id = ?',
    [testStatus, configId],
  );

  return { status: testStatus, message: testMessage };
}

/**
 * Dispatch a command to a router.
 * MikroTik: live via routerosService.
 * Others: STUBBED (records device_command_executions with status='stubbed').
 */
async function dispatchCommand(configId, organizationId, command, params = {}, executedBy = null) {
  const [configs] = await db.query(
    'SELECT * FROM router_driver_configs WHERE id = ? AND organization_id = ? AND deleted_at IS NULL',
    [configId, organizationId],
  );
  if (!configs.length) return null;

  const config = configs[0];
  const start = Date.now();
  let status;
  let response = null;
  let errorMessage = null;

  if (config.vendor === 'mikrotik') {
    try {
      const rosService = getRouterosService();
      const password = config.encrypted_password ? decrypt(config.encrypted_password) : null;
      const conn = { host: config.host, port: config.port, user: config.username, password };

      // Map command names to routerosService methods
      switch (command) {
        case 'list_interfaces':
          response = await rosService.listInterfaces(conn);
          break;
        case 'pppoe_create':
          response = await rosService.pppoeCreate(conn, params);
          break;
        case 'pppoe_delete':
          response = await rosService.pppoeDelete(conn, params);
          break;
        case 'queue_set':
          response = await rosService.queueSet(conn, params);
          break;
        case 'reboot':
          response = await rosService.systemReboot(conn);
          break;
        default:
          // Unmapped commands must NOT report success — an unknown command was
          // never sent to the device, so recording 'success' would be a silent
          // no-op that reads as a real action (e.g. a reboot that never fired).
          throw new Error(`Command '${command}' is not mapped to a MikroTik handler`);
      }
      status = 'success';
    } catch (err) {
      status = 'failure';
      errorMessage = err.message;
      logger.error({ configId, command, err }, 'MikroTik command dispatch failed');
    }
  } else {
    // Non-MikroTik vendor: driver not implemented — record as not_dispatched and surface clearly
    status = 'not_dispatched';
    errorMessage = `Vendor '${config.vendor}' driver is not implemented — command '${command}' was NOT sent to the device`;
    response = { dispatched: false, reason: `${config.vendor} driver not implemented` };
    logger.warn({ configId, vendor: config.vendor, command }, 'Non-MikroTik command not dispatched: driver not implemented');
  }

  const duration = Date.now() - start;
  const [execResult] = await db.query(
    `INSERT INTO device_command_executions
       (organization_id, driver_config_id, device_id, vendor, command, params,
        status, response, error_message, duration_ms, executed_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [organizationId, configId, config.device_id, config.vendor, command,
      JSON.stringify(params), status, response ? JSON.stringify(response) : null,
      errorMessage, duration, executedBy || null],
  );

  return {
    execution_id: execResult.insertId,
    vendor: config.vendor,
    command,
    status,
    response,
    error_message: errorMessage,
    duration_ms: duration,
  };
}

/**
 * Strip encrypted fields from config before returning to API.
 */
function sanitizeConfig(config) {
  if (!config) return null;
  const { encrypted_password, api_token, ...rest } = config;
  return { ...rest, has_password: Boolean(encrypted_password), has_api_token: Boolean(api_token) };
}

module.exports = {
  createDriverConfig,
  updateDriverConfig,
  testDriverConnection,
  dispatchCommand,
  sanitizeConfig,
};
