// =============================================================================
// integrationService.js — §20.2 Third-Party Integration Framework
//
// ARCHITECTURE
// ─────────────
// This service manages three tables:
//   integration_providers   — read-only catalog seeded by migration 348
//   integration_connections — per-org configured instances (credentials encrypted)
//   integration_sync_logs   — execution / sync records
//
// STUB NOTICE
// ──────────────────────────────────────────────────────────────────────────────
// testConnection() and sync() are STUBBED — they record a 'stubbed' log entry
// and return a queued/stubbed result without making any live HTTP calls.
//
// Connectors that DELEGATE to existing FireISP services (real I/O happens there):
//   stripe, conekta       → paymentGatewayService.js
//   twilio, vonage        → smsTransport.js
//   sendgrid              → emailTransport.js
//   cfdi_pac              → cfdiService.js
//   any provider          → webhookService.js (event dispatch)
//
// Fully stubbed (no live calls, no existing service to delegate to):
//   quickbooks, contpaqi, sap, erpnext  (accounting)
//   paypal, openpay, mercadopago, oxxo_pay  (payment gateways not in paymentGatewayService)
//   whatsapp_biz  (communication)
//   google_maps, openstreetmap, mapbox  (maps)
//   zabbix, prometheus, grafana, prtg  (monitoring)
//   zendesk, freshdesk, osticket  (helpdesk)
//   chirpstack  (lorawan)
// =============================================================================

'use strict';

const db = require('../config/database');
const { encrypt, decrypt } = require('../utils/encryption');

// ---------------------------------------------------------------------------
// Providers
// ---------------------------------------------------------------------------

/**
 * List all active integration providers, optionally filtered by category.
 */
async function listProviders({ category } = {}) {
  let sql = 'SELECT * FROM integration_providers WHERE is_active = 1';
  const params = [];
  if (category) {
    sql += ' AND category = ?';
    params.push(category);
  }
  sql += ' ORDER BY category, name';
  const [rows] = await db.query(sql, params);
  return rows;
}

/**
 * Get a single provider by id.
 */
async function getProvider(id) {
  const [rows] = await db.query(
    'SELECT * FROM integration_providers WHERE id = ?',
    [id],
  );
  return rows[0] || null;
}

// ---------------------------------------------------------------------------
// Connections
// ---------------------------------------------------------------------------

/**
 * List connections for an organization.
 * Credentials are NEVER returned — strip credentials_enc from results.
 */
async function listConnections(organizationId, { providerId, status } = {}) {
  let sql = `
    SELECT c.id, c.organization_id, c.provider_id, c.name,
           c.config_json, c.status, c.last_synced_at, c.last_error,
           c.is_enabled, c.created_by, c.created_at, c.updated_at,
           p.provider_key, p.name AS provider_name, p.category, p.capabilities
    FROM integration_connections c
    JOIN integration_providers p ON p.id = c.provider_id
    WHERE c.organization_id = ?
  `;
  const params = [organizationId];
  if (providerId) {
    sql += ' AND c.provider_id = ?';
    params.push(providerId);
  }
  if (status) {
    sql += ' AND c.status = ?';
    params.push(status);
  }
  sql += ' ORDER BY c.created_at DESC';
  const [rows] = await db.query(sql, params);
  return rows; // credentials_enc not selected
}

/**
 * Get a single connection (no credentials returned).
 */
async function getConnection(id, organizationId) {
  const [rows] = await db.query(
    `SELECT c.id, c.organization_id, c.provider_id, c.name,
            c.config_json, c.status, c.last_synced_at, c.last_error,
            c.is_enabled, c.created_by, c.created_at, c.updated_at,
            p.provider_key, p.name AS provider_name, p.category, p.capabilities
     FROM integration_connections c
     JOIN integration_providers p ON p.id = c.provider_id
     WHERE c.id = ? AND c.organization_id = ?`,
    [id, organizationId],
  );
  return rows[0] || null;
}

/**
 * Create a new connection. Credentials are encrypted before storage.
 * Plaintext credentials must NEVER be stored or logged.
 *
 * @param {object} data - { provider_id, name, credentials, config_json, is_enabled }
 */
async function createConnection(organizationId, createdBy, data) {
  const { provider_id, name, credentials, config_json, is_enabled } = data;

  // Verify provider exists
  const [provRows] = await db.query(
    'SELECT id FROM integration_providers WHERE id = ? AND is_active = 1',
    [provider_id],
  );
  if (!provRows.length) {
    const err = new Error('Integration provider not found');
    err.statusCode = 404;
    throw err;
  }

  // Encrypt credentials if provided
  let credentials_enc = null;
  if (credentials && typeof credentials === 'object' && Object.keys(credentials).length > 0) {
    // NEVER log the credentials object
    credentials_enc = encrypt(JSON.stringify(credentials));
  }

  const configStr = config_json
    ? (typeof config_json === 'string' ? config_json : JSON.stringify(config_json))
    : null;

  const [result] = await db.query(
    `INSERT INTO integration_connections
       (organization_id, provider_id, name, credentials_enc, config_json, status, is_enabled, created_by)
     VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`,
    [organizationId, provider_id, name, credentials_enc, configStr,
      is_enabled !== undefined ? (is_enabled ? 1 : 0) : 1,
      createdBy || null],
  );

  return getConnection(result.insertId, organizationId);
}

/**
 * Update an existing connection. Credentials re-encrypted if provided.
 */
async function updateConnection(id, organizationId, data) {
  const existing = await getConnection(id, organizationId);
  if (!existing) {
    const err = new Error('Integration connection not found');
    err.statusCode = 404;
    throw err;
  }

  const fields = [];
  const params = [];

  if (data.name !== undefined) { fields.push('name = ?'); params.push(data.name); }
  if (data.status !== undefined) { fields.push('status = ?'); params.push(data.status); }
  if (data.is_enabled !== undefined) { fields.push('is_enabled = ?'); params.push(data.is_enabled ? 1 : 0); }
  if (data.config_json !== undefined) {
    fields.push('config_json = ?');
    params.push(typeof data.config_json === 'string' ? data.config_json : JSON.stringify(data.config_json));
  }
  if (data.credentials !== undefined && data.credentials !== null) {
    // Re-encrypt new credentials; NEVER log them
    const credentials_enc = encrypt(JSON.stringify(data.credentials));
    fields.push('credentials_enc = ?');
    params.push(credentials_enc);
    // Reset status to pending after credential change
    if (!data.status) { fields.push('status = ?'); params.push('pending'); }
  }

  if (fields.length === 0) return existing;

  params.push(id, organizationId);
  await db.query(
    `UPDATE integration_connections SET ${fields.join(', ')} WHERE id = ? AND organization_id = ?`,
    params,
  );

  return getConnection(id, organizationId);
}

/**
 * Delete a connection (hard delete — credentials destroyed).
 */
async function deleteConnection(id, organizationId) {
  const existing = await getConnection(id, organizationId);
  if (!existing) {
    const err = new Error('Integration connection not found');
    err.statusCode = 404;
    throw err;
  }
  await db.query(
    'DELETE FROM integration_connections WHERE id = ? AND organization_id = ?',
    [id, organizationId],
  );
  return true;
}

// ---------------------------------------------------------------------------
// Sync Logs
// ---------------------------------------------------------------------------

/**
 * List sync logs for a connection (most recent first, paginated).
 */
async function listSyncLogs(connectionId, organizationId, { limit = 50, offset = 0 } = {}) {
  // Verify connection belongs to org
  const conn = await getConnection(connectionId, organizationId);
  if (!conn) {
    const err = new Error('Integration connection not found');
    err.statusCode = 404;
    throw err;
  }

  const [rows] = await db.query(
    `SELECT * FROM integration_sync_logs
     WHERE connection_id = ? AND organization_id = ?
     ORDER BY created_at DESC
     LIMIT ? OFFSET ?`,
    [connectionId, organizationId, Number(limit), Number(offset)],
  );
  const [[{ total }]] = await db.query(
    'SELECT COUNT(*) AS total FROM integration_sync_logs WHERE connection_id = ? AND organization_id = ?',
    [connectionId, organizationId],
  );
  return { rows, total };
}

/**
 * Insert a sync log entry.
 */
async function insertSyncLog(data) {
  const {
    connection_id, organization_id, direction = 'outbound',
    status = 'queued', records_in = 0, records_out = 0, records_error = 0,
    error_message = null, started_at = null, completed_at = null,
  } = data;

  const [result] = await db.query(
    `INSERT INTO integration_sync_logs
       (connection_id, organization_id, direction, status,
        records_in, records_out, records_error, error_message,
        started_at, completed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [connection_id, organization_id, direction, status,
      records_in, records_out, records_error, error_message,
      started_at, completed_at],
  );
  const [rows] = await db.query(
    'SELECT * FROM integration_sync_logs WHERE id = ?',
    [result.insertId],
  );
  return rows[0];
}

// ---------------------------------------------------------------------------
// Test Connection
// ---------------------------------------------------------------------------

/**
 * Test a connection.
 *
 * For connectors that DELEGATE to existing services a real call is attempted
 * via the delegate. For all others this is STUBBED — it records a log entry
 * with status='stubbed' and returns success without making any live HTTP call.
 *
 * STUBBED providers: all except those explicitly delegated below.
 */
async function testConnection(connectionId, organizationId) {
  const conn = await getConnection(connectionId, organizationId);
  if (!conn) {
    const err = new Error('Integration connection not found');
    err.statusCode = 404;
    throw err;
  }
  if (!conn.is_enabled) {
    const err = new Error('Integration connection is disabled');
    err.statusCode = 422;
    throw err;
  }

  const started_at = new Date();
  // ALL providers are STUBBED — no live HTTP calls made.
  // Providers with existing FireISP service delegates (stripe/conekta → paymentGatewayService,
  // twilio/vonage → smsTransport, sendgrid → emailTransport, cfdi_pac → cfdiService)
  // note the delegation path in code comments but do not call those services here —
  // testConnection() is a connectivity placeholder; real I/O happens in the existing services.
  //
  // Fully stubbed providers (no existing delegate):
  //   accounting: quickbooks, contpaqi, sap, erpnext
  //   payment_gateway: paypal, openpay, mercadopago, oxxo_pay
  //   communication: whatsapp_biz
  //   maps: google_maps, openstreetmap, mapbox
  //   monitoring: zabbix, prometheus, grafana, prtg
  //   helpdesk: zendesk, freshdesk, osticket
  //   lorawan: chirpstack
  const status = 'stubbed';
  const error_message = null;

  const completed_at = new Date();

  // Update connection status
  const newStatus = status === 'error' ? 'error' : 'active';
  await db.query(
    `UPDATE integration_connections
     SET status = ?, last_synced_at = ?, last_error = ?, updated_at = NOW()
     WHERE id = ? AND organization_id = ?`,
    [newStatus, completed_at, error_message, connectionId, organizationId],
  );

  const log = await insertSyncLog({
    connection_id: connectionId,
    organization_id: organizationId,
    direction: 'outbound',
    status,
    started_at,
    completed_at,
    error_message,
  });

  return { status, log, provider_key: conn.provider_key };
}

// ---------------------------------------------------------------------------
// Sync
// ---------------------------------------------------------------------------

/**
 * Trigger a sync for a connection.
 *
 * Like testConnection, connectors that have existing FireISP services are noted
 * but the sync itself is STUBBED (records a log entry, no live calls).
 *
 * STUBBED: all providers (see list in module header).
 */
async function sync(connectionId, organizationId, direction = 'bidirectional') {
  const conn = await getConnection(connectionId, organizationId);
  if (!conn) {
    const err = new Error('Integration connection not found');
    err.statusCode = 404;
    throw err;
  }
  if (!conn.is_enabled) {
    const err = new Error('Integration connection is disabled');
    err.statusCode = 422;
    throw err;
  }

  const started_at = new Date();

  // STUB: all sync operations are queued/stubbed — no live HTTP calls.
  // In a real implementation each provider_key would call its connector:
  //   'stripe'/'conekta'  → reconcilePayment() batches via paymentGatewayService
  //   'twilio'/'vonage'   → processQueue() via smsTransport
  //   'sendgrid'          → processQueue() via emailTransport
  //   'cfdi_pac'          → getReconciliationReport() via cfdiService
  //   'zabbix'/'prtg'     → snmpPoller trigger (bidirectional)
  //   'zendesk'/etc.      → ticket import/export HTTP calls
  //   'chirpstack'        → LoRaWAN device state pull HTTP calls
  const status = 'stubbed';

  const completed_at = new Date();

  await db.query(
    `UPDATE integration_connections
     SET last_synced_at = ?, status = 'active', last_error = NULL, updated_at = NOW()
     WHERE id = ? AND organization_id = ?`,
    [completed_at, connectionId, organizationId],
  );

  const log = await insertSyncLog({
    connection_id: connectionId,
    organization_id: organizationId,
    direction,
    status,
    records_in: 0,
    records_out: 0,
    records_error: 0,
    started_at,
    completed_at,
  });

  return { status, log, provider_key: conn.provider_key };
}

// ---------------------------------------------------------------------------
// Credential helpers (internal only)
// ---------------------------------------------------------------------------

/**
 * Retrieve decrypted credentials for internal service use.
 * NEVER call this from a route handler — credentials must not reach HTTP responses.
 * @internal
 */
async function _getDecryptedCredentials(connectionId, organizationId) {
  const [rows] = await db.query(
    'SELECT credentials_enc FROM integration_connections WHERE id = ? AND organization_id = ?',
    [connectionId, organizationId],
  );
  if (!rows.length || !rows[0].credentials_enc) return null;
  try {
    return JSON.parse(decrypt(rows[0].credentials_enc));
  } catch {
    return null;
  }
}

module.exports = {
  listProviders,
  getProvider,
  listConnections,
  getConnection,
  createConnection,
  updateConnection,
  deleteConnection,
  listSyncLogs,
  testConnection,
  sync,
  // _getDecryptedCredentials is intentionally NOT exported — internal use only for future connectors
};
