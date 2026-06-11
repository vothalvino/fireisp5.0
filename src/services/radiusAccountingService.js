// =============================================================================
// FireISP 5.0 — RADIUS Accounting Service
// =============================================================================
// Ingests FreeRADIUS accounting records (Start/Stop/Interim-Update) delivered
// via the FreeRADIUS rest module POST, persists them to connection_logs, and
// provides CDR export and retention purge utilities.
// =============================================================================

const db = require('../config/database');
const logger = require('../utils/logger').child({ service: 'radiusAccounting' });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Combine an octet counter with its Gigawords extension.
 * Gigawords wraps at 2^32 (4,294,967,296). JavaScript Number is safe up to 2^53,
 * so we use plain Number arithmetic for compatibility with mysql2 row values.
 *
 * @param {number|null} octets
 * @param {number|null} gigawords
 * @returns {number}
 */
function combineOctetsGigawords(octets, gigawords) {
  const o = octets || 0;
  const g = gigawords || 0;
  return o + g * 4294967296;
}

// ---------------------------------------------------------------------------
// Ingest
// ---------------------------------------------------------------------------

/**
 * Ingest a RADIUS accounting record (Start/Stop/Interim-Update).
 *
 * Called by the FreeRADIUS rest module POST handler. Handles:
 *  - RADIUS account lookup (username → contract_id / client_id / nas_id)
 *  - MAC move detection on Start events
 *  - Upsert into connection_logs (partitioned on event_at)
 *
 * @param {object} attrs - Normalised RADIUS accounting attributes
 * @param {string}      attrs.acctStatusType       - 'Start' | 'Stop' | 'Interim-Update'
 * @param {string}      attrs.userName              - RADIUS username
 * @param {string}      attrs.acctSessionId         - Acct-Session-Id (FreeRADIUS)
 * @param {string}      attrs.nasIpAddress          - NAS IP
 * @param {string|null} attrs.nasPortId
 * @param {string|null} attrs.calledStationId
 * @param {string|null} attrs.callingStationId      - MAC address of CPE
 * @param {string|null} attrs.framedIpAddress
 * @param {string|null} attrs.framedIpv6Prefix
 * @param {number|null} attrs.acctInputOctets
 * @param {number|null} attrs.acctOutputOctets
 * @param {number|null} attrs.acctInputGigawords
 * @param {number|null} attrs.acctOutputGigawords
 * @param {number|null} attrs.acctSessionTime       - seconds
 * @param {string|null} attrs.acctTerminateCause
 * @param {number}      attrs.organizationId        - from the ingest caller
 * @returns {Promise<{action: 'insert'|'update'|'noop', id: number|null, macMove: boolean}>}
 */
async function ingestAccounting(attrs) {
  const {
    acctStatusType,
    userName,
    acctSessionId,
    nasIpAddress,
    nasPortId = null,
    calledStationId = null,
    callingStationId = null,
    framedIpAddress = null,
    framedIpv6Prefix = null,
    acctInputOctets = null,
    acctOutputOctets = null,
    acctInputGigawords = null,
    acctOutputGigawords = null,
    acctSessionTime = null,
    acctTerminateCause = null,
    organizationId,
  } = attrs;

  logger.info(
    { userName, acctSessionId, acctStatusType, nasIpAddress },
    'Ingesting RADIUS accounting record',
  );

  // ------------------------------------------------------------------
  // 1. Look up RADIUS account + resolve NAS
  // ------------------------------------------------------------------
  const [radiusRows] = await db.query(
    `SELECT r.id AS radius_id, r.contract_id, r.client_id,
            n.id AS resolved_nas_id
     FROM radius r
     LEFT JOIN nas n ON n.ip_address = ?
     WHERE r.username = ?
     LIMIT 1`,
    [nasIpAddress, userName],
  );

  const acct = radiusRows.length > 0 ? radiusRows[0] : null;
  // connection_logs requires NOT NULL for contract_id and client_id.
  // Use 0 as a sentinel value when the RADIUS username is unknown — this
  // preserves the accounting record even if the subscriber can't be resolved.
  const contractId = acct ? acct.contract_id : 0;
  const clientId = acct ? acct.client_id : 0;
  const resolvedNasId = acct ? acct.resolved_nas_id : null;

  // ------------------------------------------------------------------
  // 2. Compute byte totals (handle 32-bit Gigawords wraparound)
  // ------------------------------------------------------------------
  const bytesIn = combineOctetsGigawords(acctInputOctets, acctInputGigawords);
  const bytesOut = combineOctetsGigawords(acctOutputOctets, acctOutputGigawords);

  // ------------------------------------------------------------------
  // 3. Determine event_type
  // ------------------------------------------------------------------
  const statusTypeMap = {
    'Start': 'start',
    'Stop': 'stop',
    'Interim-Update': 'interim-update',
  };
  const eventType = statusTypeMap[acctStatusType] || acctStatusType.toLowerCase();

  // ------------------------------------------------------------------
  // 4a. Start: check for MAC move, then insert
  // ------------------------------------------------------------------
  let macMove = false;

  if (eventType === 'start') {
    // Detect an open session for the same username with a different session-id
    // (which implies the subscriber reconnected from a potentially different device/NAS).
    const [openRows] = await db.query(
      `SELECT id, calling_station_id, nas_id, acct_session_id, event_at
       FROM connection_logs
       WHERE username = ?
         AND event_type IN ('start', 'interim-update')
         AND (acct_session_id IS NULL OR acct_session_id != ?)
       ORDER BY event_at DESC
       LIMIT 1`,
      [userName, acctSessionId],
    );

    if (openRows.length > 0) {
      const open = openRows[0];
      const macChanged = callingStationId !== null &&
        open.calling_station_id !== null &&
        open.calling_station_id !== callingStationId;
      const nasChanged = resolvedNasId !== null &&
        open.nas_id !== null &&
        open.nas_id !== resolvedNasId;

      if (macChanged || nasChanged) {
        macMove = true;
        logger.info(
          {
            userName,
            oldSessionId: open.acct_session_id,
            newSessionId: acctSessionId,
            oldMac: open.calling_station_id,
            newMac: callingStationId,
          },
          'MAC move detected — synthesising stop for stale session',
        );

        // Synthesise a stop for the stale session by copying the existing row
        // and changing only event_type + terminate_cause.
        await db.query(
          `INSERT INTO connection_logs
             (username, contract_id, client_id, nas_id, nas_ip_address,
              acct_session_id, session_id,
              nas_port_id, called_station_id, calling_station_id,
              framed_ip, framed_ipv6_prefix,
              event_type, event_at,
              bytes_in, bytes_out, session_duration, terminate_cause)
           SELECT username, contract_id, client_id, nas_id, nas_ip_address,
                  acct_session_id, session_id,
                  nas_port_id, called_station_id, calling_station_id,
                  framed_ip, framed_ipv6_prefix,
                  'stop', NOW(),
                  bytes_in, bytes_out, session_duration, 'Session-Moved'
           FROM connection_logs
           WHERE id = ?`,
          [open.id],
        );

        // Record the MAC move event (mac_move_events has old_mac/new_mac columns)
        await db.query(
          `INSERT INTO mac_move_events
             (organization_id, username, old_mac, new_mac, old_nas_id, new_nas_id, detected_at)
           VALUES (?, ?, ?, ?, ?, ?, NOW())`,
          [
            organizationId || null,
            userName,
            open.calling_station_id,
            callingStationId,
            open.nas_id,
            resolvedNasId,
          ],
        );
      }
    }

    // Insert the new Start row
    const [insertResult] = await db.query(
      `INSERT INTO connection_logs
         (username, contract_id, client_id, nas_id, nas_ip_address,
          acct_session_id, session_id,
          nas_port_id, called_station_id, calling_station_id,
          framed_ip, framed_ipv6_prefix,
          event_type, event_at,
          bytes_in, bytes_out, session_duration, terminate_cause)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'start', NOW(), ?, ?, ?, ?)`,
      [
        userName,
        contractId,
        clientId,
        resolvedNasId,
        nasIpAddress,
        acctSessionId,
        acctSessionId,  // session_id mirrors acct_session_id for backward compat
        nasPortId,
        calledStationId,
        callingStationId,
        framedIpAddress,
        framedIpv6Prefix,
        bytesIn,
        bytesOut,
        acctSessionTime,
        acctTerminateCause,
      ],
    );

    logger.info({ id: insertResult.insertId, userName, acctSessionId }, 'Start row inserted into connection_logs');
    return { action: 'insert', id: insertResult.insertId, macMove };
  }

  // ------------------------------------------------------------------
  // 4b. Interim-Update / Stop: update the open row, or insert if missing
  // ------------------------------------------------------------------
  // Note: ORDER BY on a partitioned table without event_at in WHERE requires
  // a full scan of all partitions. For correctness we accept this; production
  // deployments can add an application-level session cache if needed.
  const [updateResult] = await db.query(
    `UPDATE connection_logs
     SET event_type         = ?,
         bytes_in           = ?,
         bytes_out          = ?,
         session_duration   = ?,
         terminate_cause    = ?,
         framed_ip          = COALESCE(?, framed_ip),
         framed_ipv6_prefix = COALESCE(?, framed_ipv6_prefix)
     WHERE username = ?
       AND acct_session_id = ?
       AND event_type != 'stop'
     ORDER BY event_at DESC
     LIMIT 1`,
    [
      eventType,
      bytesIn,
      bytesOut,
      acctSessionTime,
      acctTerminateCause,
      framedIpAddress,
      framedIpv6Prefix,
      userName,
      acctSessionId,
    ],
  );

  if (updateResult.affectedRows > 0) {
    logger.info({ userName, acctSessionId, eventType }, 'connection_logs row updated');
    return { action: 'update', id: null, macMove: false };
  }

  // Late / missed Start — insert the record anyway so accounting is complete.
  logger.info({ userName, acctSessionId, eventType }, 'No open session found — inserting late accounting row');
  const [lateInsert] = await db.query(
    `INSERT INTO connection_logs
       (username, contract_id, client_id, nas_id, nas_ip_address,
        acct_session_id, session_id,
        nas_port_id, called_station_id, calling_station_id,
        framed_ip, framed_ipv6_prefix,
        event_type, event_at,
        bytes_in, bytes_out, session_duration, terminate_cause)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?, ?, ?)`,
    [
      userName,
      contractId,
      clientId,
      resolvedNasId,
      nasIpAddress,
      acctSessionId,
      acctSessionId,
      nasPortId,
      calledStationId,
      callingStationId,
      framedIpAddress,
      framedIpv6Prefix,
      eventType,
      bytesIn,
      bytesOut,
      acctSessionTime,
      acctTerminateCause,
    ],
  );

  return { action: 'insert', id: lateInsert.insertId, macMove: false };
}

// ---------------------------------------------------------------------------
// CDR Export
// ---------------------------------------------------------------------------

/**
 * Export CDRs from connection_logs.
 *
 * @param {object} opts
 * @param {string}           opts.from          - ISO date string (inclusive)
 * @param {string}           opts.to            - ISO date string (inclusive)
 * @param {string}           [opts.username]    - filter by RADIUS username
 * @param {'csv'|'json'}     [opts.format='json']
 * @param {number}           opts.organizationId
 * @returns {Promise<{format: string, rows?: object[], csv?: string}>}
 */
async function exportCdr(opts) {
  const {
    from,
    to,
    username = null,
    format = 'json',
    organizationId,
  } = opts;

  // organizationId filters via the nas_id→nas→organization_id join since
  // connection_logs itself does not have an organization_id column.
  // Fall back to username-only filter when organizationId is null (single-tenant).
  const conditions = ['cl.event_at >= ?', 'cl.event_at < DATE_ADD(?, INTERVAL 1 DAY)'];
  const params = [from, to];

  if (organizationId) {
    conditions.push('(r.organization_id = ? OR n.organization_id = ?)');
    params.push(organizationId, organizationId);
  }

  if (username) {
    conditions.push('cl.username = ?');
    params.push(username);
  }

  const [rows] = await db.query(
    `SELECT cl.session_id, cl.acct_session_id, cl.username, cl.event_type, cl.event_at,
            cl.session_duration, cl.bytes_in, cl.bytes_out,
            cl.nas_ip_address, cl.nas_port_id, cl.called_station_id, cl.calling_station_id,
            cl.framed_ip, cl.framed_ipv6_prefix, cl.terminate_cause
     FROM connection_logs cl
     LEFT JOIN radius r ON r.username = cl.username
     LEFT JOIN nas n ON n.ip_address = cl.nas_ip_address
     WHERE ${conditions.join(' AND ')}
     ORDER BY cl.event_at ASC
     LIMIT 50000`,
    params,
  );

  if (format === 'csv') {
    const COLUMNS = [
      'session_id', 'acct_session_id', 'username', 'event_type', 'event_at',
      'session_duration', 'bytes_in', 'bytes_out',
      'nas_ip_address', 'nas_port_id', 'called_station_id', 'calling_station_id',
      'framed_ip', 'framed_ipv6_prefix', 'terminate_cause',
    ];
    const header = COLUMNS.join(',');
    const lines = rows.map((row) =>
      COLUMNS.map((col) => {
        const val = row[col];
        if (val === null || val === undefined) return '';
        const str = String(val);
        // RFC 4180: quote fields that contain commas, double-quotes, or newlines.
        if (str.includes(',') || str.includes('"') || str.includes('\n')) {
          return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
      }).join(','),
    );
    return { format: 'csv', csv: [header, ...lines].join('\n') };
  }

  return { format: 'json', rows };
}

// ---------------------------------------------------------------------------
// Retention purge
// ---------------------------------------------------------------------------

/**
 * Purge old connection_logs rows beyond the configured retention window.
 *
 * Reads RADIUS_ACCOUNTING_RETENTION_MONTHS (default: 12). Deletes in batches
 * of 1000 rows to avoid long-running transactions and excessive lock contention.
 *
 * NOTE: For large deployments, manually dropping old monthly partitions via
 *   ALTER TABLE connection_logs DROP PARTITION p2024_01;
 * is orders of magnitude faster than row-level DELETE and is the recommended
 * approach for production systems with millions of rows per month. This function
 * provides a safe fallback for smaller deployments or non-partitioned schemas.
 *
 * @returns {Promise<{deleted: number}>}
 */
async function purgeRadiusAccounting() {
  const retentionMonths = parseInt(
    process.env.RADIUS_ACCOUNTING_RETENTION_MONTHS || '12',
    10,
  );

  logger.info({ retentionMonths }, 'Starting RADIUS accounting retention purge');

  const batchSize = 1000;
  let totalDeleted = 0;

  while (true) {
    const [result] = await db.query(
      `DELETE FROM connection_logs
       WHERE event_at < DATE_SUB(NOW(), INTERVAL ? MONTH)
       LIMIT ?`,
      [retentionMonths, batchSize],
    );

    totalDeleted += result.affectedRows;

    if (result.affectedRows < batchSize) {
      break;
    }
  }

  logger.info({ deleted: totalDeleted }, 'RADIUS accounting retention purge completed');
  return { deleted: totalDeleted };
}

// ---------------------------------------------------------------------------
// MAC move event listing
// ---------------------------------------------------------------------------

/**
 * List MAC move events for an organisation, newest first.
 *
 * @param {number} organizationId
 * @param {object} [opts]
 * @param {number} [opts.page=1]
 * @param {number} [opts.limit=25]
 * @returns {Promise<{rows: object[], total: number, page: number, limit: number}>}
 */
async function listMacMoveEvents(organizationId, { page = 1, limit = 25 } = {}) {
  const offset = (page - 1) * limit;

  const [[{ total }]] = await db.query(
    'SELECT COUNT(*) AS total FROM mac_move_events WHERE organization_id = ?',
    [organizationId],
  );

  const [rows] = await db.query(
    `SELECT id, organization_id, username,
            old_mac, new_mac,
            old_nas_id, new_nas_id,
            detected_at
     FROM mac_move_events
     WHERE organization_id = ?
     ORDER BY detected_at DESC
     LIMIT ? OFFSET ?`,
    [organizationId, limit, offset],
  );

  return { rows, total, page, limit };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  ingestAccounting,
  exportCdr,
  purgeRadiusAccounting,
  listMacMoveEvents,
  combineOctetsGigawords,
};
